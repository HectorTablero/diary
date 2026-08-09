import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderWithProviders } from '@/test/renderWithProviders';
import { seed } from '@/test/seed';
import { disableLock, getLockState, setPasscode, verifyPasscode } from '@/lib/appLock';
import { SecuritySection } from './SecuritySection';

/* Setting, changing and removing the passcode, against the real PBKDF2 rather than a stubbed
 * `verifyPasscode`. Mocking the crypto here would leave nothing worth asserting: the two things
 * that can actually go wrong are the *stored shape* — a blob that holds anything the passcode can
 * be recovered from makes the whole module decorative — and the two-questions-in-three-combinations
 * dialog, and a mock speaks to neither.
 *
 * 210,000 iterations is ~100–200ms per derivation and several of these pay it three times over, so
 * this file is a deliberate consumer of the components project's raised testTimeout.
 */

const PASSCODE = '4821';
const NEW_PASSCODE = '9137';

/* The lock's state is a module-level singleton read from localStorage exactly once, at import — so
   clearing storage between tests is *not* enough on its own: the previous test's config would still
   be in memory and the switch would render as already on. Setting a known passcode and immediately
   disabling it drives the module through its own API back to "no lock", whatever the last test
   left behind. Two derivations of setup cost, and no reliance on internals. */
const RESET_PASSCODE = '0000';

beforeEach(async () => {
  await setPasscode(RESET_PASSCODE);
  await disableLock(RESET_PASSCODE);
  localStorage.clear();
  await seed({});
});

const setup = () => ({ user: userEvent.setup(), ...renderWithProviders(<SecuritySection />) });

/** Fill the "new passcode twice" half of the dialog. */
const typeNewPasscode = async (
  user: ReturnType<typeof userEvent.setup>,
  next: string,
  confirm = next,
) => {
  await user.type(await screen.findByLabelText('New passcode'), next);
  await user.type(screen.getByLabelText('Confirm passcode'), confirm);
};

const turnOn = async (user: ReturnType<typeof userEvent.setup>, passcode = PASSCODE) => {
  await user.click(screen.getByRole('switch', { name: 'Require a passcode' }));
  await typeNewPasscode(user, passcode);
  await user.click(within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }));
  await waitFor(() => expect(getLockState().config).not.toBeNull());
};

describe('SecuritySection · turning the lock on', () => {
  it('offers the lock as off, with nothing to configure yet', () => {
    setup();

    expect(screen.getByRole('switch', { name: 'Require a passcode' })).not.toBeChecked();
    // The grace period and the change button belong to a lock that exists.
    expect(screen.queryByText('Lock when closed')).not.toBeInTheDocument();
  });

  it('stores only a salted hash, never the passcode or anything it can be read from', async () => {
    const { user } = setup();

    await turnOn(user);

    /* The security claim of the entire module, asserted against the bytes that actually get
       written. localStorage is trivially readable by exactly the person this lock defends
       against — someone holding the unlocked device — so a passcode anywhere in here would make
       the whole feature theatre. */
    const raw = localStorage.getItem('appLock');
    expect(raw).not.toBeNull();
    expect(raw).not.toContain(PASSCODE);

    const stored = JSON.parse(raw!) as {
      hash: string;
      salt: string;
      iterations: number;
      graceSeconds: number;
    };
    expect(stored.hash).toBeTruthy();
    expect(stored.salt).toBeTruthy();
    expect(stored.hash).not.toBe(PASSCODE);
    // The cost lives in the record, so raising the constant later cannot invalidate old locks.
    expect(stored.iterations).toBeGreaterThanOrEqual(100_000);
    // A minute, not zero: see the note on DEFAULT_GRACE_SECONDS. A lock that challenges every
    // glance at a notification is a lock people switch off.
    expect(stored.graceSeconds).toBe(60);

    // And it verifies — a hash that stores fine but matches nothing locks the user out forever.
    await expect(verifyPasscode(PASSCODE, 'settings')).resolves.toBe(true);
  });

  it('mints a fresh salt per passcode, so two identical codes do not hash alike', async () => {
    const { user } = setup();

    await turnOn(user);
    const first = JSON.parse(localStorage.getItem('appLock')!) as { hash: string; salt: string };

    await setPasscode(PASSCODE);
    const second = JSON.parse(localStorage.getItem('appLock')!) as { hash: string; salt: string };

    expect(second.salt).not.toBe(first.salt);
    expect(second.hash).not.toBe(first.hash);
  });

  it('confirms out loud, because nothing else on screen proves it worked', async () => {
    const { user } = setup();

    await turnOn(user);

    /* `important: true`, so this survives the quiet-notifications preference (which defaults to
       on). Saying nothing after someone sets a passcode reads as a failure, and the only other
       visible change is a switch they just flipped themselves. */
    expect(await screen.findByText('Passcode saved')).toBeInTheDocument();
  });

  it('refuses a passcode too short to be worth having', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('switch', { name: 'Require a passcode' }));
    await typeNewPasscode(user, '12');
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('Use at least 4 characters.');
    expect(getLockState().config).toBeNull();
  });

  it('refuses two passcodes that do not agree', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('switch', { name: 'Require a passcode' }));
    await typeNewPasscode(user, PASSCODE, '4822');
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );

    /* The confirm field is the only defence against a typo, and a typo here is unrecoverable —
       there is no reset, by design. */
    expect(await screen.findByRole('alert')).toHaveTextContent('The two passcodes do not match.');
    expect(getLockState().config).toBeNull();
  });

  it('warns that a forgotten passcode cannot be recovered, while one is being chosen', async () => {
    const { user } = setup();

    await user.click(screen.getByRole('switch', { name: 'Require a passcode' }));

    // Said at the moment it can still be acted on, not in a help page afterwards.
    expect(await screen.findByText(/no way to recover this passcode/i)).toBeInTheDocument();
  });
});

describe('SecuritySection · living with the lock', () => {
  it('exposes how long the app may sit in the background', async () => {
    const { user } = setup();
    await turnOn(user);

    /* The controls only exist once a lock does — a grace period for a lock that isn't on is a
       setting for nothing. */
    expect(await screen.findByText('Lock when closed')).toBeInTheDocument();
    await user.click(screen.getByRole('combobox'));
    await user.click(await screen.findByRole('option', { name: 'Immediately' }));

    await waitFor(() => expect(getLockState().config?.graceSeconds).toBe(0));
    // Written through, not merely held in state: the choice has to survive the app being killed.
    expect(
      (JSON.parse(localStorage.getItem('appLock')!) as { graceSeconds: number }).graceSeconds,
    ).toBe(0);
  });

  it('requires the current passcode before accepting a new one', async () => {
    const { user } = setup();
    await turnOn(user);

    await user.click(await screen.findByRole('button', { name: 'Change passcode' }));
    await user.type(await screen.findByLabelText('Current passcode'), 'wrong');
    await typeNewPasscode(user, NEW_PASSCODE);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('That passcode is not right.');
    // Still the old one — a change that half-applied would be worse than one that failed.
    await expect(verifyPasscode(PASSCODE, 'settings')).resolves.toBe(true);
  });

  it('changes the passcode when the current one is right', async () => {
    const { user } = setup();
    await turnOn(user);

    await user.click(await screen.findByRole('button', { name: 'Change passcode' }));
    await user.type(await screen.findByLabelText('Current passcode'), PASSCODE);
    await typeNewPasscode(user, NEW_PASSCODE);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Save' }),
    );

    await waitFor(async () => {
      await expect(verifyPasscode(NEW_PASSCODE, 'settings')).resolves.toBe(true);
    });
    await expect(verifyPasscode(PASSCODE, 'settings')).resolves.toBe(false);
  });

  it('will not switch the lock off for someone who cannot already pass it', async () => {
    const { user } = setup();
    await turnOn(user);

    await user.click(screen.getByRole('switch', { name: 'Require a passcode' }));
    await user.type(await screen.findByLabelText('Current passcode'), 'wrong');
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn off the lock' }),
    );

    expect(await screen.findByRole('alert')).toHaveTextContent('That passcode is not right.');
    expect(getLockState().config).not.toBeNull();
  });

  it('switches the lock off, and takes the stored record with it', async () => {
    const { user } = setup();
    await turnOn(user);

    await user.click(screen.getByRole('switch', { name: 'Require a passcode' }));
    await user.type(await screen.findByLabelText('Current passcode'), PASSCODE);
    await user.click(
      within(await screen.findByRole('dialog')).getByRole('button', { name: 'Turn off the lock' }),
    );

    await waitFor(() => expect(getLockState().config).toBeNull());
    // Not merely forgotten in memory: a leftover blob would lock the app again on next launch.
    expect(localStorage.getItem('appLock')).toBeNull();
    expect(await screen.findByText('Lock turned off')).toBeInTheDocument();
  });

  it('does not advertise biometrics on a device that has none', async () => {
    const { user } = setup();
    await turnOn(user);

    await screen.findByRole('button', { name: 'Change passcode' });
    /* Off native there is no plugin at all, so `biometryAvailable()` is false and the switch must
       be absent rather than present-and-broken — the same rule the Reminders block follows. */
    expect(
      screen.queryByRole('switch', { name: 'Unlock with biometrics' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Use biometrics' })).not.toBeInTheDocument();
  });
});
