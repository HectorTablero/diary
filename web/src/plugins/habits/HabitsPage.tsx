import {
  Archive,
  CircleCheckBig,
  Hash,
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
import { formatDateKey, todayKey } from '@/lib/dates';
import { splitColumns, useIsWideContainer } from '@/lib/useContainerWidth';
import { cn } from '@/lib/utils';
import { habitChanges } from './changes';
import { HiddenSection, StreakBadge } from './HabitControls';
import {
  DEFAULT_SCALE_MAX,
  DEFAULT_SCALE_MIN,
  formatDuration,
  formatHabitValue,
  HABIT_KINDS,
  MAX_HABIT_NAME_LENGTH,
  MAX_HABIT_TARGET,
  MAX_HABIT_UNIT_LENGTH,
  metTarget,
  scaleBounds,
  showsSeconds,
  type Habit,
  type HabitKind,
} from './model';
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
  const changes = habitChanges(habit, t);
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
            {' · '}
            {t('plugins.habits.recordedDays', { count: recorded })}
          </p>
        </div>
        <StreakBadge streak={library.streaks.get(habit.id) ?? 0} completed={todayCompleted} />
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
          return (
            <li
              key={day}
              className={cn(
                'h-7 flex-1 rounded-sm transition-colors',
                !filled && 'bg-muted',
                filled && met && 'bg-primary',
                filled && !met && 'bg-primary/40',
              )}
            >
              <span className="sr-only">
                {formatDateKey(day, i18n.language)} —{' '}
                {filled
                  ? habit.type === 'binary'
                    ? t('plugins.habits.done')
                    : formatHabitValue(habit, value, day)
                  : t('plugins.habits.notDone')}
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
 * Creating a habit: what to call it, and which of the five kinds it is.
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

    onSubmit({
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
            <Button type="submit" disabled={!name.trim()}>
              {editing ? t('common.save') : t('common.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
