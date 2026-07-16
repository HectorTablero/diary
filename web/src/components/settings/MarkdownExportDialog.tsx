import JSZip from 'jszip';
import { Hash, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { usePeople, useTags } from '@/api/hooks';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Spinner } from '@/components/common/Spinner';
import { getEntriesInRange, getPerson, getTalkingPoints, getUnsaidCount } from '@/db/repo';
import { saveBinaryFile, saveTextFile } from '@/lib/fileSave';
import { buildEntriesMarkdown } from '@/lib/markdownExport/entries';
import { buildPeopleMarkdown, buildPersonMarkdown, type PersonMarkdownOptions } from '@/lib/markdownExport/person';
import { fuzzyIncludes } from '@/lib/tokens';

type ExportType = 'entries' | 'people';
type OutputMode = 'merge' | 'zip';

const DEFAULT_PERSON_OPTIONS: PersonMarkdownOptions = {
  tags: true,
  workInfo: true,
  notes: true,
  saidTimeline: true,
  unsaidCount: true,
  age: true,
  events: true,
};

const PERSON_OPTION_KEYS = [
  'tags',
  'workInfo',
  'notes',
  'age',
  'events',
  'saidTimeline',
  'unsaidCount',
] as const satisfies readonly (keyof PersonMarkdownOptions)[];

interface MarkdownExportDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

/** Highly-customizable Markdown export "for Agent consumption" — deliberately separate from the
    JSON backup: read-only, no conflict resolution, and person mentions never carry more than a
    name (see buildEntriesMarkdown). */
export function MarkdownExportDialog({ open, onOpenChange }: MarkdownExportDialogProps) {
  const { t } = useTranslation();
  const { data: allTags = [] } = useTags();
  const { data: allPeople = [] } = usePeople();

  const [type, setType] = useState<ExportType>('entries');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [tagIds, setTagIds] = useState<string[]>([]);
  const [personQuery, setPersonQuery] = useState('');
  const [personTagFilter, setPersonTagFilter] = useState<string[]>([]);
  const [personIds, setPersonIds] = useState<string[]>([]);
  const [outputMode, setOutputMode] = useState<OutputMode>('merge');
  const [personOptions, setPersonOptions] = useState<PersonMarkdownOptions>(DEFAULT_PERSON_OPTIONS);
  const [exporting, setExporting] = useState(false);

  const toggleTag = (id: string) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));
  const togglePersonTag = (id: string) =>
    setPersonTagFilter((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));
  const togglePerson = (id: string) =>
    setPersonIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));

  /* What each person matched the search on, beyond their plain name — same idea as
     PeopleListPage's searchMatches, so "Mum", a job title, or a note all find the right person
     here too. */
  const personMatches = useMemo(() => {
    const matches = new Map<string, { alias: string | null; job: string | null }>();
    if (!personQuery.trim()) return matches;
    for (const person of allPeople) {
      const alias = person.aliases.find((a) => fuzzyIncludes(a, personQuery)) ?? null;
      const organization = [person.jobTitle, person.company].filter(Boolean).join(' · ');
      const job = organization && fuzzyIncludes(organization, personQuery) ? organization : null;
      const notesHit = fuzzyIncludes(person.notes, personQuery);
      if (alias || job || notesHit) matches.set(person.id, { alias, job });
    }
    return matches;
  }, [allPeople, personQuery]);

  const filteredPeople = useMemo(
    () =>
      allPeople
        .filter(
          (p) =>
            (!personQuery.trim() || fuzzyIncludes(p.name, personQuery) || personMatches.has(p.id)) &&
            (personTagFilter.length === 0 || p.tags.some((tag) => personTagFilter.includes(tag.id))),
        )
        .sort((a, b) => a.name.localeCompare(b.name)),
    [allPeople, personQuery, personTagFilter, personMatches],
  );

  const personFilterActive = personQuery.trim().length > 0 || personTagFilter.length > 0;
  const allFilteredSelected =
    filteredPeople.length > 0 && filteredPeople.every((p) => personIds.includes(p.id));

  const toggleSelectAll = () => {
    const filteredIds = new Set(filteredPeople.map((p) => p.id));
    setPersonIds((prev) =>
      allFilteredSelected
        ? prev.filter((id) => !filteredIds.has(id))
        : [...new Set([...prev, ...filteredIds])],
    );
  };

  const runExport = async () => {
    setExporting(true);
    try {
      if (type === 'entries') {
        const entries = await getEntriesInRange(from || null, to || null, tagIds);
        const markdown = buildEntriesMarkdown(entries, { from: from || null, to: to || null });
        await saveTextFile(`diary-entries-${Date.now()}.md`, markdown, 'text/markdown');
      } else if (personIds.length > 0) {
        const results = await Promise.all(
          personIds.map(async (id) => {
            const [person, talkingPoints, unsaidCount] = await Promise.all([
              getPerson(id),
              getTalkingPoints(id),
              getUnsaidCount(id),
            ]);
            return { person, said: talkingPoints.said, unsaidCount };
          }),
        );
        if (results.length === 1 || outputMode === 'merge') {
          const markdown = buildPeopleMarkdown(results, personOptions);
          const filename =
            results.length === 1
              ? `briefing-${results[0].person.name}-${Date.now()}.md`
              : `briefings-${Date.now()}.md`;
          await saveTextFile(filename, markdown, 'text/markdown');
        } else {
          const zip = new JSZip();
          for (const { person, said, unsaidCount } of results) {
            zip.file(`${person.name}.md`, buildPersonMarkdown(person, said, unsaidCount, personOptions));
          }
          const base64 = await zip.generateAsync({ type: 'base64' });
          await saveBinaryFile(`briefings-${Date.now()}.zip`, base64, 'application/zip');
        }
      }
      toast.success(t('settings.markdownExport.done'));
      onOpenChange(false);
    } catch {
      toast.error(t('errors.unknown'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t('settings.markdownExport.title')}</DialogTitle>
          <DialogDescription>{t('settings.markdownExport.description')}</DialogDescription>
        </DialogHeader>

        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <Label>{t('settings.markdownExport.type')}</Label>
            <Select value={type} onValueChange={(v) => setType(v as ExportType)}>
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="entries">{t('settings.markdownExport.typeEntries')}</SelectItem>
                <SelectItem value="people">{t('settings.markdownExport.typePeople')}</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {type === 'entries' ? (
            <>
              <div className="flex gap-2">
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="md-from">{t('settings.markdownExport.from')}</Label>
                  <Input id="md-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
                </div>
                <div className="flex flex-1 flex-col gap-1.5">
                  <Label htmlFor="md-to">{t('settings.markdownExport.to')}</Label>
                  <Input id="md-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.markdownExport.tags')}</Label>
                <div className="flex flex-wrap items-center gap-1.5">
                  {tagIds.map((id) => {
                    const tag = allTags.find((tg) => tg.id === id);
                    return tag ? <TagChip key={tag.id} tag={tag} onRemove={() => toggleTag(tag.id)} /> : null;
                  })}
                  <EntityPicker
                    trigger={
                      <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
                        {t('common.add')}
                      </Button>
                    }
                    items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
                    selectedIds={tagIds}
                    onToggle={toggleTag}
                    placeholder={t('tags.namePlaceholder')}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.markdownExport.people')}</Label>
                <div className="relative">
                  <Search className="absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    value={personQuery}
                    onChange={(e) => setPersonQuery(e.target.value)}
                    placeholder={t('common.search')}
                    className="h-8 pl-8 text-sm"
                  />
                </div>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    {personTagFilter.map((id) => {
                      const tag = allTags.find((tg) => tg.id === id);
                      return tag ? (
                        <TagChip key={id} tag={tag} onRemove={() => togglePersonTag(id)} />
                      ) : null;
                    })}
                    {allTags.length > 0 && (
                      <EntityPicker
                        trigger={
                          <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
                            <Hash className="size-3" />
                            {t('people.filterByTag')}
                          </Button>
                        }
                        items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
                        selectedIds={personTagFilter}
                        onToggle={togglePersonTag}
                        placeholder={t('tags.namePlaceholder')}
                      />
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 shrink-0 text-xs"
                    onClick={toggleSelectAll}
                    disabled={filteredPeople.length === 0}
                  >
                    {allFilteredSelected
                      ? t('settings.markdownExport.selectNone')
                      : personFilterActive
                        ? t('settings.markdownExport.selectAllMatching', { count: filteredPeople.length })
                        : t('settings.markdownExport.selectAll')}
                  </Button>
                </div>
                <div className="max-h-56 overflow-y-auto rounded-lg border">
                  {filteredPeople.length === 0 ? (
                    <p className="p-3 text-center text-xs text-muted-foreground">{t('common.noResults')}</p>
                  ) : (
                    <ul className="divide-y">
                      {filteredPeople.map((person) => {
                        const match = personMatches.get(person.id);
                        return (
                          <li key={person.id}>
                            <label className="flex cursor-pointer items-center gap-2.5 px-3 py-2 hover:bg-accent/40">
                              <Checkbox
                                checked={personIds.includes(person.id)}
                                onCheckedChange={() => togglePerson(person.id)}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-sm">{person.name}</p>
                                {match?.alias && (
                                  <p className="truncate text-xs text-muted-foreground">
                                    {t('people.alsoKnownAs')} {match.alias}
                                  </p>
                                )}
                                {match?.job && (
                                  <p className="truncate text-xs text-muted-foreground">{match.job}</p>
                                )}
                              </div>
                            </label>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                </div>
                {personIds.length > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {t('settings.markdownExport.selectedCount', { count: personIds.length })}
                  </p>
                )}
              </div>

              {personIds.length > 1 && (
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.markdownExport.outputMode')}</Label>
                  <Select value={outputMode} onValueChange={(v) => setOutputMode(v as OutputMode)}>
                    <SelectTrigger className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="merge">{t('settings.markdownExport.outputMerge')}</SelectItem>
                      <SelectItem value="zip">{t('settings.markdownExport.outputZip')}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div className="flex flex-col gap-2">
                {PERSON_OPTION_KEYS.map((key) => (
                  <label key={key} className="flex items-center gap-2.5">
                    <Checkbox
                      checked={personOptions[key]}
                      onCheckedChange={(v) =>
                        setPersonOptions((prev) => ({ ...prev, [key]: v === true }))
                      }
                    />
                    <span className="text-sm">{t(`settings.markdownExport.option.${key}`)}</span>
                  </label>
                ))}
              </div>
            </>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            className="gap-1.5"
            onClick={() => void runExport()}
            disabled={exporting || (type === 'people' && personIds.length === 0)}
          >
            {exporting && <Spinner className="size-3.5" />}
            {t('settings.markdownExport.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
