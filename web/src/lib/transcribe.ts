import { API_BASE, ApiError, CLIENT_ID } from './apiClient';
import { getAuthToken } from './authToken';

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
      throw new ApiError(504, 'ai.timeout');
    }
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
    throw new ApiError(res.status, code);
  }

  const data = (await res.json()) as { text?: string };
  return (data.text ?? '').trim();
}
