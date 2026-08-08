import { API_BASE, ApiError, CLIENT_ID } from './apiClient';
import { getAuthToken } from './authToken';
import { trackEvent } from './telemetry';

/**
 * Send a recording to our own API and get its text back.
 *
 * This used to call Groq straight from the browser with the user's key, which is the only reason
 * that key ever had to be sent to the client. It goes through the server now, so the key stays in
 * the database — see server/src/services/transcriptionService.ts.
 *
 * Not `apiPost`: that sets `Content-Type: application/json` and stringifies its body. A multipart
 * upload has to let the browser set the header itself, boundary included.
 */
export async function transcribeAudio(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', blob, blob.type.includes('mp4') ? 'recording.mp4' : 'recording.webm');

  const headers: Record<string, string> = { 'X-Client-Id': CLIENT_ID };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  /* Every one of these is reported, with no sampling: a voice note is a deliberate act a handful
     of times a day at most, so the volume is negligible, and it is the only user-facing flow that
     spends the user's own provider quota and can fail for half a dozen distinct reasons they can
     do nothing about. The `bytes` and the total duration together are also the only way to tell a
     slow *upload* on a phone from a slow *Groq* — the server times its own upstream leg
     separately, and the difference between the two numbers is the network. */
  const startedAt = performance.now();
  const report = (outcome: string, code?: string) =>
    trackEvent('transcribe', {
      outcome,
      code,
      bytes: blob.size,
      mime: blob.type || undefined,
      duration_ms: Math.round(performance.now() - startedAt),
    });

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api/ai/transcribe`, {
      method: 'POST',
      headers,
      body: form,
      // Generous: this covers the upload *and* Groq's own turnaround, which the server caps at 60s.
      signal: AbortSignal.timeout(90_000),
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'TimeoutError') {
      report('timeout');
      throw new ApiError(504, 'ai.timeout');
    }
    report('offline');
    throw new ApiError(0, 'errors.offline');
  }

  if (!res.ok) {
    let code = 'ai.upstream_error';
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) code = body.error;
    } catch {
      // non-JSON error body
    }
    report(`http_${res.status}`, code);
    throw new ApiError(res.status, code);
  }

  const data = (await res.json()) as { text?: string };
  const text = (data.text ?? '').trim();
  /* An empty transcript is a 200 that failed. Whisper returns one for a recording that was all
     silence — a mic permission granted but muted, a button released too early — and the user just
     sees a suggestion dialog with nothing in it, so it must not be counted as a success. */
  report(text ? 'ok' : 'empty');
  return text;
}
