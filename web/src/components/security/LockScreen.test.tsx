import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { disableLock, getLockState, lockNow, setPasscode, verifyPasscode } from '@/lib/appLock';
import { LockScreen } from './LockScreen';

/* Only `trackEvent` is replaced, and only to capture what it was handed. Everything else in
   lib/telemetry stays real — `captureError` is imported by the ErrorBoundary and the db layer, and
   a wholesale module mock would quietly disarm both. Under test the module has nowhere to report
   to anyway, so this is a recorder rather than a stub of behaviour. */
const events = vi.hoisted(() => ({
  list: [] as { name: string; fields: Record<string, unknown> }[],
}));
vi.mock('@/lib/telemetry', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/telemetry')>()),
  trackEvent: (name: string, fields: Record<string, unknown> = {}) =>
    events.list.push({ name, fields }),
}));

/* The gate in front of the diary, exercised against the real PBKDF2 implementation rather than a
   mocked `verifyPasscode` — which is the only version of this test worth having. The thing that
   could actually go wrong here is the derivation or the stored shape, and a mock asserts neither.
   `setup.ts` swaps in Node's webcrypto for exactly this: jsdom has `crypto.randomUUID` but no
   `crypto.subtle`.

   210,000 iterations is ~100-200ms per verify, and these tests set *and* check a passcode, which
   is why the components project runs with a raised testTimeout. */

const PASSCODE = '4821';

beforeEach(async () => {
  // Real storage, real hashing: the lock deliberately lives in localStorage rather than the synced
  // settings (it describes this device), so there is nothing to seed in Dexie.
  localStorage.clear();
  await setPasscode(PASSCODE);
  lockNow();
  // After the setup, so a test only ever sees what it caused.
  events.list = [];
});

/** Every unlock attempt reported so far, in order. */
const unlockEvents = () => events.list.filter((event) => event.name === 'app_lock_unlock');

const setup = () => ({ user: userEvent.setup(), ...renderWithProviders(<LockScreen />) });

describe('LockScreen', () => {
  it('asks for a passcode and offers no way past until one is typed', () => {
    setup();

    expect(screen.getByText('Diary is locked')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Unlock' })).toBeDisabled();
  });

  it('rejects a wrong passcode, says so, and stays locked', async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText('Passcode'), '0000');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    /* role="alert", so a screen reader is told without having to be looking at the field. Waited on
       by *content*, not by appearance: the element is always in the DOM and merely empty until
       there is something to say — it reserves its line so a wrong passcode doesn't shift the button
       out from under the thumb about to press it again — so `findByRole('alert')` resolves
       immediately against the empty one. */
    await waitFor(() =>
      expect(screen.getByRole('alert')).toHaveTextContent('That passcode is not right.'),
    );
    expect(getLockState().locked).toBe(true);
    // Cleared, so the next attempt starts from nothing rather than from a wrong guess.
    await waitFor(() => expect(screen.getByLabelText('Passcode')).toHaveValue(''));
  });

  it('unlocks on the right passcode', async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText('Passcode'), PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(getLockState().locked).toBe(false));
  });

  it('submits on Enter, so the lock can be cleared without reaching for the button', async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText('Passcode'), `${PASSCODE}{Enter}`);

    await waitFor(() => expect(getLockState().locked).toBe(false));
  });

  /* The security claim the whole module exists to make. Storing the passcode — or anything it could
     be recovered from — would make the lock decorative, and localStorage is trivially readable by
     anyone holding the unlocked device this is meant to defend against. */
  it('stores only a salted hash, never the passcode itself', () => {
    const raw = localStorage.getItem('appLock');

    expect(raw).not.toBeNull();
    expect(raw).not.toContain(PASSCODE);
    const stored = JSON.parse(raw!) as { hash: string; salt: string; iterations: number };
    expect(stored.hash).toBeTruthy();
    expect(stored.salt).toBeTruthy();
    expect(stored.hash).not.toBe(PASSCODE);
    // The cost is part of the stored record, so an old entry keeps verifying if the constant moves.
    expect(stored.iterations).toBeGreaterThanOrEqual(100_000);
  });

  it('does not offer biometrics on a device that has none', () => {
    setup();

    // Off native there is no plugin, so the fast path must not be advertised at all.
    expect(screen.queryByRole('button', { name: 'Use biometrics' })).not.toBeInTheDocument();
  });
});

/* What the lock reports, which is a security surface in its own right.
 *
 * The module's whole promise is that the passcode and everything it could be recovered from stay on
 * the device — and a telemetry pipeline is exactly the sort of place that promise gets broken by
 * accident, by someone adding "just the input for debugging". These tests fail if that ever
 * happens, which no amount of reading the code reliably does.
 *
 * The `context` field is the other half. `lock_screen`, `settings` and `delete_account` are the same
 * two functions used for genuinely different things, and the numbers only mean anything apart: a
 * high failure rate at the lock screen is someone shut out of their own diary, while a high failure
 * rate in front of an irreversible delete is the system working.
 */
describe('LockScreen · what it reports', () => {
  it('reports a failed unlock, tagged with the gate it happened at', async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText('Passcode'), '0000');
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(unlockEvents()).toHaveLength(1));
    expect(unlockEvents()[0].fields).toMatchObject({
      method: 'passcode',
      context: 'lock_screen',
      ok: false,
    });
  });

  it('reports a successful unlock the same way', async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText('Passcode'), PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(getLockState().locked).toBe(false));
    /* Both outcomes, because a success rate needs a denominator — reporting only failures would
       make a quiet week indistinguishable from a broken lock nobody could get past. */
    expect(unlockEvents()).toHaveLength(1);
    expect(unlockEvents()[0].fields).toMatchObject({ ok: true, context: 'lock_screen' });
  });

  it('never carries the passcode, the hash, the salt or the iteration count', async () => {
    const { user } = setup();

    await user.type(screen.getByLabelText('Passcode'), PASSCODE);
    await user.click(screen.getByRole('button', { name: 'Unlock' }));

    await waitFor(() => expect(unlockEvents()).toHaveLength(1));
    const stored = JSON.parse(localStorage.getItem('appLock')!) as { hash: string; salt: string };
    const payload = JSON.stringify(unlockEvents()[0]);
    for (const secret of [PASSCODE, stored.hash, stored.salt]) {
      expect(payload).not.toContain(secret);
    }
    // Outcome fields only — nothing that describes the credential itself.
    expect(Object.keys(unlockEvents()[0].fields).sort()).toEqual([
      'context',
      'method',
      'ok',
      'reason',
    ]);
  });

  it('says nothing at all when there is no lock to pass', async () => {
    await disableLock(PASSCODE);
    events.list = [];

    await expect(verifyPasscode('anything', 'lock_screen')).resolves.toBe(true);

    /* A vacuous pass, not an unlock. Reporting it would put a permanent `ok: true` baseline under
       the success rate of every device that has never turned the lock on — which would make the
       one number this event exists to produce meaningless. */
    expect(unlockEvents()).toHaveLength(0);
  });
});
