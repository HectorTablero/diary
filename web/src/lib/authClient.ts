import { createAuthClient } from 'better-auth/react';
import { API_BASE } from './apiClient';
import { getAuthToken, setAuthToken } from './authToken';

// Same-origin on the web (Vite proxy in dev, server-served SPA in prod);
// the Capacitor app points at the prod server and authenticates with a
// bearer token (webview cookies are unreliable cross-origin).
export const authClient = createAuthClient({
  baseURL: API_BASE || undefined,
  fetchOptions: {
    auth: { type: 'Bearer', token: () => getAuthToken() ?? undefined },
    onSuccess: (ctx) => {
      const token = ctx.response.headers.get('set-auth-token');
      if (token) setAuthToken(token);
    },
  },
});

export const { useSession, signIn, signOut } = authClient;
