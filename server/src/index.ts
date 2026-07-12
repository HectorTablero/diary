import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import mongoose from 'mongoose';
import { buildApp } from './app';
import { buildAuth } from './auth';
import { config } from './config';
import type { AppEnv } from './middleware/session';

async function main() {
  await mongoose.connect(config.mongodbUri);
  const db = mongoose.connection.getClient().db();
  const auth = buildAuth(db);

  // The WebSocket helper needs the app instance before routes are registered.
  const app = new Hono<AppEnv>();
  const { injectWebSocket, upgradeWebSocket } = createNodeWebSocket({ app });
  buildApp(app, auth, upgradeWebSocket);

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Diary server listening on http://localhost:${info.port}`);
  });
  injectWebSocket(server);
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
