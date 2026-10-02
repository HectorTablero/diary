import { useEffect, useState } from 'react';
import { db } from './db';
import { subscribeSyncStatus } from './sync';

/**
 * How many writes are still queued, while `active` — or `null` when not watching.
 *
 * Counted from the table on every status change, never read from `status.pending`, for the reason
 * waitForOutboxDrain gives: right after a large enqueue that figure still holds whatever it held
 * before, and a progress bar trusting it would open at 100%. The push loop publishes a status change
 * after every batch it settles, so this moves as the queue drains rather than only at the end.
 *
 * Only ever goes down while watching. Two counts can resolve out of order, and a bar that steps
 * backwards reads as something having gone wrong when nothing has.
 */
export function useOutboxRemaining(active: boolean): number | null {
  const [remaining, setRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!active) {
      setRemaining(null);
      return;
    }
    let cancelled = false;
    const read = () => {
      void db.outbox.count().then((count) => {
        if (!cancelled) setRemaining((prev) => (prev === null ? count : Math.min(prev, count)));
      });
    };
    const unsubscribe = subscribeSyncStatus(read);
    read();
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, [active]);

  return remaining;
}
