import type { PersonDto, PersonEventDto } from '@diary/shared';
import {
  eventEndKey,
  eventLengthDays,
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
  Undo2,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  useDeleteEvent,
  useDeletePerson,
  useMarkCheckup,
  useMarkEventAsked,
  useMemories,
  usePerson,
  usePersonHistory,
  useSetSaid,
  useSettings,
  useTalkingPoints,
  useUpdatePerson,
} from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { FullScreenSpinner } from '@/components/common/Spinner';
import { TagChip } from '@/components/entry/chips';
import { PageContainer } from '@/components/layout/PageHeader';
import { ContactInfo } from '@/components/person/ContactInfo';
import { EntryRow } from '@/components/person/EntryRow';
import { EventForm } from '@/components/person/EventForm';
import { PersonForm } from '@/components/person/PersonForm';
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
import { isCheckupDue } from '@/lib/checkup';
import { formatDateKey, parseDateKey, todayKey } from '@/lib/dates';

function TalkingPointsTab({ personId, personName }: { personId: string; personName: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useTalkingPoints(personId);
  const setSaid = useSetSaid();

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
      {data && data.active.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.active.map((node) => (
            <TalkingPointItem key={node.id} node={node} personId={personId} personName={personName} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={MessageCircle}
          title={t('people.noTalkingPoints')}
          description={t('people.noTalkingPointsDescription', { name: personName })}
        />
      )}

      {data && data.said.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ChevronDown className="size-4" />
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
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{year}</h3>
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
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
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
  const range = event.endDate ? `${day(event.startDate)} – ${day(event.endDate)}` : day(event.startDate);
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
  const daysSinceEnd = differenceInCalendarDays(parseDateKey(today), parseDateKey(eventEndKey(event)));

  return (
    <li className="rounded-xl border bg-card shadow-xs">
      <div className="flex items-start gap-2 p-3">
        <div className="min-w-0 flex-1">
          {/* flex-wrap, not a fixed two-row stack: the dates sit beside the title when they fit
              and drop to their own line only when the title needs the room. */}
          <div className="flex flex-wrap items-baseline gap-x-2">
            <span className="max-w-full truncate text-sm font-medium">{event.title}</span>
            <span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">{dates}</span>
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
        <div className="flex items-center justify-between gap-2 border-t border-amber-500/30 bg-amber-500/[0.07] px-3 py-2">
          <span className="min-w-0 truncate text-xs text-muted-foreground">
            {t('people.eventEndedDaysAgo', { count: daysSinceEnd })}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 shrink-0 gap-1.5 text-xs"
            onClick={() =>
              markAsked.mutate(
                { personId: person.id, eventId: event.id },
                {
                  onSuccess: () => toast.success(t('people.eventMarkedAsked')),
                  onError: () => toast.error(t('errors.unknown')),
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
              onSuccess: () => toast.success(t('people.eventDeleted')),
              onError: () => toast.error(t('errors.unknown')),
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
              <h3 className="px-1 text-xs font-medium text-muted-foreground">{t(heading)}</h3>
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
  const { data: person, isLoading, isError } = usePerson(id ?? '');
  const deletePerson = useDeletePerson();
  const markCheckup = useMarkCheckup();
  const markEventAsked = useMarkEventAsked();
  const updatePerson = useUpdatePerson();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!id) return <Navigate to="/people" replace />;
  if (isLoading) return <FullScreenSpinner />;
  if (isError || !person) return <Navigate to="/people" replace />;

  const checkupDue = isCheckupDue(person);
  const today = todayKey();
  const pendingFollowUps = pendingEventFollowUps(person.events, today);

  return (
    <PageContainer>
      <div className="mb-6 flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary uppercase">
          {person.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{person.name}</h1>
          {person.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {person.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          )}
          {person.notes && (
            <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{person.notes}</p>
          )}
          <ContactInfo person={person} onEdit={() => setEditing(true)} />
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
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
                    onSuccess: () => toast.success(t('people.checkupMarkedDone')),
                    onError: () => toast.error(t('errors.unknown')),
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
      </div>

      {checkupDue && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <BellRing className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium">{t('people.checkupDueTitle', { name: person.name })}</p>
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
                  onSuccess: () => toast.success(t('people.checkupMarkedDone')),
                  onError: () => toast.error(t('errors.unknown')),
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
                    onSuccess: () => toast.success(t('people.checkupsDisabled')),
                    onError: () => toast.error(t('errors.unknown')),
                  },
                )
              }
            >
              <BellOff className="size-3.5" />
              {t('people.disableCheckups')}
            </Button>
          </div>
        </div>
      )}

      {/* Same idiom as the checkup banner above — an unanswered "how did it go?" is the same
          kind of debt, so it should look like one. */}
      {pendingFollowUps.length > 0 && (
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
                className="flex items-start justify-between gap-2 rounded-lg border border-amber-500/25 bg-background/40 p-2.5"
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
                  className="shrink-0 gap-1.5"
                  onClick={() =>
                    markEventAsked.mutate(
                      { personId: person.id, eventId: event.id },
                      {
                        onSuccess: () => toast.success(t('people.eventMarkedAsked')),
                        onError: () => toast.error(t('errors.unknown')),
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

      <Tabs defaultValue="talking-points">
        {/* Four tabs no longer fit one phone-width row, so they wrap into an even 2x2 grid and
            only straighten out into a single row from `sm` up. The height override has to reuse
            the same group-data variant TabsList sets it with, or it loses on specificity. */}
        <TabsList className="mb-4 grid w-full grid-cols-2 gap-1 group-data-horizontal/tabs:h-auto sm:inline-flex sm:w-auto sm:gap-0 sm:group-data-horizontal/tabs:h-8">
          <TabsTrigger value="talking-points" className="h-8 gap-1.5 sm:h-[calc(100%-1px)]">
            <MessageCircle className="size-4" />
            {t('people.talkingPoints')}
          </TabsTrigger>
          <TabsTrigger value="events" className="h-8 gap-1.5 sm:h-[calc(100%-1px)]">
            <CalendarClock className="size-4" />
            {t('people.events')}
          </TabsTrigger>
          <TabsTrigger value="memories" className="h-8 gap-1.5 sm:h-[calc(100%-1px)]">
            <Sparkles className="size-4" />
            {t('people.memories')}
          </TabsTrigger>
          <TabsTrigger value="history" className="h-8 gap-1.5 sm:h-[calc(100%-1px)]">
            <AtSign className="size-4" />
            {t('people.history')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="talking-points">
          <TalkingPointsTab personId={person.id} personName={person.name} />
        </TabsContent>
        <TabsContent value="events">
          <EventsTab person={person} today={today} />
        </TabsContent>
        <TabsContent value="memories">
          <MemoriesTab personId={person.id} personName={person.name} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab personId={person.id} personName={person.name} />
        </TabsContent>
      </Tabs>

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
            onSuccess: () => {
              toast.success(t('people.personDeleted'));
              navigate('/people');
            },
            onError: () => toast.error(t('errors.unknown')),
          });
        }}
      />
    </PageContainer>
  );
}
