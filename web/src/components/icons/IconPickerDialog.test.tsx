import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { loadIconCatalog } from './iconCatalog';
import { IconPickerDialog } from './IconPickerDialog';

/* The picker over the real catalog (served by scripts/lucideIcons.mjs through vitest.config.ts).
   jsdom has no layout, so the grid falls back to its assumed size — which is still a small fraction
   of ~1,800 icons, and that is the point of the first test. */

function open(props: Partial<Parameters<typeof IconPickerDialog>[0]> = {}) {
  const onChange = vi.fn();
  renderWithProviders(
    <IconPickerDialog
      open
      onOpenChange={() => {}}
      value={null}
      onChange={onChange}
      emptyOption={{ label: 'No icon' }}
      {...props}
    />,
  );
  return { onChange, dialog: screen.getByRole('dialog') };
}

const grid = () => screen.findByRole('group', { name: 'Icons' }, { timeout: 5000 });

describe('IconPickerDialog', () => {
  /* Paid once, up front, under a timeout sized for it.

     The catalog is a module generated from every Lucide icon, and the first import of it in a worker
     transforms the lot — measured at ~5.3 s on its own, longer again on a busy parallel run. That
     used to land inside whichever test opened the picker first, against the 5 s the grid lookup
     waits, so that test failed — and a load slow enough could outlast the next few too, which is how
     every test in this file came to fail at once while each passed when re-run. The picker shares
     this module-level cache, so once it is warm the tests below time the picker, not the bundler.
     iconSearch is the picker's other lazy import, warmed for the same reason. */
  beforeAll(async () => {
    await Promise.all([loadIconCatalog(), import('./iconSearch')]);
  }, 60_000);

  it('renders only the rows in view, not the whole set', async () => {
    open();
    const cells = within(await grid()).getAllByRole('button');
    expect(cells.length).toBeGreaterThan(8);
    expect(cells.length).toBeLessThan(200);
    expect(screen.getByRole('button', { name: 'No icon' })).toHaveAttribute('aria-pressed', 'true');
  });

  it('is one tab stop, moved with the arrow keys', async () => {
    const user = userEvent.setup();
    open();
    const cells = within(await grid()).getAllByRole('button');
    expect(cells.filter((cell) => cell.tabIndex === 0)).toHaveLength(1);

    cells[0].focus();
    await user.keyboard('{ArrowRight}');
    expect(document.activeElement).toBe(cells[1]);
    await user.keyboard('{ArrowLeft}');
    expect(document.activeElement).toBe(cells[0]);
  });

  it('reaches the end of the list from the keyboard, rendering it on the way', async () => {
    const user = userEvent.setup();
    open();
    within(await grid())
      .getAllByRole('button')[0]
      .focus();
    await user.keyboard('{Control>}{End}{/Control}');
    // The last icon alphabetically; it did not exist in the DOM until focus moved there.
    expect(document.activeElement).toHaveAccessibleName(/^zoom out$/);
  });

  it('stores null for the empty option, and a name for an icon', async () => {
    const user = userEvent.setup();
    const { onChange } = open({ value: 'apple' });
    await user.type(screen.getByRole('searchbox'), 'banana');
    await user.click(await within(await grid()).findByRole('button', { name: 'banana' }));
    expect(onChange).toHaveBeenLastCalledWith('banana');

    await user.click(screen.getByRole('button', { name: 'No icon' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('says so when nothing matches', async () => {
    const user = userEvent.setup();
    open();
    await grid();
    await user.type(screen.getByRole('searchbox'), 'qqqqzzzz');
    expect(await screen.findByText('No icons match “qqqqzzzz”.')).toBeInTheDocument();
  });
});
