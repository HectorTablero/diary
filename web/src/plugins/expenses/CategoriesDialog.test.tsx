import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '@/db/db';
import { createPluginRecord, getUndatedRecords } from '@/db/pluginRecords';
import i18n from '@/i18n';
import { renderWithProviders } from '@/test/renderWithProviders';
import { CategoriesDialog } from './CategoriesDialog';
import en from './locales/en.json';
import { builtinCategoryId, categoryData, resolveCategories } from './model';
import { useCategories } from './useExpenses';

/* The one place a category can disappear: a custom category with no expenses is deleted, one with
   expenses is retired, and a starter is only ever retired, since it's the one kind with its own icon
   and a retired one comes back exactly as it was. */

function Harness({ usage }: { usage: ReadonlyMap<string, number> }) {
  const state = useCategories();
  if (state.loading) return null;
  return <CategoriesDialog open onOpenChange={() => {}} state={state} usage={usage} />;
}

const custom = (name: string) =>
  createPluginRecord(
    'expenses',
    'record',
    UNDATED_KEY,
    categoryData({ builtin: null, name, retired: false }),
  );

const categories = async () => resolveCategories(await getUndatedRecords('expenses'));

beforeEach(async () => {
  i18n.addResourceBundle('en', 'translation', { plugins: { expenses: en } }, true, true);
  await i18n.changeLanguage('en');
  await db.pluginRecords.clear();
  await db.outbox.clear();
});

describe('CategoriesDialog', () => {
  it('deletes an unused custom category, with an undo', async () => {
    const user = userEvent.setup();
    await custom('Pets');
    renderWithProviders(<Harness usage={new Map()} />);

    await screen.findByRole('textbox', { name: 'Rename Pets' });
    // The starters' buttons retire; only the unused custom one offers to delete.
    expect(screen.getAllByRole('button', { name: 'Delete category' })).toHaveLength(1);
    await user.click(screen.getByRole('button', { name: 'Delete category' }));

    await waitFor(async () => {
      expect((await categories()).some((c) => c.name === 'Pets')).toBe(false);
    });
    expect(screen.queryByText('Retired')).not.toBeInTheDocument();

    expect(await screen.findByText('Category “Pets” deleted')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => {
      expect((await categories()).find((c) => c.name === 'Pets')?.retired).toBe(false);
    });
  });

  it('retires a custom category that has expenses', async () => {
    const user = userEvent.setup();
    const row = await custom('Pets');
    renderWithProviders(<Harness usage={new Map([[row.id, 3]])} />);

    await screen.findByRole('textbox', { name: 'Rename Pets' });
    expect(screen.queryByRole('button', { name: 'Delete category' })).not.toBeInTheDocument();
    const retire = screen.getAllByRole('button', { name: 'Retire category' }).at(-1)!;
    await user.click(retire);

    await waitFor(async () => {
      expect((await categories()).find((c) => c.name === 'Pets')?.retired).toBe(true);
    });
  });

  it('retires an unused starter rather than deleting it', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness usage={new Map()} />);

    await screen.findByRole('textbox', { name: 'Rename Groceries' });
    await user.click(screen.getAllByRole('button', { name: 'Retire category' })[0]);

    await waitFor(async () => {
      const groceries = (await categories()).find((c) => c.id === builtinCategoryId('groceries'));
      expect(groceries?.retired).toBe(true);
    });
    expect(await screen.findByText('Retired')).toBeInTheDocument();
  });
});
