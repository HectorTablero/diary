import { serve } from '@hono/node-server';
import mongoose from 'mongoose';
import { buildApp } from './app';
import { buildAuth } from './auth';
import { config } from './config';

async function main() {
  await mongoose.connect(config.mongodbUri);
  const db = mongoose.connection.getClient().db();
  const auth = buildAuth(db);
  const app = buildApp(auth);

  serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Diary server listening on http://localhost:${info.port}`);
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
