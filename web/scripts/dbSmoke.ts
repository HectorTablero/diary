/* Node smoke test for the local-first layer (Dexie via fake-indexeddb).
   Run from web/: npx tsx scripts/dbSmoke.ts */
import 'fake-indexeddb/auto';

const memory = new Map<string, string>();
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => memory.get(k) ?? null,
  setItem: (k: string, v: string) => void memory.set(k, v),
  removeItem: (k: string) => void memory.delete(k),
};
// The i18n module (pulled in by the sync engine for toasts) touches the DOM at import.
(globalThis as Record<string, unknown>).document ??= {
  documentElement: { lang: '' },
  addEventListener: () => {},
};

let failures = 0;
const check = (name: string, ok: boolean, detail = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failures++;
};

const dk = (daysAgo: number) =>
  new Date(Date.now() - daysAgo * 86_400_000).toISOString().slice(0, 10);

async function main() {
  const { db } = await import('../src/db/db');
  const repo = await import('../src/db/repo');
  const mutations = await import('../src/db/mutations');
  const { ApiError } = await import('../src/lib/apiClient');

  // --- tags: palette + duplicate guard ---
  const trips = await mutations.createTag({ name: 'viajes' });
  const work = await mutations.createTag({ name: 'trabajo' });
  check('palette colors differ', trips.color !== work.color, `${trips.color} / ${work.color}`);
  const dup = await mutations.createTag({ name: 'Viajes' }).catch((e: unknown) => e);
  check(
    'duplicate tag name -> 409 tag.duplicate_name',
    dup instanceof ApiError && dup.status === 409 && dup.code === 'tag.duplicate_name',
  );

  // --- people ---
  const ana = await mutations.createPerson({ name: 'Ana', tags: [trips.id], notes: '' });
  const luis = await mutations.createPerson({ name: 'Luis', tags: [], notes: '' });

  // --- entries: auto-said on mention ---
  const today = dk(0);
  const mentioned = await mutations.createEntry({
    content: 'Planeando viaje con @Ana',
    dateKey: today,
    importance: 2,
    tags: [trips.id],
    people: [ana.id],
    parentId: null,
  });
  check(
    'auto-said: mention copied to saidTo',
    mentioned.saidTo.length === 1 && mentioned.saidTo[0].personId === ana.id,
  );

  // said entries are excluded from talking points
  let tp = await repo.getTalkingPoints(ana.id);
  check('said entry not an active talking point', !tp.active.some((e) => e.id === mentioned.id));
  check('said entry listed under said', tp.said.some((e) => e.id === mentioned.id));

  // unsay -> becomes a mention-strength talking point
  await mutations.setSaid(mentioned.id, ana.id, false);
  tp = await repo.getTalkingPoints(ana.id);
  const active = tp.active.find((e) => e.id === mentioned.id);
  check('unsaid entry becomes active talking point', !!active && active.matchType === 'mention');

  // tag-only match scores below a same-day mention
  const tagOnly = await mutations.createEntry({
    content: 'Reservados los vuelos #viajes',
    dateKey: today,
    importance: 2,
    tags: [trips.id],
    people: [],
    saidTo: [],
    parentId: null,
  });
  tp = await repo.getTalkingPoints(ana.id);
  const mentionScore = tp.active.find((e) => e.id === mentioned.id)?.score ?? 0;
  const tagScore = tp.active.find((e) => e.id === tagOnly.id)?.score ?? 0;
  check('mention outranks tag match', mentionScore > tagScore && tagScore > 0);

  // people list badge counts
  const people = await repo.getPeople();
  check('talking point badge for Ana = 2', people.find((p) => p.id === ana.id)?.talkingPointCount === 2);
  check('no badge for Luis', people.find((p) => p.id === luis.id)?.talkingPointCount === 0);

  // hide removes from talking points but keeps history
  await mutations.setHidden(tagOnly.id, ana.id, true);
  tp = await repo.getTalkingPoints(ana.id);
  check('hidden entry excluded', !tp.active.some((e) => e.id === tagOnly.id));

  // --- day tree ---
  const child = await mutations.createEntry({
    content: 'sub-entry',
    dateKey: today,
    importance: 3,
    tags: [],
    people: [],
    saidTo: [],
    parentId: mentioned.id,
  });
  const tree = await repo.getDayEntries(today);
  const rootNode = tree.find((n) => n.id === mentioned.id);
  check('day tree nests sub-entry', rootNode?.children[0]?.id === child.id);
  check('day tree has 2 roots', tree.length === 2);

  // --- calendar + on-this-day + memories ---
  const oldKey = `${new Date().getFullYear() - 1}-${today.slice(5)}`;
  await mutations.createEntry({
    content: 'Aniversario con @Ana',
    dateKey: oldKey,
    importance: 1,
    tags: [],
    people: [ana.id],
    parentId: null,
  });
  const month = await repo.getCalendarMonth(
    Number(today.slice(0, 4)),
    Number(today.slice(5, 7)),
  );
  const dayCell = month.find((d) => d.date === today);
  check('calendar counts roots only', dayCell?.count === 2, `count=${dayCell?.count}`);
  check('calendar maxImportance = strongest', dayCell?.maxImportance === 2);

  const otd = await repo.getOnThisDay(today);
  check('on-this-day finds last year', otd.some((e) => e.dateKey === oldKey));

  const memories = await repo.getMemories(ana.id);
  check('memory: old important mention', memories.some((e) => e.dateKey === oldKey));
  check('memory excludes recent entries', !memories.some((e) => e.dateKey === today));

  // --- search (accent-insensitive) ---
  const found = await repo.search(new URLSearchParams({ q: 'planeando' }));
  check('search finds by text', found.results.some((e) => e.id === mentioned.id));
  const accents = await repo.search(new URLSearchParams({ q: 'AVIÓN' }));
  check('search is accent/case-insensitive vs "avion"', accents.total === 0); // no such entry
  const byPerson = await repo.search(new URLSearchParams({ people: ana.id }));
  check('search filter by person', byPerson.results.every((e) => e.people.some((p) => p.id === ana.id)));

  // --- cascade delete ---
  const del = await mutations.deleteEntry(mentioned.id);
  check('delete cascades to children', del.deleted === 2);
  check('children gone from tree', (await repo.getDayEntries(today)).length === 1);

  // --- person delete pulls references ---
  await mutations.deletePerson(ana.id);
  const afterDelete = await repo.search(new URLSearchParams({ people: ana.id }));
  check('person delete: no entries reference them', afterDelete.total === 0);

  // --- tag rename reflects everywhere (normalized store) ---
  await mutations.updateTag(trips.id, { name: 'aventuras' });
  const dayAfterRename = await repo.getDayEntries(today);
  const renamed = dayAfterRename[0]?.tags.find((t) => t.id === trips.id);
  check('tag rename visible in entries without touching them', renamed?.name === 'aventuras');

  // --- outbox recorded in order ---
  const ops = await db.outbox.orderBy('seq').toArray();
  check('outbox has ops', ops.length > 5, `${ops.length} ops`);
  check('first op is the first tag create', ops[0].method === 'POST' && ops[0].path === '/tags');
  const createOp = ops.find((o) => o.path === '/entries' && o.method === 'POST') as
    | { body?: { id?: string; createdAt?: string } }
    | undefined;
  check('entry create op carries id + createdAt', !!createOp?.body?.id && !!createOp?.body?.createdAt);

  // --- settings ---
  const settings = await repo.getSettings();
  await mutations.saveSettings({ ...settings, epsilon: 0.1 });
  check('settings persist locally', (await repo.getSettings()).epsilon === 0.1);

  console.log(failures ? `\n${failures} FAILURES` : '\nALL PASS');
  process.exit(failures ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
