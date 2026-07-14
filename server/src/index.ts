import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import mongoose from 'mongoose';
import { buildApp } from './app';
import { buildAuth } from './auth';
import { config } from './config';
import { captureError, flushTelemetry, telemetryEnabled, trackEvent } from './lib/telemetry';
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
    console.log(`Diary server v${config.appVersion} listening on http://localhost:${info.port}`);
    console.log(`Telemetry: ${telemetryEnabled ? 'Better Stack' : 'console only'}`);
  });
  injectWebSocket(server);

  trackEvent('server_started', { port: config.port });

  // A crash or a container stop shouldn't take buffered telemetry with it.
  process.on('uncaughtException', (err) => captureError(err, { scope: 'uncaughtException' }));
  process.on('unhandledRejection', (reason) => captureError(reason, { scope: 'unhandledRejection' }));
  process.on('SIGTERM', () => {
    void flushTelemetry().finally(() => process.exit(0));
  });
}

main().catch(async (err) => {
  captureError(err, { scope: 'startup' });
  await flushTelemetry();
  process.exit(1);
});
