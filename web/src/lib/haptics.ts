import { Haptics, ImpactStyle, NotificationType } from '@capacitor/haptics';
import { isNative } from './native';

/* Tiny wrappers that no-op on the web so call sites stay unconditional. */

/** Light tick for ordinary actions (create, mark said, tab switch). */
export const hapticTap = (): void => {
  if (isNative) void Haptics.impact({ style: ImpactStyle.Light });
};

/** Stronger cue for destructive confirmations. */
export const hapticWarning = (): void => {
  if (isNative) void Haptics.notification({ type: NotificationType.Warning });
};
