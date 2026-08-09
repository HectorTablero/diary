/**
 * Carrying a half-finished account deletion across the web's re-authentication redirect.
 *
 * Deleting the account needs a session only minutes old (server routes/account.ts). On Android that
 * is a sheet over the app and nothing is interrupted, but on the web it means handing the whole
 * page to Google — so the dialog, the typed word, the passed device lock and the intention behind
 * all three are destroyed and rebuilt from scratch on the way back. This module is the one thing
 * that survives, and all it says is *this page load is the far side of that redirect*.
 *
 * **Deliberately not a resumable state.** It carries no confirmation, no authority and nothing that
 * could stand in for a step the user has already taken. What it does is reopen the dialog at a
 * stage that still asks for the device lock and still requires the destructive button to be pressed
 * again. A marker that skipped those would be a way to delete an account by writing a string into
 * storage, which is a worse hole than the one the re-authentication closes.
 *
 * **sessionStorage, not localStorage.** The marker belongs to the tab that started the redirect and
 * should die with it. In localStorage it would outlive the browsing session, reach other tabs, and
 * leave a pending destructive action lying around for a page load that had nothing to do with it.
 *
 * **Read once, at import.** "Did *this* page load come back from a re-authentication?" is a fact
 * about the page load, not about whoever asks — so it is answered once, before any component
 * exists, and handed out unchanged. Reading it inside a hook instead would put a storage write in
 * a render path that StrictMode runs twice, and the second read would find the marker already gone.
 */

const KEY = 'diary.deleteAccountResume';

/**
 * How long a marker stays good for.
 *
 * Long enough for a slow OAuth round trip through an account chooser and a two-factor prompt, and
 * short enough that a redirect abandoned halfway — the user wandered off, came back and reopened
 * the tab from history — does not reopen a deletion dialog they have stopped thinking about. It is
 * checked here rather than trusted from the server's five-minute window because the two are
 * answering different questions, and this one is allowed to be the stricter of the pair.
 */
const MAX_AGE_MS = 10 * 60 * 1000;

/** Reads the marker and takes it with it: it is spent by the page load that finds it, whatever that
    page load then decides to do, so a reload can never present it a second time. */
function takeMarker(): boolean {
  try {
    const raw = sessionStorage.getItem(KEY);
    sessionStorage.removeItem(KEY);
    if (!raw) return false;
    const startedAt = Number(raw);
    // NaN — a marker from an older build, or hand-written — fails this and is discarded.
    return Number.isFinite(startedAt) && Date.now() - startedAt < MAX_AGE_MS;
  } catch {
    // Storage can be unavailable (private mode). Then there is no resuming, and the user is asked
    // to start the deletion over — which is the safe direction for this to fail in.
    return false;
  }
}

let resuming = takeMarker();

/** True when this page load is the far side of a deletion re-authentication. Stable for the whole
    page load, so every caller sees the same answer regardless of mount order. */
export const resumingAccountDeletion = (): boolean => resuming;

/** Called immediately before handing the page to Google. */
export function markAccountDeletionResume(): void {
  try {
    sessionStorage.setItem(KEY, String(Date.now()));
  } catch {
    /* Nothing to do about it here. The redirect still goes ahead and the sign-in is still worth
       having; the user simply lands back on Settings and has to reopen the dialog. Refusing to
       re-authenticate over a failed storage write would be the worse trade. */
  }
}

/** Puts the resume down: the dialog was closed, or it resolved without ever leaving the page. */
export function forgetAccountDeletionResume(): void {
  resuming = false;
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // Already unreachable, so there is nothing there to remove.
  }
}
