import dotenv from 'dotenv';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env; both src/ (tsx) and dist/ (tsup bundle) sit two levels below it.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

/** The root package.json version is the single source of truth for the app version, and it is
    copied into the runtime image, so the server reads it rather than taking a build arg. */
const readAppVersion = (): string => {
  try {
    const path = fileURLToPath(new URL('../../package.json', import.meta.url));
    return JSON.parse(readFileSync(path, 'utf8')).version ?? 'dev';
  } catch {
    return 'dev';
  }
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/diary',
  googleClientId: required('GOOGLE_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
  betterAuthSecret: required('BETTER_AUTH_SECRET'),
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
  // Better Stack error + metrics reporting. Optional: with either unset, telemetry stays
  // console-only, so local development and self-hosters need no account.
  betterStackToken: process.env.BETTERSTACK_SOURCE_TOKEN,
  betterStackIngestUrl: process.env.BETTERSTACK_INGEST_URL,
  appVersion: readAppVersion(),
};
