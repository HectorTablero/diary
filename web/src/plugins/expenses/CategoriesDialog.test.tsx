import 'fake-indexeddb/auto';
import { UNDATED_KEY } from '@diary/shared';
import { screen, waitFor, within } from '@testing-library/react';
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

/* The one place a category can disappear: any category with no expenses is deleted — a starter
   included, now that every category can carry any icon — and one with expenses is only retired. */

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
    // Nothing is in use, so every row — starters too — offers to delete. Pets is the last.
    const deletes = screen.getAllByRole('button', { name: 'Delete category' });
    expect(deletes).toHaveLength((await categories()).length);
    await user.click(deletes.at(-1)!);

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
    // The unused starters still delete; Pets, the one in use, is the only row that retires.
    await user.click(screen.getByRole('button', { name: 'Retire category' }));

    await waitFor(async () => {
      expect((await categories()).find((c) => c.name === 'Pets')?.retired).toBe(true);
    });
  });

  it('deletes an unused starter, and undo brings it back as it was', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness usage={new Map()} />);

    await screen.findByRole('textbox', { name: 'Rename Groceries' });
    await user.click(screen.getAllByRole('button', { name: 'Delete category' })[0]);

    const groceries = async () =>
      (await categories()).find((c) => c.id === builtinCategoryId('groceries'));
    await waitFor(async () => expect(await groceries()).toBeUndefined());
    expect(screen.queryByText('Retired')).not.toBeInTheDocument();

    expect(await screen.findByText('Category “Groceries” deleted')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Undo' }));
    await waitFor(async () => expect((await groceries())?.retired).toBe(false));
    // The override row is reused rather than a second one piling up beside it.
    expect(await getUndatedRecords('expenses')).toHaveLength(1);
  });

  it('retires a starter that has expenses', async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness usage={new Map([[builtinCategoryId('groceries'), 2]])} />);

    await screen.findByRole('textbox', { name: 'Rename Groceries' });
    await user.click(screen.getByRole('button', { name: 'Retire category' }));

    await waitFor(async () => {
      const groceries = (await categories()).find((c) => c.id === builtinCategoryId('groceries'));
      expect(groceries?.retired).toBe(true);
    });
    expect(await screen.findByText('Retired')).toBeInTheDocument();
  });

  it("changes a starter's icon, showing its default as selected until then", async () => {
    const user = userEvent.setup();
    renderWithProviders(<Harness usage={new Map()} />);

    await user.click(await screen.findByRole('button', { name: 'Change icon of Groceries' }));
    const picker = await screen.findByRole('dialog', { name: 'Icon for Groceries' });
    // On its default: the "Default" row and the starter's own icon in the grid are both marked.
    expect(within(picker).getByRole('button', { name: 'Default' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    expect(
      await within(picker).findByRole('button', { name: 'shopping basket' }, { timeout: 5000 }),
    ).toHaveAttribute('aria-pressed', 'true');

    await user.type(within(picker).getByRole('searchbox', { name: 'Search icons' }), 'apple');
    await user.click(await within(picker).findByRole('button', { name: 'apple' }));

    await waitFor(async () => {
      const groceries = (await categories()).find((c) => c.id === builtinCategoryId('groceries'));
      expect(groceries?.iconName).toBe('apple');
    });
  });
});
