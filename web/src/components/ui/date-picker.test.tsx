import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { DatePicker } from './date-picker';

/*
 * The app's replacement for `<input type="date">`, and now the only date control it has — the
 * diary heading used to open the browser's native one instead. These cover the contract every
 * caller relies on: the value stays a plain `YYYY-MM-DD` string, min/max are honoured, and the
 * `trigger` escape hatch (which is what let the diary heading adopt it) really does replace the
 * default button rather than sit next to it.
 */
function Controlled({ initial = '', ...props }: { initial?: string } & Partial<React.ComponentProps<typeof DatePicker>>) {
  const [value, setValue] = useState(initial);
  return <DatePicker value={value} onChange={setValue} aria-label="Date" {...props} />;
}

const open = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByLabelText('Date'));
  return screen.findByRole('dialog');
};

describe('DatePicker', () => {
  it('shows the placeholder when empty and the date once set', async () => {
    const user = userEvent.setup();
    render(<Controlled placeholder="Pick a day" />);
    expect(screen.getByLabelText('Date')).toHaveTextContent('Pick a day');

    await open(user);
    await user.click(screen.getByRole('button', { name: 'Today' }));

    expect(screen.getByLabelText('Date')).not.toHaveTextContent('Pick a day');
  });

  it('reports the chosen day as a YYYY-MM-DD string', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-08-07" onChange={onChange} aria-label="Date" />);

    await open(user);
    await user.click(screen.getByRole('button', { name: '12' }));

    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-08-12');
  });

  it('closes once a day is picked', async () => {
    const user = userEvent.setup();
    render(<Controlled initial="2026-08-07" />);

    await open(user);
    await user.click(screen.getByRole('button', { name: '12' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('blocks days outside min/max', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<DatePicker value="2026-08-15" onChange={onChange} min="2026-08-10" max="2026-08-20" aria-label="Date" />);

    await open(user);
    expect(screen.getByRole('button', { name: '5' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '25' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '15' })).toBeEnabled();
  });

  it('only offers Clear when the field is clearable and actually has a value', async () => {
    const user = userEvent.setup();
    const { unmount } = render(<Controlled initial="2026-08-07" clearable />);

    await open(user);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(screen.getByLabelText('Date')).toHaveTextContent('Select a date');

    // Nothing left to clear, so the action goes away rather than becoming a no-op.
    await open(user);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();

    unmount();
    render(<Controlled initial="2026-08-07" />);
    await open(user);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('uses a supplied trigger instead of its own button', async () => {
    const user = userEvent.setup();
    render(
      <Controlled
        initial="2026-08-07"
        trigger={<button type="button">Thursday, 7 August</button>}
      />,
    );

    // The default field-shaped button is gone entirely — this is what the diary heading needs.
    expect(screen.queryByLabelText('Date')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Thursday, 7 August' }));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });
});
