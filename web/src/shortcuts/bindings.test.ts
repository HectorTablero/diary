import { describe, expect, it } from 'vitest';
import { nextInCycle, resolveBinding } from './actions';
import {
  ariaKeyShortcuts,
  canonicalBinding,
  formatBinding,
  hintMatches,
  parseBinding,
  recordFromEvent,
} from './bindings';

const key = (init: Partial<KeyboardEvent>) =>
  ({ ctrlKey: false, altKey: false, shiftKey: false, metaKey: false, ...init }) as KeyboardEvent;

const none = { ctrl: false, alt: false, shift: false, meta: false };

describe('parseBinding', () => {
  it('resolves mod to Ctrl off a Mac and to ⌘ on one', () => {
    expect(parseBinding('mod+1', false)).toMatchObject({ ctrl: true, meta: false, key: '1' });
    expect(parseBinding('mod+1', true)).toMatchObject({ ctrl: false, meta: true, key: '1' });
  });
});

describe('canonicalBinding', () => {
  it('spells the same combination one way, so clashes are visible', () => {
    expect(canonicalBinding('mod+1', false)).toBe(canonicalBinding('ctrl+1', false));
    expect(canonicalBinding('shift+alt+k', false)).toBe('alt+shift+k');
  });

  it('keeps mod and ctrl apart on a Mac, where they are different keys', () => {
    expect(canonicalBinding('mod+1', true)).not.toBe(canonicalBinding('ctrl+1', true));
  });
});

describe('recordFromEvent', () => {
  it('records physical keys, so Option+1 on a Mac is alt+1 and not ¡', () => {
    expect(recordFromEvent(key({ key: '¡', code: 'Digit1', altKey: true }))).toEqual({
      kind: 'binding',
      binding: 'alt+1',
    });
  });

  it('waits while only modifiers are down', () => {
    expect(recordFromEvent(key({ key: 'Control', code: 'ControlLeft', ctrlKey: true }))).toEqual({
      kind: 'pending',
    });
  });

  it('refuses a key that would fire while typing', () => {
    expect(recordFromEvent(key({ key: 'k', code: 'KeyK' })).kind).toBe('needsModifier');
    expect(recordFromEvent(key({ key: 'K', code: 'KeyK', shiftKey: true })).kind).toBe(
      'needsModifier',
    );
  });

  it('orders modifiers the same way whatever order they were pressed in', () => {
    expect(
      recordFromEvent(key({ key: 'K', code: 'KeyK', shiftKey: true, ctrlKey: true, altKey: true })),
    ).toEqual({ kind: 'binding', binding: 'ctrl+alt+shift+k' });
  });
});

describe('formatBinding', () => {
  it("uses each platform's own notation", () => {
    expect(formatBinding('mod+shift+comma', undefined, false)).toBe('Ctrl+Shift+,');
    expect(formatBinding('mod+shift+comma', undefined, true)).toBe('⇧⌘,');
  });

  it('drops the modifiers already held, which is all a hint needs to say', () => {
    expect(formatBinding('alt+1', { ...none, alt: true }, false)).toBe('1');
    expect(formatBinding('ctrl+alt+k', { ...none, ctrl: true }, false)).toBe('Alt+K');
  });
});

describe('ariaKeyShortcuts', () => {
  it('uses the ARIA key names', () => {
    expect(ariaKeyShortcuts('mod+1', false)).toBe('Control+1');
    expect(ariaKeyShortcuts('alt+arrowup', false)).toBe('Alt+ArrowUp');
  });
});

describe('hintMatches', () => {
  it('shows a binding when every held modifier is part of it', () => {
    expect(hintMatches('mod+1', { ...none, ctrl: true }, false)).toBe(true);
    expect(hintMatches('ctrl+shift+k', { ...none, ctrl: true }, false)).toBe(true);
  });

  it('keeps the Alt family out of a Ctrl hold, and the reverse', () => {
    expect(hintMatches('alt+1', { ...none, ctrl: true }, false)).toBe(false);
    expect(hintMatches('mod+1', { ...none, alt: true }, false)).toBe(false);
  });

  it('shows nothing for Shift alone', () => {
    expect(hintMatches('ctrl+shift+k', { ...none, shift: true }, false)).toBe(false);
  });
});

describe('resolveBinding', () => {
  it('distinguishes "turned off" from "never touched"', () => {
    expect(resolveBinding('nav.diary', 'alt+1', {})).toBe('alt+1');
    expect(resolveBinding('nav.diary', 'alt+1', { 'nav.diary': null })).toBeNull();
    expect(resolveBinding('nav.diary', 'alt+1', { 'nav.diary': 'alt+d' })).toBe('alt+d');
  });
});

describe('nextInCycle', () => {
  const places = ['/threads', '/plugins/notebook', '/plugins/expenses'];

  it('starts at the first from anywhere else, walks on, and wraps round', () => {
    expect(nextInCycle(places, (p) => p === '/diary')).toBe('/threads');
    expect(nextInCycle(places, (p) => p === '/threads')).toBe('/plugins/notebook');
    expect(nextInCycle(places, (p) => p === '/plugins/expenses')).toBe('/threads');
  });

  it('stays put for a key with a single action', () => {
    expect(nextInCycle(['/diary'], (p) => p === '/diary')).toBe('/diary');
  });
});
