import { CEREBRAS_API_BASE, GROQ_API_BASE, OPENROUTER_API_BASE } from '@diary/shared';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { HttpError } from '../errors';
import type { ChatMessage } from '../lib/aiChatClient';
import { modelDouble, resetModels } from '../test/mongooseDouble';

/* Provider failover.
 *
 * A user's keys are free or near-free tiers, so "has a Cerebras key" and "Cerebras will answer
 * right now" are different statements: the account runs dry and the provider answers 402. Adding a
 * second provider key is exactly what a user does about that, so a request that dies on the first
 * key while a second one sits configured and unused is the failure worth pinning here — it looks
 * like a plain upstream 502 from the outside and nothing else in the system notices.
 */

const chat = vi.hoisted(() => vi.fn());
vi.mock('../lib/aiChatClient', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../lib/aiChatClient')>()),
  // `isProviderFailure` stays real: which errors are worth failing over on is half of what this
  // file tests.
  chatCompletion: chat,
}));

const settings = vi.hoisted(() => ({ getSettings: vi.fn(), getProviderKeys: vi.fn() }));
vi.mock('./settingsService', () => settings);

const Tag = vi.hoisted(() => ({ value: null as unknown }));
const Person = vi.hoisted(() => ({ value: null as unknown }));
vi.mock('../models/tag', () => ({ Tag: Tag.value }));
vi.mock('../models/person', () => ({ Person: Person.value }));
Tag.value = modelDouble();
Person.value = modelDouble();

const { generateSuggestions } = await import('./aiSuggestionService');

const DAY = '2026-08-01';

/** The model's final answer: one `submit_entries` call, which ends the loop. */
const submits = (content: string) => ({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_submit',
            type: 'function',
            function: {
              name: 'submit_entries',
              arguments: JSON.stringify({
                entries: [{ content, importance: 3, tags: [], people: [], children: [] }],
              }),
            },
          },
        ],
      },
    },
  ],
});

/** A turn that keeps the loop going, so a failure can land *mid*-conversation. */
const looksUpAPerson = () => ({
  choices: [
    {
      finish_reason: 'tool_calls',
      message: {
        role: 'assistant',
        content: null,
        tool_calls: [
          {
            id: 'call_query',
            type: 'function',
            function: { name: 'query_people', arguments: JSON.stringify({ query: 'Ana' }) },
          },
        ],
      },
    },
  ],
});

const run = () => generateSuggestions('user1', 'Bought milk today', DAY, 'en');

/** The base urls chatCompletion was pointed at, in call order. */
const calledBaseUrls = () => chat.mock.calls.map((call) => call[0] as string);

beforeEach(() => {
  chat.mockReset();
  resetModels(Tag.value as ReturnType<typeof modelDouble>);
  resetModels(Person.value as ReturnType<typeof modelDouble>);
  settings.getSettings.mockResolvedValue({ forceEnglishAIEvents: false, maxSubEntryDepth: 2 });
  settings.getProviderKeys.mockResolvedValue({
    cerebrasApiKey: 'cere-key',
    openRouterApiKey: 'or-key',
    groqApiKey: '',
  });
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

describe('provider failover', () => {
  it('falls back to the next key when the first account is out of credit', async () => {
    // Cerebras' 402 — the account is empty, the key is fine. Nothing about it says anything about
    // the OpenRouter key sitting right behind it.
    chat.mockRejectedValueOnce(new HttpError(402, 'ai.quota_exhausted'));
    chat.mockResolvedValueOnce(submits('Bought milk'));

    const entries = await run();

    expect(entries).toEqual([
      { content: 'Bought milk', importance: 3, tags: [], people: [], children: [] },
    ]);
    expect(calledBaseUrls()).toEqual([CEREBRAS_API_BASE, OPENROUTER_API_BASE]);
  });

  it.each([
    ['an exhausted account', new HttpError(402, 'ai.quota_exhausted')],
    ['a key the provider rejects', new HttpError(400, 'ai.invalid_key')],
    ['a rate limit that outlasted the retries', new HttpError(429, 'ai.rate_limited')],
    ['an upstream error', new HttpError(502, 'ai.upstream_error')],
    ['a provider too slow to answer', new HttpError(504, 'ai.timeout')],
  ])('fails over on %s', async (_label, err) => {
    chat.mockRejectedValueOnce(err);
    chat.mockResolvedValueOnce(submits('Bought milk'));

    await expect(run()).resolves.toHaveLength(1);
    expect(calledBaseUrls()).toEqual([CEREBRAS_API_BASE, OPENROUTER_API_BASE]);
  });

  it('carries the conversation over when a provider dies mid-loop', async () => {
    chat.mockResolvedValueOnce(looksUpAPerson());
    chat.mockRejectedValueOnce(new HttpError(402, 'ai.quota_exhausted'));
    chat.mockResolvedValueOnce(submits('Ran into Ana'));

    const entries = await run();

    expect(entries).toEqual([
      { content: 'Ran into Ana', importance: 3, tags: [], people: [], children: [] },
    ]);
    /* The messages are provider-neutral, so the second provider resumes the same conversation
       rather than starting over — the tool call the first provider made, and the result we fed
       back to it, are both still in the transcript OpenRouter is handed. */
    const resumed = chat.mock.calls[2][2] as { messages: ChatMessage[] };
    expect(resumed.messages.map((m) => m.role)).toContain('tool');
    expect(resumed.messages[2]?.tool_calls?.[0]?.function.name).toBe('query_people');
    expect(resumed.messages[3]?.tool_call_id).toBe('call_query');
  });

  it('does not go back to a provider that already ran dry', async () => {
    chat.mockRejectedValueOnce(new HttpError(402, 'ai.quota_exhausted'));
    chat.mockResolvedValueOnce(looksUpAPerson());
    chat.mockResolvedValueOnce(submits('Ran into Ana'));

    await run();

    /* Whatever emptied the account is still true a second later. Retrying it once per tool
       iteration would pay the round trip — and the 429 backoff inside chatCompletion — every time,
       for a call that cannot succeed. */
    expect(calledBaseUrls()).toEqual([CEREBRAS_API_BASE, OPENROUTER_API_BASE, OPENROUTER_API_BASE]);
  });

  it('hands each provider its own key, model and headers', async () => {
    chat.mockRejectedValueOnce(new HttpError(402, 'ai.quota_exhausted'));
    chat.mockResolvedValueOnce(submits('Bought milk'));

    await run();

    // The model name is per provider, not per request: falling back with the previous provider's
    // model id would just turn one failure into a different one.
    const [, cerebrasKey, cerebrasBody] = chat.mock.calls[0] as [string, string, { model: string }];
    const [, openRouterKey, openRouterBody, openRouterHeaders] = chat.mock.calls[1] as [
      string,
      string,
      { model: string },
      Record<string, string>,
    ];
    expect(cerebrasKey).toBe('cere-key');
    expect(openRouterKey).toBe('or-key');
    expect(openRouterBody.model).not.toBe(cerebrasBody.model);
    expect(openRouterHeaders).toMatchObject({ 'X-Title': 'Diary' });
  });

  it("reports the last provider's failure when every key is spent", async () => {
    settings.getProviderKeys.mockResolvedValue({
      cerebrasApiKey: 'cere-key',
      openRouterApiKey: 'or-key',
      groqApiKey: 'groq-key',
    });
    chat.mockRejectedValueOnce(new HttpError(402, 'ai.quota_exhausted'));
    chat.mockRejectedValueOnce(new HttpError(429, 'ai.rate_limited'));
    chat.mockRejectedValueOnce(new HttpError(400, 'ai.invalid_key'));

    // The real reason the request could not be served, not a generic upstream error — the first
    // provider's 402 is no longer the interesting one once a later key turned out to be invalid.
    await expect(run()).rejects.toMatchObject({ status: 400, code: 'ai.invalid_key' });
    expect(calledBaseUrls()).toEqual([CEREBRAS_API_BASE, OPENROUTER_API_BASE, GROQ_API_BASE]);
  });

  it('does not burn a second key on a bug in our own code', async () => {
    chat.mockRejectedValueOnce(new TypeError('messages is not iterable'));

    await expect(run()).rejects.toBeInstanceOf(TypeError);
    expect(calledBaseUrls()).toEqual([CEREBRAS_API_BASE]);
  });

  it('refuses without a single key rather than calling anything', async () => {
    settings.getProviderKeys.mockResolvedValue({
      cerebrasApiKey: '',
      openRouterApiKey: '',
      groqApiKey: '',
    });

    await expect(run()).rejects.toMatchObject({ status: 400, code: 'ai.no_key' });
    expect(chat).not.toHaveBeenCalled();
  });
});
