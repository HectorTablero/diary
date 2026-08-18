import 'fake-indexeddb/auto';
import { screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { db } from '@/db/db';
import { createPluginDocument, putDocumentRevision } from '@/db/pluginDocuments';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { revisionFor } from './history';
import en from './locales/en.json';
import { NotebookDayWidget } from './NotebookDayWidget';

/* The day card's whole job is knowing when *not* to be there.
 *
 * It is the one plugin surface with an explicit rule about absence: today always has something to
 * say, and a past day has something to say only if something was actually written that day. A card
 * that appeared on every day of the diary to report that nothing happened is the complaint any
 * always-present widget earns, and there is no such thing as backdating a thought — a revision is
 * dated by the day it was written, never by the day being looked at. */

const TODAY = '2026-08-18';
const PAST = '2026-08-11';

const seed = async (title: string, dateKey: string, text: string) => {
  const doc = await createPluginDocument('notebook', {
    parentId: '',
    title,
    body: text,
    sortKey: 'a0',
  });
  const { patch, added, removed } = revisionFor('', text);
  await putDocumentRevision('notebook', doc.id, dateKey, patch, added, removed);
  return doc;
};

const render = (dateKey: string) =>
  renderWithProviders(<NotebookDayWidget dateKey={dateKey} />, { toaster: false });

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { notebook: en } }, true, true);
  await db.pluginDocuments.clear();
  await db.outbox.clear();
  // Date only — waitFor needs its timers real. Same reasoning as the habits widget tests.
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(`${TODAY}T12:00:00.000Z`) });
});

afterEach(() => {
  vi.useRealTimers();
});

describe('today', () => {
  it('asks the question, and offers a way in, when nothing has been written', async () => {
    render(TODAY);
    expect(await screen.findByText(en.dayPrompt)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: en.open })).toHaveAttribute(
      'href',
      '/plugins/notebook',
    );
  });

  it('links what was written instead of asking again', async () => {
    const doc = await seed('Writing', TODAY, 'Everything I keep noticing.');
    render(TODAY);

    const link = await screen.findByRole('link', { name: /Writing/ });
    expect(link).toHaveAttribute('href', `/plugins/notebook?doc=${doc.id}`);
    // The prompt is for a blank day. Asking whether there is anything to write, under a list of
    // what was written, reads as not having noticed.
    expect(screen.queryByText(en.dayPrompt)).not.toBeInTheDocument();
  });

  it('titles a document by its first line when it has no title of its own', async () => {
    await seed('', TODAY, '# Cold showers\n\nNo effect, as far as I can tell.');
    render(TODAY);
    expect(await screen.findByRole('link', { name: /Cold showers/ })).toBeInTheDocument();
  });
});

describe('a past day', () => {
  it('renders nothing at all when nothing was written that day', async () => {
    // Written *today*, so the past day has nothing of its own — this is the case that would
    // otherwise put an empty card on every day of the diary.
    await seed('Writing', TODAY, 'Everything I keep noticing.');
    const { container } = render(PAST);

    await waitFor(() => expect(container).toBeEmptyDOMElement());
    expect(screen.queryByText(en.dayPrompt)).not.toBeInTheDocument();
  });

  it('shows what was written that day, without the prompt', async () => {
    await seed('Walking', PAST, 'Walking helps me think.');
    render(PAST);

    expect(await screen.findByRole('link', { name: /Walking/ })).toBeInTheDocument();
    expect(screen.queryByText(en.dayPrompt)).not.toBeInTheDocument();
    // No way in either: the card is a record of that day, not an invitation to add to it.
    expect(screen.queryByRole('link', { name: en.open })).not.toBeInTheDocument();
  });

  it('ignores a revision whose document has since been deleted', async () => {
    const doc = await seed('Gone', PAST, 'Something written and then thrown away.');
    await db.pluginDocuments.delete(doc.id);

    const { container } = render(PAST);
    await waitFor(() => expect(container).toBeEmptyDOMElement());
  });
});
