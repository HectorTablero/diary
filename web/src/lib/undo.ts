import i18n from 'i18next';
import { notifyError, notifySuccess } from './notify';

/**
 * The toast a deletion leaves behind, carrying the one action that can take it back.
 *
 * Written as a plain function rather than a hook so it can be called from a mutation callback,
 * which is where every deletion in this app actually finishes. It reads the label off the i18next
 * singleton for the same reason — `useTranslation` isn't available at a callback's call site, and
 * the instance is already initialised by the time any of this can run.
 *
 * notifySuccess treats a toast with an action as never-silenceable and never-hurried (see
 * notify.ts), so the "hide routine notifications" preference can't take an undo away and the
 * toast stays up until it is dismissed. That is deliberate: the undo window *is* the toast, since
 * nothing about the deletion is persisted anywhere else.
 */
export function notifyDeleted(message: string, restore: () => Promise<unknown>) {
  return notifySuccess(message, {
    action: {
      label: i18n.t('common.undo'),
      onClick: () => {
        void restore().catch(() => notifyError(i18n.t('errors.unknown')));
      },
    },
  });
}
