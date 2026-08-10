import type { Page, Route } from '@playwright/test';
import type {
  EntryDto,
  PersonDto,
  SettingsDto,
  SyncResponse,
  TagDto,
  PluginRecordDto,
  ThreadDto,
} from '@diary/shared';
import { DEFAULT_SETTINGS } from '@diary/shared';

/* The server, as a fixture.
 *
 * Stateful rather than a pile of one-off `page.route` calls, because most of these specs are about
 * state moving *through* it: a write leaves the browser, lands here, and comes back on the next
 * pull. A stack of independent responders cannot express that, and mocking each call individually
 * would mean every spec re-deciding what the API does.
 *
 * Typed against `SyncResponse` from `@diary/shared` — the same type the real route returns — so the
 * fixture cannot drift away from the server without the typecheck saying so. */

export interface RecordedCall {
  method: string;
  path: string;
  body: unknown;
}

interface ApiState {
  entries: EntryDto[];
  people: PersonDto[];
  tags: TagDto[];
  threads: ThreadDto[];
  pluginRecords: PluginRecordDto[];
  settings: SettingsDto;
  deletions: SyncResponse['deletions'];
}

interface Rejection {
  method: string;
  path: RegExp;
  status: number;
  code: string;
}

export interface ApiMock {
  state: ApiState;
  /** Every API call the app made, in order. */
  calls: RecordedCall[];
  /** Answer the next pull with the whole state and `reset: true`. */
  nextPullIsReset(): void;
  /** Refuse the next matching write once, the way a validation failure would. */
  rejectOnce(rejection: Rejection): void;
  /**
   * Make the server unreachable *without* taking the network down.
   *
   * A genuinely different state from `context.setOffline(true)`: `navigator.onLine` stays true, the
   * fetch throws, and the app resolves that to `blocker: 'unreachable'` rather than `'offline'` —
   * a server that is down, or a captive portal eating requests. Both deserve a spec.
   */
  setUnreachable(down: boolean): void;
  /** Resolve once the app has made a matching call. */
  waitForCall(method: string, path: RegExp, timeoutMs?: number): Promise<RecordedCall>;
}

export const SIGNED_IN_USER = {
  id: 'user_e2e',
  name: 'E2E User',
  email: 'e2e@example.com',
  emailVerified: true,
  image: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const SESSION = {
  id: 'sess_e2e',
  userId: SIGNED_IN_USER.id,
  token: 'e2e-token',
  expiresAt: '2099-01-01T00:00:00.000Z',
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });

export async function installApiMock(
  page: Page,
  seed: Partial<ApiState> = {},
  options: { signedIn?: boolean } = {},
): Promise<ApiMock> {
  const { signedIn = true } = options;

  const state: ApiState = {
    entries: [],
    people: [],
    tags: [],
    threads: [],
    pluginRecords: [],
    settings: { ...DEFAULT_SETTINGS },
    deletions: [],
    ...seed,
  };
  const calls: RecordedCall[] = [];
  let forceReset = false;
  let unreachable = false;
  const rejections: Rejection[] = [];

  const record = (route: Route): RecordedCall => {
    const request = route.request();
    const call: RecordedCall = {
      method: request.method(),
      path: new URL(request.url()).pathname,
      body: (() => {
        try {
          return request.postDataJSON();
        } catch {
          return undefined; // not JSON (multipart upload), or no body at all
        }
      })(),
    };
    calls.push(call);
    return call;
  };

  /* Registration order is load-bearing and counter-intuitive: Playwright matches the *most
     recently* registered route first, so the catch-all has to go on first or it would swallow
     everything below it. The catch-all exists so an endpoint nobody thought to mock becomes a
     visible 404 in `calls` rather than a request that hangs until the test times out. */
  await page.route('**/api/**', async (route) => {
    const call = record(route);
    if (unreachable) return route.abort('connectionfailed');
    await json(route, { error: 'errors.not_found' }, 404);
    void call;
  });

  // The reconnect probe polls this every 10s once a sync has failed on network grounds. Without an
  // answer, `onReconnected` never fires and the "Connection restored" toast never appears.
  await page.route('**/api/health', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    await json(route, { ok: true });
  });

  await page.route('**/api/auth/**', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    if (route.request().url().includes('get-session')) {
      // `null` is better-auth's signed-out answer, and a 200 — not a 401, which the client would
      // read as a session that expired rather than one that never existed.
      return json(route, signedIn ? { session: SESSION, user: SIGNED_IN_USER } : null);
    }
    await json(route, { error: 'errors.not_found' }, 404);
  });

  /* Deliberately refused. `page.route` does not intercept WebSocket handshakes, so if the ticket
     succeeded the app would open a real socket against `vite preview`, get a 404, and re-arm a
     ten-second reconnect for the rest of the run. Failing the ticket means the socket is never
     constructed, and sync.ts's existing catch handles it exactly as designed (retry later). */
  await page.route('**/api/sync/ws-ticket', async (route) => {
    record(route);
    await json(route, { error: 'errors.unavailable' }, 503);
  });

  await page.route('**/api/sync*', async (route) => {
    record(route);
    if (unreachable) return route.abort('connectionfailed');
    const since = new URL(route.request().url()).searchParams.get('since');
    const reset = forceReset || !since;
    forceReset = false;
    const response: SyncResponse = {
      // The client stores `serverTime - 10s` as its next cursor, to absorb clock skew.
      serverTime: new Date().toISOString(),
      reset,
      entries: state.entries,
      people: state.people,
      tags: state.tags,
      threads: state.threads,
      pluginRecords: state.pluginRecords,
      settings: state.settings,
      // A reset carries no tombstones — the ids it omits *are* the deletions.
      deletions: reset ? [] : state.deletions,
    };
    await json(route, response);
  });

  await page.route('**/api/{entries,people,tags,threads,settings}**', async (route) => {
    const call = record(route);
    if (unreachable) return route.abort('connectionfailed');

    const index = rejections.findIndex((r) => r.method === call.method && r.path.test(call.path));
    if (index !== -1) {
      const [rejection] = rejections.splice(index, 1);
      /* `{ error: <i18n key> }` is the contract: apiClient parses it into ApiError.code, sync.ts
           stores that on the dead-letter row, and the toast renders it. Any other body shape would
           make the rejection path untestable while still looking like a failure. */
      return json(route, { error: rejection.code }, rejection.status);
    }

    // Apply creates so the next pull returns them — which is what makes "write, drain, reload"
    // a round trip rather than two unrelated assertions.
    if (call.method === 'POST' && call.path === '/api/entries') {
      state.entries = [...state.entries, call.body as EntryDto];
    }
    await json(route, {});
  });

  return {
    state,
    calls,
    nextPullIsReset: () => {
      forceReset = true;
    },
    rejectOnce: (rejection) => rejections.push(rejection),
    setUnreachable: (down) => {
      unreachable = down;
    },
    waitForCall: async (method, path, timeoutMs = 10_000) => {
      const deadline = Date.now() + timeoutMs;
      for (;;) {
        const found = calls.find((c) => c.method === method && path.test(c.path));
        if (found) return found;
        if (Date.now() > deadline) {
          throw new Error(
            `Timed out waiting for ${method} ${path}. Saw: ${
              calls.map((c) => `${c.method} ${c.path}`).join(', ') || '(nothing)'
            }`,
          );
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    },
  };
}
