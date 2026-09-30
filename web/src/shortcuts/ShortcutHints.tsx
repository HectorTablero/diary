import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { LucideIcon } from 'lucide-react';
import { isNative } from '@/lib/native';
import { usePreferences } from '@/lib/preferences';
import { cn } from '@/lib/utils';
import { formatBinding, hintMatches, type Binding, type Modifiers } from './bindings';
import { createHoldDetector } from './holdDetector';

/** Off on the native build: it has no sidebar to put hints on and, on a phone, no keyboard to press
    them with. Settings hides the section there for the same reason. */
export function useShortcutsEnabled(): boolean {
  const { shortcuts } = usePreferences();
  return shortcuts && !isNative;
}

interface HeldState {
  /** What is down right now, once the hold has lasted long enough; null otherwise. */
  held: Modifiers | null;
  /** The last non-null `held`. A hint fading out keeps the label it faded in with, instead of
      spelling out its full binding (`Alt+1` where it said `1`) for the length of the fade. */
  last: Modifiers | null;
}

const HeldContext = createContext<HeldState>({ held: null, last: null });

/**
 * Watches for a held Ctrl / Alt / ⌘ and, after `shortcutHintDelay`, tells every hint below it which
 * modifiers are down. The rules for "held" are in holdDetector.ts.
 *
 * Listens on window in the capture phase, so a component that stops propagation for its own keys
 * (a menu, a combobox) can't leave the overlay believing a modifier is still down.
 */
export function ShortcutHintsProvider({ children }: { children: ReactNode }) {
  const enabled = useShortcutsEnabled();
  const { shortcutHintDelay } = usePreferences();
  const [state, setState] = useState<HeldState>({ held: null, last: null });

  useEffect(() => {
    if (!enabled || shortcutHintDelay === null) return;
    const detector = createHoldDetector({
      delay: shortcutHintDelay,
      onChange: (held) => setState((prev) => ({ held, last: held ?? prev.last })),
    });
    /* A lone Alt, pressed and released, is the Windows gesture for "focus the menu bar" — and in
       the browser that menu then eats the *next* Alt press, so every other hold would silently do
       nothing. Holding Alt to read the hints is exactly that gesture, so both halves of it are
       claimed here. Only Alt on its own: Alt+1 and friends are left for the shortcuts to handle,
       and nothing else Alt does (Alt+Tab, Alt+F4) ever reaches the page. */
    const isLoneAlt = (event: KeyboardEvent) =>
      event.key === 'Alt' && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    const onKeyDown = (event: KeyboardEvent) => {
      if (isLoneAlt(event)) event.preventDefault();
      detector.keydown(event);
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (isLoneAlt(event)) event.preventDefault();
      detector.keyup(event);
    };
    const onPointerDown = () => detector.pointerdown();
    const onReset = () => detector.reset();
    const onVisibility = () => {
      if (document.hidden) detector.reset();
    };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    // Alt+Tab away never delivers the keyup, so losing focus has to count as letting go.
    window.addEventListener('blur', onReset);
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
      window.removeEventListener('blur', onReset);
      document.removeEventListener('visibilitychange', onVisibility);
      detector.reset();
    };
  }, [enabled, shortcutHintDelay]);

  return <HeldContext.Provider value={state}>{children}</HeldContext.Provider>;
}

/** Whether a binding's hint is on screen, and what it says. `active` is for targets that exist more
    than once — see ShortcutHint. */
function useHint(binding: Binding | null, active?: () => boolean) {
  const { held, last } = useContext(HeldContext);
  const visible = !!held && !!binding && hintMatches(binding, held) && (!active || active());
  const label = binding ? formatBinding(binding, held ?? last ?? undefined) : '';
  return { visible, label };
}

/* Mounted whenever there is a binding and faded with opacity, rather than mounted on demand: an
   element that unmounts can fade in but never out, and a badge that blinks away the moment the key
   is released reads as a glitch. aria-hidden throughout, because each only repeats, visually, the
   `aria-keyshortcuts` its target already carries. */
const FADE = 'transition-[opacity,scale] duration-150 ease-out';

/**
 * A key badge laid over whatever the shortcut activates, while its modifier is held.
 *
 * Positioned absolutely inside its target (which needs `relative`), rather than measured and drawn
 * in a portal: it scrolls, reflows and unmounts with the thing it labels, for free.
 *
 * `active` is for targets that exist more than once — two composers open at once each have an
 * importance picker, and only one of them will receive the keys.
 */
export function ShortcutHint({
  binding,
  active,
  className,
}: {
  binding: Binding | null;
  active?: () => boolean;
  className?: string;
}) {
  const { visible, label } = useHint(binding, active);
  if (!binding) return null;
  return (
    <kbd
      aria-hidden
      data-shortcut-hint
      data-visible={visible}
      className={cn(
        'pointer-events-none absolute z-20 flex h-4.5 min-w-4.5 items-center justify-center rounded border border-border bg-popover px-1 font-sans text-[10px] leading-none font-semibold text-popover-foreground shadow-sm',
        FADE,
        visible ? 'scale-100 opacity-100' : 'scale-75 opacity-0',
        className,
      )}
    >
      {label}
    </kbd>
  );
}

/**
 * An icon that turns into its shortcut's key while the modifier is held — the nav's version of
 * ShortcutHint. A badge laid *over* an 18px icon covers it without replacing it, and the two
 * shapes fight; swapping one for the other in the same slot keeps the row exactly as it was, with
 * the key standing where the icon stood.
 *
 * The key box is the icon's own size, so nothing shifts. A longer label (`Shift+K` under a held
 * Alt) grows rightwards into the gap before the text rather than being squeezed.
 */
export function ShortcutIcon({
  icon: Icon,
  binding,
  className,
}: {
  icon: LucideIcon;
  binding: Binding | null;
  className?: string;
}) {
  const { visible, label } = useHint(binding);
  return (
    <span className={cn('relative flex size-4.5 shrink-0 items-center justify-center', className)}>
      <Icon className={cn('size-4.5', FADE, visible && 'scale-50 opacity-0')} />
      {binding && (
        <kbd
          aria-hidden
          data-shortcut-hint
          data-visible={visible}
          className={cn(
            'pointer-events-none absolute top-0 left-0 flex h-4.5 w-max min-w-4.5 items-center justify-center rounded-[5px] border border-current/40 px-0.5 font-sans text-[11px] leading-none font-semibold',
            FADE,
            visible ? 'scale-100 opacity-100' : 'scale-50 opacity-0',
          )}
        >
          {label}
        </kbd>
      )}
    </span>
  );
}
