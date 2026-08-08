import { GROQ_API_BASE, GROQ_WHISPER_FALLBACK_MODEL, GROQ_WHISPER_MODEL } from '@diary/shared';
import { badRequest, HttpError } from '../errors';
import { trackEvent, userHash } from '../lib/telemetry';
import { getProviderKeys } from './settingsService';

/**
 * Speech-to-text, via the user's own Groq key.
 *
 * This used to happen in the browser, which was the only reason the Groq key had to be sent to
 * the client at all — and sending it meant every settings fetch shipped a live billable
 * credential into the page and into the IndexedDB mirror. Proxying the audio through here is what
 * lets the key stay in the database.
 *
 * The cost is one hop: the recording travels to us before it travels to Groq. That is bandwidth,
 * not compute — the body is streamed straight into the upstream request and never buffered to
 * disk — and a voice note is a few hundred kilobytes.
 */
async function callGroq(apiKey: string, audio: File, model: string): Promise<Response> {
  const form = new FormData();
  form.append('file', audio, audio.name || 'recording.webm');
  form.append('model', model);
  form.append('response_format', 'json');
  // No `language` param: lets Whisper auto-detect, same as the client used to.
  try {
    return await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      throw new HttpError(504, 'ai.timeout');
    }
    throw new HttpError(502, 'ai.upstream_error');
  }
}

export async function transcribe(userId: string, audio: File): Promise<string> {
  const { groqApiKey } = await getProviderKeys(userId);
  if (!groqApiKey) throw badRequest('ai.no_key');

  /* The upstream leg, timed separately from the request as a whole.
   *
   * The client already times the round trip (lib/transcribe.ts), and the difference between that
   * number and this one is the upload — which on a phone is most of it, and which is not something
   * anyone can fix by changing a model. Two timings on two sources, joined by client_id.
   *
   * The fallback matters more than the timing. `GROQ_WHISPER_MODEL` is the rate-limited turbo
   * variant and the retry against the base model is silent by design, so a key whose turbo quota
   * is exhausted every single time looks exactly like a healthy one from the outside — same 200,
   * same text, twice the latency and a quietly different transcription model. `fell_back` is what
   * makes that a number rather than a suspicion. */
  const startedAt = performance.now();
  let model = GROQ_WHISPER_MODEL;
  let fellBack = false;

  let res = await callGroq(groqApiKey, audio, model);
  if (res.status === 429) {
    // Turbo is the more rate-limited variant; the base model has separate quota headroom on
    // Groq's free tier, so a single retry there often just works.
    model = GROQ_WHISPER_FALLBACK_MODEL;
    fellBack = true;
    res = await callGroq(groqApiKey, audio, model);
  }

  trackEvent('ai_transcribe_upstream', {
    user: userHash(userId),
    model,
    fell_back: fellBack,
    status: res.status,
    bytes: audio.size,
    duration_ms: Math.round(performance.now() - startedAt),
  });

  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new HttpError(res.status, 'ai.invalid_key');
    if (res.status === 429) throw new HttpError(429, 'ai.rate_limited');
    throw new HttpError(502, 'ai.upstream_error');
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
