import { createAuthClient } from 'better-auth/react';

// Same-origin in both dev (Vite proxy) and prod (server serves the SPA).
export const authClient = createAuthClient();

export const { useSession, signIn, signOut } = authClient;
