import type { PersonDto, PersonEventDto, TagDto } from '@diary/shared';
import {
  eventEndKey,
  eventLengthDays,
  groupTalkingPointsByThread,
  isEventFollowUpDue,
  isEventOngoing,
  isEventUpcoming,
  pendingEventFollowUps,
} from '@diary/shared';
import { differenceInCalendarDays } from 'date-fns';
import {
  AtSign,
  BellOff,
  BellRing,
  CalendarClock,
  Check,
  ChevronDown,
  MessageCircle,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  TriangleAlert,
  Undo2,
  UserX,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, useNavigate, useParams } from 'react-router';
import {
  useDeleteEvent,
  useDeletePerson,
  useMarkCheckup,
  useMarkEventAsked,
  useMemories,
  usePeople,
  usePerson,
  usePersonHistory,
  useSetSaid,
  useSettings,
  useTalkingPoints,
  useUpdatePerson,
} from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { TagChip } from '@/components/entry/chips';
import { PageContainer } from '@/components/layout/PageHeader';
import { ContactInfo } from '@/components/person/ContactInfo';
import { EntryRow } from '@/components/person/EntryRow';
import { EventForm } from '@/components/person/EventForm';
import { PersonForm } from '@/components/person/PersonForm';
import { TalkingPointGroup } from '@/components/person/TalkingPointGroup';
import { TalkingPointItem } from '@/components/person/TalkingPointItem';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { notifyError, notifySuccess } from '@/lib/notify';
import { notifyDeleted } from '@/lib/undo';
import { ApiError } from '@/lib/apiClient';
import { isCheckupDue } from '@/lib/checkup';
import { formatDateKey, parseDateKey, todayKey } from '@/lib/dates';
import { useEntityLinks } from '@/lib/entityLinks';
import {
  SIDEBAR_SPLIT_MIN_WIDTH,
  SIDEBAR_SPLIT_WIDE_GAP_MIN_WIDTH,
  useContainerWidth,
} from '@/lib/useContainerWidth';
import { cn } from '@/lib/utils';

/** Shared by all four profile tabs — see the note at the TabsList below for why it un-sets
    `whitespace-nowrap` and lets the trigger grow, but only up to the `sm` breakpoint. */
const TAB_TRIGGER =
  'h-full min-h-8 py-1 text-center leading-tight whitespace-normal ' +
  'sm:h-[calc(100%-1px)] sm:min-h-0 sm:py-0.5 sm:whitespace-nowrap';

/**
 * Icon and label as one *inline* run rather than two flex children.
 *
 * As flex siblings they can't be centred together once the label wraps: the label becomes a flex
 * item shrunk to all the width the icon left over, so `justify-center` centres a box whose left
 * edge is already against the icon, and there is no way to ask a block to shrink to the width of
 * its own longest line (`fit-content` resolves to the available width once wrapping is involved).
 *
 * Handing the trigger a single child sidesteps it entirely. The icon rides inline at the head of
 * the text, so it wraps with the text and `text-center` centres every line — including the one
 * carrying the icon. `mr-1.5` reproduces the `gap-1.5` it no longer gets from the flex container.
 */
function TabLabel({ icon: Icon, children }: { icon: LucideIcon; children: ReactNode }) {
  return (
    <span>
      <Icon className="mr-1.5 inline size-4 align-[-0.2em]" />
      {children}
    </span>
  );
}

/**
 * Avatar, name and tags — everything the profile can show about a person before its own query has
 * resolved, and the only part of the header the People list cache can supply.
 *
 * Shared by the loaded header and the pending one so the two are the same object rather than two
 * that happen to match: when the full person lands, the name doesn't move.
 */
function PersonIdentity({
  name,
  tags,
  children,
  actions,
}: {
  name: string;
  tags: TagDto[];
  children?: ReactNode;
  actions?: ReactNode;
}) {
  const { tagTo } = useEntityLinks();
  return (
    <div className="mb-6 flex items-start gap-4">
      <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary uppercase">
        {name.slice(0, 2)}
      </div>
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-xl font-semibold tracking-tight">{name}</h1>
        {tags.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {tags.map((tag) => (
              <TagChip key={tag.id} tag={tag} to={tagTo(tag.id)} />
            ))}
          </div>
        )}
        {children}
      </div>
      {actions}
    </div>
  );
}

/**
 * The profile before its query has answered, or after the query has failed.
 *
 * Every other screen in the app loads with skeletons that keep the page chrome in place. This one
 * blanked the whole viewport and then, on *any* error, redirected to the list without a word — so
 * a transient read failure and "this person was deleted" were the same experience: you tapped a
 * name and ended up back where you started, with nothing to retry and nothing to read.
 *
 * The name and tags come from the People list cache, which almost always holds them already (you
 * arrived by tapping a row that rendered them), so in practice the header is real from the first
 * frame and only the tabs are skeletons.
 */
function ProfileFallback({
  cached,
  state,
  onRetry,
}: {
  cached: PersonDto | undefined;
  state: 'loading' | 'error' | 'not-found';
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <PageContainer>
      {cached ? (
        <PersonIdentity name={cached.name} tags={cached.tags} />
      ) : (
        <div className="mb-6 flex items-start gap-4">
          <Skeleton className="size-14 shrink-0 rounded-full" />
          <div className="flex min-w-0 flex-1 flex-col gap-2">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-4 w-24" />
          </div>
        </div>
      )}

      {state === 'loading' ? (
        <div className="flex flex-col gap-4">
          <Skeleton className="h-8 w-full sm:w-80" />
          <Skeleton className="h-14" />
          <Skeleton className="h-14" />
        </div>
      ) : (
        /* Reported here rather than by navigating away. "Deleted" and "couldn't read it" are
           genuinely different facts and only one of them is worth leaving the page over — so
           neither does, and the one that can be retried says so. */
        <EmptyState
          icon={state === 'not-found' ? UserX : TriangleAlert}
          title={state === 'not-found' ? t('person.not_found') : t('errors.unknown')}
          description={state === 'not-found' ? undefined : t('people.loadFailedDescription')}
        >
          {state === 'error' ? (
            <Button variant="outline" size="sm" onClick={onRetry}>
              {t('common.retry')}
            </Button>
          ) : (
            <Button variant="outline" size="sm" asChild>
              <Link to="/people">{t('nav.people')}</Link>
            </Button>
          )}
        </EmptyState>
      )}
    </PageContainer>
  );
}

function TalkingPointsTab({ personId, personName }: { personId: string; personName: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useTalkingPoints(personId);
  const setSaid = useSetSaid();
  const [alreadyToldOpen, setAlreadyToldOpen] = useState(false);

  // Threads come off the entries themselves, so grouping needs no extra query. With no threads
  // defined this returns one singleton group per cluster, in the order the forest already had.
  const groups = useMemo(() => (data ? groupTalkingPointsByThread(data.active) : []), [data]);

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {groups.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {groups.map((group) =>
            group.thread ? (
              <TalkingPointGroup
                key={group.thread.id}
                thread={group.thread}
                clusters={group.clusters}
                markableIds={group.markableIds}
                personId={personId}
                personName={personName}
              />
            ) : (
              <TalkingPointItem
                key={group.clusters[0].id}
                node={group.clusters[0]}
                personId={personId}
                personName={personName}
              />
            ),
          )}
        </ul>
      ) : (
        <EmptyState
          icon={MessageCircle}
          title={t('people.noTalkingPoints')}
          description={t('people.noTalkingPointsDescription', { name: personName })}
        />
      )}

      {data && data.said.length > 0 && (
        <Collapsible open={alreadyToldOpen} onOpenChange={setAlreadyToldOpen}>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ChevronDown
                className={cn('size-4 transition-transform', alreadyToldOpen && 'rotate-180')}
              />
              {t('people.alreadyTold')} ({data.said.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-2">
              {data.said.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-dashed p-3">
                  <EntryRow entry={entry} crossedOut showChips={false}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                      onClick={() => setSaid.mutate({ entryId: entry.id, personId, said: false })}
                    >
                      <Undo2 className="size-3.5" />
                      {t('people.unmarkSaid')}
                    </Button>
                  </EntryRow>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function MemoriesTab({ personId, personName }: { personId: string; personName: string }) {
  const { t } = useTranslation();
  const { data: memories, isLoading } = useMemories(personId);
  const { data: settings } = useSettings();

  if (isLoading) return <Skeleton className="h-24" />;

  if (!memories || memories.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t('people.noMemories')}
        description={t('people.noMemoriesDescription', {
          name: personName,
          months: Math.round((settings?.memoryMinAgeDays ?? 180) / 30),
        })}
      />
    );
  }

  const byYear = new Map<string, typeof memories>();
  for (const entry of memories) {
    const year = entry.dateKey.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), entry]);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...byYear.entries()].map(([year, entries]) => (
        <div key={year}>
          {/* h2, not h3: the person's name is the page's h1 and there is nothing between them, so
              an h3 here would leave heading navigation reporting a gap. */}
          <h2 className="mb-2 text-sm font-semibold text-muted-foreground">{year}</h2>
          <ul className="flex flex-col gap-3 border-l-2 border-border/70 pl-4">
            {entries.map((entry) => (
              <li key={entry.id}>
                <EntryRow entry={entry} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ personId, personName }: { personId: string; personName: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePersonHistory(personId, page);

  if (isLoading) return <Skeleton className="h-24" />;
  if (!data || data.results.length === 0) {
    return <EmptyState icon={AtSign} title={t('people.noHistory', { name: personName })} />;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {data.results.map((entry) => (
          <li key={entry.id}>
            <EntryRow entry={entry} />
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => setPage(page - 1)}
          >
            ‹
          </Button>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}

/** Human-readable span: one line covering both the dates and how long it ran. */
function useEventDates(event: PersonEventDto) {
  const { t, i18n } = useTranslation();
  const day = (key: string) => formatDateKey(key, i18n.language, 'd MMM yyyy');
  const range = event.endDate
    ? `${day(event.startDate)} – ${day(event.endDate)}`
    : day(event.startDate);
  const length = eventLengthDays(event);
  return length > 1 ? `${range} · ${t('people.eventDays', { count: length })}` : range;
}

/**
 * One event card.
 *
 * Edit/delete live in an overflow menu — the same idiom the profile header uses — which leaves the
 * one action that actually matters ("mark as asked") as the only button on the card. No "ongoing"
 * chip: the section heading already says so.
 */
function EventRow({
  person,
  event,
  today,
  onEdit,
}: {
  person: PersonDto;
  event: PersonEventDto;
  today: string;
  onEdit: (event: PersonEventDto) => void;
}) {
  const { t } = useTranslation();
  const deleteEvent = useDeleteEvent();
  const markAsked = useMarkEventAsked();
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  const followUpDue = isEventFollowUpDue(event, today);
  const dates = useEventDates(event);
  const daysSinceEnd = differenceInCalendarDays(
    parseDateKey(today),
    parseDateKey(eventEndKey(event)),
  );

  return (
    <li className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {/* flex-wrap, not a fixed two-row stack: the dates sit beside the title when they fit
              and drop to their own line only when the title needs the room. */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="max-w-full truncate text-sm font-medium">{event.title}</span>
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
              {dates}
            </span>
            {event.askedAt && (
              <Check className="size-3.5 shrink-0 text-emerald-600 dark:text-emerald-400" />
            )}
          </div>
          {event.notes && (
            <p className="mt-1.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
              {event.notes}
            </p>
          )}
        </div>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              aria-label={t('people.editEvent')}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => onEdit(event)}>
              <Pencil className="size-3.5" /> {t('common.edit')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="size-3.5" /> {t('common.delete')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {/* Footer only appears when you owe them something, and says *why* it's here. */}
      {followUpDue && (
        <div className="flex flex-col items-stretch gap-2 border-t border-amber-500/30 bg-amber-500/[0.07] px-3 py-2 sm:flex-row sm:items-center sm:justify-between">
          <span className="min-w-0 text-xs text-muted-foreground">
            {t('people.eventEndedDaysAgo', { count: daysSinceEnd })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full shrink-0 gap-1.5 text-xs sm:w-auto"
            onClick={() =>
              markAsked.mutate(
                { personId: person.id, eventId: event.id },
                {
                  onSuccess: () => notifySuccess(t('people.eventMarkedAsked')),
                  onError: () => notifyError(t('errors.unknown')),
                },
              )
            }
          >
            <Check className="size-3.5" />
            {t('people.markEventAsked')}
          </Button>
        </div>
      )}

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('people.eventDeleteConfirmTitle', { title: event.title })}
        description={t('people.eventDeleteConfirmDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          setConfirmingDelete(false);
          deleteEvent.mutate(
            { personId: person.id, eventId: event.id },
            {
              onSuccess: (deletion) => notifyDeleted(t('people.eventDeleted'), deletion),
              onError: () => notifyError(t('errors.unknown')),
            },
          );
        }}
      />
    </li>
  );
}

function EventsTab({ person, today }: { person: PersonDto; today: string }) {
  const { t } = useTranslation();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonEventDto | null>(null);

  // Ongoing first (they're what's happening now), then what's coming, then the past newest-first.
  const groups = useMemo(() => {
    const ongoing: PersonEventDto[] = [];
    const upcoming: PersonEventDto[] = [];
    const past: PersonEventDto[] = [];
    for (const event of person.events) {
      if (isEventOngoing(event, today)) ongoing.push(event);
      else if (isEventUpcoming(event, today)) upcoming.push(event);
      else past.push(event);
    }
    ongoing.sort((a, b) => a.startDate.localeCompare(b.startDate));
    upcoming.sort((a, b) => a.startDate.localeCompare(b.startDate));
    past.sort((a, b) => eventEndKey(b).localeCompare(eventEndKey(a)));
    return { ongoing, upcoming, past };
  }, [person.events, today]);

  // Past first: those are the ones you might still owe a "how did it go?".
  const sections: [string, PersonEventDto[]][] = [
    ['people.eventsPast', groups.past],
    ['people.eventsOngoingHeading', groups.ongoing],
    ['people.eventsUpcoming', groups.upcoming],
  ];

  return (
    <div className="flex flex-col gap-4">
      <Button size="sm" className="w-fit gap-1.5" onClick={() => setAdding(true)}>
        <Plus className="size-4" />
        {t('people.addEvent')}
      </Button>

      {person.events.length === 0 ? (
        <EmptyState
          icon={CalendarClock}
          title={t('people.noEvents')}
          description={t('people.noEventsDescription', { name: person.name })}
        />
      ) : (
        sections
          .filter(([, events]) => events.length > 0)
          .map(([heading, events]) => (
            <div key={heading} className="flex flex-col gap-2">
              <h2 className="px-1 text-xs font-medium text-muted-foreground">{t(heading)}</h2>
              <ul className="flex flex-col gap-2">
                {events.map((event) => (
                  <EventRow
                    key={event.id}
                    person={person}
                    event={event}
                    today={today}
                    onEdit={setEditing}
                  />
                ))}
              </ul>
            </div>
          ))
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('people.addEvent')}</DialogTitle>
          </DialogHeader>
          {adding && <EventForm personId={person.id} onDone={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('people.editEvent')}</DialogTitle>
          </DialogHeader>
          {editing && (
            <EventForm personId={person.id} event={editing} onDone={() => setEditing(null)} />
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default function PersonProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: person, isLoading, isError, error, refetch } = usePerson(id ?? '');
  const { data: people } = usePeople();
  const deletePerson = useDeletePerson();
  const markCheckup = useMarkCheckup();
  const markEventAsked = useMarkEventAsked();
  const updatePerson = useUpdatePerson();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [splitRef, splitWidth] = useContainerWidth<HTMLDivElement>();
  const useTwoColumns = splitWidth >= SIDEBAR_SPLIT_MIN_WIDTH;

  /* The Events tab disappears in two-column mode — its content moves to the sidebar instead — so a
     resize that crosses the threshold while it's the active tab would otherwise leave the page on a
     trigger and a content pane that no longer exist. Falls back to the first tab rather than, say,
     Memories: talking points are what most people open this page to check. */
  const [activeTab, setActiveTab] = useState('talking-points');
  useEffect(() => {
    if (useTwoColumns && activeTab === 'events') setActiveTab('talking-points');
  }, [useTwoColumns, activeTab]);

  /* The list this profile was almost certainly opened from. It already holds the name and the
     tags, so the header can be real from the first frame instead of a blank viewport. */
  const cached = useMemo(() => people?.find((p) => p.id === id), [people, id]);

  if (!id) return <Navigate to="/people" replace />;
  if (!person) {
    /* A 404 out of repo.getPerson means the row genuinely isn't in the local store — deleted, or
       never synced to this device. Anything else is a read that failed, which is a different fact
       and gets a different screen. Both used to be a silent redirect to /people. */
    const notFound = isError && error instanceof ApiError && error.status === 404;
    return (
      <ProfileFallback
        cached={cached}
        state={isLoading ? 'loading' : notFound ? 'not-found' : 'error'}
        onRetry={() => void refetch()}
      />
    );
  }

  const checkupDue = isCheckupDue(person);
  const today = todayKey();
  const pendingFollowUps = pendingEventFollowUps(person.events, today);

  /* Built once and placed twice below (never both): in the left column above the tabs when there's
     only one column, or above Events in the sidebar when there are two — checking up on someone is
     as much "context for reaching out" as an overdue event is, so it belongs beside Events rather
     than buried above tab content the sidebar has already made unnecessary to scroll past. */
  const checkupBanner = checkupDue && (
    <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-start gap-2.5">
        <BellRing className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        <div>
          <p className="text-sm font-medium">
            {t('people.checkupDueTitle', { name: person.name })}
          </p>
          <p className="text-xs text-muted-foreground">{t('people.checkupDueDescription')}</p>
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            markCheckup.mutate(person.id, {
              onSuccess: () => notifySuccess(t('people.checkupMarkedDone')),
              onError: () => notifyError(t('errors.unknown')),
            })
          }
        >
          <Check className="size-3.5" />
          {t('people.markCheckupDone')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() =>
            updatePerson.mutate(
              { id: person.id, input: { checkupIntervalDays: null } },
              {
                onSuccess: () => notifySuccess(t('people.checkupsDisabled')),
                onError: () => notifyError(t('errors.unknown')),
              },
            )
          }
        >
          <BellOff className="size-3.5" />
          {t('people.disableCheckups')}
        </Button>
      </div>
    </div>
  );

  return (
    // Unlike the list pages, this one is allowed to grow: the payoff of two columns here is real
    // (events always visible instead of a tab away) rather than a cramped attempt to fit two card
    // columns into a reading-width page, so the container widens the same way the day page's does.
    <PageContainer className="lg:max-w-5xl xl:max-w-6xl 2xl:max-w-7xl">
      {/* The split starts here, at the very top, rather than below the header: the events sidebar
          is meant to sit level with the identity block, not dangle down to align with wherever the
          tabs happen to start. The ⋯ menu is what actually forces the header inside the left
          column too — outside the split it would sit at the top-right of the whole widened page,
          not the left column it visually belongs to. */}
      <div
        ref={splitRef}
        className={cn(
          useTwoColumns && 'grid grid-cols-12 items-start',
          useTwoColumns && (splitWidth >= SIDEBAR_SPLIT_WIDE_GAP_MIN_WIDTH ? 'gap-8' : 'gap-6'),
        )}
      >
        <div className={cn(useTwoColumns && 'col-span-7')}>
          <PersonIdentity
            name={person.name}
            tags={person.tags}
            actions={
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground"
                    aria-label={t('people.personActions', { name: person.name })}
                  >
                    <MoreHorizontal className="size-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onClick={() => setEditing(true)}>
                    <Pencil className="size-3.5" /> {t('people.editPerson')}
                  </DropdownMenuItem>
                  {person.checkupIntervalDays != null && (
                    <DropdownMenuItem
                      onClick={() =>
                        markCheckup.mutate(person.id, {
                          onSuccess: () => notifySuccess(t('people.checkupMarkedDone')),
                          onError: () => notifyError(t('errors.unknown')),
                        })
                      }
                    >
                      <Check className="size-3.5" /> {t('people.markCheckupNow')}
                    </DropdownMenuItem>
                  )}
                  <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
                    <Trash2 className="size-3.5" /> {t('people.deletePerson')}
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            }
          >
            {person.notes && (
              <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">
                {person.notes}
              </p>
            )}
            <ContactInfo person={person} onEdit={() => setEditing(true)} />
          </PersonIdentity>

          {!useTwoColumns && checkupBanner}

          {/* Same idiom as the checkup banner above — an unanswered "how did it go?" is the same
          kind of debt, so it should look like one.

          Suppressed in two-column mode: it exists to surface something a tab was hiding, and once
          the events section sits in the sidebar at all times, nothing is hidden — the same overdue
          events are right there, each already carrying this exact nudge on its own `EventRow`
          footer (the `followUpDue` block, above). Keeping both would just say it twice. */}
          {!useTwoColumns && pendingFollowUps.length > 0 && (
            <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4">
              <div className="flex items-start gap-2.5">
                <MessageCircleQuestion className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
                <div>
                  <p className="text-sm font-medium">
                    {t('people.eventFollowUpTitle', { count: pendingFollowUps.length })}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t('people.eventFollowUpDescription', { name: person.name })}
                  </p>
                </div>
              </div>
              <ul className="flex flex-col gap-2">
                {pendingFollowUps.map((event) => (
                  <li
                    key={event.id}
                    className="flex flex-col items-stretch gap-2 rounded-lg border border-amber-500/25 bg-background/40 p-2.5 sm:flex-row sm:items-start sm:justify-between"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{event.title}</p>
                      {/* The notes are the whole point of the reminder — they're what you'd actually
                      ask about, so they belong right here rather than a tab away. */}
                      {event.notes && (
                        <p className="mt-0.5 text-xs leading-relaxed whitespace-pre-wrap text-muted-foreground">
                          {event.notes}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="w-full shrink-0 gap-1.5 sm:w-auto"
                      onClick={() =>
                        markEventAsked.mutate(
                          { personId: person.id, eventId: event.id },
                          {
                            onSuccess: () => notifySuccess(t('people.eventMarkedAsked')),
                            onError: () => notifyError(t('errors.unknown')),
                          },
                        )
                      }
                    >
                      <Check className="size-3.5" />
                      {t('people.markEventAsked')}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <Tabs value={activeTab} onValueChange={setActiveTab}>
            {/* Four tabs no longer fit one phone-width row, so they wrap into an even 2x2 grid and
                only straighten out into a single row from `sm` up. The height override has to reuse
                the same group-data variant TabsList sets it with, or it loses on specificity.

                TAB_TRIGGER also drops TabsTrigger's own `whitespace-nowrap` below `sm`: a label that
                can't shrink and can't wrap simply overflows its grid cell, which is what Spanish's
                "Temas de conversación" did — pushing the icon off the left edge and the text off the
                right. Letting it take a second line costs height only in the languages that need it,
                and the grid keeps both cells in a row the same height by itself.

                In two-column mode Events drops out of both the grid and the count that sizes it —
                three tabs fit their own row without the 2x2 wrap ever coming into play, since
                `useTwoColumns` can't be true below the `sm` viewport width the wrap exists for (a
                container can't measure wider than the viewport holding it). */}
            <TabsList
              className={cn(
                'mb-4 grid w-full gap-1 group-data-horizontal/tabs:h-auto sm:inline-flex sm:w-auto sm:gap-0 sm:group-data-horizontal/tabs:h-8',
                useTwoColumns ? 'grid-cols-3' : 'grid-cols-2',
              )}
            >
              <TabsTrigger value="talking-points" className={TAB_TRIGGER}>
                <TabLabel icon={MessageCircle}>{t('people.talkingPoints')}</TabLabel>
              </TabsTrigger>
              {!useTwoColumns && (
                <TabsTrigger value="events" className={TAB_TRIGGER}>
                  <TabLabel icon={CalendarClock}>{t('people.events')}</TabLabel>
                </TabsTrigger>
              )}
              <TabsTrigger value="memories" className={TAB_TRIGGER}>
                <TabLabel icon={Sparkles}>{t('people.memories')}</TabLabel>
              </TabsTrigger>
              <TabsTrigger value="history" className={TAB_TRIGGER}>
                <TabLabel icon={AtSign}>{t('people.history')}</TabLabel>
              </TabsTrigger>
            </TabsList>
            <TabsContent value="talking-points">
              <TalkingPointsTab personId={person.id} personName={person.name} />
            </TabsContent>
            {!useTwoColumns && (
              <TabsContent value="events">
                <EventsTab person={person} today={today} />
              </TabsContent>
            )}
            <TabsContent value="memories">
              <MemoriesTab personId={person.id} personName={person.name} />
            </TabsContent>
            <TabsContent value="history">
              <HistoryTab personId={person.id} personName={person.name} />
            </TabsContent>
          </Tabs>
        </div>

        {/* The tab's replacement: always on screen rather than a click away, which is also why the
            amber follow-up banner above stands down in this mode — an overdue event is right here,
            not hidden behind anything. `sticky` so it stays put while the (often longer) tab content
            beside it scrolls. */}
        {useTwoColumns && (
          <aside className="col-span-5 sticky top-6">
            {checkupBanner}
            <h2 className="mb-3 flex items-center gap-2 text-sm font-medium">
              <CalendarClock className="size-4 text-muted-foreground" aria-hidden />
              {t('people.events')}
            </h2>
            <EventsTab person={person} today={today} />
          </aside>
        )}
      </div>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('people.editPerson')}</DialogTitle>
          </DialogHeader>
          {editing && <PersonForm person={person} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('people.deleteConfirmTitle', { name: person.name })}
        description={t('people.deleteConfirmDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          setConfirmingDelete(false);
          deletePerson.mutate(person.id, {
            onSuccess: (deletion) => {
              // Navigating away doesn't take the toast with it, so the undo stays reachable from
              // the list the user lands on.
              //
              // Undo deliberately does NOT navigate back to the profile. It used to, and it
              // flickered: the delete left an error cached under this person's query key, and the
              // restore's invalidation is asynchronous, so the profile remounted while the key
              // still held that error, hit the isError guard above and redirected straight back to
              // /people. The person reappearing in the list underneath the toast is confirmation
              // enough, and staying put is what the user asked the Undo button for anyway.
              notifyDeleted(t('people.personDeleted'), deletion);
              void navigate('/people');
            },
            onError: () => notifyError(t('errors.unknown')),
          });
        }}
      />
    </PageContainer>
  );
}
