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

/** Anything a finger can meaningfully press. `data-haptic` opts custom elements in. */
const INTERACTIVE =
  'button, a[href], select, label[for], input[type="checkbox"], input[type="radio"], input[type="date"], ' +
  '[role="button"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], ' +
  '[role="option"], [role="checkbox"], [role="switch"], [role="radio"], [role="slider"], [data-haptic]';

/**
 * Global subtle haptics: one light tick whenever an interactive element is
 * actually activated. Native only; no-op on the web.
 */
export function initGlobalHaptics(): void {
  if (!isNative) return;

  document.addEventListener(
    'click',
    (event) => {
      const target = event.target as Element | null;
      if (target?.closest(INTERACTIVE)) hapticTap();
    },
    { capture: true, passive: true },
  );
}