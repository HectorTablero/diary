import type { PersonDto, PersonListItem } from '@diary/shared';
import { BellRing, ContactRound, Hash, MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePeople, useTags } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { PersonForm } from '@/components/person/PersonForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { isCheckupDue } from '@/lib/checkup';
import { canImportContacts } from '@/lib/contacts';
import { fuzzyIncludes } from '@/lib/tokens';

type SortOption = 'name' | 'talkingPoints' | 'lastContact';

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
  matchedAliases,
  checkupPending = false,
}: {
  person: PersonListItem;
  onEdit: (person: PersonListItem) => void;
  /** Nicknames that matched the current search — shown so a hit on "Mum" explains why
      Carmen is in the results. */
  matchedAliases?: string[];
  checkupPending?: boolean;
}) {
  const { t } = useTranslation();
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
          <p className="truncate font-medium">{person.name}</p>
          {matchedAliases && matchedAliases.length > 0 && (
            <p className="truncate text-xs text-muted-foreground">
              {t('people.alsoKnownAs')}{' '}
              <span className="font-medium text-foreground">{matchedAliases.join(', ')}</span>
            </p>
          )}
          {person.tags.length > 0 && (
            <div className="mt-1 flex flex-wrap gap-1">
              {person.tags.slice(0, 4).map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
              {person.tags.length > 4 && (
                <span className="text-xs text-muted-foreground">+{person.tags.length - 4}</span>
              )}
            </div>
          )}
        </div>
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
        <Button
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          aria-label={t('people.editPerson')}
          onClick={(e) => {
            e.preventDefault();
            onEdit(person);
          }}
        >
          <Pencil className="size-4" />
        </Button>
      </Link>
    </li>
  );
}

export default function PeopleListPage() {
  const { t } = useTranslation();
  const { data: people, isLoading } = usePeople();
  const { data: tags } = useTags();
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

  const filtered = useMemo(() => {
    const matching = (people ?? []).filter(
      (p) =>
        (!query || fuzzyIncludes(p.name, query) || aliasMatches.has(p.id)) &&
        (tagFilter.length === 0 || p.tags.some((tag) => tagFilter.includes(tag.id))),
    );
    return sortPeople(matching, sort);
  }, [people, query, sort, tagFilter, aliasMatches]);

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
                    matchedAliases={aliasMatches.get(person.id)}
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
                    matchedAliases={aliasMatches.get(person.id)}
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
                matchedAliases={aliasMatches.get(person.id)}
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
