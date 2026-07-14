import type { PersonDto, PersonListItem } from '@diary/shared';
import { ongoingEvents, pendingEventFollowUps } from '@diary/shared';
import {
  BellRing,
  Briefcase,
  CalendarClock,
  Check,
  ContactRound,
  Hash,
  MessageCircle,
  MessageCircleQuestion,
  MoreHorizontal,
  Pencil,
  Plus,
  Search,
  Users,
} from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { toast } from 'sonner';
import { useMarkCheckup, usePeople, useTags } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { HintTooltip } from '@/components/common/HintTooltip';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { PersonForm } from '@/components/person/PersonForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isCheckupDue } from '@/lib/checkup';
import { canImportContacts } from '@/lib/contacts';
import { todayKey } from '@/lib/dates';
import { isNative } from '@/lib/native';
import { visibleTags } from '@/lib/tags';
import { fuzzyIncludes } from '@/lib/tokens';
import { cn } from '@/lib/utils';

type SortOption = 'name' | 'talkingPoints' | 'lastContact';

const pendingEventCount = (person: PersonListItem, today: string): number =>
  pendingEventFollowUps(person.events, today).length;

/**
 * Tier people by what their events demand of you: something you owe them an answer about, then
 * something happening to them right now, then everyone else.
 *
 * One pass, so each tier keeps the order `sortPeople` gave it — the chosen sort never changes
 * meaning, it just applies within each tier. And because the checkup grouping downstream is only
 * a filter, this ordering survives into both of its groups too.
 */
function eventsFirst(people: PersonListItem[], today: string): PersonListItem[] {
  const pending: PersonListItem[] = [];
  const ongoing: PersonListItem[] = [];
  const rest: PersonListItem[] = [];

  for (const person of people) {
    if (pendingEventCount(person, today) > 0) pending.push(person);
    else if (ongoingEvents(person.events, today).length > 0) ongoing.push(person);
    else rest.push(person);
  }

  return [...pending, ...ongoing, ...rest];
}

function sortPeople(people: PersonListItem[], sort: SortOption): PersonListItem[] {
  const sorted = [...people];
  switch (sort) {
    case 'talkingPoints':
      return sorted.sort(
        (a, b) => b.talkingPointCount - a.talkingPointCount || a.name.localeCompare(b.name),
      );
    case 'lastContact':
      return sorted.sort(
        (a, b) =>
          Date.parse(a.lastCheckupAt) - Date.parse(b.lastCheckupAt) || a.name.localeCompare(b.name),
      );
    case 'name':
    default:
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
  }
}

function PersonRow({
  person,
  onEdit,
  today,
  tagFilter,
  matchedAliases,
  matchedJob,
  checkupPending = false,
}: {
  person: PersonListItem;
  onEdit: (person: PersonListItem) => void;
  today: string;
  /** Tag ids currently being filtered on; anything else on the row is faded back. */
  tagFilter: string[];
  /** Nicknames that matched the current search — shown so a hit on "Mum" explains why
      Carmen is in the results. */
  matchedAliases?: string[];
  /** "Job title · company" when the search matched there instead of the name/aliases — shown
      because job info isn't otherwise displayed in this list, so the hit would look unexplained. */
  matchedJob?: string;
  checkupPending?: boolean;
}) {
  const { t } = useTranslation();
  const markCheckup = useMarkCheckup();
  const ongoing = ongoingEvents(person.events, today);
  const pending = pendingEventCount(person, today);
  // Under a tag filter the matching tags claim the visible slots, so a person can't be shown
  // without the tag that put them there. See lib/tags.ts.
  const { shown: shownTags, hidden: hiddenTagCount } = visibleTags(person.tags, tagFilter);
  return (
    <li>
      <Link
        to={`/people/${person.id}`}
        className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent/40"
      >
        <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary uppercase">
          {person.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          {/* flex-wrap so the matched nickname sits beside the name when it fits, and only drops
              to its own line — still above the tags — when it doesn't. */}
          <div className="flex flex-wrap items-baseline gap-x-1.5">
            <span className="max-w-full truncate font-medium">{person.name}</span>
            {matchedAliases && matchedAliases.length > 0 && (
              <span className="max-w-full truncate text-xs text-muted-foreground">
                {t('people.alsoKnownAs')}{' '}
                <span className="font-medium text-foreground">{matchedAliases.join(', ')}</span>
              </span>
            )}
            {matchedJob && (
              <span className="flex max-w-full items-center gap-1 truncate text-xs text-muted-foreground">
                <Briefcase className="size-3 shrink-0" />
                <span className="truncate font-medium text-foreground">{matchedJob}</span>
              </span>
            )}
          </div>
          {ongoing.length > 0 && (
            /* A bare "3 ongoing events" says nothing useful. On the web the names are a hover
               away; on the phone there's no hover to be had, so list them inline instead — the
               count alone would be information the user could never reach. */
            <HintTooltip
              content={
                <ul>
                  {ongoing.map((event) => (
                    <li key={event.id}>{event.title}</li>
                  ))}
                </ul>
              }
            >
              <p
                className={cn(
                  'mt-0.5 flex w-fit max-w-full items-center gap-1 text-xs text-muted-foreground',
                  ongoing.length > 1 && !isNative && 'underline decoration-dotted underline-offset-2',
                )}
              >
                <CalendarClock className="size-3 shrink-0" />
                <span className="truncate">
                  {ongoing.length === 1 || isNative
                    ? ongoing.map((event) => event.title).join(' · ')
                    : t('people.eventsOngoing', { count: ongoing.length })}
                </span>
              </p>
            </HintTooltip>
          )}
          {person.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {shownTags.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  // Fade the tags that aren't what you filtered on, so the ones that are jump out.
                  className={
                    tagFilter.length > 0 && !tagFilter.includes(tag.id) ? 'opacity-30' : undefined
                  }
                />
              ))}
              {hiddenTagCount > 0 && (
                <span className="text-xs text-muted-foreground">+{hiddenTagCount}</span>
              )}
            </div>
          )}
        </div>
        {/* Same destructive tint the row already uses for an overdue checkup — an unanswered
            "how did it go?" is the same kind of debt. */}
        {pending > 0 && (
          <Badge variant="outline" className="shrink-0 gap-1 border-destructive/40 text-destructive">
            <MessageCircleQuestion className="size-3" />
            {pending}
          </Badge>
        )}
        {person.checkupIntervalDays != null && (
          <span className={"hidden shrink-0 items-center gap-1 text-xs sm:flex" + (checkupPending ? ' text-destructive' : ' text-muted-foreground')}>
            <BellRing className="size-3" />
            {t('people.checkupEvery')} {person.checkupIntervalDays} {t('settings.memories.days')}
          </span>
        )}
        {person.talkingPointCount > 0 && (
          <Badge variant="secondary" className="gap-1">
            <MessageCircle className="size-3" />
            {person.talkingPointCount}
          </Badge>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="size-8 shrink-0 text-muted-foreground"
              aria-label={t('people.editPerson')}
              onClick={(e) => e.preventDefault()}
            >
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onClick={(e) => {
                e.preventDefault();
                onEdit(person);
              }}
            >
              <Pencil className="size-3.5" /> {t('people.editPerson')}
            </DropdownMenuItem>
            {person.checkupIntervalDays != null && (
              <DropdownMenuItem
                onClick={(e) => {
                  e.preventDefault();
                  markCheckup.mutate(person.id, {
                    onSuccess: () => toast.success(t('people.checkupMarkedDone')),
                    onError: () => toast.error(t('errors.unknown')),
                  });
                }}
              >
                <Check className="size-3.5" /> {t('people.markCheckupNow')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </Link>
    </li>
  );
}

export default function PeopleListPage() {
  const { t } = useTranslation();
  const { data: people, isLoading } = usePeople();
  const { data: tags } = useTags();
  // The event follow-up maths is date-key based, so it needs today's *local* key.
  const today = todayKey();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('name');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonDto | null>(null);

  /* Which nicknames each person matched the query on. Doubles as the search rule itself — a
     person is a hit if their name matches *or* any alias does, so searching "Mum" finds Carmen. */
  const aliasMatches = useMemo(() => {
    const matches = new Map<string, string[]>();
    if (!query.trim()) return matches;
    for (const person of people ?? []) {
      const hits = person.aliases.filter((alias) => fuzzyIncludes(alias, query));
      if (hits.length) matches.set(person.id, hits);
    }
    return matches;
  }, [people, query]);

  /* Same idea for job title/company: a hit here also counts as a search match, and the matched
     "job title · company" string (format mirrors ContactInfo) is shown on the row so it's clear
     why that person surfaced. */
  const jobMatches = useMemo(() => {
    const matches = new Map<string, string>();
    if (!query.trim()) return matches;
    for (const person of people ?? []) {
      const organization = [person.jobTitle, person.company].filter(Boolean).join(' · ');
      if (organization && fuzzyIncludes(organization, query)) matches.set(person.id, organization);
    }
    return matches;
  }, [people, query]);

  const filtered = useMemo(() => {
    const matching = (people ?? []).filter(
      (p) =>
        (!query || fuzzyIncludes(p.name, query) || aliasMatches.has(p.id) || jobMatches.has(p.id)) &&
        (tagFilter.length === 0 || p.tags.some((tag) => tagFilter.includes(tag.id))),
    );
    return eventsFirst(sortPeople(matching, sort), today);
  }, [people, query, sort, tagFilter, aliasMatches, jobMatches, today]);

  // Pending checkups always float to the top, as their own category; the chosen
  // sort still applies within each group since it's just a filter over `filtered`.
  const pendingCheckups = useMemo(() => filtered.filter(isCheckupDue), [filtered]);
  const rest = useMemo(
    () => (pendingCheckups.length > 0 ? filtered.filter((p) => !isCheckupDue(p)) : filtered),
    [filtered, pendingCheckups],
  );

  const toggleTagFilter = (id: string) =>
    setTagFilter((prev) => (prev.includes(id) ? prev.filter((v) => v !== id) : [...prev, id]));

  return (
    <PageContainer>
      <PageHeader
        title={
          <span className="flex items-center gap-2">
            {t('people.title')}
            {people && people.length > 0 && (
              <span className="flex h-6 min-w-6 items-center justify-center rounded-full bg-muted text-[12px] font-medium text-muted-foreground">
                <span className="sr-only">{t('people.count', { count: people.length })}</span>
                <span className="px-2">{people.length}</span>
              </span>
            )}
          </span>
        }
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t('people.addPerson')}
          </Button>
        }
      />

      {people && people.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          <div className="relative">
            <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t('common.search')}
              className="pl-9"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Select value={sort} onValueChange={(v) => setSort(v as SortOption)}>
              <SelectTrigger size="sm" className="w-fit">
                <span className="text-muted-foreground">{t('people.sortBy')}:</span>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="name">{t('people.sortName')}</SelectItem>
                <SelectItem value="talkingPoints">{t('people.sortTalkingPoints')}</SelectItem>
                <SelectItem value="lastContact">{t('people.sortLastContact')}</SelectItem>
              </SelectContent>
            </Select>
            {tags && tags.length > 0 && (
              <EntityPicker
                trigger={
                  <Button variant="outline" size="sm" className="h-7 gap-1">
                    <Hash className="size-3.5" />
                    {t('people.filterByTag')}
                    {tagFilter.length > 0 && <span className="text-primary">({tagFilter.length})</span>}
                  </Button>
                }
                items={tags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
                selectedIds={tagFilter}
                onToggle={toggleTagFilter}
                placeholder={t('tags.namePlaceholder')}
              />
            )}
          </div>
          {tagFilter.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {tagFilter.map((id) => {
                const tag = tags?.find((tg) => tg.id === id);
                return tag ? (
                  <TagChip key={id} tag={tag} onRemove={() => toggleTagFilter(id)} />
                ) : null;
              })}
            </div>
          )}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
          <Skeleton className="h-16" />
        </div>
      ) : filtered.length > 0 ? (
        pendingCheckups.length > 0 ? (
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-1.5 px-1 text-xs font-medium text-muted-foreground">
                <BellRing className="size-3.5 text-destructive" />
                {t('people.checkupsPending', { count: pendingCheckups.length })}
              </div>
              <ul className="flex flex-col gap-2">
                {pendingCheckups.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    onEdit={setEditing}
                    today={today}
                    tagFilter={tagFilter}
                    matchedAliases={aliasMatches.get(person.id)}
                    matchedJob={jobMatches.get(person.id)}
                    checkupPending
                  />
                ))}
              </ul>
            </div>
            {rest.length > 0 && (
              <ul className="flex flex-col gap-2 border-t pt-4">
                {rest.map((person) => (
                  <PersonRow
                    key={person.id}
                    person={person}
                    onEdit={setEditing}
                    today={today}
                    tagFilter={tagFilter}
                    matchedAliases={aliasMatches.get(person.id)}
                    matchedJob={jobMatches.get(person.id)}
                  />
                ))}
              </ul>
            )}
          </div>
        ) : (
          <ul className="flex flex-col gap-2">
            {filtered.map((person) => (
              <PersonRow
                key={person.id}
                person={person}
                onEdit={setEditing}
                today={today}
                tagFilter={tagFilter}
                matchedAliases={aliasMatches.get(person.id)}
                matchedJob={jobMatches.get(person.id)}
              />
            ))}
          </ul>
        )
      ) : people && people.length > 0 ? (
        <EmptyState icon={Search} title={t('common.noResults')} />
      ) : (
        <EmptyState
          icon={Users}
          title={t('people.noPeople')}
          description={t('people.noPeopleDescription')}
        >
          <div className="mt-2 flex flex-wrap justify-center gap-2">
            <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
              <Plus className="size-4" />
              {t('people.addPerson')}
            </Button>
            {canImportContacts() && (
              <Button asChild size="sm" variant="outline" className="gap-1.5">
                <Link to="/people/import">
                  <ContactRound className="size-4" />
                  {t('import.title')}
                </Link>
              </Button>
            )}
          </div>
        </EmptyState>
      )}

      {/* Contacts are only readable inside the Android app, so this stays hidden on the web. */}
      {canImportContacts() && filtered.length > 0 && (
        <div className="mt-6 flex justify-center border-t pt-6">
          <Button asChild variant="outline" size="sm" className="gap-1.5">
            <Link to="/people/import">
              <ContactRound className="size-4" />
              {t('import.title')}
            </Link>
          </Button>
        </div>
      )}

      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('people.addPerson')}</DialogTitle>
          </DialogHeader>
          {adding && <PersonForm onDone={() => setAdding(false)} />}
        </DialogContent>
      </Dialog>

      <Dialog open={editing !== null} onOpenChange={(open) => !open && setEditing(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('people.editPerson')}</DialogTitle>
          </DialogHeader>
          {editing && <PersonForm person={editing} onDone={() => setEditing(null)} />}
        </DialogContent>
      </Dialog>
    </PageContainer>
  );
}
