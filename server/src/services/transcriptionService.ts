import { GROQ_API_BASE, GROQ_WHISPER_FALLBACK_MODEL, GROQ_WHISPER_MODEL } from '@diary/shared';
import { badRequest, HttpError } from '../errors';
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

  let res = await callGroq(groqApiKey, audio, GROQ_WHISPER_MODEL);
  if (res.status === 429) {
    // Turbo is the more rate-limited variant; the base model has separate quota headroom on
    // Groq's free tier, so a single retry there often just works.
    res = await callGroq(groqApiKey, audio, GROQ_WHISPER_FALLBACK_MODEL);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new HttpError(res.status, 'ai.invalid_key');
    if (res.status === 429) throw new HttpError(429, 'ai.rate_limited');
    throw new HttpError(502, 'ai.upstream_error');
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
