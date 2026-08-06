import { createAuthClient } from 'better-auth/react';
import { API_BASE } from './apiClient';
import { getAuthToken, setAuthToken } from './authToken';

// Same-origin on the web (Vite proxy in dev, server-served SPA in prod);
// the Capacitor app points at the prod server and authenticates with a
// bearer token (webview cookies are unreliable cross-origin).
//
// Both hooks below are therefore native-only in effect: getAuthToken() is null on the web, so no
// Authorization header is attached, and setAuthToken() ignores the write. That is load-bearing —
// see authToken.ts for what a bearer token does to a perfectly good session cookie.
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
