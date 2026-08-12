import {
  Angry,
  Check,
  ChevronRight,
  Flame,
  Frown,
  Laugh,
  Meh,
  Minus,
  Pause,
  Play,
  Plus,
  Smile,
} from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Slider as SliderPrimitive } from 'radix-ui';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  configAt,
  formatDuration,
  formatHabitValue,
  scaleBounds,
  showsSeconds,
  type Habit,
} from './model';
import { useStopwatch, type Stopwatch } from './useStopwatch';

/* The pieces both surfaces are built from, so a habit looks like itself wherever it appears. */

/** Below this a streak is just "you did it today", which the control already shows. */
export const STREAK_MIN = 2;

/**
 * A disclosure for a group that is context rather than the point — retired habits, edit history —
 * the way the diary hides sub-entries and the person page hides what has already been said.
 *
 * The chevron rotates rather than swapping glyphs: the rotation *is* the state change, and reusing
 * the diary's exact idiom means one thing to learn instead of two.
 */
export function HiddenSection({
  count,
  showLabel,
  hideLabel,
  children,
}: {
  count: number;
  showLabel: string;
  hideLabel: string;
  children: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  if (count === 0) return null;

  return (
    <div className="mt-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((previous) => !previous)}
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {open ? hideLabel : showLabel}
      </Button>
      {open && <div className="mt-1 space-y-1 opacity-70">{children}</div>}
    </div>
  );
}

/**
 * The flame + number shown beside a habit on a run.
 *
 * Renders an empty slot rather than nothing below the threshold, because the caller reserves this
 * column for the whole list: without it every row's controls would sit at a different x depending
 * on whether that particular habit happened to be on a streak.
 */
export function StreakBadge({ streak, completed = true }: { streak: number; completed?: boolean }) {
  const { t } = useTranslation();
  if (streak < STREAK_MIN) return null;
  return (
    <span
      className={cn(
        'flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[11px] font-medium tabular-nums transition-colors',
        completed
          ? 'bg-amber-500/10 text-amber-700 dark:text-amber-400'
          : 'bg-muted text-muted-foreground',
      )}
      aria-label={t('plugins.habits.streak', { count: streak })}
    >
      <Flame className="size-3" aria-hidden />
      <span aria-hidden>{streak}</span>
    </span>
  );
}

/**
 * A habit's value as it stands *right now*, which for a running timer is not what is stored.
 *
 * `committed` is banked; `pending` is what the stopwatch has counted since it started and has not
 * yet written. Both are needed separately, because the progress bar draws them in different tones —
 * the point being that you can watch a session fill the bar without it looking already saved.
 */
export interface LiveValue {
  committed: number;
  pending: number;
  total: number;
  stopwatch: Stopwatch;
}

export function useLiveHabitValue(habit: Habit, value: number, dateKey: string): LiveValue {
  // Called for every kind because hooks cannot be conditional; it is a localStorage read and
  // nothing more for the four kinds that never start it.
  const stopwatch = useStopwatch(habit.id, dateKey);
  const pending = habit.type === 'time' ? stopwatch.elapsed : 0;
  return { committed: value, pending, total: value + pending, stopwatch };
}

/**
 * How wide a value's box is: the longest thing it will have to hold, in characters.
 *
 * ## Why it is computed rather than a class
 *
 * This control is two elements that must look like one — a button showing "1h 10m" and, on click,
 * a field holding "1:10:09". Neither CSS answer works. Content-derived sizing (`min-w-fit`) is
 * measured per element, so it resolves differently for two different strings, which *is* the resize.
 * A fixed class has to be wide enough for the longest string either state can ever show, and the
 * unit is user-authored ("glasses of water"), so no such number exists that isn't absurd everywhere
 * else — and the same class then has to serve a 12-minute stretch and a two-hour study session.
 *
 * So both states are measured against the *same* set of strings, here, and given one width. Opening
 * the field cannot move anything, because nothing about the measurement changed. The box still
 * adjusts as content genuinely grows — 9 → 10, or past an hour — which is the part that should
 * adjust.
 *
 * ## `ch`, and the slack
 *
 * `ch` is the advance of "0", and `tabular-nums` makes every digit exactly that, so the digits — the
 * part that actually varies — are measured exactly. Letters are not, but a duration's are `h`, `m`
 * and `s`, which land near enough either side of a digit to cancel out. The slack covers the
 * padding, the field's border, and that approximation; it is generous because being a few pixels
 * wide costs nothing and being a few pixels narrow clips the last character.
 */
const VALUE_SLACK = '0.75rem';
/** So a lone digit is still a comfortable target between two steppers. */
const VALUE_MIN_CHARS = 5;

const valueWidth = (...candidates: string[]): string =>
  `calc(${Math.max(VALUE_MIN_CHARS, ...candidates.map((text) => text.length))}ch + ${VALUE_SLACK})`;

/**
 * A value you can read, and edit by clicking it.
 *
 * Steppers are right for the common case — one more push-up, another five minutes — and hopeless
 * for the uncommon one: typing 47 push-ups is nine taps, and correcting a stopwatch that ran an
 * hour too long is not possible at all. So the number itself is a button, and pressing it (or
 * tabbing to it and hitting Enter) turns it into a field.
 *
 * Commit on blur and on Enter, abandon on Escape. A value that cannot be parsed is abandoned rather
 * than coerced: silently turning "3o" into 3 is worse than leaving what was there.
 */
function EditableValue({
  display,
  draftOf,
  parse,
  onCommit,
  ariaLabel,
  reserve,
  className,
  disabled = false,
}: {
  display: string;
  /** The text the field opens with — not always what is shown (a duration reads "1h 20m"). */
  draftOf: () => string;
  parse: (raw: string) => number | null;
  onCommit: (value: number) => void;
  ariaLabel: string;
  /**
   * A further string to hold room for, beyond what is on screen now.
   *
   * For the two cases where the box must not move for something that hasn't happened yet: a
   * stopwatch about to start showing seconds, and a rating whose track must not lengthen as the
   * number under it goes from 4 to 10.
   */
  reserve?: string;
  className?: string;
  disabled?: boolean;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  /* Measured against every string this box can show — the one on screen, the one clicking it opens,
     and whatever the caller is holding room for — so all of them get the same width. `draftOf` is
     called during render, which is safe because it only formats the value it was given. */
  const width = valueWidth(display, draft ?? draftOf(), reserve ?? '');

  if (draft === null) {
    return (
      <button
        type="button"
        disabled={disabled}
        aria-label={ariaLabel}
        onClick={() => setDraft(draftOf())}
        style={{ width }}
        className={cn(
          /* Never wraps: an under-measured string spilling sideways is a cosmetic near-miss, the
             same string wrapping to two lines is the row changing height — the identical reflow the
             width exists to prevent, in the other axis. */
          'rounded-md px-1 text-center whitespace-nowrap tabular-nums transition-colors',
          !disabled && 'hover:bg-accent',
          className,
        )}
      >
        {display}
      </button>
    );
  }

  const commit = () => {
    const parsed = parse(draft);
    setDraft(null);
    if (parsed !== null) onCommit(parsed);
  };

  return (
    <input
      autoFocus
      inputMode="numeric"
      /* An explicit width, which also settles what an `<input>` does when left to itself: twenty
         characters wide by specification, around 200px, several times the slot the button it
         replaced was sitting in. `size` would fix that too, but only by making the field's width
         its own business again — and the whole point here is that it is the button's. */
      style={{ width }}
      aria-label={ariaLabel}
      value={draft}
      onChange={(event) => setDraft(event.target.value)}
      onFocus={(event) => event.target.select()}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit();
        if (event.key === 'Escape') setDraft(null);
      }}
      className={cn(
        'rounded-md border border-input bg-background px-1 text-center tabular-nums outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50',
        className,
      )}
    />
  );
}

/** Whole, non-negative, or nothing. */
const parseCount = (raw: string): number | null => {
  const trimmed = raw.trim();
  return /^\d+$/.test(trimmed) ? Number.parseInt(trimmed, 10) : null;
};

/**
 * A duration typed as `h:mm:ss`, `mm:ss`, or a bare number of minutes.
 *
 * Bare minutes because that is what people type when they mean "forty minutes", and the colon forms
 * because that is what the display looks like once seconds matter. Anything else is refused rather
 * than guessed at.
 */
const parseDuration = (raw: string): number | null => {
  const trimmed = raw.trim();
  if (/^\d+$/.test(trimmed)) return Number.parseInt(trimmed, 10) * 60;
  if (!/^\d+(:[0-5]?\d){1,2}$/.test(trimmed)) return null;
  const parts = trimmed.split(':').map((part) => Number.parseInt(part, 10));
  return parts.length === 3 ? parts[0] * 3600 + parts[1] * 60 + parts[2] : parts[0] * 60 + parts[1];
};

/** The editable form of a duration: `h:mm:ss` when it has hours, `mm:ss` otherwise. */
const durationDraft = (seconds: number): string => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, '0');
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
};

/**
 * The control for one habit on a given day.
 *
 * One per kind: a box, a stepper, a stopwatch, a dragged track, five faces. Steppers rather than
 * text fields throughout, because the number is almost always reached by repetition ("another ten
 * minutes") and a day page on a phone should never open a keyboard to record a habit.
 *
 * `readOnly` renders the same shapes without the controls, for days being looked at rather than
 * filled in — a retired habit on a past day.
 */
export function HabitControl({
  habit,
  live,
  dateKey,
  onChange,
  readOnly = false,
}: {
  habit: Habit;
  live: LiveValue;
  dateKey: string;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const value = live.committed;
  const done = value > 0;

  if (habit.type === 'mood') {
    return <MoodControl habit={habit} value={value} onChange={onChange} readOnly={readOnly} />;
  }

  if (habit.type === 'scale') {
    return (
      <ScaleControl
        habit={habit}
        value={value}
        dateKey={dateKey}
        onChange={onChange}
        readOnly={readOnly}
      />
    );
  }

  if (habit.type === 'time') {
    return <TimeControl habit={habit} live={live} onChange={onChange} readOnly={readOnly} />;
  }

  /**
   * Binary: a labelled button, not a tick-box.
   *
   * A 20px box is under half the 44px a finger is reliably accurate to, and it was the *only*
   * control on the card that small — the steppers, the faces and the stopwatch are all comfortably
   * bigger. So the one habit that takes a single tap to record was the one hardest to tap, which is
   * exactly backwards.
   *
   * It is still a checkbox to a screen reader (`role`, `aria-checked`, named by the habit): the
   * semantics were right, only the target was wrong. The visible word is the same in both states —
   * the fill is what says which one you are in — so the button never becomes a congratulation, and
   * the row's width does not change as it is pressed.
   */
  if (habit.type === 'binary') {
    return (
      <Button
        type="button"
        role="checkbox"
        aria-checked={done}
        aria-label={habit.name}
        disabled={readOnly}
        variant={done ? 'default' : 'outline'}
        onClick={() => onChange?.(done ? 0 : 1)}
        className={cn('min-w-22 rounded-full', readOnly && 'opacity-60')}
      >
        {/* Always rendered, faded rather than absent when unchecked: mounting it on tick would
            change the button's content width, so the one control you press without aiming would
            move as you pressed it. */}
        <Check
          className={cn('size-3.5 transition-opacity', !done && 'opacity-30')}
          strokeWidth={3}
          aria-hidden
        />
        {t('plugins.habits.markDone')}
      </Button>
    );
  }

  /* Numeric. The step is the size of the thing being recorded — a goal of a hundred push-ups in
     ones is a hundred taps. Nothing caps the value at the goal: exceeding it is the good outcome. */
  const target = configAt(habit, dateKey).target;
  const step = target && target >= 50 ? 5 : 1;
  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* Disabled rather than unmounted, like every other kind's controls: `readOnly` toggles live
          now that a day can be unlocked mid-visit, and a stepper that appears and disappears would
          shift the row under whatever was about to be tapped. */}
      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-full sm:size-8"
        disabled={readOnly || value <= 0}
        aria-label={t('plugins.habits.decrease', { name: habit.name })}
        onClick={() => onChange?.(Math.max(0, value - step))}
      >
        <Minus className="size-3.5" />
      </Button>
      <EditableValue
        display={formatHabitValue(habit, value, dateKey)}
        draftOf={() => String(value)}
        parse={parseCount}
        onCommit={(next) => onChange?.(next)}
        ariaLabel={t('plugins.habits.edit', { name: habit.name })}
        disabled={readOnly}
        className={cn('text-sm', done ? 'font-medium' : 'text-muted-foreground')}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-full sm:size-8"
        disabled={readOnly}
        aria-label={t('plugins.habits.increase', { name: habit.name })}
        onClick={() => onChange?.(value + step)}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * Time: a stopwatch, plus the same stepper every other number gets.
 *
 * Both, because the two ways of recording time are genuinely different tasks. The timer is for
 * while it is happening; the stepper is for afterwards ("I read for about twenty minutes on the
 * train"), which is most of the time and which a timer cannot help with at all.
 *
 * Running time is *added* to what is already there rather than replacing it, so a session broken in
 * two adds up — and it is banked at full precision, which is why the value is seconds.
 *
 * ## Starting the timer changes one glyph and nothing else
 *
 * The stepper and the value stay exactly where they are; play becomes pause, and `−`, `+` and the
 * value go disabled. They used to unmount, which meant the act of starting a timer reflowed the row
 * out from under the finger that started it — and on a phone the button that had been under your
 * thumb a moment ago was suddenly a different one. Disabling says the same thing ("not while this is
 * running") without moving anything, and it is also the truer statement: they are still there, they
 * are just not the control you want right now.
 */
function TimeControl({
  habit,
  live,
  onChange,
  readOnly,
}: {
  habit: Habit;
  live: LiveValue;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { stopwatch, committed, total } = live;
  const running = stopwatch.running;
  const step = habit.target && habit.target < 15 * 60 ? 60 : 5 * 60;

  const toggle = () => {
    if (running) {
      const banked = stopwatch.stop();
      if (banked > 0) onChange?.(committed + banked);
    } else {
      stopwatch.start();
    }
  };

  return (
    <div className="flex shrink-0 items-center gap-0.5">
      {/* Disabled rather than unmounted, like every other kind's controls: `readOnly` toggles live
          now that a day can be unlocked mid-visit, and a control that appears and disappears would
          shift the row under whatever was about to be tapped. */}
      <Button
        variant={running ? 'default' : 'ghost'}
        size="icon"
        className="size-7 rounded-full sm:size-8"
        disabled={readOnly}
        aria-label={t(running ? 'plugins.habits.pause' : 'plugins.habits.start', {
          name: habit.name,
        })}
        onClick={toggle}
      >
        {running ? <Pause className="size-3.5" /> : <Play className="size-3.5" />}
      </Button>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-full sm:size-8"
        disabled={readOnly || running || committed <= 0}
        aria-label={t('plugins.habits.decrease', { name: habit.name })}
        onClick={() => onChange?.(Math.max(0, committed - step))}
      >
        <Minus className="size-3.5" />
      </Button>
      {/* Live, and not editable while running: typing into a number that ticks every second would
          fight the tick. Pause, then correct it — the same element, so nothing moves. Seconds always
          show while running, because a timer whose display does not move is indistinguishable from
          one that has stopped; the reserved width fits that longer form, so they cost no reflow. */}
      <EditableValue
        display={formatDuration(total, running || showsSeconds(habit))}
        draftOf={() => durationDraft(committed)}
        parse={parseDuration}
        onCommit={(next) => onChange?.(next)}
        ariaLabel={t('plugins.habits.edit', { name: habit.name })}
        disabled={readOnly || running}
        /* Room held for the running form even while paused. It is the longest thing this box ever
           shows — seconds appear the moment the stopwatch starts — and pressing play is the one
           moment nothing may move. Reserving it here rather than by magnitude means a 12-minute
           habit still gets a 12-minute box: it grows when the time does, not when a class says so. */
        reserve={formatDuration(total, true)}
        className={cn(
          'text-sm',
          running
            ? 'font-medium text-primary'
            : total > 0
              ? 'font-medium'
              : 'text-muted-foreground',
        )}
      />
      <Button
        variant="ghost"
        size="icon"
        className="size-7 rounded-full sm:size-8"
        disabled={readOnly || running}
        aria-label={t('plugins.habits.increase', { name: habit.name })}
        onClick={() => onChange?.(committed + step)}
      >
        <Plus className="size-3.5" />
      </Button>
    </div>
  );
}

/**
 * A dragged track, for a value that is judged rather than counted.
 *
 * ## Telling "the lowest" from "nothing"
 *
 * A slider parked at its left end looks identical whether you rated the night a 1 or never
 * answered, and those are completely different facts about a day. So an unset track draws no fill
 * and a hollow, dashed handle, reads as an em dash, and announces itself as not set; touching it
 * fills in. Clearing is the row's × — the same one every other kind uses.
 *
 * ## Ticks
 *
 * Marks make a scale countable at a glance rather than something you squint at, but one per unit is
 * a hatched blur on a 0–100 range. Capped at eleven, so 1–5 gets five and 0–100 gets one every ten.
 */
const MAX_TICKS = 11;

/**
 * Where the scale's ends actually are.
 *
 * ## The handle
 *
 * Radix keeps the thumb inside the Root by offsetting it half its own width inwards at each end, so
 * the ball's *left edge* lands on the start and its *right edge* on the finish — its centre marks
 * neither. That is right for a bare track and wrong for a ruled one: a handle reading 3 should be
 * centred over the mark for 3, and that has to hold at the bottom of the scale as much as anywhere.
 * The offset can't be switched off, so the track is inset to meet it instead.
 *
 * ## The ruler
 *
 * The end marks sat on the track's very tips, which are inside its rounding — so they read as
 * floating slightly off the end of the bar, and because every mark between them is spaced against
 * those two, the whole ruler was off. `TICK_INSET` is the track's corner radius: start the ruler
 * where the bar stops curving and the marks sit on the flat.
 *
 * ## Why they are one problem
 *
 * The thumb's centre travels from `THUMB_RADIUS` to `width - THUMB_RADIUS` of the Root, and the
 * marks now run from `TICK_INSET` to `trackWidth - TICK_INSET`. Inset the track by the difference
 * and both the constant and the slope come out equal — the handle lands on a mark at every end and
 * tracks the ruler in between. (Only *in between*: a 0–100 scale has eleven marks and a hundred
 * stops, so most values land between two, which is the point of a ruler rather than a set of pegs.)
 */
const TICK_INSET = 3; // px — half the track's 6px height, i.e. its corner radius
const THUMB_RADIUS = 7; // px — half of size-3.5

/**
 * The unset handle's colour — mixed, not translucent, for the reason `MOOD_IDLE` is.
 *
 * At 40% alpha the bar and the ruler read straight through the handle, so the one element that has
 * to sit *on* the track looked like part of it, and a tick passing underneath showed as a dark spot
 * travelling through the ball as you dragged. The handle is the thing being moved; it has to be
 * opaque or it isn't on top of anything.
 *
 * Mixed against `--card` rather than the track it overlaps, because at 14px against a 6px bar most
 * of the handle overhangs onto the card.
 */
const THUMB_IDLE = 'bg-[color-mix(in_oklch,var(--card),var(--muted-foreground)_40%)]';

function ScaleControl({
  habit,
  value,
  dateKey,
  onChange,
  readOnly,
}: {
  habit: Habit;
  value: number;
  dateKey: string;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  const { min, max } = scaleBounds(habit, dateKey);
  const recorded = value > 0;
  const span = max - min;
  const stride = Math.max(1, Math.ceil(span / (MAX_TICKS - 1)));
  const ticks: number[] = [];
  for (let mark = min; mark <= max; mark += stride) ticks.push(mark);
  if (ticks[ticks.length - 1] !== max) ticks.push(max);

  return (
    <div className="flex min-w-32 flex-1 items-center gap-3">
      <SliderPrimitive.Root
        className="relative flex h-6 flex-1 touch-none items-center select-none data-disabled:opacity-50"
        aria-label={habit.name}
        aria-valuetext={recorded ? `${value}` : t('plugins.habits.notSet')}
        min={min}
        max={max}
        step={1}
        disabled={readOnly}
        value={[recorded ? value : min]}
        onValueChange={([next]) => onChange?.(next)}
      >
        {/* Narrower than the Root by exactly the overhang Radix reserves for the thumb, so the ends
            of the bar are where the handle's centre can actually reach. See the note above. */}
        <SliderPrimitive.Track
          className="relative h-1.5 grow rounded-full bg-muted"
          style={{ marginInline: THUMB_RADIUS - TICK_INSET }}
        >
          <SliderPrimitive.Range
            className={cn(
              'absolute h-full rounded-full',
              recorded ? 'bg-primary' : 'bg-transparent',
            )}
          />
          {/* Behind the handle and non-interactive: they are a ruler, not targets. */}
          <span className="pointer-events-none absolute inset-0" aria-hidden>
            {ticks.map((mark) => (
              <span
                key={mark}
                /* Centred by auto margins against a pinned top and bottom, not by translating the
                   dot half its own height. Both are "centre it", but only one is exact: the dot is
                   4px inside a 6px track, so the whole clearance is a pixel either side and a
                   translate that lands on a half-pixel spends it all, which reads as the ruler
                   sitting high rather than as a rounding error. Auto margins split an integer
                   remainder and cannot land between pixels. Horizontally it is still a translate,
                   where the dot has a whole track to be off-centre in and nothing to notice. */
                className={cn(
                  'absolute inset-y-0 my-auto size-1 -translate-x-1/2 rounded-full',
                  recorded && mark <= value ? 'bg-primary-foreground/60' : 'bg-foreground/20',
                )}
                style={{
                  left: `calc(${TICK_INSET}px + (100% - ${TICK_INSET * 2}px) * ${(mark - min) / span})`,
                }}
              />
            ))}
          </span>
        </SliderPrimitive.Track>
        {/* A small dot rather than a bordered puck: at this size a ring reads as a second control
            sitting on the track. Grey while nothing is recorded and solid foreground — white in
            dark mode — once there is a value, so "not answered" and "answered lowest" differ by
            fill rather than only by position. */}
        <SliderPrimitive.Thumb
          className={cn(
            'relative block size-3.5 rounded-full transition-colors after:absolute after:-inset-2.5 focus-visible:ring-3 focus-visible:ring-ring/40 focus-visible:outline-none',
            recorded ? 'bg-foreground' : THUMB_IDLE,
          )}
        />
      </SliderPrimitive.Root>
      <EditableValue
        display={recorded ? `${value}/${max}` : '—'}
        draftOf={() => (recorded ? String(value) : '')}
        parse={(raw) => {
          const parsed = parseCount(raw);
          /* Clamped rather than refused: a rating has hard ends, and typing 11 on a 1–10 scale
             plainly means "the top". A count has no ceiling, so it is not clamped there. */
          return parsed === null ? null : Math.min(max, Math.max(min, parsed));
        }}
        onCommit={(next) => onChange?.(next)}
        ariaLabel={t('plugins.habits.edit', { name: habit.name })}
        disabled={readOnly}
        /* Room held for the scale's widest reading, so this box is a constant for a given habit and
           the track beside it does not shorten as the number goes from 4 to 10. Every pixel here is
           one the track doesn't get, and the track is the control — but a track that changes length
           while you drag it is worse than a slightly shorter one. */
        reserve={`${max}/${max}`}
        className={cn('shrink-0 text-sm', recorded ? 'font-medium' : 'text-muted-foreground')}
      />
    </div>
  );
}

/** Five faces, worst to best. Icons rather than emoji so they inherit the palette and stroke weight
    of everything else, and render identically on every platform. */
const MOOD_ICONS = [Angry, Frown, Meh, Smile, Laugh];

/**
 * The unchosen face's colour — a blend, not a translucent one.
 *
 * These icons are built from several separate `<path>` elements that touch: an eye is a 1-unit line
 * with round caps (`M15 10V9`), and on the angry face the eyebrow is drawn straight across it. Each
 * path composites its own alpha, so a translucent stroke does not overlay those crossings at 45% —
 * it overlays them twice, at about 70%, and the eyes came out as two bright pinpricks on a face
 * that was supposed to be evenly faded. Nothing was wrong with the icon; alpha simply is not a
 * property you can hand to five shapes and expect to hold for their union.
 *
 * Mixing the colour instead gives one opaque value with nothing to double up. It is the same grey
 * 45% over the card would have produced, and it is the same trick `button.tsx` uses for its
 * secondary hover — computed against `--card`, which is what this control always sits on.
 */
const MOOD_IDLE = 'text-[color-mix(in_oklch,var(--card),var(--muted-foreground)_45%)]';

function MoodControl({
  habit,
  value,
  onChange,
  readOnly,
}: {
  habit: Habit;
  value: number;
  onChange?: (value: number) => void;
  readOnly?: boolean;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex shrink-0 items-center gap-0.5" role="radiogroup" aria-label={habit.name}>
      {MOOD_ICONS.map((Icon, index) => {
        const level = index + 1;
        const chosen = value === level;
        return (
          <button
            key={level}
            type="button"
            role="radio"
            aria-checked={chosen}
            aria-label={t(`plugins.habits.mood${level}`)}
            disabled={readOnly}
            // Tapping the chosen face again clears it — the only way back to "not recorded" without
            // a sixth control meaning "nothing".
            onClick={() => onChange?.(chosen ? 0 : level)}
            className={cn(
              'flex size-8.5 items-center justify-center rounded-full transition-colors',
              chosen
                ? 'bg-primary/15 text-primary'
                : `${MOOD_IDLE} hover:bg-accent hover:text-muted-foreground`,
              readOnly && 'pointer-events-none',
            )}
          >
            <Icon className="size-5.5" aria-hidden />
          </button>
        );
      })}
    </div>
  );
}

/**
 * The bar under a goal, drawn in two tones.
 *
 * The darker part is what has been saved; the lighter part is what a running stopwatch has counted
 * and not yet banked. Watching a session fill the bar is most of the point of having a timer, and
 * drawing both in the same colour would say the time was already recorded when pausing is what
 * records it.
 *
 * ## Stacked, not side by side
 *
 * The pale band is drawn from zero to the *total* and the solid bar sits on top of it, rather than
 * the two being laid end to end. It matters only at one moment, and it is the moment the bar exists
 * for: pausing. Banking a session leaves the total exactly where it was — what was pending is now
 * committed — so the pale band does not move at all, and the solid bar simply grows across it to
 * the mark the session had already reached.
 *
 * End to end, the same instant read as the opposite of what happened: the pale segment's width fell
 * to zero the moment it was banked, so the preview *vanished* and the solid bar then crawled 300ms
 * to catch up with a mark that was no longer drawn. The reward for finishing a session was watching
 * your progress disappear and be slowly re-earned.
 *
 * ## Why the pale band is a stopwatch thing only
 *
 * There is nothing pending on a counted habit — `pending` is zero for every kind but time — so the
 * band's width already *is* the solid bar's. It was still visible for a third of a second every time
 * a count went up, and only because the two moved differently: the band snapped to the new value
 * while the bar eased into it, and the gap between them was grey.
 *
 * So the band eases too, whenever nothing is running. Then the only thing that can separate them is
 * a stopwatch, which is the one case the band is for. No check on the habit's kind is needed and
 * none would be honest — it is not the kind that makes a preview, it is having something un-banked.
 */
export function HabitProgress({
  habit,
  live,
  dateKey,
}: {
  habit: Habit;
  live: LiveValue;
  dateKey: string;
}) {
  const target = configAt(habit, dateKey).target;
  // Only the two kinds that can fall short of something. A rating or a mood *is* its value, and a
  // box is either ticked or not — a bar there would be decoration pretending to be information.
  if ((habit.type !== 'numeric' && habit.type !== 'time') || !target) return null;

  const committed = Math.min(1, live.committed / target);
  // The far edge of everything counted, banked or not. Conserved across a pause, which is the whole
  // reason the two are stacked rather than laid end to end.
  const total = Math.min(1, (live.committed + live.pending) / target);

  return (
    /* `w-full` on a narrow screen. It is a width rather than a flex basis on purpose: `flex-1` and
       `basis-full` both write `flex-basis`, and which of the two wins is Tailwind's emit order, not
       the order they appear in here — a coin toss to read the layout by. A plain width with the
       default `flex-basis: auto` says the same thing unambiguously: too wide to share a line, so it
       wraps to one of its own and fills it. A 20-unit stub beside the controls was a fraction you
       had to squint at. Above `sm` it goes back to a fixed gauge on the controls' line, free to
       shrink to `min-w-16` before anything overflows. */
    <div
      className="relative h-1.5 w-full min-w-16 overflow-hidden rounded-full bg-muted sm:w-40"
      aria-hidden
    >
      {/* Underneath, and the full extent of what has been counted. It eases in step with the bar
          above it — which is what keeps it out of sight on a habit that has no stopwatch — except
          while one is actually running, where it advances every second and easing each of those
          steps makes a smooth clock look laggy. */}
      <div
        className={cn(
          'absolute inset-y-0 left-0 bg-primary/25',
          live.pending === 0 && 'transition-[width] duration-300',
        )}
        style={{ width: `${total * 100}%` }}
      />
      <div
        className={cn(
          'absolute inset-y-0 left-0 transition-[width] duration-300',
          committed >= 1 ? 'bg-primary' : 'bg-primary/60',
        )}
        style={{ width: `${committed * 100}%` }}
      />
    </div>
  );
}
