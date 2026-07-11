import { zValidator } from '@hono/zod-validator';
import type { ZodType } from 'zod';

const onInvalid = (result: { success: boolean }, c: { json: Function }) => {
  if (!result.success) return c.json({ error: 'errors.validation' }, 400);
};

export const jsonValidator = <T extends ZodType>(schema: T) =>
  zValidator('json', schema, onInvalid as never);

export const queryValidator = <T extends ZodType>(schema: T) =>
  zValidator('query', schema, onInvalid as never);
