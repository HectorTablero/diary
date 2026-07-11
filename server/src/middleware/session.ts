import type { MiddlewareHandler } from 'hono';
import type { Auth } from '../auth';

export interface AppEnv {
  Variables: {
    userId: string;
  };
}

export const requireAuth =
  (auth: Auth): MiddlewareHandler<AppEnv> =>
  async (c, next) => {
    const session = await auth.api.getSession({ headers: c.req.raw.headers });
    if (!session) return c.json({ error: 'errors.unauthorized' }, 401);
    c.set('userId', session.user.id);
    await next();
  };
