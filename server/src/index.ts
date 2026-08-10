import { serve } from '@hono/node-server';
import { createNodeWebSocket } from '@hono/node-ws';
import { Hono } from 'hono';
import mongoose from 'mongoose';
import { buildApp } from './app';
import { buildAuth } from './auth';
import { config } from './config';
import {
  captureError,
  flushTelemetry,
  startRuntimeMetrics,
  telemetryEnabled,
  trackEvent,
} from './lib/telemetry';
import type { AppEnv } from './middleware/session';
import { ensureTombstoneTtl, tombstoneGauges } from './models/deletion';
import { ensurePluginRecordIndexes, pluginRecordGauges } from './models/pluginRecord';
import { liveSyncGauges } from './services/liveSync';

async function main() {
  /* Registered before connect(), so the first transition is caught too.
     Every request in this app ends at Mongo, so a dropped connection is a total outage — and one
     that heals itself, which is exactly the kind that gets reported as "it was broken earlier" and
     never reproduced. `disconnected` and `reconnected` as a pair give the outage a duration. */
  mongoose.connection.on('disconnected', () => trackEvent('mongo_disconnected'));
  mongoose.connection.on('reconnected', () => trackEvent('mongo_reconnected'));
  mongoose.connection.on('error', (err) => captureError(err, { scope: 'mongo' }));

  await mongoose.connect(config.mongodbUri);
  /* Reported and stepped over rather than awaited into a crash. Without the index tombstones only
     accumulate — every pull stays correct, since the retention window is enforced by the cursor
     check and not by whether the rows are actually gone. An index tweak failing is not a reason to
     leave someone unable to open their diary. */
  await ensureTombstoneTtl().catch((err) => captureError(err, { scope: 'tombstoneTtl' }));
  /* Same tolerance, for the same reason: without these indexes plugin sync still answers correctly,
     it just scans instead of seeking. A slow delta is not a reason to refuse to start. */
  await ensurePluginRecordIndexes().catch((err) =>
    captureError(err, { scope: 'pluginRecordIndexes' }),
  );
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

  trackEvent('server_started', { port: config.port, node: process.version });
  /* Heap, event-loop lag, the live-sync gauges and the tombstone gauges, once a minute. Per
     container, not per user. Composed here rather than inside the metrics module so neither gauge
     source has to know the other exists — and so lib/telemetry.ts keeps importing no model and no
     service, which is what stops it from being part of an import cycle with the things it reports
     on (liveSync already imports it). */
  startRuntimeMetrics(async () => ({
    ...liveSyncGauges(),
    ...(await tombstoneGauges()),
    ...(await pluginRecordGauges()),
  }));

  // A crash or a container stop shouldn't take buffered telemetry with it.
  process.on('uncaughtException', (err) => captureError(err, { scope: 'uncaughtException' }));
  process.on('unhandledRejection', (reason) =>
    captureError(reason, { scope: 'unhandledRejection' }),
  );
  /* SIGINT as well as SIGTERM. The container runtime sends SIGTERM, but a developer stopping the
     server with Ctrl-C sends SIGINT — and the buffered events lost that way are the ones from the
     session someone was actively debugging. Shared handler so the two can never drift. */
  const shutdown = (signal: string) => () => {
    trackEvent('server_stopping', { signal, uptime_s: Math.round(process.uptime()) });
    void flushTelemetry().finally(() => process.exit(0));
  };
  process.on('SIGTERM', shutdown('SIGTERM'));
  process.on('SIGINT', shutdown('SIGINT'));
}

main().catch(async (err) => {
  captureError(err, { scope: 'startup' });
  await flushTelemetry();
  process.exit(1);
});
