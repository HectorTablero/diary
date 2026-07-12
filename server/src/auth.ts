import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import { bearer } from 'better-auth/plugins';
import type { Db } from 'mongodb';
import { config } from './config';

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
  });

export type Auth = ReturnType<typeof buildAuth>;
