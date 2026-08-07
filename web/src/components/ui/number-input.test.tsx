import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NumberInput } from './number-input';

/*
 * NumberInput carries the rule that makes the Settings page work without a Save button: typing is
 * a draft, while stepping or leaving the field is the user saying they meant it. Everything below
 * is about that distinction, and about the empty field being a legitimate state on the way from
 * one number to another — the case that silently wrote a default over a half-typed value before
 * `onCommit` existed.
 */

/** Mirrors how the Settings page drives it: the parent owns the value, so the field is controlled. */
function Controlled({
  initial = 10,
  onCommit,
  ...props
}: { initial?: number; onCommit?: (value: number) => void } & Partial<
  React.ComponentProps<typeof NumberInput>
>) {
  const [value, setValue] = useState(initial);
  return (
    <NumberInput
      value={value}
      onChange={setValue}
      onCommit={onCommit}
      aria-label="Days"
      stepDownLabel="Less"
      stepUpLabel="More"
      {...props}
    />
  );
}

const field = () => screen.getByLabelText('Days');

describe('NumberInput', () => {
  it('steps by one and commits immediately', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Controlled initial={10} onCommit={onCommit} />);

    await user.click(screen.getByLabelText('More'));
    expect(field()).toHaveValue(11);
    expect(onCommit).toHaveBeenLastCalledWith(11);

    await user.click(screen.getByLabelText('Less'));
    expect(field()).toHaveValue(10);
    expect(onCommit).toHaveBeenLastCalledWith(10);
  });

  it('does not commit while the value is being typed', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Controlled initial={10} onCommit={onCommit} />);

    await user.clear(field());
    await user.type(field(), '25');

    expect(field()).toHaveValue(25);
    expect(onCommit).not.toHaveBeenCalled();
  });

  it('commits the settled value on blur', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Controlled initial={10} onCommit={onCommit} />);

    await user.clear(field());
    await user.type(field(), '25');
    await user.tab();

    expect(onCommit).toHaveBeenCalledWith(25);
  });

  it('leaves an emptied field alone until it is left, then restores the last good value', async () => {
    const user = userEvent.setup();
    const onCommit = vi.fn();
    render(<Controlled initial={180} onCommit={onCommit} />);

    // Clearing 180 is the only way to type 365 — the field must tolerate being empty rather than
    // snapping back to the minimum mid-edit.
    await user.clear(field());
    expect(field()).toHaveValue(null);
    expect(onCommit).not.toHaveBeenCalled();

    await user.tab();
    expect(field()).toHaveValue(180);
    expect(onCommit).toHaveBeenCalledWith(180);
  });

  it('clamps out-of-range input on blur rather than while typing', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={50} min={1} max={99} />);

    await user.clear(field());
    await user.type(field(), '250');
    // Still shows what was typed: clamping mid-edit would fight the user.
    expect(field()).toHaveValue(250);

    await user.tab();
    expect(field()).toHaveValue(99);
  });

  it('disables the step buttons at each end of the range', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={2} min={1} max={3} />);

    await user.click(screen.getByLabelText('Less'));
    expect(field()).toHaveValue(1);
    expect(screen.getByLabelText('Less')).toBeDisabled();
    expect(screen.getByLabelText('More')).toBeEnabled();

    await user.click(screen.getByLabelText('More'));
    await user.click(screen.getByLabelText('More'));
    expect(field()).toHaveValue(3);
    expect(screen.getByLabelText('More')).toBeDisabled();
  });

  it('steps from the last good value when the field is empty', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={7} />);

    await user.clear(field());
    await user.click(screen.getByLabelText('More'));

    // 8, not 1: an empty field means "mid-edit", not "zero".
    expect(field()).toHaveValue(8);
  });
});
