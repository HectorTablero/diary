import { entryCreateSchema, entryUpdateSchema, OBJECT_ID_REGEX } from '@diary/shared';
import { Hono } from 'hono';
import { notFound } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { createEntry, deleteEntry, setHidden, setSaid, updateEntry } from '../services/entryService';

const oid = (value: string) => {
  if (!OBJECT_ID_REGEX.test(value)) throw notFound('errors.not_found');
  return value;
};

/* Writes only — a day's entries are read straight from the client's own Dexie store. */
export const entriesRouter = new Hono<AppEnv>()
  .post('/', jsonValidator(entryCreateSchema), async (c) => {
    const entry = await createEntry(c.get('userId'), c.req.valid('json'));
    return c.json(entry, 201);
  })
  .patch('/:id', jsonValidator(entryUpdateSchema), async (c) => {
    const entry = await updateEntry(c.get('userId'), oid(c.req.param('id')), c.req.valid('json'));
    return c.json(entry);
  })
  .delete('/:id', async (c) => {
    const deleted = await deleteEntry(c.get('userId'), oid(c.req.param('id')));
    return c.json({ deleted });
  })
  .put('/:id/said/:personId', async (c) => {
    await setSaid(c.get('userId'), oid(c.req.param('id')), oid(c.req.param('personId')), true);
    return c.json({ ok: true });
  })
  .delete('/:id/said/:personId', async (c) => {
    await setSaid(c.get('userId'), oid(c.req.param('id')), oid(c.req.param('personId')), false);
    return c.json({ ok: true });
  })
  .put('/:id/hidden/:personId', async (c) => {
    await setHidden(c.get('userId'), oid(c.req.param('id')), oid(c.req.param('personId')), true);
    return c.json({ ok: true });
  })
  .delete('/:id/hidden/:personId', async (c) => {
    await setHidden(c.get('userId'), oid(c.req.param('id')), oid(c.req.param('personId')), false);
    return c.json({ ok: true });
  });
