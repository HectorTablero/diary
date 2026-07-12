import type { PersonDto } from '@diary/shared';
import { BellRing, MessageCircle, Pencil, Plus, Search, Users } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link } from 'react-router';
import { usePeople } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { TagChip } from '@/components/entry/chips';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { PersonForm } from '@/components/person/PersonForm';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { fuzzyIncludes } from '@/lib/tokens';

export default function PeopleListPage() {
  const { t } = useTranslation();
  const { data: people, isLoading } = usePeople();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<PersonDto | null>(null);

  const filtered = useMemo(
    () => (people ?? []).filter((p) => !query || fuzzyIncludes(p.name, query)),
    [people, query],
  );

  return (
    <PageContainer>
      <PageHeader
        title={t('people.title')}
        actions={
          <Button size="sm" className="gap-1.5" onClick={() => setAdding(true)}>
            <Plus className="size-4" />
            {t('people.addPerson')}
          </Button>
        }
      />

      {people && people.length > 0 && (
        <div className="relative mb-4">
          <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t('common.search')}
            className="pl-9"
          />
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
