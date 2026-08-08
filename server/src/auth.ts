import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { bearer } from 'better-auth/plugins';
import type { Db } from 'mongodb';
import { config } from './config';
import { captureError, trackEvent, userHash } from './lib/telemetry';

/* Sign-in is the one flow the request middleware cannot see the outcome of.
 *
 * `/api/auth/*` is served by a single catch-all handler (app.ts) that sits outside `requireAuth`,
 * so `requestTelemetry` records a POST and a status for it and nothing more — no user, because
 * `c.get('userId')` is only populated behind the guard, and no way to tell a successful sign-in
 * from a 200 that refreshed an existing session. These three hooks are how the outcome becomes
 * visible, and they are the only place the user id is available to hash.
 *
 * Native and web both arrive here. The Android app posts a Google idToken to
 * `/sign-in/social` and the browser is redirected through `/callback/google`, but both end at the
 * same handler and the same session insert — so this counts sign-ins without having to know or
 * care which platform produced one. */
const authTelemetry = {
  databaseHooks: {
    session: {
      create: {
        after: async (session: { userId: string }) => {
          trackEvent('auth_signin', { user: userHash(session.userId) });
        },
      },
    },
    user: {
      create: {
        after: async (user: { id: string }) => {
          /* A genuinely new account, which a session insert alone cannot distinguish from the
             hundredth login by the same person. It is also the only event in the system that says
             anything about growth. */
          trackEvent('auth_user_created', { user: userHash(user.id) });
        },
      },
    },
  },
  onAPIError: {
    /* Observing only — `throw` is left at its default, so this changes no response. Better Auth
       already renders its own error pages and JSON; what it does not do is tell anyone. A failure
       here means somebody could not get in, which is indistinguishable from disinterest in every
       other signal the server produces. */
    onError: (error: unknown) => captureError(error, { scope: 'auth' }),
  },
} as const;

/** Must be constructed after mongoose has connected (the adapter needs a live Db). */
export const buildAuth = (db: Db) =>
  betterAuth({
    database: mongodbAdapter(db),
    baseURL: config.betterAuthUrl,
    secret: config.betterAuthSecret,
    // The Capacitor webview runs on https://localhost (capacitor://localhost on iOS)
    // and authenticates with a bearer token instead of cookies.
    trustedOrigins: [config.betterAuthUrl, 'https://localhost', 'capacitor://localhost'],
    plugins: [bearer()],
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
    ...authTelemetry,
  });

export type Auth = ReturnType<typeof buildAuth>;
