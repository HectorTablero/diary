import dotenv from 'dotenv';
import { fileURLToPath } from 'node:url';

// Load the repo-root .env; both src/ (tsx) and dist/ (tsup bundle) sit two levels below it.
dotenv.config({ path: fileURLToPath(new URL('../../.env', import.meta.url)) });

const required = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required env var: ${name}`);
  return value;
};

export const config = {
  port: Number(process.env.PORT ?? 3000),
  mongodbUri: process.env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/diary',
  googleClientId: required('GOOGLE_CLIENT_ID'),
  googleClientSecret: required('GOOGLE_CLIENT_SECRET'),
  betterAuthSecret: required('BETTER_AUTH_SECRET'),
  betterAuthUrl: process.env.BETTER_AUTH_URL ?? 'http://localhost:5173',
};
