import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Modifiers } from './bindings';
import { createHoldDetector } from './holdDetector';

const DELAY = 1000;

const event = (key: string, mods: Partial<Modifiers> = {}, repeat = false) => ({
  key,
  repeat,
  ctrlKey: !!mods.ctrl,
  altKey: !!mods.alt,
  shiftKey: !!mods.shift,
  metaKey: !!mods.meta,
});

const ctrl = { ctrl: true };

describe('createHoldDetector', () => {
  let onChange: ReturnType<typeof vi.fn<(held: Modifiers | null) => void>>;
  let detector: ReturnType<typeof createHoldDetector>;

  beforeEach(() => {
    vi.useFakeTimers();
    onChange = vi.fn<(held: Modifiers | null) => void>();
    detector = createHoldDetector({ delay: DELAY, onChange });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const shown = () => onChange.mock.lastCall?.[0] ?? null;

  it('shows the held modifiers once the delay has passed, and hides them on release', () => {
    detector.keydown(event('Control', ctrl));
    vi.advanceTimersByTime(DELAY - 1);
    expect(onChange).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(shown()).toMatchObject({ ctrl: true, alt: false });

    expect(detector.keyup(event('Control'))).toBe(true);
    expect(shown()).toBeNull();
  });

  it('is not restarted by key repeat', () => {
    detector.keydown(event('Control', ctrl));
    for (let elapsed = 0; elapsed < DELAY; elapsed += 50) {
      vi.advanceTimersByTime(50);
      detector.keydown(event('Control', ctrl, true));
    }
    expect(shown()).toMatchObject({ ctrl: true });
  });

  it('never appears after a shortcut was used, until the modifier is let go', () => {
    detector.keydown(event('Control', ctrl));
    detector.keydown(event('c', ctrl));
    vi.advanceTimersByTime(DELAY * 3);
    expect(onChange).not.toHaveBeenCalled();

    // A fresh hold after letting go works again.
    detector.keyup(event('Control'));
    detector.keydown(event('Control', ctrl));
    vi.advanceTimersByTime(DELAY);
    expect(shown()).toMatchObject({ ctrl: true });
  });

  it('recovers when the release that should have cleared a spoiled hold never arrived', () => {
    // Alt+1, then Alt is let go somewhere the page can't hear it (the OS, the browser's menu).
    detector.keydown(event('Alt', { alt: true }));
    detector.keydown(event('1', { alt: true }));
    // The next hold starts from nothing but Alt, so it is a fresh one.
    detector.keydown(event('Alt', { alt: true }));
    vi.advanceTimersByTime(DELAY);
    expect(shown()).toMatchObject({ alt: true });
  });

  it('stays up while shortcuts are pressed with the hints showing', () => {
    detector.keydown(event('Control', ctrl));
    vi.advanceTimersByTime(DELAY);
    detector.keydown(event('2', ctrl));
    detector.keyup(event('2', ctrl));
    expect(shown()).toMatchObject({ ctrl: true });
  });

  it('re-filters rather than hides when a second modifier joins', () => {
    detector.keydown(event('Control', ctrl));
    vi.advanceTimersByTime(DELAY);
    detector.keydown(event('Alt', { ctrl: true, alt: true }));
    expect(shown()).toMatchObject({ ctrl: true, alt: true });
    detector.keyup(event('Alt', ctrl));
    expect(shown()).toMatchObject({ ctrl: true, alt: false });
  });

  it('ignores Shift on its own', () => {
    detector.keydown(event('Shift', { shift: true }));
    vi.advanceTimersByTime(DELAY * 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('gives way to a click, so Ctrl+click never flashes hints', () => {
    detector.keydown(event('Control', ctrl));
    detector.pointerdown();
    vi.advanceTimersByTime(DELAY * 2);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('reports a release that ended nothing as such', () => {
    detector.keydown(event('Alt', { alt: true }));
    expect(detector.keyup(event('Alt'))).toBe(false);
  });
});
