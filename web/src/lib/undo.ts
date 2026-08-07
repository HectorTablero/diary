import i18n from 'i18next';
import * as mutations from '@/db/mutations';
import { notifyError, notifySuccess } from './notify';
import { queryClient } from './queryClient';

/** Anything a delete can hand back, and this module knows how to put back. */
export type Deletion =
  | mutations.EntryDeletion
  | mutations.PersonDeletion
  | mutations.TagDeletion
  | mutations.ThreadDeletion
  | mutations.EventDeletion;

/** One dispatch point, so a call site only has to hand over what its delete returned. */
async function restore(deletion: Deletion): Promise<void> {
  switch (deletion.kind) {
    case 'entry':
      return mutations.restoreEntries(deletion);
    case 'person':
      return mutations.restorePerson(deletion);
    case 'tag':
      return mutations.restoreTag(deletion);
    case 'thread':
      return mutations.restoreThread(deletion);
    case 'event':
      await mutations.restoreEvent(deletion);
      return;
  }
}

/**
 * The toast a deletion leaves behind, carrying the one action that can take it back.
 *
 * Deliberately *not* built on a `useMutation` from the call site. The component that owned the
 * deletion is usually gone by the time Undo is pressed — an EntryItem unmounts with its entry, and
 * deleting a person navigates away from their profile — and react-query drops an observer's
 * callbacks on unmount. The write still ran, so the row came back in Dexie, but the
 * `invalidateQueries` hanging off the mutation never fired: the screen kept its stale list until
 * the next sync tick invalidated everything, which looked like undo taking twenty seconds to work.
 *
 * So the restore is a plain call against the store and the refresh is issued here, from the module
 * scope that outlives every screen. Nothing about undo needs the mutation machinery anyway — there
 * is no pending state to render and no component left to render it in.
 *
 * A plain function rather than a hook for the same reason: this is called from mutation callbacks,
 * where `useTranslation` isn't available, hence the i18next singleton for the label.
 *
 * notifySuccess treats a toast with an action as never-silenceable and never-hurried (see
 * notify.ts), so the "hide routine notifications" preference can't take an undo away and the toast
 * stays up until dismissed. That is the whole undo window: nothing is persisted anywhere else.
 */
export function notifyDeleted(message: string, deletion: Deletion) {
  return notifySuccess(message, {
    action: {
      label: i18n.t('common.undo'),
      onClick: () => {
        void restore(deletion)
          .then(() => {
            // Broad on purpose: restoring a person rewrites mentions on entries, a tag reattaches
            // to both entries and people, and an entry subtree touches the calendar and search.
            void queryClient.invalidateQueries();
          })
          .catch(() => notifyError(i18n.t('errors.unknown')));
      },
    },
  });
}
