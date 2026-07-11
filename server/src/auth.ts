import { betterAuth } from 'better-auth';
import { mongodbAdapter } from 'better-auth/adapters/mongodb';
import type { Db } from 'mongodb';
import { config } from './config';

/** Must be constructed after mongoose has connected (the adapter needs a live Db). */
export const buildAuth = (db: Db) =>
  betterAuth({
    database: mongodbAdapter(db),
    baseURL: config.betterAuthUrl,
    secret: config.betterAuthSecret,
    trustedOrigins: [config.betterAuthUrl],
    socialProviders: {
      google: {
        clientId: config.googleClientId,
        clientSecret: config.googleClientSecret,
      },
    },
  });

export type Auth = ReturnType<typeof buildAuth>;
