import { useCallback, useMemo, type RefObject } from 'react';
import { useHotkeys } from 'react-hotkeys-hook';
import { usePreferences } from '@/lib/preferences';
import {
  IMPORTANCE_LEVELS,
  importanceDefaultBinding,
  importanceShortcutId,
  nextInCycle,
  resolveBinding,
} from './actions';
import { canonicalBinding, type Binding } from './bindings';
import { useShortcutsEnabled } from './ShortcutHints';

/**
 * Which composer Ctrl+2 is for: the one holding focus, else the last one in the document. More than
 * one on screen is normal — the day page's own, plus an edit or a sub-entry in a dialog.
 *
 * "Last in the document" is the one most recently opened, because dialogs portal to the end of
 * <body>: the shortcut works on the day page before anyone has clicked into it, and a dialog that
 * was just opened takes the keys from the page composer beneath it.
 *
 * Read from the DOM on every press rather than kept in a registry of mounted composers. A registry
 * is state that can disagree with the screen — a hot-reloaded module starts with an empty one while
 * the composers it should list are still mounted — and the DOM can't.
 *
 * Inside a dialog, only that dialog's composers are candidates: a confirmation opened over the page
 * must not have the importance of the entry behind it changed through it.
 */
export function targetComposer(): Element | undefined {
  const active = document.activeElement;
  const dialog = active?.closest('[role="dialog"], [role="alertdialog"]');
  const pool = [...(dialog ?? document).querySelectorAll('[data-entry-composer]')];
  return pool.find((el) => active && el.contains(active)) ?? pool.at(-1);
}

export interface ImportanceShortcuts {
  /** The binding for each level, 1 to 5, in order; null where turned off. */
  bindings: readonly (Binding | null)[];
  /** Whether this composer is the one the keys would reach right now. */
  isTarget: () => boolean;
}

/**
 * Ctrl/⌘ + 1–5 sets the importance of the entry being written.
 *
 * Every mounted composer registers the same keys, and each checks whether it is the target before
 * acting — so exactly one of them does, without the composers knowing about each other. The root
 * must carry `data-entry-composer`.
 */
export function useImportanceShortcuts(
  rootRef: RefObject<HTMLElement | null>,
  importance: number,
  onImportance: (importance: number) => void,
): ImportanceShortcuts {
  const enabled = useShortcutsEnabled();
  const { shortcutOverrides } = usePreferences();

  const bindings = useMemo(
    () =>
      IMPORTANCE_LEVELS.map((level) =>
        resolveBinding(
          importanceShortcutId(level),
          importanceDefaultBinding(level),
          shortcutOverrides,
        ),
      ),
    [shortcutOverrides],
  );

  /* Levels sharing a key cycle through, like shared nav keys do (see nextInCycle) — Ctrl+1 on both
     "Transformative" and "Significant" toggles between the two. */
  const levelsByBinding = useMemo(() => {
    const map = new Map<Binding, number[]>();
    bindings.forEach((binding, index) => {
      if (!binding) return;
      const canonical = canonicalBinding(binding);
      map.set(canonical, [...(map.get(canonical) ?? []), IMPORTANCE_LEVELS[index]]);
    });
    return map;
  }, [bindings]);

  const isTarget = useCallback(() => {
    const root = rootRef.current;
    return !!root && targetComposer() === root;
  }, [rootRef]);

  const keys = [...levelsByBinding.keys()];

  useHotkeys(
    keys,
    (event, hotkey) => {
      if (event.repeat || !isTarget()) return;
      const levels = levelsByBinding.get(canonicalBinding(hotkey.hotkey));
      if (levels) onImportance(nextInCycle(levels, (level) => level === importance));
    },
    {
      enabled: enabled && keys.length > 0,
      // The textarea is where focus is while writing, which is exactly when this is wanted.
      enableOnFormTags: true,
      enableOnContentEditable: true,
      /* Only the composer that acts claims the key. With none to act (focus in a dialog that has
         no composer), Ctrl+1 is left to the browser rather than swallowed for nothing. */
      preventDefault: () => isTarget(),
    },
  );

  return { bindings: enabled ? bindings : NO_BINDINGS, isTarget };
}

const NO_BINDINGS: readonly (Binding | null)[] = IMPORTANCE_LEVELS.map(() => null);
