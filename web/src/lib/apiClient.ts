import { getAuthToken } from './authToken';

/** Empty for web builds (same-origin); the Capacitor build points at the prod server.
    Optional-chained so the module also loads outside Vite (node-based tests). */
export const API_BASE: string =
  (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_API_BASE ?? '';

/** Identifies this client session so live-sync can skip echoing our own changes back. */
export const CLIENT_ID: string = crypto.randomUUID();

export class ApiError extends Error {
  constructor(
    public status: number,
    /** i18n key, e.g. "errors.not_found" */
    public code: string,
  ) {
    super(code);
    this.name = 'ApiError';
  }
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Client-Id': CLIENT_ID,
  };
  const token = getAuthToken();
  if (token) headers.Authorization = `Bearer ${token}`;

  let res: Response;
  try {
    res = await fetch(`${API_BASE}/api${path}`, {
      ...init,
      headers: { ...headers, ...init?.headers },
    });
  } catch {
    throw new ApiError(0, 'errors.offline');
  }
  if (!res.ok) {
    let code = 'errors.unknown';
    try {
      const body = (await res.json()) as { error?: string };
      if (body.error) code = body.error;
    } catch {
      // non-JSON error body
    }
    throw new ApiError(res.status, code);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export const apiGet = <T>(path: string) => api<T>(path);
export const apiPost = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'POST', body: JSON.stringify(body) });
export const apiPatch = <T>(path: string, body: unknown) =>
  api<T>(path, { method: 'PATCH', body: JSON.stringify(body) });
export const apiPut = <T>(path: string, body?: unknown) =>
  api<T>(path, { method: 'PUT', body: body === undefined ? undefined : JSON.stringify(body) });
export const apiDelete = <T>(path: string) => api<T>(path, { method: 'DELETE' });
