import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { ApiKeyField } from './ApiKeyField';

/*
 * The field for a secret the app deliberately cannot read back. What is being pinned down here is
 * the consequence of that: with no value to show, "a key is stored" and "type a key" have to be
 * two different states, and the resting one must never present an input that looks pre-filled.
 *
 * The save rule matters as much. Every other control on the Settings page autosaves on blur; this
 * one must not, because half a pasted key committed by a stray focus change would overwrite a
 * working key with something that cannot authenticate.
 */
const setup = (hasKey: boolean) => {
  const onSave = vi.fn();
  render(
    <ApiKeyField
      id="test-key"
      label="Groq key"
      hint="Get one at example.com"
      placeholder="gsk_…"
      hasKey={hasKey}
      onSave={onSave}
    />,
  );
  return { onSave, user: userEvent.setup() };
};

describe('ApiKeyField', () => {
  it('offers an input when no key is stored', () => {
    setup(false);
    expect(screen.getByLabelText('Groq key')).toHaveValue('');
    expect(screen.queryByText('Key set')).not.toBeInTheDocument();
  });

  it('reports a stored key instead of showing a filled-looking input', () => {
    setup(true);
    expect(screen.getByText('Key set')).toBeInTheDocument();
    // No input at all in the resting state: dots standing in for a secret the page does not have
    // would be a lie about where the key lives.
    expect(screen.queryByLabelText('Groq key')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Replace' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeInTheDocument();
  });

  it('saves a typed key only when Save is pressed', async () => {
    const { onSave, user } = setup(false);

    await user.type(screen.getByLabelText('Groq key'), 'gsk_secret');
    // Leaving the field is not consent — unlike every other control on the page.
    await user.tab();
    expect(onSave).not.toHaveBeenCalled();

    await user.click(screen.getByRole('button', { name: 'Save' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('gsk_secret');
  });

  it('submits on Enter', async () => {
    const { onSave, user } = setup(false);
    await user.type(screen.getByLabelText('Groq key'), 'gsk_secret{Enter}');
    expect(onSave).toHaveBeenCalledExactlyOnceWith('gsk_secret');
  });

  it('will not save an empty or blank key by mistake', async () => {
    const { onSave, user } = setup(false);
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();

    await user.type(screen.getByLabelText('Groq key'), '   ');
    expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('clears the stored key with Remove, which is the one empty save that is intentional', async () => {
    const { onSave, user } = setup(true);
    await user.click(screen.getByRole('button', { name: 'Remove' }));
    expect(onSave).toHaveBeenCalledExactlyOnceWith('');
  });

  it('replaces a stored key, and cancelling leaves it alone', async () => {
    const { onSave, user } = setup(true);

    await user.click(screen.getByRole('button', { name: 'Replace' }));
    await user.type(screen.getByLabelText('Groq key'), 'gsk_new');
    await user.click(screen.getByRole('button', { name: 'Cancel' }));

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByText('Key set')).toBeInTheDocument();

    // And the abandoned draft is gone rather than waiting to be committed later.
    await user.click(screen.getByRole('button', { name: 'Replace' }));
    expect(screen.getByLabelText('Groq key')).toHaveValue('');
  });

  it('does nothing at all while disabled', async () => {
    const onSave = vi.fn();
    render(
      <ApiKeyField
        id="test-key"
        label="Groq key"
        hint="Get one at example.com"
        placeholder="gsk_…"
        hasKey
        disabled
        onSave={onSave}
      />,
    );
    expect(screen.getByRole('button', { name: 'Replace' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Remove' })).toBeDisabled();
  });
});
