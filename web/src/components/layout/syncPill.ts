import type { SyncBlocker } from '@/db/sync';

/**
 * Whether the sync pill should be on screen for the given blocker.
 *
 * `paused` is the one blocker that is not a failure — nothing is broken, the app is holding writes
 * back because it was told to — and so the only one that is ever hidden. It goes away for two
 * different reasons:
 *
 *   - nothing is queued, so there is nothing being held back yet and the pill would be announcing
 *     a *setting* rather than a state. No preference involved; this applies to everyone.
 *   - the preference, for someone who knows their own Wi-Fi-only setting is on and would rather
 *     not be reminded.
 *
 * Neither can silence `offline` or `unreachable`. Those mean writes are not reaching the server for
 * a reason nobody chose, and staying quiet about them is exactly how a diary stops backing itself
 * up without anyone noticing.
 *
 * This decides what is *shown*. The sync engine's own `blocker` is untouched and still reads
 * `paused`, which is what disables the voice recorder on a metered connection (see EntryTree) —
 * uploading audio being the one thing here that isn't a few kilobytes of text.
 */
export function shouldShowBlocker(
  blocker: SyncBlocker,
  pending: number,
  hidePausedSyncStatus: boolean,
): boolean {
  if (blocker === null) return false;
  if (blocker !== 'paused') return true;
  return pending > 0 && !hidePausedSyncStatus;
}
