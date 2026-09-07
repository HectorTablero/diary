import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { chatCompletion, isProviderFailure } from './aiChatClient';

/* A 200 is not a completion.
 *
 * OpenRouter answers OK with an error envelope when its own upstream fails, and providers
 * occasionally return a completion with no choices at all. Casting that body straight to
 * ChatCompletionResponse pushed the failure one layer up, where the caller read `choices[0]` off
 * `undefined` and the whole request died on a TypeError — bypassing the failover that a user's
 * second key exists for. It has to be rejected here, as a provider failure.
 */

const REQUEST = {
  model: 'some-model',
  messages: [{ role: 'user' as const, content: 'hi' }],
};

const ok = (body: unknown) =>
  vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => body } as Response);

const call = () => chatCompletion('https://api.example.com/v1', 'key', REQUEST);

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('chatCompletion', () => {
  it('returns a well-formed completion untouched', async () => {
    const body = {
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'hello' } }],
    };
    vi.stubGlobal('fetch', ok(body));

    await expect(call()).resolves.toEqual(body);
  });

  it.each([
    ['an error envelope', { error: { message: 'upstream is down', code: 502 } }],
    ['no choices at all', { id: 'chatcmpl-1', object: 'chat.completion' }],
    ['an empty choices array', { choices: [] }],
    ['a choice with no message', { choices: [{ finish_reason: 'error' }] }],
    ['a body that is not an object', 'service unavailable'],
  ])('treats a 200 carrying %s as a provider failure', async (_label, body) => {
    vi.stubGlobal('fetch', ok(body));

    const err = await call().catch((e: unknown) => e);

    expect(err).toMatchObject({ status: 502, code: 'ai.upstream_error' });
    // The point of rejecting it: a caller holding a second key fails over instead of crashing.
    expect(isProviderFailure(err)).toBe(true);
  });

  it('treats an unparseable 200 body as a provider failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => {
          throw new SyntaxError('Unexpected token < in JSON at position 0');
        },
      } as unknown as Response),
    );

    const err = await call().catch((e: unknown) => e);

    expect(err).toMatchObject({ status: 502, code: 'ai.upstream_error' });
    expect(isProviderFailure(err)).toBe(true);
  });
});
