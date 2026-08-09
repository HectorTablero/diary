import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { anEntry, aPerson, aTag } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps, seed } from '@/test/seed';
import TagsPage from './TagsPage';

/* Tags, and — more to the point — the undo path.
 *
 * This is the file the harness's most surprising decision exists for. `renderWithProviders` renders
 * against the app's *singleton* QueryClient rather than a fresh one, because `lib/undo.ts` restores
 * a row and then invalidates that singleton from module scope, on purpose: the component that owned
 * the deletion has usually unmounted by the time Undo is pressed. Hand this test its own client and
 * the restore still writes to Dexie, nothing re-reads it, and the assertion below fails while the
 * app it describes works perfectly. Worth knowing before anyone "fixes" the harness.
 */

const setup = () => ({ user: userEvent.setup(), ...renderWithProviders(<TagsPage />) });

/**
 * The queued ops, once the mutation has finished queueing them.
 *
 * Waiting on the *outbox* rather than reading it after waiting on Dexie, which is a real race and
 * not a theoretical one: every mutation in db/mutations.ts writes its table first and calls
 * `enqueue` afterwards, so a `waitFor` polling `db.tags` is satisfied in the window between the
 * two and the read that follows finds an empty queue. It fails perhaps one run in twenty, under
 * load, which is the worst possible failure rate for a test to have.
 */
const queuedOps = (expected: number) =>
  waitFor(async () => {
    const ops = await outboxOps();
    expect(ops).toHaveLength(expected);
    return ops;
  });

/** The delete flow, which is a two-step confirm — never one click. */
const deleteTag = async (user: ReturnType<typeof userEvent.setup>, name: string) => {
  await user.click(screen.getByRole('button', { name: 'Delete tag' }));
  expect(await screen.findByText(`Delete tag "${name}"?`)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Delete' }));
};

describe('TagsPage', () => {
  it('lists tags with what actually uses them', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({
      tags: [work],
      people: [aPerson({ id: 'p1', name: 'Ana', tags: [work] })],
      entries: [
        anEntry({ id: 'e1', content: 'Shipped it', dateKey: '2026-08-01', tags: [work] }),
        anEntry({ id: 'e2', content: 'Shipped more', dateKey: '2026-08-02', tags: [work] }),
      ],
    });

    setup();

    /* Both counts come from repo.getTags, which reads them off the *tagIds index rather than
       walking the diary — so this also pins that the index-based tally agrees with the rows. */
    expect(await screen.findByText('2 entries · 1 people')).toBeInTheDocument();
  });

  it('shows the empty state rather than an empty list', async () => {
    await seed({});

    setup();

    expect(await screen.findByText('No tags yet')).toBeInTheDocument();
  });

  it('creates a tag locally and queues exactly one create for the server', async () => {
    await seed({});
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await user.type(await screen.findByLabelText('Name'), 'garden');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    const stored = await waitFor(async () => {
      const rows = await db.tags.toArray();
      expect(rows).toHaveLength(1);
      return rows[0];
    });
    expect(stored.name).toBe('garden');

    const ops = await queuedOps(1);
    expect(ops[0].method).toBe('POST');
    expect(ops[0].path).toBe('/tags');
    /* The colour is resolved *locally* and sent with the create, so the server stores the same one
       rather than picking its own from the palette — otherwise two devices would disagree about
       what colour a tag is until the next pull, for no reason anybody could see. */
    expect(ops[0].body).toMatchObject({ id: stored.id, name: 'garden', color: stored.color });
  });

  it('refuses a tag with no name', async () => {
    await seed({});
    const { user } = setup();

    await user.click(screen.getByRole('button', { name: 'Add tag' }));
    await screen.findByLabelText('Name');

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(await outboxOps()).toHaveLength(0);
  });

  it('deletes a tag and queues the delete', async () => {
    await seed({ tags: [aTag({ id: 't1', name: 'work' })] });
    const { user } = setup();

    await screen.findByText('work');
    await deleteTag(user, 'work');

    await waitFor(async () => expect(await db.tags.count()).toBe(0));
    const ops = await queuedOps(1);
    expect(ops[0]).toMatchObject({ method: 'DELETE', path: '/tags/t1' });
  });

  /* The undo window is the toast and nothing else — no snapshot is persisted anywhere — which is
     why `notifyDeleted` is exempt from the quiet-notifications filter and from the two-second
     success duration. An Undo nobody sees is an Undo that does not exist. */
  it('offers an Undo that puts the tag back, on screen and in the store', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({
      tags: [work],
      entries: [anEntry({ id: 'e1', content: 'Shipped it', dateKey: '2026-08-01', tags: [work] })],
    });
    const { user } = setup();

    await screen.findByText('work');
    await deleteTag(user, 'work');

    expect(await screen.findByText('Tag deleted')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText('work')).not.toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: 'Undo' }));

    // Back on screen: only possible because undo.ts invalidates the singleton client this test
    // renders against. See the note at the top of the file.
    expect(await screen.findByText('work')).toBeInTheDocument();

    /* And reattached to the entry it was stripped from. The cascade is the part of a tag deletion
       that isn't reconstructible from the tag alone, so the snapshot carries the ids — and a
       restore that forgot them would leave the tag existing but orphaned, which looks fine on this
       page and wrong everywhere else. */
    const entry = await db.entries.get('e1');
    expect(entry?.tagIds).toEqual(['t1']);
  });

  it('renames a tag and rewrites the #mentions that named it', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({
      tags: [work],
      entries: [
        anEntry({ id: 'e1', content: 'Shipped #work today', dateKey: '2026-08-01', tags: [work] }),
      ],
    });
    const { user } = setup();

    await user.click(await screen.findByRole('button', { name: 'Edit tag' }));
    const name = await screen.findByLabelText('Name');
    await user.clear(name);
    await user.type(name, 'projects');
    await user.click(screen.getByRole('button', { name: 'Save' }));

    /* The structured link is an id and was never stale; the literal text in the entry was, and
       leaving it would show `#work` next to a tag chip reading "projects" forever. */
    await waitFor(async () => {
      expect((await db.entries.get('e1'))?.content).toBe('Shipped #projects today');
    });
    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.some((op) => op.method === 'PATCH' && op.path === '/entries/e1')).toBe(true);
    });
  });
});
