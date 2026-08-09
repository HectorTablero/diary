import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

/*
 * The only irreversible action in the app, so what is pinned down here is everything standing
 * between a tap and a deleted diary — and, just as much, that none of it fires early.
 *
 * Every guard below is one a refactor could remove without breaking a single other test: the
 * button would still work, the request would still be sent, the diary would still be erased. It
 * would just be erased by people who hadn't finished deciding.
 */

const {
  apiDelete,
  ApiErrorMock,
  endSession,
  navigate,
  lock,
  promptBiometrics,
  verifyPasscode,
  saveTextFile,
  syncStatus,
  googleReauth,
  resume,
  markResume,
  forgetResume,
} = vi.hoisted(() => ({
  apiDelete: vi.fn(),
  ApiErrorMock: class ApiError extends Error {
    constructor(
      public status: number,
      public code: string,
    ) {
      super(code);
    }
  },
  endSession: vi.fn(),
  navigate: vi.fn(),
  lock: { config: null as { biometrics: boolean } | null },
  promptBiometrics: vi.fn(),
  verifyPasscode: vi.fn(),
  saveTextFile: vi.fn(),
  syncStatus: { blocker: null as string | null },
  googleReauth: vi.fn(),
  resume: { active: false },
  markResume: vi.fn(),
  forgetResume: vi.fn(),
}));

vi.mock('@/db/useSyncStatus', () => ({ useSyncStatus: () => syncStatus }));

vi.mock('@/lib/apiClient', () => ({ apiDelete, ApiError: ApiErrorMock, API_BASE: '' }));
vi.mock('@/lib/endSession', () => ({ endSession }));
vi.mock('@/lib/googleSignIn', () => ({ googleReauth }));
vi.mock('@/lib/deleteAccountResume', () => ({
  resumingAccountDeletion: () => resume.active,
  markAccountDeletionResume: markResume,
  forgetAccountDeletionResume: forgetResume,
}));
vi.mock('react-router', () => ({ useNavigate: () => navigate }));
vi.mock('@/lib/appLock', () => ({
  getLockState: () => lock,
  promptBiometrics,
  verifyPasscode,
  biometryAvailable: () => Promise.resolve(true),
}));
vi.mock('@/lib/backup/export', () => ({
  buildBackupEnvelope: () => Promise.resolve({ exportedAt: '2026-08-08T00:00:00.000Z' }),
}));
vi.mock('@/lib/fileSave', () => ({ saveTextFile }));
vi.mock('@/lib/notify', () => ({ notifyError: () => {}, notifySuccess: () => {} }));

const { DeleteAccountDialog } = await import('./DeleteAccountDialog');

const setup = () => {
  render(<DeleteAccountDialog open onOpenChange={() => {}} />);
  return userEvent.setup();
};

const deleteButton = () => screen.getAllByRole('button', { name: 'Delete everything' }).at(-1)!;

beforeEach(() => {
  apiDelete.mockReset().mockResolvedValue(undefined);
  endSession.mockReset().mockResolvedValue(undefined);
  navigate.mockReset();
  promptBiometrics.mockReset().mockResolvedValue(false);
  verifyPasscode.mockReset();
  saveTextFile.mockReset().mockResolvedValue(undefined);
  googleReauth.mockReset().mockResolvedValue('signed-in');
  markResume.mockReset();
  forgetResume.mockReset();
  resume.active = false;
  lock.config = null;
  syncStatus.blocker = null;
});

/** The server refusing once because the session is too old, then accepting. */
const staleThenFresh = () =>
  apiDelete
    .mockRejectedValueOnce(new ApiErrorMock(403, 'errors.reauth_required'))
    .mockResolvedValue(undefined);

const googleButton = () => screen.getByRole('button', { name: 'Continue with Google' });

/* The request is the only thing here that cannot be done offline — everything else on the settings
   page reads or writes the local store. Letting someone type the word, pass their fingerprint and
   *then* be told the server is unreachable would be the worst possible ordering. */
describe('with no connection', () => {
  it('will not arm the button, and says why', async () => {
    syncStatus.blocker = 'offline';
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');

    expect(deleteButton()).toBeDisabled();
    expect(screen.getByRole('status')).toHaveTextContent('Needs a connection to the server');
  });

  it('treats an unreachable server the same as no network', async () => {
    syncStatus.blocker = 'unreachable';
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');

    expect(deleteButton()).toBeDisabled();
  });

  it('still allows it when sync is merely paused on cellular', async () => {
    // 'paused' is wi-fi-only holding the *background* sync back. It must not veto something the
    // user is asking for right now, and the request would succeed.
    syncStatus.blocker = 'paused';
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');

    expect(deleteButton()).toBeEnabled();
  });
});

describe('with no device lock', () => {
  it('will not delete until the word is typed', async () => {
    setup();

    expect(deleteButton()).toBeDisabled();
    // The consequences have to be on screen before the control that causes them is reachable.
    expect(screen.getByText(/Every entry, person, tag and thread is deleted/)).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('is not fooled by a near miss', async () => {
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'delet');

    expect(deleteButton()).toBeDisabled();
  });

  it('accepts the word in any case, and with stray spaces', async () => {
    const user = setup();

    // Phone keyboards autocapitalise and add a trailing space; neither is a change of mind.
    await user.type(screen.getByLabelText('Type DELETE to confirm'), ' delete ');

    expect(deleteButton()).toBeEnabled();
  });

  it('deletes and ends the session once the word is typed', async () => {
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/account'));
    // The account is gone, so the local copy and the session have to go with it — and the user
    // must not be left sitting on a settings page for a diary that no longer exists.
    expect(endSession).toHaveBeenCalledWith({ serverSessionGone: true });
    expect(navigate).toHaveBeenCalledWith('/login', { replace: true });
  });

  it('keeps the user signed in when the server refuses', async () => {
    apiDelete.mockRejectedValue(new Error('boom'));
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());

    /* Nothing was deleted, so nothing local may be thrown away either. Tearing down the session on
       a failed request would wipe this device's copy of a diary that still exists on the server. */
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(endSession).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});

describe('with a device lock', () => {
  beforeEach(() => {
    lock.config = { biometrics: false };
  });

  it('asks for the passcode instead of deleting straight away', async () => {
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());

    expect(await screen.findByLabelText('Passcode')).toBeInTheDocument();
    // The typed word got as far as the lock and no further.
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('does not delete on a wrong passcode', async () => {
    verifyPasscode.mockResolvedValue(false);
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());
    await user.type(await screen.findByLabelText('Passcode'), '0000');
    await user.click(deleteButton());

    await waitFor(() => expect(verifyPasscode).toHaveBeenCalled());
    expect(screen.getByRole('alert')).toHaveTextContent('That passcode is not right.');
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('deletes once the passcode is right', async () => {
    verifyPasscode.mockResolvedValue(true);
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());
    await user.type(await screen.findByLabelText('Passcode'), '1234');
    await user.click(deleteButton());

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/account'));
  });

  it('deletes when biometry succeeds, without a passcode', async () => {
    lock.config = { biometrics: true };
    promptBiometrics.mockResolvedValue(true);
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/account'));
  });

  it('falls back to the passcode when biometry is refused', async () => {
    lock.config = { biometrics: true };
    promptBiometrics.mockResolvedValue(false);
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());

    // A cancelled fingerprint prompt is not an authorisation, and it must not be a dead end either.
    await waitFor(() => expect(promptBiometrics).toHaveBeenCalled());
    expect(await screen.findByLabelText('Passcode')).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
  });
});

/*
 * Re-authentication.
 *
 * The typed word and the device lock are this dialog's own, which means the server cannot see them
 * and a caller holding a session token is under no obligation to visit them. So the server refuses
 * a session that isn't minutes old, and everything below is about what the dialog does with that
 * refusal. The two platforms split here and nowhere else: Android signs in over the app and comes
 * straight back, the web hands the whole page to Google and has to be reassembled afterwards.
 */
describe('when the server says the sign-in is too old', () => {
  it('deletes nothing and offers the one thing that fixes it', async () => {
    apiDelete.mockRejectedValue(new ApiErrorMock(403, 'errors.reauth_required'));
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());

    expect(await screen.findByRole('button', { name: 'Continue with Google' })).toBeEnabled();
    /* The user has already typed the word and passed the lock, so the copy has to say that the
       detour costs them nothing — otherwise this reads as the deletion having failed. */
    expect(screen.getByText(/Nothing has been deleted/)).toBeInTheDocument();
    expect(endSession).not.toHaveBeenCalled();
  });

  it('finishes in place once Google confirms, without leaving a resume behind', async () => {
    staleThenFresh();
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    // Native: googleReauth resolved without navigating, so the retry happens here and now.
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(2));
    expect(endSession).toHaveBeenCalledWith({ serverSessionGone: true });
    /* Nothing to come back to, so nothing may be left waiting: a marker outliving a deletion that
       already happened would reopen this dialog on the next visit to Settings. */
    expect(forgetResume).toHaveBeenCalled();
  });

  it('writes down the resume before handing the page to Google', async () => {
    // The web redirect: googleReauth resolves as the navigation starts, not when the user returns.
    googleReauth.mockResolvedValue('redirecting');
    apiDelete.mockRejectedValue(new ApiErrorMock(403, 'errors.reauth_required'));
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    await waitFor(() => expect(googleReauth).toHaveBeenCalled());
    /* Before, not after. There is no line of code following the redirect that is guaranteed to
       run, so a marker written afterwards is a marker that sometimes isn't. */
    expect(markResume.mock.invocationCallOrder[0]).toBeLessThan(
      googleReauth.mock.invocationCallOrder[0],
    );
    // And nothing is retried on a page that is leaving.
    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(endSession).not.toHaveBeenCalled();
  });

  it('hands the attempt back when the sign-in fails', async () => {
    apiDelete.mockRejectedValue(new ApiErrorMock(403, 'errors.reauth_required'));
    googleReauth.mockRejectedValue(new Error('cancelled'));
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    /* A cancelled Google prompt is not an authorisation and must not be a dead end either: the
       button stays live, and the marker is picked back up so a later page load isn't ambushed. */
    await waitFor(() => expect(forgetResume).toHaveBeenCalled());
    expect(googleButton()).toBeEnabled();
    expect(apiDelete).toHaveBeenCalledTimes(1);
    expect(endSession).not.toHaveBeenCalled();
  });

  it('does not send the user round again on its own', async () => {
    apiDelete.mockRejectedValue(new ApiErrorMock(403, 'errors.reauth_required'));
    const user = setup();

    await user.type(screen.getByLabelText('Type DELETE to confirm'), 'DELETE');
    await user.click(deleteButton());
    await user.click(await screen.findByRole('button', { name: 'Continue with Google' }));

    /* A server that refuses a session it has just watched being created is a fault no further
       round trip can fix. Retrying automatically would bounce the user out to Google and back
       forever — and on the web each bounce is a page load, so it would survive a reload too. */
    await waitFor(() => expect(apiDelete).toHaveBeenCalledTimes(2));
    expect(googleReauth).toHaveBeenCalledTimes(1);
  });
});

describe('coming back from the web redirect', () => {
  beforeEach(() => {
    resume.active = true;
  });

  it('opens at the last step, with the consequences back on screen', async () => {
    const user = setup();

    /* The user did not navigate here — the page was rebuilt around them — so the dialog has to say
       what is about to happen before offering the button that does it. */
    expect(screen.getByText(/Every entry, person, tag and thread is deleted/)).toBeInTheDocument();
    expect(screen.getByText(/last step/)).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();

    // The typed word went with the page that was destroyed; it is not asked for again, and the
    // button it used to gate must not stay disabled waiting for it.
    await user.click(deleteButton());

    await waitFor(() => expect(apiDelete).toHaveBeenCalledWith('/account'));
  });

  it('still asks for the device lock', async () => {
    lock.config = { biometrics: false };
    const user = setup();

    await user.click(deleteButton());

    /* The Google round trip proves who owns the account. It says nothing about who is holding the
       phone, which is the other half and the cheap one. */
    expect(await screen.findByLabelText('Passcode')).toBeInTheDocument();
    expect(apiDelete).not.toHaveBeenCalled();
  });

  it('will not set off a second redirect if the server refuses again', async () => {
    apiDelete.mockRejectedValue(new ApiErrorMock(403, 'errors.reauth_required'));
    const user = setup();

    await user.click(deleteButton());

    // Arriving here *is* the trip through Google, spent. Offering another would be the same
    // forever-loop as above, one page load at a time.
    await waitFor(() => expect(apiDelete).toHaveBeenCalled());
    expect(googleReauth).not.toHaveBeenCalled();
    expect(screen.queryByRole('button', { name: 'Continue with Google' })).not.toBeInTheDocument();
  });
});

describe('the way out', () => {
  it('offers a backup without leaving the dialog', async () => {
    const user = setup();

    await user.click(screen.getByRole('button', { name: 'Export a backup first' }));

    await waitFor(() => expect(saveTextFile).toHaveBeenCalled());
    expect(saveTextFile.mock.calls[0][0]).toBe('diary-backup-2026-08-08.json');
    // Still here, still armed, and nothing deleted by having taken the safe route.
    expect(deleteButton()).toBeDisabled();
    expect(apiDelete).not.toHaveBeenCalled();
  });
});
