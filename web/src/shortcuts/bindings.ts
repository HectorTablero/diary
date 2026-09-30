/**
 * Key combinations, as stored and as handed to react-hotkeys-hook.
 *
 * A binding is a lowercase, `+`-joined string with the modifiers first and the key last: `alt+1`,
 * `mod+2`, `ctrl+shift+k`, `alt+comma`. The key is a `KeyboardEvent.code` with its `Key`/`Digit`
 * prefix dropped — the same normalisation the library applies before comparing — so a binding
 * names a *physical* key. That is what makes `alt+1` work on a Mac, where Option+1 types `¡` and
 * `event.key` would never be `1`, and on an AZERTY keyboard, where the digits are shifted.
 *
 * `mod` is Cmd on a Mac and Ctrl everywhere else. Defaults use it so one default reads right on
 * both; a combination recorded in Settings is stored concretely (`meta+1`), because preferences are
 * per device and the device it was recorded on is the one it will be pressed on.
 */
export type Binding = string;

export interface Modifiers {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  meta: boolean;
}

export interface ParsedBinding extends Modifiers {
  key: string;
}

const MODIFIER_NAMES = ['ctrl', 'control', 'alt', 'shift', 'meta', 'mod'];

/** Same test react-hotkeys-hook uses for `mod`, so the label and the behaviour never disagree. */
export const isMac = (): boolean =>
  typeof navigator !== 'undefined' &&
  /mac/i.test(navigator.userAgent) &&
  !/iphone|ipad|ipod/i.test(navigator.userAgent);

export function parseBinding(binding: Binding, mac = isMac()): ParsedBinding {
  const parts = binding.toLowerCase().split('+');
  const has = (name: string) => parts.includes(name);
  const mod = has('mod');
  return {
    ctrl: has('ctrl') || has('control') || (mod && !mac),
    alt: has('alt'),
    shift: has('shift'),
    meta: has('meta') || (mod && mac),
    key: parts.find((part) => !MODIFIER_NAMES.includes(part)) ?? '',
  };
}

/** One spelling per combination on this platform — `mod+1` and `ctrl+1` are the same thing off a
    Mac, and conflict detection has to see that. */
export function canonicalBinding(binding: Binding, mac = isMac()): Binding {
  const { ctrl, alt, shift, meta, key } = parseBinding(binding, mac);
  return [ctrl && 'ctrl', alt && 'alt', shift && 'shift', meta && 'meta', key]
    .filter(Boolean)
    .join('+');
}

/** Shift alone doesn't count: Shift+K is how a capital K is typed, so a shortcut on it would fire
    inside every text field in the app. */
export const hasCommandModifier = (m: Modifiers): boolean => m.ctrl || m.alt || m.meta;

/** The library's own normalisation of `event.code`: `KeyA` → `a`, `Digit1` / `Numpad1` → `1`. */
export const keyFromCode = (code: string): string =>
  code.toLowerCase().replace(/key|digit|numpad/, '');

const MODIFIER_KEYS = new Set(['Control', 'Alt', 'AltGraph', 'Shift', 'Meta', 'OS']);

export const isModifierKey = (key: string): boolean => MODIFIER_KEYS.has(key);

type ModifierFlags = Pick<KeyboardEvent, 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>;

export const modifiersOf = (event: ModifierFlags): Modifiers => ({
  ctrl: event.ctrlKey,
  alt: event.altKey,
  shift: event.shiftKey,
  meta: event.metaKey,
});

export type RecordResult =
  | { kind: 'binding'; binding: Binding }
  /** A modifier on its own — keep listening, the rest of the combination is on its way. */
  | { kind: 'pending' }
  | { kind: 'needsModifier' };

/** Turns one keydown in the Settings recorder into a binding, if it makes one. */
export function recordFromEvent(event: KeyboardEvent): RecordResult {
  if (isModifierKey(event.key) || !event.code) return { kind: 'pending' };
  const mods = modifiersOf(event);
  if (!hasCommandModifier(mods)) return { kind: 'needsModifier' };
  const key = keyFromCode(event.code);
  return {
    kind: 'binding',
    binding: [
      mods.ctrl && 'ctrl',
      mods.alt && 'alt',
      mods.shift && 'shift',
      mods.meta && 'meta',
      key,
    ]
      .filter(Boolean)
      .join('+'),
  };
}

const KEY_LABELS: Record<string, string> = {
  comma: ',',
  period: '.',
  slash: '/',
  backslash: '\\',
  semicolon: ';',
  quote: "'",
  backquote: '`',
  bracketleft: '[',
  bracketright: ']',
  minus: '-',
  equal: '=',
  arrowup: '↑',
  arrowdown: '↓',
  arrowleft: '←',
  arrowright: '→',
  escape: 'Esc',
  enter: '↵',
  space: 'Space',
  backspace: '⌫',
  delete: 'Del',
  pageup: 'PgUp',
  pagedown: 'PgDn',
};

const keyLabel = (key: string): string =>
  KEY_LABELS[key] ?? (key.length === 1 ? key.toUpperCase() : key[0].toUpperCase() + key.slice(1));

/**
 * How a binding reads on screen: `Ctrl+Alt+K` off a Mac, `⌃⌥K` on one — each platform's own
 * convention, since that is what's printed on the keys.
 *
 * `omit` drops modifiers already being held, which is what the on-screen hints want: with Alt down,
 * a badge saying `1` is the whole instruction, and it fits on a 28px importance button where
 * `Alt+1` would not.
 */
export function formatBinding(binding: Binding, omit?: Modifiers, mac = isMac()): string {
  const parsed = parseBinding(binding, mac);
  const show = (name: keyof Modifiers) => parsed[name] && !omit?.[name];
  if (mac) {
    return [
      show('ctrl') && '⌃',
      show('alt') && '⌥',
      show('shift') && '⇧',
      show('meta') && '⌘',
      keyLabel(parsed.key),
    ]
      .filter(Boolean)
      .join('');
  }
  return [
    show('ctrl') && 'Ctrl',
    show('alt') && 'Alt',
    show('shift') && 'Shift',
    show('meta') && 'Win',
    keyLabel(parsed.key),
  ]
    .filter(Boolean)
    .join('+');
}

/** The `aria-keyshortcuts` spelling, so assistive tech can announce a shortcut the hint badges
    (which are aria-hidden) only show. */
const ARIA_KEY_NAMES: Record<string, string> = {
  arrowup: 'ArrowUp',
  arrowdown: 'ArrowDown',
  arrowleft: 'ArrowLeft',
  arrowright: 'ArrowRight',
  escape: 'Escape',
  enter: 'Enter',
  space: 'Space',
  backspace: 'Backspace',
  delete: 'Delete',
  pageup: 'PageUp',
  pagedown: 'PageDown',
};

export function ariaKeyShortcuts(binding: Binding, mac = isMac()): string {
  const { ctrl, alt, shift, meta, key } = parseBinding(binding, mac);
  const name = ARIA_KEY_NAMES[key] ?? keyLabel(key);
  return [ctrl && 'Control', alt && 'Alt', shift && 'Shift', meta && 'Meta', name]
    .filter(Boolean)
    .join('+');
}

/** Whether a binding's hint belongs on screen while `held` is down: every held modifier is part of
    it. Holding Ctrl shows Ctrl+1 and Ctrl+Shift+K, but not Alt+1. */
export function hintMatches(binding: Binding, held: Modifiers, mac = isMac()): boolean {
  if (!hasCommandModifier(held)) return false;
  const parsed = parseBinding(binding, mac);
  return (Object.keys(held) as (keyof Modifiers)[]).every((name) => !held[name] || parsed[name]);
}
