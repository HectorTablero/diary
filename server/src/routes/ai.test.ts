import { AI_MAX_RECORDING_BYTES, AI_RATE_LIMIT } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { postJson, routeApp, USER_ID } from '../test/routeApp';

/* The two routes that cost money.
 *
 * Both spend the caller's own provider quota, and both are reachable from a client that retries —
 * which is a far likelier way to burn a month's credits than anyone attacking the thing. So the
 * limiter is the point of this file, and the property worth pinning is the one that is easiest to
 * lose in a refactor: the window is *shared* across both routes, because a voice note is
 * transcribed and then turned into suggestions. Limit them separately and a loop runs at twice the
 * intended rate while every individual counter still looks correct.
 */

const services = vi.hoisted(() => ({
  generateSuggestions: vi.fn(),
  transcribe: vi.fn(),
}));
vi.mock('../services/aiSuggestionService', () => ({
  generateSuggestions: services.generateSuggestions,
}));
vi.mock('../services/transcriptionService', () => ({ transcribe: services.transcribe }));
vi.mock('../lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/telemetry')>()),
  trackEvent: vi.fn(),
}));

const { aiRouter } = await import('./ai');

const DAY = '2026-08-01';
const SUGGESTION = { content: 'Bought milk', dateKey: DAY };

/* A fresh app per test. The limiter's window map lives in the middleware closure, which is created
   when the router module is evaluated — so every test in this file shares one counter, and each
   needs a distinct user id to start from zero. */
let userSeed = 0;
const freshApp = () => routeApp('/ai', aiRouter, `${USER_ID}_${userSeed++}`);

const suggest = (app: ReturnType<typeof routeApp>) =>
  postJson(app, '/ai/suggestions', { transcript: 'Bought milk today', dateKey: DAY });

/** A multipart upload of `bytes` zero bytes, as the recorder would send it. */
const upload = (app: ReturnType<typeof routeApp>, bytes: number, field = 'file') => {
  const form = new FormData();
  form.append(field, new File([new Uint8Array(bytes)], 'note.webm', { type: 'audio/webm' }));
  return app.request('/ai/transcribe', { method: 'POST', body: form });
};

beforeEach(() => {
  services.generateSuggestions.mockReset();
  services.transcribe.mockReset();
  services.generateSuggestions.mockResolvedValue([SUGGESTION]);
  services.transcribe.mockResolvedValue('Bought milk today');
});

describe('POST /ai/suggestions', () => {
  it('passes the caller and the whole validated request through', async () => {
    const app = freshApp();

    const res = await postJson(app, '/ai/suggestions', {
      transcript: 'Bought milk today',
      dateKey: DAY,
      language: 'es',
      parentPath: ['Ran into Ana'],
    });

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ entries: [SUGGESTION] });
    /* `parentPath` is both the depth the suggestions will be created at and the context the model
       is given, so it has to survive the trip intact rather than being reduced to a count. */
    expect(services.generateSuggestions).toHaveBeenCalledWith(
      expect.stringContaining(USER_ID),
      'Bought milk today',
      DAY,
      'es',
      ['Ran into Ana'],
    );
  });

  it('defaults the language and the parent path', async () => {
    await suggest(freshApp());

    const [, , , language, parentPath] = services.generateSuggestions.mock.calls[0];
    expect(language).toBe('es');
    // Empty = an ordinary top-level recording, which is what the service reads it as.
    expect(parentPath).toEqual([]);
  });

  it('refuses an empty transcript without spending anything', async () => {
    const res = await postJson(freshApp(), '/ai/suggestions', { transcript: '  ', dateKey: DAY });

    expect(res.status).toBe(400);
    expect(services.generateSuggestions).not.toHaveBeenCalled();
  });

  it('refuses a parent path deeper than an entry can nest', async () => {
    const res = await postJson(freshApp(), '/ai/suggestions', {
      transcript: 'Bought milk',
      dateKey: DAY,
      parentPath: Array.from({ length: 20 }, (_, i) => `level ${i}`),
    });

    expect(res.status).toBe(400);
    expect(services.generateSuggestions).not.toHaveBeenCalled();
  });
});

describe('POST /ai/transcribe', () => {
  it('hands the file to the service and answers with the text', async () => {
    const app = freshApp();

    const res = await upload(app, 128);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Bought milk today' });
    /* The key never reaches the browser — that is the entire reason this endpoint exists rather
       than the client calling Groq directly — so the service is handed a user id and a file. */
    const [userId, file] = services.transcribe.mock.calls[0];
    expect(userId).toContain(USER_ID);
    expect(file).toBeInstanceOf(File);
  });

  it('refuses a request with no audio in it', async () => {
    const res = await upload(freshApp(), 128, 'not-the-file-field');

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ai.no_audio' });
    expect(services.transcribe).not.toHaveBeenCalled();
  });

  it('refuses a recording past the byte cap', async () => {
    // Over the file limit but under the envelope limit, so it is the in-handler check that catches
    // it — the one that can say *which* part was too big.
    const res = await upload(freshApp(), AI_MAX_RECORDING_BYTES + 1);

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'ai.recording_too_large' });
    expect(services.transcribe).not.toHaveBeenCalled();
  });
});

describe('the shared rate limit', () => {
  it('allows the whole window and then refuses, with a Retry-After', async () => {
    const app = freshApp();
    for (let i = 0; i < AI_RATE_LIMIT; i++) {
      expect((await suggest(app)).status).toBe(200);
    }

    const refused = await suggest(app);

    expect(refused.status).toBe(429);
    expect(await refused.json()).toEqual({ error: 'ai.too_many_requests' });
    /* Returned rather than thrown as an HttpError, precisely so this header survives — handleError
       rebuilds the response from a status and a code and would drop it, which is the difference
       between a client that waits the right amount of time and one that guesses. */
    expect(Number(refused.headers.get('Retry-After'))).toBeGreaterThan(0);
  });

  it('counts both routes against one window', async () => {
    const app = freshApp();
    // Spend the entire budget on transcription…
    for (let i = 0; i < AI_RATE_LIMIT; i++) {
      expect((await upload(app, 64)).status).toBe(200);
    }

    // …and the other half of the same action is refused too.
    expect((await suggest(app)).status).toBe(429);
  });

  it('counts per user, not per process', async () => {
    const busy = freshApp();
    for (let i = 0; i < AI_RATE_LIMIT; i++) await suggest(busy);
    expect((await suggest(busy)).status).toBe(429);

    /* Per user rather than per IP, because everything here sits behind requireAuth and the app is
       used from phones on carrier NAT — where an IP is a whole neighbourhood. */
    expect((await suggest(freshApp())).status).toBe(200);
  });

  it('refuses without calling the service, which is where the money goes', async () => {
    const app = freshApp();
    for (let i = 0; i < AI_RATE_LIMIT; i++) await suggest(app);
    services.generateSuggestions.mockClear();

    await suggest(app);

    // A limiter that rejected *after* the provider call would cap the responses and none of the
    // spending, which is the only thing it exists to do.
    expect(services.generateSuggestions).not.toHaveBeenCalled();
  });
});
