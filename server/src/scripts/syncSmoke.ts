/* Temporary smoke test for the sync foundation (S1). Run: npx tsx src/scripts/syncSmoke.ts */
import { newObjectId } from '@diary/shared';
import mongoose from 'mongoose';
import { config } from '../config';
import { Deletion } from '../models/deletion';
import { Entry } from '../models/entry';
import '../models/person';
import '../models/tag';
import '../models/userSettings';
import { createEntry, deleteEntry } from '../services/entryService';

const USER = 'sync-smoke-user';
let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

async function main() {
  await mongoose.connect(config.mongodbUri);
  await Entry.deleteMany({ userId: USER });
  await Deletion.deleteMany({ userId: USER });

  // 1. Client-generated id + createdAt survive create
  const id = newObjectId();
  const createdAt = '2026-01-05T10:00:00.000Z';
  const dto = await createEntry(USER, {
    id,
    createdAt,
    content: 'offline entry',
    dateKey: '2026-01-05',
    importance: 3,
    tags: [],
    people: [],
    parentId: null,
  });
  check('client id respected', dto.id === id, `${dto.id} vs ${id}`);
  check('client createdAt respected', dto.createdAt === createdAt, `${dto.createdAt}`);
  const raw = await Entry.findById(id).lean();
  check('updatedAt is server time', !!raw && raw.updatedAt.getTime() > Date.parse(createdAt));

  // 2. Duplicate id create → 11000
  let dupCode: unknown = null;
  try {
    await createEntry(USER, {
      id,
      content: 'dup',
      dateKey: '2026-01-05',
      importance: 3,
      tags: [],
      people: [],
      parentId: null,
    });
  } catch (err) {
    dupCode = (err as { code?: number }).code;
  }
  check('duplicate id raises 11000', dupCode === 11000, `code=${String(dupCode)}`);

  // 3. Sync pull filtering by updatedAt
  const before = new Date(Date.now() - 60_000).toISOString();
  const changed = await Entry.find({ userId: USER, updatedAt: { $gt: new Date(before) } }).lean();
  check('updatedAt filter finds new entry', changed.length === 1);
  const none = await Entry.find({
    userId: USER,
    updatedAt: { $gt: new Date(Date.now() + 60_000) },
  }).lean();
  check('future cursor finds nothing', none.length === 0);

  // 4. Delete writes tombstones (incl. cascade)
  const child = await createEntry(USER, {
    content: 'child',
    dateKey: '2026-01-05',
    importance: 3,
    tags: [],
    people: [],
    parentId: id,
  });
  await deleteEntry(USER, id);
  const tombstones = await Deletion.find({ userId: USER, coll: 'entry' }).lean();
  const ids = new Set(tombstones.map((t) => t.docId.toString()));
  check('tombstones for root + child', ids.has(id) && ids.has(child.id), `${tombstones.length} tombstones`);

  await Entry.deleteMany({ userId: USER });
  await Deletion.deleteMany({ userId: USER });
  await mongoose.disconnect();
  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
