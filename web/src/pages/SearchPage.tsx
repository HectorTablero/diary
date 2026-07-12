import { AtSign, Hash, Search as SearchIcon, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router';
import { usePeople, useSearch, useTags } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { PersonChip, TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { importanceDotClass } from '@/components/entry/ImportanceDot';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { EntryRow } from '@/components/person/EntryRow';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { isNative } from '@/lib/native';
import { cn } from '@/lib/utils';

const csv = (values: string[]) => values.filter(Boolean).join(',');
const parseCsv = (value: string | null) => (value ? value.split(',').filter(Boolean) : []);

export default function SearchPage() {
  const { t } = useTranslation();
  const [params, setParams] = useSearchParams();
  const { data: allTags = [] } = useTags();
  const { data: allPeople = [] } = usePeople();

  const q = params.get('q') ?? '';
  const tagIds = parseCsv(params.get('tags'));
  const personIds = parseCsv(params.get('people'));
  const importances = parseCsv(params.get('importance'));
  const from = params.get('from') ?? '';
  const to = params.get('to') ?? '';
  const page = Number(params.get('page') ?? '1') || 1;

  const [input, setInput] = useState(q);
  useEffect(() => setInput(q), [q]);

  const update = (patch: Record<string, string | null>, resetPage = true) => {
    setParams(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const [key, value] of Object.entries(patch)) {
          if (value) next.set(key, value);
          else next.delete(key);
        }
        if (resetPage) next.delete('page');
        return next;
      },
      { replace: true },
    );
  };

  // Debounce free-text input into the URL.
  useEffect(() => {
    const handle = setTimeout(() => {
      if (input !== q) update({ q: input || null });
    }, 300);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [input]);

  const apiParams = useMemo(() => {
    const p = new URLSearchParams();
    if (q) p.set('q', q);
    if (tagIds.length) p.set('tags', csv(tagIds));
    if (personIds.length) p.set('people', csv(personIds));
    if (importances.length) p.set('importance', csv(importances));
    if (from) p.set('from', from);
    if (to) p.set('to', to);
    p.set('page', String(page));
    p.set('limit', '50');
    return p;
  }, [q, tagIds, personIds, importances, from, to, page]);

  const { data, isLoading } = useSearch(apiParams, true);

  const hasFilters = tagIds.length > 0 || personIds.length > 0 || importances.length > 0 || !!from || !!to || !!q;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;

  const toggleCsvParam = (key: string, current: string[], id: string) => {
    const next = current.includes(id) ? current.filter((v) => v !== id) : [...current, id];
    update({ [key]: next.length ? csv(next) : null });
  };

  return (
    <PageContainer>
      <PageHeader title={t('search.title')} />

      <div className="relative mb-3">
        <SearchIcon className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t('search.placeholder')}
          className="pl-9"
          autoFocus={!isNative}
        />
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <EntityPicker
          trigger={
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
              <Hash className="size-3" />
              {t('search.byTags')}
              {tagIds.length > 0 && <span className="text-primary">({tagIds.length})</span>}
            </Button>
          }
          items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
          selectedIds={tagIds}
          onToggle={(id) => toggleCsvParam('tags', tagIds, id)}
          placeholder={t('tags.namePlaceholder')}
        />
        <EntityPicker
          trigger={
            <Button variant="outline" size="sm" className="h-7 gap-1 px-2 text-xs">
              <AtSign className="size-3" />
              {t('search.byPeople')}
              {personIds.length > 0 && <span className="text-primary">({personIds.length})</span>}
            </Button>
          }
          items={allPeople.map((p) => ({ id: p.id, label: p.name }))}
          selectedIds={personIds}
          onToggle={(id) => toggleCsvParam('people', personIds, id)}
          placeholder={t('people.namePlaceholder')}
        />
        <div className="flex items-center gap-0.5" aria-label={t('search.byImportance')}>
          {[1, 2, 3, 4, 5].map((level) => (
            <Tooltip key={level}>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  onClick={() => toggleCsvParam('importance', importances, String(level))}
                  className={cn(
                    'flex size-6 items-center justify-center rounded-full transition-all',
                    importances.includes(String(level))
                      ? 'bg-accent ring-1 ring-ring'
                      : 'opacity-50 hover:opacity-100',
                  )}
                >
                  <span className={cn('size-2.5 rounded-full', importanceDotClass(level))} />
                </button>
              </TooltipTrigger>
              <TooltipContent>{t(`importance.levels.${level}`)}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        <input
          type="date"
          value={from}
          onChange={(e) => update({ from: e.target.value || null })}
          aria-label={t('search.from')}
          className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
        />
        <span className="text-xs text-muted-foreground">–</span>
        <input
          type="date"
          value={to}
          onChange={(e) => update({ to: e.target.value || null })}
          aria-label={t('search.to')}
          className="h-7 rounded-md border bg-transparent px-1.5 text-xs"
        />
        {hasFilters && (
          <Button
            variant="ghost"
            size="sm"
            className="h-7 gap-1 px-2 text-xs text-muted-foreground"
            onClick={() => {
              setInput('');
              setParams(new URLSearchParams(), { replace: true });
            }}
          >
            <X className="size-3" />
            {t('search.clearFilters')}
          </Button>
        )}
      </div>

      {(tagIds.length > 0 || personIds.length > 0) && (
        <div className="mb-3 flex flex-wrap gap-1.5">
          {tagIds.map((id) => {
            const tag = allTags.find((tg) => tg.id === id);
            return tag ? (
              <TagChip key={id} tag={tag} onRemove={() => toggleCsvParam('tags', tagIds, id)} />
            ) : null;
          })}
          {personIds.map((id) => {
            const person = allPeople.find((p) => p.id === id);
            return person ? (
              <PersonChip key={id} person={person} onRemove={() => toggleCsvParam('people', personIds, id)} />
            ) : null;
          })}
        </div>
      )}

      {isLoading ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
          <Skeleton className="h-12" />
        </div>
      ) : data && data.results.length > 0 ? (
        <>
          <p className="mb-3 text-xs text-muted-foreground">
            {t('search.results', { count: data.total })}
          </p>
          <ul className="flex flex-col gap-3">
            {data.results.map((entry) => (
              <li key={entry.id}>
                <EntryRow entry={entry} />
              </li>
            ))}
          </ul>
          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-center gap-2 text-sm">
              <Button
                variant="outline"
                size="sm"
                disabled={page <= 1}
                onClick={() => update({ page: String(page - 1) }, false)}
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
                onClick={() => update({ page: String(page + 1) }, false)}
              >
                ›
              </Button>
            </div>
          )}
        </>
      ) : (
        <EmptyState
          icon={SearchIcon}
          title={t('search.noResults')}
          description={t('search.noResultsDescription')}
        />
      )}
    </PageContainer>
  );
}
