import { afterEach, describe, expect, it } from 'vitest';

/*
 * These pin down *when* a missing credential is noticed, which is the whole point of the getters.
 *
 * Importing a module must never be what demands a secret — errors.ts reaches config through
 * telemetry, so if evaluating this file threw, most of the server became untestable and CI would
 * need real Google credentials to run tests that make no requests. But startup must still stop
 * dead, by name, rather than booting a server that cannot authenticate anybody.
 */

const SECRETS = ['GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'BETTER_AUTH_SECRET'] as const;

const original = Object.fromEntries(SECRETS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of SECRETS) {
    if (original[key] === undefined) delete process.env[key];
    else process.env[key] = original[key];
  }
});

describe('config', () => {
  it('imports without any credentials present', async () => {
    for (const key of SECRETS) delete process.env[key];
    // The import itself is the assertion: this used to throw as the module was evaluated.
    const { config } = await import('./config');
    expect(config).toBeDefined();
  });

  it('serves the non-secret values regardless', async () => {
    const { config } = await import('./config');
    expect(config.port).toBeTypeOf('number');
    expect(config.mongodbUri).toContain('mongodb');
    // Optional by design: unset means console-only telemetry, not a failure.
    expect(() => config.betterStackToken).not.toThrow();
  });

  it.each(SECRETS)('throws by name when %s is read and missing', async (key) => {
    delete process.env[key];
    const { config } = await import('./config');
    const read = () =>
      ({
        GOOGLE_CLIENT_ID: () => config.googleClientId,
        GOOGLE_CLIENT_SECRET: () => config.googleClientSecret,
        BETTER_AUTH_SECRET: () => config.betterAuthSecret,
      })[key]();

    // Naming the variable is the point — this is the message someone deploying reads.
    expect(read).toThrow(key);
  });

  it('treats an empty string as missing, not as a value', async () => {
    // A half-filled .env is likelier than an absent one, and an empty client id would otherwise
    // reach Google as a real request and fail somewhere far less obvious.
    process.env.BETTER_AUTH_SECRET = '';
    const { config } = await import('./config');
    expect(() => config.betterAuthSecret).toThrow('BETTER_AUTH_SECRET');
  });
});
