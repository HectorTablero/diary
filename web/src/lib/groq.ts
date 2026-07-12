import { GROQ_API_BASE, GROQ_WHISPER_MODEL } from '@diary/shared';
import { ApiError } from './apiClient';

/* Talks to Groq directly with the user's own key — NOT through apiClient.ts, which
   targets our own API and attaches our app's auth headers. */

function filenameFor(mimeType: string): string {
  if (mimeType.includes('mp4')) return 'recording.mp4';
  return 'recording.webm';
}

export async function transcribeAudio(apiKey: string, blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', blob, filenameFor(blob.type));
  form.append('model', GROQ_WHISPER_MODEL);
  form.append('response_format', 'json');
  // No `language` param: lets Whisper auto-detect between the app's bilingual users.

  let res: Response;
  try {
    res = await fetch(`${GROQ_API_BASE}/audio/transcriptions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
      signal: AbortSignal.timeout(60_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') throw new ApiError(504, 'ai.timeout');
    throw new ApiError(0, 'errors.offline');
  }
  if (!res.ok) {
    if (res.status === 401 || res.status === 403) throw new ApiError(res.status, 'ai.invalid_key');
    if (res.status === 429) throw new ApiError(429, 'ai.rate_limited');
    throw new ApiError(res.status, 'ai.upstream_error');
  }
  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
