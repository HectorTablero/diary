import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { aTag } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps, seed, seedSettings } from '@/test/seed';
import { db } from '@/db/db';
import { EntryComposer } from './EntryComposer';

/* The write path, asserted at both ends: what lands in the local store, and what gets queued for
   the server. Those are two different facts in a local-first app — the whole design is that the
   first happens immediately and the second happens whenever it can — and a test that only checks
   the screen would pass just as happily if nothing were ever queued at all. */

const DAY = '2026-08-01';

const setup = () => ({
  user: userEvent.setup(),
  ...renderWithProviders(<EntryComposer dateKey={DAY} />),
});

const write = async (user: ReturnType<typeof userEvent.setup>, text: string) => {
  await user.type(screen.getByPlaceholderText('What happened? Use @person and #tag…'), text);
  await user.click(screen.getByRole('button', { name: 'Save' }));
};

describe('EntryComposer', () => {
  it('writes the entry locally and queues exactly one create for the server', async () => {
    await seed({});
    const { user } = setup();

    await write(user, 'Bought milk');

    const stored = await waitFor(async () => {
      const rows = await db.entries.toArray();
      expect(rows).toHaveLength(1);
      return rows[0];
    });
    expect(stored.content).toBe('Bought milk');
    expect(stored.dateKey).toBe(DAY);

    /* Exactly one, and carrying the same id as the local row. A client-generated id is what makes
       the create idempotent when the outbox replays it — sync.ts treats a 409 on POST as "already
       applied" and drops the op — so an id mismatch here would surface much later as a duplicate
       entry on another device. */
    const ops = await outboxOps();
    expect(ops).toHaveLength(1);
    expect(ops[0].method).toBe('POST');
    expect(ops[0].path).toBe('/entries');
    expect((ops[0].body as { id: string }).id).toBe(stored.id);
  });

  it('clears itself after saving, so the next entry starts empty', async () => {
    await seed({});
    const { user } = setup();

    await write(user, 'First thing');

    const box = screen.getByPlaceholderText('What happened? Use @person and #tag…');
    await waitFor(() => expect(box).toHaveValue(''));
    // The button goes back to being unavailable, which is the visible half of the same fact.
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
  });

  it('refuses to save nothing', async () => {
    await seed({});
    setup();

    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(await outboxOps()).toHaveLength(0);
  });

  /* The `quietNotifications` filter in lib/notify.ts, which has never had a test and is the single
     easiest thing in this app to break without noticing — it fails *silently*, by not rendering
     something. Both directions are asserted, because a filter that always suppresses and a filter
     that works look identical from the passing side. */
  it('stays quiet about a routine save by default', async () => {
    await seed({}); // DEFAULT_SETTINGS.quietNotifications is true
    const { user } = setup();

    await write(user, 'Bought milk');

    await waitFor(async () => expect(await db.entries.count()).toBe(1));
    expect(screen.queryByText('Entry saved')).not.toBeInTheDocument();
  });

  it('confirms the save when the user has asked to be told', async () => {
    await seed({});
    await seedSettings({ quietNotifications: false });
    const { user } = setup();

    await write(user, 'Bought milk');

    expect(await screen.findByText('Entry saved')).toBeInTheDocument();
  });

  /* Typing `#work` as plain text deliberately links nothing — the id has to come from picking a
     real tag, which is the whole reason the composer has an autocomplete rather than parsing the
     text afterwards. So this drives the combobox the way a person does. */
  it('links a tag chosen from the autocomplete, and carries the id through to the queue', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({ tags: [work] });
    const { user } = setup();

    await user.type(
      screen.getByPlaceholderText('What happened? Use @person and #tag…'),
      'Shipped the thing #wo',
    );

    // A real combobox: the textarea owns a listbox and the rows are options (see TokenTextarea).
    const textarea = screen.getByRole('combobox');
    await waitFor(() => expect(textarea).toHaveAttribute('aria-expanded', 'true'));
    await user.click(await screen.findByRole('option', { name: /work/ }));

    await user.click(screen.getByRole('button', { name: 'Save' }));

    const stored = await waitFor(async () => {
      const rows = await db.entries.toArray();
      expect(rows).toHaveLength(1);
      return rows[0];
    });
    /* Stored as an id, not an embedded tag — entries are normalised (db.ts) and the name is
       resolved at read time, which is what keeps a rename from going stale across the diary. */
    expect(stored.tagIds).toEqual(['t1']);

    /* The queued body carries `tags`, not `tagIds`: the outbox op is the REST payload the server
       expects, while `tagIds` is the local row's shape. mutations.ts is where the two diverge, and
       asserting on both ends is what would catch them being wired to each other incorrectly. */
    const [op] = await outboxOps();
    expect((op.body as { tags: string[] }).tags).toEqual(['t1']);
  });
});
