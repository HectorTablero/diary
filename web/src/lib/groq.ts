import { GROQ_API_BASE, GROQ_WHISPER_FALLBACK_MODEL, GROQ_WHISPER_MODEL } from '@diary/shared';
import { ApiError } from './apiClient';

/* Talks to Groq directly with the user's own key — NOT through apiClient.ts, which
   targets our own API and attaches our app's auth headers. */

function filenameFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'recording.mp4';
  return 'recording.webm';
}

async function callTranscription(apiKey: string, blob: Blob, model: string): Promise<Response> {
  const form = new FormData();
  form.append('file', blob, filenameFor(blob.type));
  form.append('model', model);
  form.append('response_format', 'json');
  // No `language` param: lets Whisper auto-detect between the app's bilingual users.
  try {
    return await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new ApiError(504, 'ai.timeout');
    throw new ApiError(0, 'errors.offline');
  }
}

export async function transcribeAudio(apiKey: string, blob: Blob): Promise<string> {
  let res = await callTranscription(apiKey, blob, GROQ_WHISPER_MODEL);
  if (res.status === 429) {
    // Turbo is the more rate-limited variant; the base model has separate quota
    // headroom on Groq's free tier, so a single retry there often just works.
    res = await callTranscription(apiKey, blob, GROQ_WHISPER_FALLBACK_MODEL);
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new ApiError(res.status, 'ai.invalid_key');
    if (res.status === 429) throw new ApiError(429, 'ai.rate_limited');
    throw new ApiError(res.status, 'ai.upstream_error');
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
