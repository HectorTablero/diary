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
    threads: [],
    parentId: null,
  });
  check('client id respected', dto.id === id, `${dto.id} vs ${id}`);
  check('client createdAt respected', dto.createdAt === createdAt, `${dto.createdAt}`);
  const raw = await Entry.findById(id).lean();
  check('updatedAt is server time', !!raw && raw.updatedAt.getTime() > Date.parse(createdAt));

  // 2. A create replayed under an id that already exists is idempotent, not a conflict — the
  //    outbox re-sends an op whose response was lost, and a 409 there would make the client
  //    delete its local copy as a phantom.
  const replay = await createEntry(USER, {
    id,
    content: 'dup',
    dateKey: '2026-01-05',
    importance: 3,
    tags: [],
    people: [],
    threads: [],
    parentId: null,
  });
  check('replayed create returns the existing entry', replay.id === id, `${replay.id}`);
  check('replayed create does not overwrite', replay.content === 'offline entry', replay.content);
  check('replayed create adds no second row', (await Entry.countDocuments({ userId: USER })) === 1);

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
    threads: [],
    parentId: id,
  });
  await deleteEntry(USER, id);
  const tombstones = await Deletion.find({ userId: USER, coll: 'entry' }).lean();
  const ids = new Set(tombstones.map((t) => t.docId.toString()));
  check('tombstones for root + child', ids.has(id) && ids.has(child.id), `${tombstones.length} tombstones`);

  // 5. Undo: re-creating a deleted id retracts its tombstone. Without this the server holds two
  //    contradictory facts about the id — the entry is back, but a tombstone still says it is
  //    gone — and every client's next pull deletes the entry the undo had just restored.
  await createEntry(USER, {
    id,
    createdAt,
    content: 'offline entry',
    dateKey: '2026-01-05',
    importance: 3,
    tags: [],
    people: [],
    threads: [],
    parentId: null,
  });
  const afterRestore = await Deletion.find({ userId: USER, coll: 'entry' }).lean();
  const remaining = new Set(afterRestore.map((t) => t.docId.toString()));
  check('restore retracts the entry tombstone', !remaining.has(id));
  // Scoped to the id actually restored: the child is still deleted and must stay tombstoned.
  check('restore leaves other tombstones alone', remaining.has(child.id));

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
