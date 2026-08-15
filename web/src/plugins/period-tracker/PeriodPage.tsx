import { differenceInCalendarDays } from 'date-fns';
import {
  ChevronRight,
  Droplet,
  Pencil,
  Plus,
  Repeat,
  Timer,
  Trash2,
  type LucideIcon,
} from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { EmptyState } from '@/components/common/EmptyState';
import { HintTooltip } from '@/components/common/HintTooltip';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import { DatePicker } from '@/components/ui/date-picker';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { formatDateKey, parseDateKey, todayKey } from '@/lib/dates';
import { cn } from '@/lib/utils';
import { FLOW_ICON } from './flowIcons';
import { DEFAULT_FLOW, FLOW_LEVELS, type FlowLevel, type PeriodDay } from './model';
import { dateKeysBetween, type Cycle } from './predict';
import { usePeriodHistory } from './useCycle';

/**
 * The period tracker's own screen: the history the day card doesn't have room for, and — since the
 * restructure that made the day card stop offering to mark an arbitrary blank day — the only place
 * a forgotten period gets entered or its shape corrected at all.
 *
 * The split with the day widget is the same one habits draws between its card and its page: the day
 * card answers "what's true about today", one or two taps and done; this answers "how has it been
 * going" and "I forgot to log something" or "I logged something wrong", all of which want the whole
 * list rather than one day's worth.
 */
export default function PeriodPage() {
  const { t } = useTranslation();
  const { cycles, byDate, stats, loading, deleteCycle, addPeriod, editCycle, setDayFlow } =
    usePeriodHistory();
  const [confirming, setConfirming] = useState<Cycle | null>(null);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Cycle | null>(null);
  const [working, setWorking] = useState(false);

  const confirmDelete = async () => {
    if (!confirming) return;
    setWorking(true);
    await deleteCycle(confirming);
    setWorking(false);
    setConfirming(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title={t('plugins.period-tracker.title')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            {t('plugins.period-tracker.addPeriod')}
          </Button>
        }
      />

      {/* One dialog for both jobs — adding and editing write through the same range-of-days shape,
          so they differ only in a title, a submit label and what the fields start out holding. Keyed
          on which cycle (if any) is being edited, so switching from one edit to another — or from
          editing to a fresh "add" — remounts with a clean slate rather than carrying over state. */}
      <PeriodFormDialog
        key={editing?.start ?? 'new'}
        open={adding || editing !== null}
        onOpenChange={(open) => {
          if (!open) {
            setAdding(false);
            setEditing(null);
          }
        }}
        initial={
          editing ? { start: editing.start, end: editing.end, flowByDay: byDate } : undefined
        }
        onSubmit={async (start, end, flowByDay) => {
          if (editing) await editCycle(editing, start, end, flowByDay);
          else await addPeriod(start, end, flowByDay);
          setAdding(false);
          setEditing(null);
        }}
      />

      {loading ? (
        <div className="space-y-3">
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      ) : cycles.length === 0 ? (
        <EmptyState
          icon={Droplet}
          title={t('plugins.period-tracker.empty')}
          description={t('plugins.period-tracker.emptyPageDescription')}
        >
          <Button size="sm" className="mt-2 gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-3.5" />
            {t('plugins.period-tracker.addPeriod')}
          </Button>
        </EmptyState>
      ) : (
        <>
          {/* Only shown once there is a real average behind it — see recentStats — rather than a
              placeholder that would read as data before there is any. */}
          {stats && (
            <div className="mb-4 grid grid-cols-2 gap-3">
              <StatCard
                icon={Repeat}
                label={t('plugins.period-tracker.avgCycleLengthLabel')}
                value={t('plugins.period-tracker.daysCount', {
                  count: Math.round(stats.avgCycleLength),
                })}
              />
              <StatCard
                icon={Timer}
                label={t('plugins.period-tracker.avgDurationLabel')}
                value={t('plugins.period-tracker.daysCount', {
                  count: Math.round(stats.avgDuration),
                })}
              />
            </div>
          )}

          <ul className="space-y-3">
            {cycles.map((cycle, i) => (
              <CycleCard
                key={cycle.start}
                cycle={cycle}
                previous={cycles[i + 1]}
                byDate={byDate}
                onEdit={() => setEditing(cycle)}
                onDelete={() => setConfirming(cycle)}
                onSetDayFlow={(dateKey, flow) => void setDayFlow(dateKey, flow)}
              />
            ))}
          </ul>
        </>
      )}

      {/* Confirmed, unlike a habit definition with no history: every day here is diary history, the
          same reason habits can only retire and never delete once anything has been recorded. A
          cycle has nothing but recorded days, so deleting it is deleting that history outright — and
          there is no undo, which the dialog says plainly rather than leaving to be discovered. */}
      <Dialog open={confirming !== null} onOpenChange={(open) => !open && setConfirming(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('plugins.period-tracker.deleteCycleTitle')}</DialogTitle>
            <DialogDescription>
              {t('plugins.period-tracker.deleteCycleDescription')}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setConfirming(null)} disabled={working}>
              {t('common.cancel')}
            </Button>
            <Button variant="destructive" onClick={() => void confirmDelete()} disabled={working}>
              {t('common.delete')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}

function StatCard({
  icon: Icon,
  label,
  value,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-xs">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <Icon className="size-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-lg font-semibold tabular-nums">{value}</p>
        <p className="truncate text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

/**
 * A disclosure for a group that is context rather than the point — the same idiom habits'
 * HiddenSection uses for retired habits and edit history: the chevron rotates rather than swapping
 * glyphs, because the rotation *is* the state change. Its own copy rather than a shared import,
 * matching this plugin's habit of not reaching into another plugin's internals for a component this
 * small.
 */
export function Disclosure({
  label,
  hideLabel,
  children,
  defaultOpen = false,
}: {
  label: string;
  hideLabel: string;
  children: ReactNode;
  /** Open on first render rather than collapsed — for `onboarding/CyclePageStep.tsx`, which exists
      to show what is behind this disclosure and would otherwise have to script a click before
      there was anything on screen worth looking at. Every real call site leaves this at its
      default, which is unchanged from before this prop existed. */
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mt-2">
      <Button
        variant="ghost"
        size="sm"
        className="h-7 gap-1 px-2 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <ChevronRight className={cn('size-3.5 transition-transform', open && 'rotate-90')} />
        {open ? hideLabel : label}
      </Button>
      {open && <div className="mt-2 space-y-1">{children}</div>}
    </div>
  );
}

const capitalize = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);

/** The bare three-button flow choice, with no "no period" option — every day it is offered for is
    already a period day by construction (a day inside a chosen or logged range), so there is nothing
    for "off" to mean here. Shared between a cycle card's expanded day list and the add/edit dialog's
    own copy of the same list. */
function IntensityPill({
  value,
  onSelect,
}: {
  value: FlowLevel;
  onSelect: (level: FlowLevel) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className="flex gap-1">
      {FLOW_LEVELS.map((level) => {
        const Icon = FLOW_ICON[level];
        const selected = value === level;
        const label = t(`plugins.period-tracker.flow${capitalize(level)}`);
        return (
          <HintTooltip key={level} content={label}>
            <Button
              type="button"
              role="radio"
              aria-checked={selected}
              aria-label={label}
              variant={selected ? 'default' : 'outline'}
              size="icon"
              className="size-7 rounded-full"
              onClick={() => onSelect(level)}
            >
              <Icon className="size-3.5" aria-hidden />
            </Button>
          </HintTooltip>
        );
      })}
    </div>
  );
}

export function CycleCard({
  cycle,
  previous,
  byDate,
  onEdit,
  onDelete,
  onSetDayFlow,
  disclosureDefaultOpen,
  disableActions,
}: {
  cycle: Cycle;
  /** The cycle before this one, chronologically — used only for the cycle-length reading beside it.
      Absent for the earliest cycle on record, which has nothing to measure a length against. */
  previous?: Cycle;
  byDate: ReadonlyMap<string, PeriodDay>;
  onEdit: () => void;
  onDelete: () => void;
  onSetDayFlow: (dateKey: string, flow: FlowLevel) => void;
  /** Passed straight through to the per-day list's own `Disclosure`. See that prop's own note. */
  disclosureDefaultOpen?: boolean;
  /** Grays out Edit and Delete without removing them — for a tour's preview of this card, where
      both would otherwise look like real actions on a period that does not exist. The intensity
      list stays live regardless: it is what the card exists to demonstrate. */
  disableActions?: boolean;
}) {
  const { t, i18n } = useTranslation();
  const duration = differenceInCalendarDays(parseDateKey(cycle.end), parseDateKey(cycle.start)) + 1;
  const cycleLength = previous
    ? differenceInCalendarDays(parseDateKey(cycle.start), parseDateKey(previous.start))
    : undefined;

  return (
    <li className="rounded-xl border bg-card p-4 shadow-xs">
      <div className="flex items-start gap-2">
        <span
          className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground"
          aria-hidden
        >
          <Droplet className="size-3.5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium">
            {formatDateKey(cycle.start, i18n.language, 'PP')}
            {cycle.end !== cycle.start && ` – ${formatDateKey(cycle.end, i18n.language, 'PP')}`}
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {t('plugins.period-tracker.daysCount', { count: duration })}
            {cycleLength !== undefined &&
              ` · ${t('plugins.period-tracker.cycleLength', { count: cycleLength })}`}
          </p>
        </div>
      </div>

      <Disclosure
        label={t('plugins.period-tracker.perDayToggle')}
        hideLabel={t('plugins.period-tracker.perDayToggleHide')}
        defaultOpen={disclosureDefaultOpen}
      >
        <ul className="space-y-1">
          {dateKeysBetween(cycle.start, cycle.end).map((day) => (
            <li
              key={day}
              className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
            >
              <span className="text-xs text-muted-foreground">
                {formatDateKey(day, i18n.language, 'PP')}
              </span>
              <IntensityPill
                value={byDate.get(day)?.flow ?? DEFAULT_FLOW}
                onSelect={(level) => onSetDayFlow(day, level)}
              />
            </li>
          ))}
        </ul>
      </Disclosure>

      <div className="mt-3 flex flex-wrap justify-end gap-1.5 border-t pt-2.5">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-muted-foreground"
          disabled={disableActions}
          onClick={onEdit}
        >
          <Pencil className="size-3" />
          {t('common.edit')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 gap-1 px-2 text-xs text-destructive"
          disabled={disableActions}
          onClick={onDelete}
        >
          <Trash2 className="size-3" />
          {t('common.delete')}
        </Button>
      </div>
    </li>
  );
}

/**
 * The add-a-period / edit-a-period form: a date range, and a disclosure for refining the flow of
 * each day inside it.
 *
 * Every day in the range defaults to a medium flow (or, editing, to whatever it already held). No
 * "no period" option in the per-day list — unlike the day widget's control, which has to be able to
 * say a day *isn't* one, every day here already is one by virtue of falling inside the chosen range.
 * Narrowing the range is how a day is excluded.
 */
function PeriodFormDialog({
  open,
  onOpenChange,
  initial,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Present when editing an existing cycle; absent when adding a new one. `flowByDay` may hold more
      than the cycle's own days — the caller passes the page's whole `byDate` map for convenience —
      only the days actually inside `start`..`end` are ever read from it. */
  initial?: { start: string; end: string; flowByDay: ReadonlyMap<string, PeriodDay> };
  onSubmit: (
    start: string,
    end: string,
    flowByDay: ReadonlyMap<string, FlowLevel>,
  ) => Promise<void>;
}) {
  const { t, i18n } = useTranslation();
  const editing = initial !== undefined;
  const today = todayKey();
  const [start, setStart] = useState(initial?.start ?? '');
  const [end, setEnd] = useState(initial?.end ?? '');
  const [perDay, setPerDay] = useState<Record<string, FlowLevel>>({});
  const [expanded, setExpanded] = useState(false);
  const [working, setWorking] = useState(false);

  const days = start && end && start <= end ? dateKeysBetween(start, end) : [];
  const valid = days.length > 0;

  const flowOf = (day: string): FlowLevel =>
    perDay[day] ?? initial?.flowByDay.get(day)?.flow ?? DEFAULT_FLOW;

  const submit = async () => {
    if (!valid) return;
    setWorking(true);
    const flowByDay = new Map(days.map((day) => [day, flowOf(day)]));
    await onSubmit(start, end, flowByDay);
    setWorking(false);
  };

  // Reset on close, so reopening the same instance (repeated "add" presses; an edit always remounts
  // fresh via the page's `key`) is a clean form rather than the half-filled remains of the last one.
  useEffect(() => {
    if (open) return;
    setStart(initial?.start ?? '');
    setEnd(initial?.end ?? '');
    setPerDay({});
    setExpanded(false);
  }, [open, initial]);

  return (
    <Dialog open={open} onOpenChange={(next) => !working && onOpenChange(next)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>
            {editing
              ? t('plugins.period-tracker.editPeriod')
              : t('plugins.period-tracker.addPeriod')}
          </DialogTitle>
          <DialogDescription>
            {editing
              ? t('plugins.period-tracker.editPeriodDescription')
              : t('plugins.period-tracker.addPeriodDescription')}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="flex gap-3">
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="period-start">{t('plugins.period-tracker.startDateLabel')}</Label>
              <DatePicker
                id="period-start"
                value={start}
                max={today}
                rangeAnchor={end}
                // Pushing the end date forward when it falls before a newly-picked start keeps the
                // range always valid, rather than leaving it silently inverted until the end field
                // is also touched.
                onChange={(next) => {
                  setStart(next);
                  if (end && next > end) setEnd(next);
                }}
              />
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              <Label htmlFor="period-end">{t('plugins.period-tracker.endDateLabel')}</Label>
              <DatePicker
                id="period-end"
                value={end}
                min={start}
                max={today}
                rangeAnchor={start}
                onChange={setEnd}
              />
            </div>
          </div>

          {days.length > 0 && (
            <Disclosure
              label={t('plugins.period-tracker.perDayToggle')}
              hideLabel={t('plugins.period-tracker.perDayToggleHide')}
            >
              <ul className="max-h-56 space-y-1 overflow-y-auto pr-1">
                {days.map((day) => (
                  <li
                    key={day}
                    className="flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5"
                  >
                    <span className="text-xs text-muted-foreground">
                      {formatDateKey(day, i18n.language, 'PP')}
                    </span>
                    <IntensityPill
                      value={flowOf(day)}
                      onSelect={(level) => setPerDay((current) => ({ ...current, [day]: level }))}
                    />
                  </li>
                ))}
              </ul>
            </Disclosure>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={working}>
            {t('common.cancel')}
          </Button>
          <Button onClick={() => void submit()} disabled={!valid || working}>
            {editing ? t('common.save') : t('common.create')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
