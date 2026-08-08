import { clearLocalData } from '@/db/db';
import { closeLiveChannel } from '@/db/sync';
import { signOut } from './authClient';
import { setAuthToken } from './authToken';
import { setLocalOnly } from './localOnly';
import { cacheUser } from './sessionCache';

/**
 * Put the app back to a signed-out state: no session, no local copy of the diary, no live socket.
 *
 * Shared by the two things that end a session — signing out, and deleting the account — because
 * they have to leave the device in exactly the same condition, and the pieces are easy to get
 * partly right. Forgetting `closeLiveChannel` leaves a WebSocket open on a dead session; forgetting
 * `cacheUser(null)` leaves the sync engine believing there is still an account to push to.
 *
 * `clearLocalData()` takes the outbox with it, so anything still queued is discarded rather than
 * pending — the sign-out path checks for that and warns first (see AccountSection). After an account
 * deletion there is nothing left for a queued write to reach, so there is nothing to warn about.
 *
 * The app lock is deliberately untouched: it is a property of this device, not of the account, and
 * it has to survive both of these. See lib/appLock.ts.
 */
export async function endSession(options: { serverSessionGone?: boolean } = {}): Promise<void> {
  /* When the account has just been deleted, the session row went with it — better-auth's sign-out
     call will fail, and that failure means the job is already done. It is still worth attempting:
     on the web it is what clears the cookie the browser is holding. */
  if (options.serverSessionGone) await signOut().catch(() => {});
  else await signOut();

  closeLiveChannel();
  await clearLocalData();
  setAuthToken(null);
  cacheUser(null);
  setLocalOnly(false);
}
