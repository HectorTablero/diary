import { hasCommandModifier, isModifierKey, modifiersOf, type Modifiers } from './bindings';

type KeyEventLike = Pick<
  KeyboardEvent,
  'key' | 'repeat' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'
>;

/**
 * Decides when "the user is holding Ctrl (or Alt, or ⌘) and wants to see what it does".
 *
 * Kept free of the DOM and of React so the rules can be tested with fake timers — they are the part
 * that is easy to get subtly wrong:
 *
 *  - The timer starts on the first press of a modifier. Key repeat (a held key re-fires keydown
 *    every ~30ms) must not restart it, or the hints would never appear.
 *  - Any other key cancels it, and the hold stays *spoiled* until every modifier is released.
 *    Without that, Ctrl+C followed by keeping a finger on Ctrl would flash the hints over whatever
 *    was just copied — the overlay is for someone who paused, not someone mid-shortcut.
 *  - A pointer press spoils it too: Ctrl+click opens a link in a new tab, and a hand on the mouse
 *    is not waiting for instructions.
 *  - Once shown, the hints stay while the modifier does, including across shortcut presses, so
 *    importance can be tried level by level with the badges still on screen. Adding or dropping a
 *    modifier re-filters them rather than hiding them.
 *  - Shift alone never counts; see hasCommandModifier.
 */
export function createHoldDetector({
  delay,
  onChange,
}: {
  delay: number;
  onChange: (held: Modifiers | null) => void;
}) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending: Modifiers | null = null;
  let shown: Modifiers | null = null;
  let spoiled = false;

  const cancelTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };

  const show = (held: Modifiers) => {
    shown = held;
    onChange(held);
  };

  /** Back to rest. Returns whether hints had been on screen. */
  const reset = (): boolean => {
    cancelTimer();
    pending = null;
    spoiled = false;
    if (!shown) return false;
    shown = null;
    onChange(null);
    return true;
  };

  const spoil = () => {
    cancelTimer();
    if (!shown) spoiled = true;
  };

  return {
    keydown(event: KeyEventLike) {
      if (!isModifierKey(event.key)) {
        spoil();
        return;
      }
      if (event.repeat) return;
      const held = modifiersOf(event);
      if (!hasCommandModifier(held)) return;
      if (shown) {
        show(held);
        return;
      }
      /* This key alone being down is a fresh hold, whatever came before. The keyup that should have
         cleared `spoiled` is not guaranteed to arrive — the OS or the browser's own UI can take it
         (Alt+Tab, the Windows menu bar) — and without this one lost keyup would silently disable
         the hints until some later release happened to clean up. */
      if (Object.values(held).filter(Boolean).length === 1) spoiled = false;
      if (spoiled) return;
      pending = held;
      cancelTimer();
      timer = setTimeout(() => {
        timer = undefined;
        if (pending) show(pending);
      }, delay);
    },

    /** Returns true when this release ended a visible hold. */
    keyup(event: KeyEventLike): boolean {
      const held = modifiersOf(event);
      if (!hasCommandModifier(held)) return reset();
      if (!isModifierKey(event.key)) return false;
      if (shown) show(held);
      else spoil();
      return false;
    },

    pointerdown: spoil,
    reset,
  };
}
