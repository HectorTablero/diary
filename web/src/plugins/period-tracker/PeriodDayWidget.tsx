import { Droplet, Lock, LockOpen } from 'lucide-react';
import { useState, type ReactNode } from 'react';
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
 * On today and every past day, in one of two sizes, so the flow buttons are always within reach
 * of any day that has happened:
 *
 *   - the **full card** opens by itself when there's something to say — **today** if a period is
 *     predicted soon, already ongoing and undecided for today, or already marked; a **past** day if
 *     it was marked;
 *   - any other such day gets a single **quiet button** in its place, the same arrangement the
 *     expense tracker uses for a past day with nothing on it. Pressing it opens the full card, and
 *     since that is already a deliberate act, the card opens unlocked.
 *
 * A marked past day opens **locked**, behind the padlock habits uses: correcting history is a
 * deliberate act rather than a stray tap.
 *
 * A **future** day never has the buttons, nor the quiet button — nobody can mark a day that hasn't
 * happened. It shows only the prediction's words, and only inside a predicted window.
 *
 * Once open, the card stays open for the visit even if an edit would, on its own, argue for closing
 * it again — tapping "no period" on a marked day must not make the card that button lives on vanish
 * out from under the tap that pressed it.
 *
 * ## Why no day ever shows a day-count
 *
 * A period's "day 2 of 5" would be a guess dressed as an observation for any day not yet marked, and
 * a bare restatement of something the control already shows for one that has been — so neither case
 * earns the number, and it never appears.
 */
export function PeriodDayWidget({ dateKey }: { dateKey: string }) {
  const { t } = useTranslation();
  const { day, outlook, ongoing, ready, setFlow } = usePeriodDay(dateKey);
  const today = todayKey();
  const isToday = dateKey === today;
  const isPast = dateKey < today;
  const isFuture = dateKey > today;

  // Whether *this day's* data opens the full card by itself — see the class comment.
  const opensByItself = isPast
    ? day !== undefined
    : day !== undefined || ongoing || outlook.kind !== 'none';

  /* Both keyed by the day they were set for rather than reset by an effect, so moving to another day
     starts from "closed, locked" in that same render — never showing one day's answer for the next.
     `openedFor` is set during render (React's pattern for state derived from props) the moment this
     day's own data says to open, and then stays: that is what makes an opened card sticky. */
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  const [unlockedFor, setUnlockedFor] = useState<string | null>(null);
  if (ready && opensByItself && openedFor !== dateKey) setOpenedFor(dateKey);

  if (!ready) return null;

  if (isFuture) {
    return outlook.kind === 'none' ? null : (
      <Card>
        <OutlookText outlook={outlook} />
      </Card>
    );
  }

  if (openedFor !== dateKey) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="gap-1.5 text-xs text-muted-foreground"
        onClick={() => {
          setOpenedFor(dateKey);
          setUnlockedFor(dateKey);
        }}
      >
        <Droplet className="size-3.5" aria-hidden />
        {t('plugins.period-tracker.openControl')}
      </Button>
    );
  }

  const locked = !isToday && unlockedFor !== dateKey;

  /* What the control reads as selected:
       - a marked day: the recorded flow, as habits' controls always defer to what was stored;
       - today, with a run left open since yesterday: nothing, because defaulting to "no period"
         would answer a question that hasn't been decided yet;
       - otherwise: "no period", which is simply true until told otherwise. */
  const selected: FlowLevel | 'off' | undefined = day
    ? day.flow
    : isToday && ongoing
      ? undefined
      : 'off';

  return (
    <Card
      action={
        isToday ? undefined : (
          <DayLockButton locked={locked} onToggle={() => setUnlockedFor(locked ? dateKey : null)} />
        )
      }
    >
      <div className="space-y-3">
        {!day && outlook.kind !== 'none' && <OutlookText outlook={outlook} />}
        <PeriodControl
          value={selected}
          onSelect={(choice) => void setFlow(choice === 'off' ? null : choice)}
          disabled={locked}
        />
      </div>
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

/** Own copy of habits' day-lock button, simplified: it only ever appears on a past day — a future
    day never carries the buttons to lock — so there is only one reason to give. See
    HabitsDayWidget.tsx for the pattern this follows. */
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
