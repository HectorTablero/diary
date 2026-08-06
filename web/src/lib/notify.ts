import type { SettingsDto } from '@diary/shared';
import { DEFAULT_SETTINGS } from '@diary/shared';
import { toast, type ExternalToast } from 'sonner';
import { queryClient } from './queryClient';

/** Success toasts say "that worked" and are read at a glance. Sonner's default four seconds
    leaves them sitting over the UI long after they have been understood. Errors get longer:
    they carry something the user has to act on. */
const SUCCESS_DURATION_MS = 2000;
const ERROR_DURATION_MS = 3500;

/**
 * The account's notification preference, read synchronously.
 *
 * It lives in the synced settings rather than in localStorage — it's a choice about the diary,
 * not about this device — but toasts fire from mutation callbacks and from module scope, where
 * a hook is not available. Every query in this app reads Dexie rather than the network, so the
 * cache is a local snapshot rather than a network one, and consulting it here costs nothing.
 * Before the first read resolves it falls back to the shipped default.
 */
const quietNotifications = () =>
  queryClient.getQueryData<SettingsDto>(['settings'])?.quietNotifications ??
  DEFAULT_SETTINGS.quietNotifications;

interface SuccessOptions extends ExternalToast {
  /**
   * Marks a confirmation the user went looking for, rather than one that merely happened:
   * saving settings, finishing an export, restoring a backup. These survive the "hide routine
   * notifications" preference, because doing nothing visible after an explicit, slow or
   * far-reaching action reads as a failure.
   */
  important?: boolean;
}

/**
 * A success toast, filtered through the account's notification preference.
 *
 * Everything that goes well in this app used to announce itself, which is a lot of noise for
 * actions the user can already see the result of — an entry appearing in the list does not also
 * need to be described. Routine confirmations are therefore droppable; the ones that report on
 * something the user cannot otherwise verify are not.
 */
export function notifySuccess(message: string, options: SuccessOptions = {}) {
  const { important = false, ...toastOptions } = options;
  /* A toast carrying an action is the only route to that action — an Undo nobody sees is an
     Undo that does not exist — so it is neither silenced nor hurried. */
  const actionable = toastOptions.action !== undefined;

  if (!important && !actionable && quietNotifications()) return;

  return toast.success(message, {
    duration: actionable ? undefined : SUCCESS_DURATION_MS,
    ...toastOptions,
  });
}

/** An error toast. Never suppressed, and given longer than a success to be read and acted on. */
export function notifyError(message: string, options: ExternalToast = {}) {
  return toast.error(message, { duration: ERROR_DURATION_MS, ...options });
}
