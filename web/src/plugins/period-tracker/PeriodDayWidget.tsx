import { Droplet, Lock, LockOpen } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { HintTooltip } from '@/components/common/HintTooltip';
import { Button } from '@/components/ui/button';
import { todayKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { FLOW_ICON, OFF_ICON } from './flowIcons';
import { FLOW_LEVELS, type FlowLevel } from './model';
import type { PeriodOutlook } from './predict';
import { usePeriodDay } from './useCycle';

/**
 * The period tracker's card on the day page.
 *
 * Deliberately absent most days — the complaint a plugin present on every single day earns, whether
 * or not there is anything to say. This only ever renders for a reason:
 *
 *   - **today**, if a period is predicted soon, already ongoing and undecided for today, or already
 *     marked;
 *   - a **past** day, only if it *was* actually marked when this mount last checked — nothing to say
 *     about an ordinary day gone by, and nothing to *add* to one either: that belongs to the
 *     plugin's own page now (see PeriodPage, "add a past period"). Once shown, it stays shown for
 *     the visit even if unmarking it right there would, on its own, argue for hiding it again — see
 *     `wantsShown` vs. `shown` below;
 *   - a **future** day, only if it falls inside a predicted window — and then only the words, never
 *     the control. Nobody can mark a day that hasn't happened.
 *
 * ## Why no day ever shows a day-count
 *
 * A period's "day 2 of 5" would be a guess dressed as an observation for any day not yet marked, and
 * a bare restatement of something the control already shows for one that has been — so neither case
 * earns the number, and it never appears.
 */
export function PeriodDayWidget({ dateKey }: { dateKey: string }) {
  const { day, outlook, ongoing, loading, setFlow } = usePeriodDay(dateKey);
  const today = todayKey();
  const isPast = dateKey < today;
  const isFuture = dateKey > today;

  // Whether *this render's* data says the card belongs on screen — see the class comment for what
  // each branch is watching for.
  const wantsShown = isFuture
    ? outlook.kind !== 'none'
    : isPast
      ? day !== undefined
      : day !== undefined || ongoing || outlook.kind !== 'none';

  /* But once a card has actually appeared, it stays for the life of this mount even if a later edit
     would, on its own, have answered `wantsShown` differently — tapping "no period" on an
     already-marked day must not make the card that button lives on vanish out from under the tap
     that pressed it. The card's *content* still tracks `day`/`outlook`/`ongoing` live (the pill
     moves to reflect what was just pressed); only the decision to show it at all is sticky. Reset
     whenever the viewed day changes, so a different date starts this fresh — "shown" is a fact about
     a visit to *this* day, not a flag that should survive navigating to another one. */
  const [shown, setShown] = useState(false);
  useEffect(() => {
    setShown(false);
  }, [dateKey]);
  useEffect(() => {
    if (!loading && wantsShown) setShown(true);
  }, [loading, wantsShown]);

  if (loading || !shown) return null;

  if (isPast) {
    // A past day speaks for itself — see the class comment. What it does speak is still editable,
    // behind the same lock every other day-but-today opens under: correcting a mistaken flow, or
    // unmarking the day outright, is a deliberate act on history, not a casual one. `day` may already
    // be gone by the time this renders (the day was just unmarked) — `'off'` is the honest reading of
    // that, not a reason to have hidden the card `wantsShown` no longer asks for.
    return (
      <PastCard
        dateKey={dateKey}
        value={day ? day.flow : 'off'}
        onSelect={(choice) => void setFlow(choice === 'off' ? null : choice)}
      />
    );
  }

  if (isFuture) {
    return (
      <Card>
        <OutlookText outlook={outlook} />
      </Card>
    );
  }

  // Today. The control's own "selected" reading differs by which of the three reasons in the class
  // comment applied when the card appeared:
  //   - already marked: the recorded flow, exactly as habits' own controls always defer to what was
  //     actually stored;
  //   - a run left open since yesterday, with today not yet answered: nothing selected, because
  //     defaulting to "no period" would misstate a question that hasn't been decided yet;
  //   - otherwise (a fresh prediction, nothing ongoing): "no period" selected, which is simply true
  //     until told otherwise.
  const selected: FlowLevel | 'off' | undefined = day ? day.flow : ongoing ? undefined : 'off';

  return (
    <Card>
      {!day && outlook.kind !== 'none' && <OutlookText outlook={outlook} />}
      <PeriodControl
        value={selected}
        onSelect={(choice) => void setFlow(choice === 'off' ? null : choice)}
      />
    </Card>
  );
}

/** Exported for `onboarding/DayWarningsStep.tsx`, which previews this card's two faces — the
    outlook text and the flow control — through the exact components the day page renders rather
    than a redrawing of either. */
export function Card({ children, action }: { children: ReactNode; action?: ReactNode }) {
  const { t } = useTranslation();
  return (
    <section
      className="rounded-xl border bg-card p-4 shadow-xs"
      aria-labelledby="period-tracker-day-title"
    >
      <div className="flex items-center gap-2">
        <Droplet className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <h2 id="period-tracker-day-title" className="flex-1 text-sm font-medium">
          {t('plugins.period-tracker.title')}
        </h2>
        {action}
      </div>
      <div className="mt-3">{children}</div>
    </section>
  );
}

/**
 * A past, marked day — the one case the control is shown locked. Its own small component only
 * because it is the one branch that owns unlock state; every other branch is a pure function of
 * `usePeriodDay`'s own return.
 */
function PastCard({
  dateKey,
  value,
  onSelect,
}: {
  dateKey: string;
  value: FlowLevel | 'off';
  onSelect: (choice: FlowLevel | 'off') => void;
}) {
  /* Opens read-only, with a lock the day can be unlocked from — the same friction habits puts in
     front of editing a day that is not the one being lived. Local state, not persisted: reopening
     this day, or simply leaving and coming back, starts locked again. The point is friction at the
     moment of editing history, not a setting to configure once. */
  const [unlocked, setUnlocked] = useState(false);
  useEffect(() => {
    setUnlocked(false);
  }, [dateKey]);

  return (
    <Card
      action={
        <DayLockButton locked={!unlocked} onToggle={() => setUnlocked((current) => !current)} />
      }
    >
      <PeriodControl value={value} onSelect={onSelect} disabled={!unlocked} />
    </Card>
  );
}

/** Own copy of habits' day-lock button, simplified: every day this appears on is in the past — a
    future day never carries a control to lock in the first place — so there is only ever one reason
    the padlock is showing, not two. See HabitsDayWidget.tsx for the pattern this follows. */
function DayLockButton({ locked, onToggle }: { locked: boolean; onToggle: () => void }) {
  const { t } = useTranslation();
  const reason = t(
    locked ? 'plugins.period-tracker.dayLockedPast' : 'plugins.period-tracker.dayUnlockedHint',
  );

  return (
    <HintTooltip content={reason}>
      <Button
        variant="ghost"
        size="icon"
        className="size-7 shrink-0 text-muted-foreground"
        aria-label={t(locked ? 'plugins.period-tracker.unlock' : 'plugins.period-tracker.lock')}
        onClick={onToggle}
      >
        {locked ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
      </Button>
    </HintTooltip>
  );
}

export function OutlookText({ outlook }: { outlook: PeriodOutlook }) {
  const { t } = useTranslation();
  if (outlook.kind === 'none') return null;
  return (
    <p className="text-sm text-muted-foreground">
      {outlook.kind === 'approaching'
        ? t('plugins.period-tracker.approaching', { count: outlook.daysUntil })
        : t('plugins.period-tracker.due')}
    </p>
  );
}

/**
 * The day's whole choice: how heavy, or not at all.
 *
 * Two visually distinct pieces sharing one radiogroup — a merged pill of the three flow levels,
 * beside a standalone "no period" button. Not one undifferentiated row of four: "no period" is not a
 * fourth intensity, it is the *absence* of the other three, and looking different from them is what
 * says so before either tooltip does.
 *
 * `value` of `undefined` renders with nothing pressed, for the one case that has to ask rather than
 * assume — see PeriodDayWidget's notes on `ongoing`.
 */
export function PeriodControl({
  value,
  onSelect,
  disabled,
}: {
  value: FlowLevel | 'off' | undefined;
  onSelect: (choice: FlowLevel | 'off') => void;
  disabled?: boolean;
}) {
  const { t } = useTranslation();
  const offLabel = t('plugins.period-tracker.flowOff');

  return (
    <div
      className="flex flex-wrap items-center gap-3"
      role="radiogroup"
      aria-label={t('plugins.period-tracker.flowLabel')}
    >
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted-foreground">
          {t('plugins.period-tracker.flowLabel')}
        </span>
        {/* The merged pill: one rounded-full track, each level a segment inside it — the app's own
            segmented-switcher look (see ExploreLayout), which already means "one choice among these"
            everywhere else it appears. */}
        <div className="inline-flex items-center gap-0.5 rounded-full bg-muted p-1">
          {FLOW_LEVELS.map((level) => {
            const Icon = FLOW_ICON[level];
            const selected = value === level;
            const label = t(
              `plugins.period-tracker.flow${level.charAt(0).toUpperCase()}${level.slice(1)}`,
            );
            return (
              <HintTooltip key={level} content={label}>
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={label}
                  disabled={disabled}
                  onClick={() => onSelect(level)}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full transition-colors',
                    selected
                      ? 'bg-primary text-primary-foreground shadow-xs'
                      : 'text-muted-foreground hover:text-foreground',
                    disabled && 'pointer-events-none opacity-60',
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                </button>
              </HintTooltip>
            );
          })}
        </div>
      </div>

      <HintTooltip content={offLabel}>
        <Button
          type="button"
          role="radio"
          aria-checked={value === 'off'}
          aria-label={offLabel}
          disabled={disabled}
          variant={value === 'off' ? 'default' : 'outline'}
          size="icon"
          className={cn('size-9 rounded-full', disabled && 'opacity-60')}
          onClick={() => onSelect('off')}
        >
          <OFF_ICON className="size-4" aria-hidden />
        </Button>
      </HintTooltip>
    </div>
  );
}
