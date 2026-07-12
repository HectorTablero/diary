import { HttpError } from '../errors';

/* Generic OpenAI-compatible chat-completions client — both Groq and OpenRouter speak this
   same shape, so the tool-calling loop in aiSuggestionService.ts can point at either. */

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export interface ChatCompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: unknown[];
  tool_choice?: 'auto' | 'none' | 'required';
  temperature?: number;
  max_tokens?: number;
}

export interface ChatCompletionResponse {
  choices: { message: ChatMessage; finish_reason: string }[];
}

function mapErrorResponse(res: Response): HttpError {
  if (res.status === 401 || res.status === 403) return new HttpError(400, 'ai.invalid_key');
  if (res.status === 429) return new HttpError(429, 'ai.rate_limited');
  return new HttpError(502, 'ai.upstream_error');
}

/** Providers send this on 429s, usually a fraction of a second to a few seconds for burst limits. */
function retryDelayMs(res: Response, attempt: number): number {
  const header = res.headers.get('retry-after');
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds >= 0) return Math.min(seconds * 1000, 10_000);
  return attempt * 1000; // no header: back off a bit more each retry
}

const MAX_ATTEMPTS = 3;

/** This is the server's only outbound fetch — Node's global fetch, no new dependency. */
export async function chatCompletion(
  baseUrl: string,
  apiKey: string,
  body: ChatCompletionRequest,
  extraHeaders?: Record<string, string>,
): Promise<ChatCompletionResponse> {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
          ...extraHeaders,
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(60_000),
      });
    } catch (err) {
      if (err instanceof Error && err.name === 'TimeoutError') throw new HttpError(504, 'ai.timeout');
      throw new HttpError(502, 'ai.upstream_error');
    }
    if (res.ok) return (await res.json()) as ChatCompletionResponse;

    // Free-tier rate limits are commonly short bursts, not real capacity problems — the account
    // can easily have headroom while a single request still gets a 429. Retry a couple of times
    // honoring Retry-After before giving up.
    if (res.status === 429 && attempt < MAX_ATTEMPTS) {
      const detail = await res.text().catch(() => '');
      const wait = retryDelayMs(res, attempt);
      console.warn(
        `ai chat (${baseUrl}): 429 on attempt ${attempt}/${MAX_ATTEMPTS}, retrying in ${wait}ms`,
        detail.slice(0, 500),
      );
      await new Promise((resolve) => setTimeout(resolve, wait));
      continue;
    }

    const detail = await res.text().catch(() => '');
    if (detail) console.warn(`ai chat (${baseUrl}): request failed (${res.status})`, detail.slice(0, 500));
    throw mapErrorResponse(res);
  }
  throw new HttpError(429, 'ai.rate_limited');
}
