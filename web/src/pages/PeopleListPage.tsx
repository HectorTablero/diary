import type { PersonDto, PersonListItem } from '@diary/shared';
import { BellRing, Hash, MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
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

export default function PeopleListPage() {
  const { t } = useTranslation();
  const { data: people, isLoading } = usePeople();
  const { data: tags } = useTags();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortOption>('name');
  const [tagFilter, setTagFilter] = useState<string[]>([]);
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonDto | null>(null);

  const filtered = useMemo(() => {
    const matching = (people ?? []).filter(
      (p) =>
        (!query || fuzzyIncludes(p.name, query)) &&
        (tagFilter.length === 0 || p.tags.some((tag) => tagFilter.includes(tag.id))),
    );
    return sortPeople(matching, sort);
  }, [people, query, sort, tagFilter]);

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
                  <Button variant="outline" size="sm" className="h-8 gap-1.5">
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
        <ul className="flex flex-col gap-2">
          {filtered.map((person) => (
            <li key={person.id}>
              <Link
                to={`/people/${person.id}`}
                className="flex items-center gap-3 rounded-xl border bg-card p-4 shadow-xs transition-colors hover:bg-accent/40"
              >
                <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-primary/10 text-sm font-semibold text-primary uppercase">
                  {person.name.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <p className="truncate font-medium">{person.name}</p>
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
                  <span className="hidden shrink-0 items-center gap-1 text-xs text-muted-foreground sm:flex">
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
                    setEditing(person);
                  }}
                >
                  <Pencil className="size-4" />
                </Button>
              </Link>
            </li>
          ))}
        </ul>
      ) : people && people.length > 0 ? (
        <EmptyState icon={Search} title={t('common.noResults')} />
      ) : (
        <EmptyState
          icon={Users}
          title={t('people.noPeople')}
          description={t('people.noPeopleDescription')}
        >
          <Button size="sm" className="mt-2 gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t('people.addPerson')}
          </Button>
        </EmptyState>
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
