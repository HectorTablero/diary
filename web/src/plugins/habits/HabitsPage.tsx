import {
  Archive,
  CircleCheckBig,
  Hash,
  ListTodo,
  Plus,
  RotateCcw,
  SlidersHorizontal,
  Smile,
  Timer,
  Pencil,
  Trash2,
} from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/common/EmptyState';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateKey, todayKey, weekdayName } from '@/lib/dates';
import { useWeekStart } from '@/lib/preferences';
import { splitColumns, useIsWideContainer } from '@/lib/useContainerWidth';
import { cn } from '@/lib/utils';
import { describeSchedule, habitChanges } from './changes';
import { HiddenSection, StreakBadge } from './HabitControls';
import {
  DEFAULT_SCALE_MAX,
  DEFAULT_SCALE_MIN,
  defaultSchedule,
  formatDuration,
  formatHabitValue,
  HABIT_KINDS,
  habitOccursOn,
  isCheckbox,
  MAX_HABIT_NAME_LENGTH,
  MAX_HABIT_TARGET,
  MAX_HABIT_UNIT_LENGTH,
  metTarget,
  scaleBounds,
  scheduleAt,
  showsSeconds,
  type Habit,
  type HabitKind,
} from './model';
import {
  MAX_INTERVAL_DAYS,
  MIN_INTERVAL_DAYS,
  sameSchedule,
  SCHEDULE_KINDS,
  WEEKDAY_INDICES,
  type HabitSchedule,
  type HabitScheduleKind,
} from './schedule';
import { dateKeyWindow } from './streaks';
import { useHabitsLibrary } from './useHabits';

/**
 * The habit tracker's own screen: where habits are made, and where you see how they have gone.
 *
 * The split with the day widget is deliberate and is the point of having two surfaces. The day page
 * answers "what am I doing today" and must be finishable in two taps; this answers "what am I
 * tracking, and how has it been going", which needs decisions — a name, whether it ticks or counts,
 * a unit, a target, whether to retire it. Putting either job on the other screen makes one of them
 * worse.
 */

/** Three weeks: wide enough to see a pattern, narrow enough to fit a phone without scrolling. */
const GRID_DAYS = 21;

/* A habit card carries a 21-cell day grid across its full width — the same reason people's row of
   badges wants more room than a tag chip does, that grid wants more per column than a bare list
   item, so this sits above TagsPage's/PeriodPage's LIST_TWO_COLUMN_MIN. Still comfortably under
   ~700px, though: `PageContainer` here never widens past its default max-w-3xl, so that's roughly
   the ceiling this page's content width can ever reach, on any window. */
const HABITS_TWO_COLUMN_MIN = 620;

/** One habit list — active or archived — rendered as a single column or, given the room, as two
    independent ones built from `splitColumns`. Shared so the archived list inside `HiddenSection`
    doesn't have to repeat this branch. */
function HabitCardList({
  habits,
  today,
  library,
  onEdit,
  twoColumns,
  archived = false,
}: {
  habits: Habit[];
  today: string;
  library: ReturnType<typeof useHabitsLibrary>;
  onEdit: (habit: Habit) => void;
  twoColumns: boolean;
  archived?: boolean;
}) {
  if (!twoColumns) {
    return (
      <div className="space-y-3">
        {habits.map((habit) => (
          <HabitCard
            key={habit.id}
            habit={habit}
            today={today}
            library={library}
            onEdit={() => onEdit(habit)}
            archived={archived}
          />
        ))}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-3">
      {splitColumns(habits).map((column, i) => (
        <div key={i} className="flex min-w-0 flex-1 flex-col gap-3">
          {column.map((habit) => (
            <HabitCard
              key={habit.id}
              habit={habit}
              today={today}
              library={library}
              onEdit={() => onEdit(habit)}
              archived={archived}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export default function HabitsPage() {
  const { t } = useTranslation();
  const today = todayKey();
  const library = useHabitsLibrary(today);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Habit | null>(null);
  const [listRef, twoColumns] = useIsWideContainer<HTMLDivElement>(HABITS_TWO_COLUMN_MIN);

  return (
    <PageContainer>
      <PageHeader
        title={t('plugins.habits.title')}
        actions={
          !library.atLimit && !adding ? (
            <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              {t('plugins.habits.newHabit')}
            </Button>
          ) : null
        }
      />

      <HabitForm
        open={adding}
        onOpenChange={setAdding}
        onSubmit={async (habit) => {
          await library.addHabit(habit);
          setAdding(false);
        }}
      />

      {/* The same form, opened on an existing habit. Its kind is fixed once created — stored values
          mean different things per kind, and reinterpreting a year of numbers is a new habit. */}
      <HabitForm
        key={editing?.id}
        habit={editing ?? undefined}
        open={editing !== null}
        onOpenChange={(open) => !open && setEditing(null)}
        onSubmit={async (config) => {
          if (editing) await library.editHabit(editing, config);
          setEditing(null);
        }}
      />

      <div ref={listRef}>
        {library.loading ? (
          <div className="space-y-3">
            <Skeleton className="h-20 w-full" />
            <Skeleton className="h-20 w-full" />
          </div>
        ) : library.active.length === 0 && library.archived.length === 0 ? (
          <EmptyState
            icon={CircleCheckBig}
            title={t('plugins.habits.empty')}
            description={t('plugins.habits.emptyPageDescription')}
          >
            <Button size="sm" className="mt-2 gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-3.5" />
              {t('plugins.habits.newHabit')}
            </Button>
          </EmptyState>
        ) : (
          <HabitCardList
            habits={library.active}
            today={today}
            library={library}
            onEdit={setEditing}
            twoColumns={twoColumns}
          />
        )}

        <HiddenSection
          count={library.archived.length}
          showLabel={t('plugins.habits.retiredCount', { count: library.archived.length })}
          hideLabel={t('plugins.habits.hideRetired')}
        >
          <HabitCardList
            habits={library.archived}
            today={today}
            library={library}
            onEdit={setEditing}
            twoColumns={twoColumns}
            archived
          />
        </HiddenSection>
      </div>
    </PageContainer>
  );
}

/** The glyph in a habit card's corner — what kind of thing this is, at a glance down the page. */
function KindIcon({ kind }: { kind: HabitKind }) {
  const Icon =
    kind === 'numeric'
      ? Hash
      : kind === 'time'
        ? Timer
        : kind === 'scale'
          ? SlidersHorizontal
          : kind === 'mood'
            ? Smile
            : kind === 'task'
              ? ListTodo
              : CircleCheckBig;
  return <Icon className="size-3.5" />;
}

/**
 * The one-line description under a habit's name.
 *
 * Every branch is written out rather than built from a template, because `checkI18n` can only see
 * string-literal keys — a key assembled at runtime is invisible to it and would be the first thing
 * to go missing in a translation nobody checks.
 */
function habitSummary(habit: Habit, t: TFunction): string {
  switch (habit.type) {
    case 'numeric':
      return habit.target
        ? t('plugins.habits.summaryNumeric_target', {
            unit: habit.unit || t('plugins.habits.typeNumeric'),
            target: habit.target,
          })
        : t('plugins.habits.summaryNumeric', {
            unit: habit.unit || t('plugins.habits.typeNumeric'),
          });
    case 'time':
      return habit.target
        ? t('plugins.habits.summaryTime_target', {
            target: formatDuration(habit.target, showsSeconds(habit)),
          })
        : t('plugins.habits.summaryTime');
    case 'scale': {
      const { min, max } = scaleBounds(habit);
      return t('plugins.habits.summaryScale', { min, max });
    }
    case 'mood':
      return t('plugins.habits.summaryMood');
    case 'task':
      return t('plugins.habits.summaryTask');
    default:
      return t('plugins.habits.summaryBinary');
  }
}

/**
 * The habit's edit history, behind the same disclosure everything else contextual uses.
 *
 * Shown because the grid alone can mislead: a wall of met days beside a goal of 100 invites the
 * reading that you were always doing 100, when half of them were a goal of 50 you had every right
 * to be pleased with. The log is what makes the grid honest.
 */
function HabitChanges({ habit }: { habit: Habit }) {
  const { t, i18n } = useTranslation();
  const weekStart = useWeekStart();
  const changes = habitChanges(habit, t, i18n.language, weekStart);
  if (!changes.length) return null;

  return (
    <HiddenSection
      count={changes.length}
      showLabel={t('plugins.habits.changeCount', { count: changes.length })}
      hideLabel={t('plugins.habits.hideChanges')}
    >
      <ol className="space-y-1 text-xs text-muted-foreground">
        {changes.map((change) => (
          <li key={change.since}>
            <span className="font-medium">{formatDateKey(change.since, i18n.language)}</span>
            {change.lines.map((line) => (
              <span key={line} className="block">
                {line}
              </span>
            ))}
          </li>
        ))}
      </ol>
    </HiddenSection>
  );
}

function HabitCard({
  habit,
  today,
  library,
  onEdit,
  archived = false,
}: {
  habit: Habit;
  today: string;
  library: ReturnType<typeof useHabitsLibrary>;
  onEdit: () => void;
  archived?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const days = dateKeyWindow(today, GRID_DAYS);
  const recorded = library.progress.get(habit.id) ?? 0;
  /* A habit that was never recorded has no history to protect, so it can simply go. One that was
     can only be retired — the days it happened on are diary history, and there is no undo. */
  const deletable = recorded === 0;
  const todayValue = library.history.get(today)?.[habit.id] ?? 0;
  const todayCompleted = metTarget(habit, todayValue, today);
  /* Named on the card whenever it is anything but "every day" — which is what a habit was before
     schedules existed, and still the thing most of them are. Saying so on every card would be a
     word in every line that distinguishes nothing. */
  const schedule = scheduleAt(habit);
  const scheduleNoted = schedule.kind !== 'daily';
  const weekStart = useWeekStart();

  return (
    <section
      className={cn('rounded-xl border bg-card p-4 shadow-xs', archived && 'border-dashed')}
      aria-labelledby={`habit-${habit.id}-name`}
    >
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden
        >
          <KindIcon kind={habit.type} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id={`habit-${habit.id}-name`} className="truncate text-sm font-medium">
            {habit.name}
          </h2>
          <p className="text-xs text-muted-foreground">
            {habitSummary(habit, t)}
            {scheduleNoted && ` · ${describeSchedule(schedule, t, i18n.language, weekStart)}`}
            {' · '}
            {t('plugins.habits.recordedDays', { count: recorded })}
          </p>
        </div>
        <StreakBadge
          streak={library.streaks.get(habit.id) ?? 0}
          completed={todayCompleted}
          everyDay={!scheduleNoted}
        />
      </div>

      {/* Oldest on the left. Each cell carries its own label, because a row of coloured squares
          says nothing at all to a screen reader. */}
      <ol
        className="mt-3 flex gap-1"
        aria-label={t('plugins.habits.lastDays', { count: GRID_DAYS })}
      >
        {days.map((day) => {
          const value = library.history.get(day)?.[habit.id] ?? 0;
          const filled = value > 0;
          const met = metTarget(habit, value, day);
          /* A day the habit was never asked on is drawn fainter than an empty one, and read out as
             such. Without the distinction a Mon/Wed/Fri habit looks like a habit failed four days
             a week — the grid would be showing the calendar's shape rather than the person's. */
          const asked = habitOccursOn(habit, day);
          return (
            <li
              key={day}
              className={cn(
                'h-7 flex-1 rounded-sm transition-colors',
                !filled && (asked ? 'bg-muted' : 'bg-muted/40'),
                filled && met && 'bg-primary',
                filled && !met && 'bg-primary/40',
              )}
            >
              <span className="sr-only">
                {formatDateKey(day, i18n.language)} —{' '}
                {filled
                  ? isCheckbox(habit.type)
                    ? t('plugins.habits.done')
                    : formatHabitValue(habit, value, day)
                  : asked
                    ? t('plugins.habits.notDone')
                    : t('plugins.habits.notScheduled')}
              </span>
            </li>
          );
        })}
      </ol>

      <HabitChanges habit={habit} />

      <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t pt-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          onClick={onEdit}
        >
          <Pencil className="size-3" />
          {t('common.edit')}
        </Button>
        {archived ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs"
            onClick={() => void library.setArchived(habit, false)}
          >
            <RotateCcw className="size-3" />
            {t('plugins.habits.restore')}
          </Button>
        ) : deletable ? (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-destructive"
            onClick={() => void library.deleteHabit(habit)}
          >
            <Trash2 className="size-3" />
            {t('common.delete')}
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => void library.setArchived(habit, true)}
          >
            <Archive className="size-3" />
            {t('plugins.habits.retire')}
          </Button>
        )}
      </div>
    </section>
  );
}

/**
 * The parts of the schedule form, assembled into the thing that gets stored.
 *
 * Each shape falls back within itself rather than to another shape: a monthly with no date typed is
 * the 1st, not "every day". Someone who picked "day of the month" and moved on has said the thing
 * that matters, and turning that into a daily habit would be answering a different question from
 * the one they answered. The bounds are the schema's own, applied here so a submitted form can
 * never produce a row `scheduleSchema` would refuse to read back.
 */
function buildSchedule(
  kind: HabitScheduleKind,
  weekdays: number[],
  monthDay: string,
  interval: string,
): HabitSchedule {
  const clamp = (raw: string, fallback: number, low: number, high: number) => {
    const parsed = Number.parseInt(raw, 10);
    return Number.isFinite(parsed) ? Math.min(Math.max(parsed, low), high) : fallback;
  };
  switch (kind) {
    case 'weekdays':
      return { kind: 'weekdays', days: [...weekdays].sort((a, b) => a - b) };
    case 'monthly':
      return { kind: 'monthly', day: clamp(monthDay, 1, 1, 31) };
    case 'interval':
      return {
        kind: 'interval',
        every: clamp(interval, MIN_INTERVAL_DAYS, MIN_INTERVAL_DAYS, MAX_INTERVAL_DAYS),
      };
    default:
      return { kind };
  }
}

/** The option names in the schedule picker. Spelled out rather than assembled, for the reason
    `habitSummary` spells its branches out: `checkI18n` only ever sees string literals. */
function scheduleOptionLabel(kind: HabitScheduleKind, t: TFunction): string {
  switch (kind) {
    case 'once':
      return t('plugins.habits.scheduleOnce');
    case 'weekdays':
      return t('plugins.habits.scheduleWeekdays');
    case 'monthly':
      return t('plugins.habits.scheduleMonthly');
    case 'interval':
      return t('plugins.habits.scheduleInterval');
    default:
      return t('plugins.habits.scheduleDaily');
  }
}

/**
 * When a habit is asked about — one picker, and whatever that choice needs beside it.
 *
 * Progressive rather than four fields side by side: three of the five shapes need nothing at all,
 * and a form that shows a day-of-the-month box to someone tracking a daily habit is a form asking
 * four questions to record the answer to one.
 *
 * `once` is offered only for a task. A habit that happens on exactly one day is a task by another
 * name, and offering it in both places would be offering two routes to the same thing — the sort of
 * choice that makes a person wonder which one they were supposed to pick.
 */
function ScheduleField({
  kind,
  onKindChange,
  task,
  weekdays,
  onWeekdaysChange,
  monthDay,
  onMonthDayChange,
  interval,
  onIntervalChange,
}: {
  kind: HabitScheduleKind;
  onKindChange: (kind: HabitScheduleKind) => void;
  task: boolean;
  weekdays: number[];
  onWeekdaysChange: (days: number[]) => void;
  monthDay: string;
  onMonthDayChange: (value: string) => void;
  interval: string;
  onIntervalChange: (value: string) => void;
}) {
  const { t, i18n } = useTranslation();
  /* Stored Sunday-first, always; shown from whichever day the reader's week starts on — the same
     Settings preference the calendar's month grid is built from, rather than a second answer to a
     question the app has already asked. The two orders are deliberately not the same thing: one is
     a storage format, the other is a reading habit, and pinning the format to the reader is how a
     synced row starts meaning two different things on two devices. */
  const weekStart = useWeekStart();
  const ordered = WEEKDAY_INDICES.map((offset) => (weekStart + offset) % 7);
  const options: HabitScheduleKind[] = task ? ['once', ...SCHEDULE_KINDS] : [...SCHEDULE_KINDS];

  return (
    <div className="space-y-1.5">
      <Label htmlFor="habit-schedule">{t('plugins.habits.scheduleLabel')}</Label>
      <Select value={kind} onValueChange={(next) => onKindChange(next as HabitScheduleKind)}>
        <SelectTrigger id="habit-schedule" aria-label={t('plugins.habits.scheduleLabel')}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {options.map((option) => (
            <SelectItem key={option} value={option}>
              {scheduleOptionLabel(option, t)}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {kind === 'weekdays' && (
        /* Seven toggles rather than a multi-select: the whole week fits across a phone at this
           size, and picking three days is three taps against a list that has to be opened, scrolled
           and dismissed. The visible label is the two-letter form and the accessible one is the
           full weekday name, since "We" read aloud is not a day of the week. */
        <div
          className="flex flex-wrap gap-1 pt-0.5"
          role="group"
          aria-label={t('plugins.habits.weekdaysLabel')}
        >
          {ordered.map((day) => {
            const picked = weekdays.includes(day);
            return (
              <Button
                key={day}
                type="button"
                size="sm"
                variant={picked ? 'default' : 'outline'}
                aria-pressed={picked}
                aria-label={weekdayName(day, i18n.language)}
                className="h-8 min-w-10 flex-1 px-2 text-xs capitalize"
                onClick={() =>
                  onWeekdaysChange(
                    picked ? weekdays.filter((other) => other !== day) : [...weekdays, day],
                  )
                }
              >
                {weekdayName(day, i18n.language, 'EEEEEE')}
              </Button>
            );
          })}
        </div>
      )}

      {kind === 'monthly' && (
        <div className="space-y-1.5 pt-0.5">
          <Label htmlFor="habit-month-day" className="text-xs text-muted-foreground">
            {t('plugins.habits.monthDayLabel')}
          </Label>
          <Input
            id="habit-month-day"
            inputMode="numeric"
            value={monthDay}
            placeholder="1"
            onChange={(event) =>
              onMonthDayChange(event.target.value.replace(/\D/g, '').slice(0, 2))
            }
          />
          {/* The commonest reason to pick 31 is "the last day of the month", so say what February
              will do with it now rather than letting someone find out in eleven months. */}
          <p className="text-xs text-muted-foreground">{t('plugins.habits.monthDayHint')}</p>
        </div>
      )}

      {kind === 'interval' && (
        <div className="space-y-1.5 pt-0.5">
          <Label htmlFor="habit-interval" className="text-xs text-muted-foreground">
            {t('plugins.habits.intervalLabel')}
          </Label>
          <Input
            id="habit-interval"
            inputMode="numeric"
            value={interval}
            placeholder={String(MIN_INTERVAL_DAYS)}
            onChange={(event) =>
              onIntervalChange(event.target.value.replace(/\D/g, '').slice(0, 3))
            }
          />
          <p className="text-xs text-muted-foreground">{t('plugins.habits.intervalHint')}</p>
        </div>
      )}
    </div>
  );
}

/**
 * Creating a habit: what to call it, which of the six kinds it is, and when it is asked about.
 *
 * A dialog rather than a panel on the page. Creating a habit is a short, self-contained decision
 * with its own fields, and inline it pushed the list of existing habits down the screen — so the
 * one thing worth looking at while naming a new one was the thing that moved away.
 */
function HabitForm({
  habit,
  open,
  onOpenChange,
  onSubmit,
}: {
  /** Present when editing. Its kind is shown but fixed. */
  habit?: Habit;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (habit: {
    name: string;
    type: HabitKind;
    unit?: string;
    target?: number;
    min?: number;
    max?: number;
    /** Always present, `undefined` meaning the kind's default — see the note in `submit`. */
    schedule: HabitSchedule | undefined;
  }) => void;
}) {
  const { t } = useTranslation();
  const editing = habit !== undefined;
  const [name, setName] = useState(habit?.name ?? '');
  const [type, setType] = useState<HabitKind>(habit?.type ?? 'binary');
  const [unit, setUnit] = useState(habit?.unit ?? '');
  // Time goals are held in seconds and edited in minutes — the one place the two units meet.
  const [target, setTarget] = useState(
    habit?.target === undefined
      ? ''
      : String(habit.type === 'time' ? Math.round(habit.target / 60) : habit.target),
  );
  const [min, setMin] = useState(habit?.min === undefined ? '' : String(habit.min));
  const [max, setMax] = useState(habit?.max === undefined ? '' : String(habit.max));

  /* The schedule is held as its parts rather than as a `HabitSchedule`, so switching from weekdays
     to monthly and back does not throw away the days that were picked. `buildSchedule` assembles
     them on submit; the one shape that can be left genuinely empty — a week with no days ticked —
     is refused there by the submit button rather than assembled into a habit that never comes
     round. */
  const initial: HabitSchedule = habit
    ? (habit.schedule ?? defaultSchedule(habit.type))
    : { kind: 'daily' };
  const [scheduleKind, setScheduleKind] = useState<HabitScheduleKind>(initial.kind);
  const [weekdays, setWeekdays] = useState<number[]>(
    initial.kind === 'weekdays' ? initial.days : [],
  );
  const [monthDay, setMonthDay] = useState(initial.kind === 'monthly' ? String(initial.day) : '');
  const [interval, setInterval] = useState(
    initial.kind === 'interval' ? String(initial.every) : '',
  );

  /* `once` is only meaningful for a task — a habit that happens on exactly one day is a task by
     another name — and it is a task's default. So the two are kept in step as the kind changes,
     rather than leaving the picker offering an option that would be dropped on submit. */
  useEffect(() => {
    if (editing) return;
    setScheduleKind((current) =>
      type === 'task' ? 'once' : current === 'once' ? 'daily' : current,
    );
  }, [type, editing]);

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    const number = (raw: string) => {
      const parsed = Number.parseInt(raw, 10);
      return Number.isFinite(parsed) ? parsed : undefined;
    };
    const parsedTarget = number(target);
    const parsedMin = number(min) ?? DEFAULT_SCALE_MIN;
    const parsedMax = number(max) ?? DEFAULT_SCALE_MAX;

    const built = buildSchedule(scheduleKind, weekdays, monthDay, interval);
    /* Stored only when it says something the kind does not already say. A habit left on "every
       day" keeps an absent `schedule`, exactly like every row written before this existed — so
       opening a habit and saving it unchanged banks no revision, and the change log stays a log of
       decisions rather than of dialogs that were opened.

       Always passed, even as `undefined`, unlike the optional fields below: `editHabit` applies the
       new configuration by spreading it over the old one, so a key that is merely absent leaves the
       previous value standing. Absent would mean "unchanged" where this has to mean "back to every
       day". */
    const schedule = sameSchedule(built, defaultSchedule(type)) ? undefined : built;

    onSubmit({
      schedule,
      name: trimmed,
      type,
      ...(type === 'numeric' && unit.trim() ? { unit: unit.trim() } : {}),
      /* Time is entered in minutes and stored in seconds — the field says "(minutes)" because
         nobody sets a reading goal in seconds, and the storage is seconds because the stopwatch
         produces them. The conversion belongs here, at the one place the two units meet. */
      ...((type === 'numeric' || type === 'time') && parsedTarget && parsedTarget > 0
        ? { target: Math.min(type === 'time' ? parsedTarget * 60 : parsedTarget, MAX_HABIT_TARGET) }
        : {}),
      // Swapped or equal bounds fall back to the defaults rather than producing a dead track.
      ...(type === 'scale' && parsedMax > parsedMin
        ? { min: parsedMin, max: Math.min(parsedMax, MAX_HABIT_TARGET) }
        : {}),
    });
  };

  /* Reset on close, so reopening is a fresh habit rather than the half-filled remains of an
     abandoned one — which would be indistinguishable from a form that had failed to submit. */
  useEffect(() => {
    if (open || editing) return;
    setName('');
    setType('binary');
    setUnit('');
    setTarget('');
    setMin('');
    setMax('');
    setScheduleKind('daily');
    setWeekdays([]);
    setMonthDay('');
    setInterval('');
  }, [open, editing]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing ? t('plugins.habits.editHabit') : t('plugins.habits.newHabit')}
          </DialogTitle>
        </DialogHeader>
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault();
            submit();
          }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="habit-name">{t('plugins.habits.nameLabel')}</Label>
            <Input
              id="habit-name"
              autoFocus
              value={name}
              maxLength={MAX_HABIT_NAME_LENGTH}
              placeholder={t('plugins.habits.namePlaceholder')}
              onChange={(event) => setName(event.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="habit-type">{t('plugins.habits.typeLabel')}</Label>
            <Select value={type} onValueChange={(next) => setType(next as HabitKind)}>
              <SelectTrigger id="habit-type" aria-label={t('plugins.habits.typeLabel')}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {HABIT_KINDS.map((kind) => (
                  <SelectItem key={kind} value={kind}>
                    {t(`plugins.habits.type${kind[0].toUpperCase()}${kind.slice(1)}`)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* One line saying what the chosen kind actually is. The names alone don't distinguish
            "a number" from "a rating" for someone meeting them for the first time. */}
            <p className="text-xs text-muted-foreground">
              {t(`plugins.habits.type${type[0].toUpperCase()}${type.slice(1)}Hint`)}
            </p>
          </div>

          <ScheduleField
            kind={scheduleKind}
            onKindChange={setScheduleKind}
            task={type === 'task'}
            weekdays={weekdays}
            onWeekdaysChange={setWeekdays}
            monthDay={monthDay}
            onMonthDayChange={setMonthDay}
            interval={interval}
            onIntervalChange={setInterval}
          />

          {/* All optional. A counted habit is perfectly useful as a bare number — "how many times did I
          do this" needs neither a word for it nor a goal to fall short of. */}
          {type === 'numeric' && (
            <div className="flex gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="habit-target">{t('plugins.habits.targetLabel')}</Label>
                <Input
                  id="habit-target"
                  inputMode="numeric"
                  value={target}
                  placeholder={t('plugins.habits.targetPlaceholder')}
                  onChange={(event) => setTarget(event.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="habit-unit">{t('plugins.habits.unitLabel')}</Label>
                <Input
                  id="habit-unit"
                  value={unit}
                  maxLength={MAX_HABIT_UNIT_LENGTH}
                  placeholder={t('plugins.habits.unitPlaceholder')}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </div>
            </div>
          )}

          {/* Time has no unit to choose — it is minutes, shown as hours and minutes. */}
          {type === 'time' && (
            <div className="space-y-1.5">
              <Label htmlFor="habit-target">{t('plugins.habits.targetMinutesLabel')}</Label>
              <Input
                id="habit-target"
                inputMode="numeric"
                value={target}
                placeholder={t('plugins.habits.targetMinutesPlaceholder')}
                onChange={(event) => setTarget(event.target.value.replace(/\D/g, ''))}
              />
            </div>
          )}

          {/* Mood is deliberately not configurable: five faces, always the same five, so the icon in a
          grid means the same thing in every diary. */}
          {type === 'scale' && (
            <div className="flex gap-3">
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="habit-min">{t('plugins.habits.minLabel')}</Label>
                <Input
                  id="habit-min"
                  inputMode="numeric"
                  value={min}
                  placeholder={String(DEFAULT_SCALE_MIN)}
                  onChange={(event) => setMin(event.target.value.replace(/\D/g, ''))}
                />
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                <Label htmlFor="habit-max">{t('plugins.habits.maxLabel')}</Label>
                <Input
                  id="habit-max"
                  inputMode="numeric"
                  value={max}
                  placeholder={String(DEFAULT_SCALE_MAX)}
                  onChange={(event) => setMax(event.target.value.replace(/\D/g, ''))}
                />
              </div>
            </div>
          )}

          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            {/* The name is the one field that isn't optional: it is how the habit is referred to
                everywhere else, and there is nothing sensible to fall back on. */}
            <Button
              type="submit"
              /* A week with no days ticked is a habit that never comes round, so it is refused
                 rather than quietly falling back to every day — the one schedule shape that can be
                 left genuinely empty. */
              disabled={!name.trim() || (scheduleKind === 'weekdays' && weekdays.length === 0)}
            >
              {editing ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
