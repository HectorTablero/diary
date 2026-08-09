import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import * as repo from '@/db/repo';
import { anEntry, aPerson, aTag, aThread } from '@/test/fixtures';
import { renderWithProviders } from '@/test/renderWithProviders';
import { outboxOps, seed, seedSettings } from '@/test/seed';
import PersonProfilePage from './PersonProfilePage';

/* The profile: four tabs, two debt banners, and the one screen where the diary tells you to go and
 * do something.
 *
 * The per-row `said`/`hidden` marks have their own file (TalkingPointItem.test.tsx). What is left
 * here is the page's own work — grouping clusters by thread, the bulk "mark all", the checkup and
 * follow-up banners, and the loading behaviour that exists because this screen used to blank the
 * viewport and redirect to the list on *any* error, making a transient read failure and a deleted
 * person the same silent experience.
 */

const TODAY = '2026-08-09';
const PERSON = 'p1';

beforeEach(() => {
  // Every banner here is "has enough time passed", so the clock is pinned for the file.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => vi.useRealTimers());

const renderProfile = (id = PERSON) => ({
  user: userEvent.setup(),
  ...renderWithProviders(<PersonProfilePage />, {
    path: '/people/:id',
    initialEntries: [`/people/${id}`],
  }),
});

/**
 * Find an entry by its sentence.
 *
 * `getByText` cannot: EntryContent renders one element per segment so `@mentions` and `#tags` can
 * be links, which makes "Coffee with @Ana" three elements matching none of them. Matching the
 * paragraph's whole `textContent` asks the question the test means.
 */
const entryText = (text: string) =>
  screen.findByText((_, el) => el?.tagName === 'P' && el.textContent === text);

/** A mention of Ana on a given day — the raw material of a talking point. */
const mention = (id: string, content: string, patch: Record<string, unknown> = {}) =>
  anEntry({
    id,
    content,
    dateKey: TODAY,
    people: [{ id: PERSON, name: 'Ana' }],
    ...patch,
  });

describe('PersonProfilePage · the header', () => {
  it('shows who this is, with their tags', async () => {
    const work = aTag({ id: 't1', name: 'work' });
    await seed({
      tags: [work],
      people: [aPerson({ id: PERSON, name: 'Ana', tags: [work] })],
    });

    renderProfile();

    expect(await screen.findByRole('heading', { name: 'Ana' })).toBeInTheDocument();
    expect(screen.getByText('#work')).toBeInTheDocument();
  });

  it('offers all four tabs', async () => {
    await seed({ people: [aPerson({ id: PERSON, name: 'Ana' })] });

    renderProfile();

    await screen.findByRole('heading', { name: 'Ana' });
    for (const tab of ['Talking points', 'Events', 'Memories', 'History']) {
      expect(screen.getByRole('tab', { name: tab })).toBeInTheDocument();
    }
  });

  it('keeps the page on screen when the person cannot be read, instead of redirecting', async () => {
    await seed({ people: [] });

    const { router } = renderProfile('p_missing');

    /* This screen used to blank the viewport and send you back to the list without a word, so a
       transient failure and "this person was deleted" were indistinguishable — you tapped a name
       and ended up where you started, with nothing to retry. */
    await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
    expect(router.state.location.pathname).toBe('/people/p_missing');
  });
});

describe('PersonProfilePage · talking points', () => {
  it('suggests an entry that mentions them', async () => {
    await seed({
      people: [aPerson({ id: PERSON, name: 'Ana' })],
      entries: [mention('e1', 'Coffee with @Ana')],
    });

    renderProfile();

    expect(await entryText('Coffee with @Ana')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Mark as said' })).toBeInTheDocument();
  });

  it('says there is nothing to tell rather than showing an empty list', async () => {
    await seed({ people: [aPerson({ id: PERSON, name: 'Ana' })] });

    renderProfile();

    expect(await screen.findByText('Nothing new to tell')).toBeInTheDocument();
    // Named, because "nothing to tell Ana" and "nothing to tell anyone" are different facts.
    expect(screen.getByText(/mention Ana or share their tags/)).toBeInTheDocument();
  });

  /* Grouping comes off the entries' own thread membership, so it needs no extra query — and with
     no threads at all it degenerates to one singleton group per cluster, which is what keeps a
     diary that never used threads looking exactly as it did before they existed. */
  it('gathers a thread’s talking points under one header', async () => {
    const jobHunt = aThread({ id: 'th1', name: 'Job hunt' });
    await seed({
      people: [aPerson({ id: PERSON, name: 'Ana' })],
      threads: [jobHunt],
      entries: [
        mention('e1', 'Ana got an interview', { threads: [jobHunt] }),
        mention('e2', 'Ana is prepping for it', { threads: [jobHunt] }),
        mention('e3', 'Unrelated coffee with @Ana'),
      ],
    });

    renderProfile();

    expect(await screen.findByRole('heading', { name: 'Job hunt' })).toBeInTheDocument();
    // Two in the group, and the ungrouped one rendered on its own outside it.
    expect(screen.getByText('2 to tell')).toBeInTheDocument();
    expect(await entryText('Unrelated coffee with @Ana')).toBeInTheDocument();
  });

  it('marks a whole thread as said in one action, queueing one op per entry', async () => {
    const jobHunt = aThread({ id: 'th1', name: 'Job hunt' });
    await seed({
      people: [aPerson({ id: PERSON, name: 'Ana' })],
      threads: [jobHunt],
      entries: [
        mention('e1', 'Ana got an interview', { threads: [jobHunt] }),
        mention('e2', 'Ana is prepping for it', { threads: [jobHunt] }),
      ],
    });
    const { user } = renderProfile();

    await screen.findByRole('heading', { name: 'Job hunt' });
    await user.click(screen.getByRole('button', { name: 'Mark all' }));

    /* One op per entry, not a bulk endpoint. That keeps replay idempotent and — the reason it
       matters beyond this button — keeps the outbox path at `entries/<id>/said/<person>`, which
       sync.ts parses positionally to protect unpushed edits from a pull. */
    const ops = await waitFor(async () => {
      const queued = await outboxOps();
      expect(queued).toHaveLength(2);
      return queued;
    });
    expect(ops.map((op) => op.path).sort()).toEqual([
      `/entries/e1/said/${PERSON}`,
      `/entries/e2/said/${PERSON}`,
    ]);
    expect(ops.every((op) => op.method === 'PUT')).toBe(true);
  });

  it('undoes a bulk mark against exactly the entries it wrote', async () => {
    const jobHunt = aThread({ id: 'th1', name: 'Job hunt' });
    await seed({
      people: [aPerson({ id: PERSON, name: 'Ana' })],
      threads: [jobHunt],
      entries: [mention('e1', 'Ana got an interview', { threads: [jobHunt] })],
    });
    const { user } = renderProfile();

    await screen.findByRole('heading', { name: 'Job hunt' });
    await user.click(screen.getByRole('button', { name: 'Mark all' }));

    expect(await screen.findByText(/marked as said/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));

    /* The undo replays the ids that were *written*, captured when the button was pressed — so it
       can neither over-reach onto an entry added to the thread since, nor under-reach and leave
       one marked. */
    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.at(-1)).toMatchObject({ method: 'DELETE', path: `/entries/e1/said/${PERSON}` });
    });
  });

  it('keeps what has already been told, behind a fold', async () => {
    await seed({
      people: [aPerson({ id: PERSON, name: 'Ana' })],
      entries: [
        mention('e1', 'Already mentioned this', {
          saidTo: [{ personId: PERSON, at: `${TODAY}T10:00:00.000Z` }],
        }),
      ],
    });
    const { user } = renderProfile();

    // Out of the suggestions, but not gone — it is the record of what you actually discussed.
    expect(await screen.findByText('Nothing new to tell')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /Already told/ }));

    expect(await screen.findByText('Already mentioned this')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Not said yet' })).toBeInTheDocument();
  });

  it('puts a mistakenly marked entry back into the suggestions', async () => {
    await seed({
      people: [aPerson({ id: PERSON, name: 'Ana' })],
      entries: [
        mention('e1', 'Already mentioned this', {
          saidTo: [{ personId: PERSON, at: `${TODAY}T10:00:00.000Z` }],
        }),
      ],
    });
    const { user } = renderProfile();

    await screen.findByText('Nothing new to tell');
    await user.click(screen.getByRole('button', { name: /Already told/ }));
    await user.click(await screen.findByRole('button', { name: 'Not said yet' }));

    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.at(-1)).toMatchObject({ method: 'DELETE', path: `/entries/e1/said/${PERSON}` });
    });
    await waitFor(async () => {
      expect((await repo.getTalkingPoints(PERSON)).active).toHaveLength(1);
    });
  });
});

describe('PersonProfilePage · the checkup banner', () => {
  const overdue = () =>
    seed({
      people: [
        aPerson({
          id: PERSON,
          name: 'Ana',
          checkupIntervalDays: 7,
          lastCheckupAt: '2020-01-01T00:00:00.000Z',
        }),
      ],
    });

  it('says whose checkup is due, and why it is here', async () => {
    await overdue();

    renderProfile();

    expect(await screen.findByText('Time to check up on Ana')).toBeInTheDocument();
    expect(screen.getByText(/since you last marked something as said/)).toBeInTheDocument();
  });

  it('stays away when the checkup is not due', async () => {
    await seed({
      people: [
        aPerson({
          id: PERSON,
          name: 'Ana',
          checkupIntervalDays: 30,
          lastCheckupAt: `${TODAY}T09:00:00.000Z`,
        }),
      ],
    });

    renderProfile();

    await screen.findByRole('heading', { name: 'Ana' });
    expect(screen.queryByText('Time to check up on Ana')).not.toBeInTheDocument();
  });

  it('clears itself when the checkup is marked done', async () => {
    await overdue();
    await seedSettings({ quietNotifications: false });
    const { user } = renderProfile();

    await screen.findByText('Time to check up on Ana');
    await user.click(screen.getByRole('button', { name: /Mark.*done/i }));

    expect(await screen.findByText('Checkup marked as done')).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByText('Time to check up on Ana')).not.toBeInTheDocument(),
    );
    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.at(-1)).toMatchObject({ method: 'PUT', path: `/people/${PERSON}/checkup` });
    });
  });

  it('can be switched off for good, rather than only silenced today', async () => {
    await overdue();
    const { user } = renderProfile();

    await screen.findByText('Time to check up on Ana');
    await user.click(screen.getByRole('button', { name: /Turn off|Disable/i }));

    /* Turning checkups off is a change to the person, not a dismissal of the banner — so it has to
       reach the store, or the reminder comes straight back on the next device. */
    await waitFor(async () => {
      expect((await db.people.get(PERSON))?.checkupIntervalDays).toBeNull();
    });
  });
});

describe('PersonProfilePage · event follow-ups', () => {
  /** An event that finished yesterday and has never been asked about. */
  const finishedYesterday = {
    id: 'evt1',
    title: 'Trip to Lisbon',
    startDate: '2026-08-01',
    endDate: '2026-08-08',
    notes: 'Going with her sister',
    askedAt: null,
    createdAt: '2026-07-01T09:00:00.000Z',
  };

  it('asks you to follow up, and shows the notes you would ask about', async () => {
    await seed({
      people: [aPerson({ id: PERSON, name: 'Ana', events: [finishedYesterday] })],
    });

    renderProfile();

    expect(await screen.findByText(/ask Ana how they went/)).toBeInTheDocument();
    expect(screen.getByText('Trip to Lisbon')).toBeInTheDocument();
    /* The notes are the whole point of the reminder — they are what you would actually ask about,
       so they sit in the banner rather than a tab away. */
    expect(screen.getByText('Going with her sister')).toBeInTheDocument();
  });

  it('marking it asked counts as an interaction, not just a dismissal', async () => {
    await seed({
      people: [
        aPerson({
          id: PERSON,
          name: 'Ana',
          events: [finishedYesterday],
          checkupIntervalDays: 30,
          lastCheckupAt: '2020-01-01T00:00:00.000Z',
        }),
      ],
    });
    const { user } = renderProfile();

    await screen.findByText(/ask Ana how they went/);
    const banner = screen.getByText(/ask Ana how they went/).closest('div')!.parentElement!;
    await user.click(within(banner.parentElement!).getAllByRole('button', { name: /asked/i })[0]);

    await waitFor(async () => {
      const ops = await outboxOps();
      expect(ops.at(-1)).toMatchObject({
        method: 'PUT',
        path: `/people/${PERSON}/events/evt1/asked`,
      });
    });
    /* Asking someone how their trip went *is* talking to them, so it moves the checkup clock too —
       the same rule the server applies on its own copy of this route. Without it you would be
       nagged to check up on someone you spoke to a minute ago. */
    await waitFor(async () => {
      const person = await db.people.get(PERSON);
      expect(Date.parse(person!.lastCheckupAt)).toBeGreaterThan(Date.parse('2020-01-01'));
    });
  });

  it('says nothing when every event has already been asked about', async () => {
    await seed({
      people: [
        aPerson({
          id: PERSON,
          name: 'Ana',
          events: [{ ...finishedYesterday, askedAt: `${TODAY}T09:00:00.000Z` }],
        }),
      ],
    });

    renderProfile();

    await screen.findByRole('heading', { name: 'Ana' });
    expect(screen.queryByText(/ask Ana how they went/)).not.toBeInTheDocument();
  });
});
