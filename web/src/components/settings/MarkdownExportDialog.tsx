import { Hash, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { usePeople, useTags } from '@/api/hooks';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { DatePicker } from '@/components/ui/date-picker';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Spinner } from '@/components/common/Spinner';
import { getEntriesInRange, getPerson, getTalkingPoints, getUnsaidCount } from '@/db/repo';
import { notifyError, notifySuccess } from '@/lib/notify';
import { saveBinaryFile, saveTextFile } from '@/lib/fileSave';
import { buildEntriesMarkdown } from '@/lib/markdownExport/entries';
import {
  buildPeopleMarkdown,
  buildPersonMarkdown,
  type PersonMarkdownOptions,
} from '@/lib/markdownExport/person';
import { fuzzyIncludes } from '@/lib/tokens';
import { zipTextFiles } from '@/lib/zip';
import { useEnabledPlugins } from '@/plugins/enabled';
import { ensurePluginLocales } from '@/plugins/i18n';
import { collectPluginMarkdown } from '@/plugins/markdown';
import { PLUGINS } from '@/plugins/registry';

/* 'entries' and 'people' are the app's own two; anything else is a plugin id — one that declares
   the `ownExport` surface (see PluginModule.exportOwn), discovered below off `PLUGINS` rather than
   named here. This dialog knows nothing about any particular plugin: it reads a manifest's `id` and
   `load()`, and every string it shows for one comes from that plugin's own locale bundle
   (`plugins.<id>.name`, `plugins.<id>.exportHint`), the same way the Plugins list in Settings does. */
type ExportType = string;
type OutputMode = 'merge' | 'zip';

const DEFAULT_PERSON_OPTIONS: PersonMarkdownOptions = {
  aliases: true,
  tags: true,
  workInfo: true,
  notes: true,
  saidTimeline: true,
  unsaidCount: true,
  age: true,
  checkupInterval: true,
  events: true,
};

const PERSON_OPTION_KEYS = [
  'aliases',
  'tags',
  'workInfo',
  'age',
  'checkupInterval',
  'notes',
  'events',
  'saidTimeline',
  'unsaidCount',
] as const satisfies readonly (keyof PersonMarkdownOptions)[];

/* Person names are free text; archive entry names are not.
 *
 * Two people can share a name, and a name can contain characters that mean something to a
 * filesystem. JSZip papered over both by keying its files by name, so a second "Ana" silently
 * replaced the first and a slash quietly became a directory. Writing the archive directly means
 * neither is handled for us — duplicate entries are legal ZIP that unzippers disagree about — so
 * the names are made distinct and inert here, where we still know they came from people. */
function zipEntryNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name) => {
    // Path separators, the characters Windows rejects outright, and control codes.
    const base = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim() || 'person';
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base} (${n})`;
    used.add(candidate);
    return `${candidate}.md`;
  });
}

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
  const enabledPlugins = useEnabledPlugins();

  /* Every enabled plugin with an export type of its own — checked off `surfaces`, readable without
     loading any plugin's chunk, the same rule every other slot in this app follows (registry.ts
     rule 3). `type` matching one of these ids is what picks it out below; there is no other branch
     naming a plugin. */
  const ownExportPlugins = useMemo(
    () =>
      PLUGINS.filter(
        (plugin) => enabledPlugins.has(plugin.id) && plugin.surfaces.includes('ownExport'),
      ),
    [enabledPlugins],
  );
  const ownExportPlugin = ownExportPlugins.find((plugin) => plugin.id === type);

  /* A plugin's name and export hint live in its own locale bundle, fetched only once it is enabled
     — same as PluginsSection.tsx fetching every plugin's strings to show a name beside its switch. */
  const [pluginLabelsReady, setPluginLabelsReady] = useState(false);
  useEffect(() => {
    let cancelled = false;
    setPluginLabelsReady(false);
    void Promise.all(
      ownExportPlugins.map((plugin) => ensurePluginLocales(plugin.id).catch(() => {})),
    ).then(() => !cancelled && setPluginLabelsReady(true));
    return () => {
      cancelled = true;
    };
  }, [ownExportPlugins]);

  const toggleTag = (id: string) =>
    setTagIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );
  const togglePersonTag = (id: string) =>
    setPersonTagFilter((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );
  const togglePerson = (id: string) =>
    setPersonIds((prev) =>
      prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id],
    );

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
            (!personQuery.trim() ||
              fuzzyIncludes(p.name, personQuery) ||
              personMatches.has(p.id)) &&
            (personTagFilter.length === 0 ||
              p.tags.some((tag) => personTagFilter.includes(tag.id))),
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
        /* Appended to the same document rather than downloaded beside it. Plugin data is day-scoped
           — a habit log is another thing that happened on the days these entries describe — so two
           files would just hand the reader something to line up by date themselves. A plugin that
           fails to load contributes nothing and the export goes ahead without it. */
        const pluginSections = await collectPluginMarkdown(enabledPlugins);
        const full = [markdown, ...pluginSections.map((section) => section.markdown)].join('\n\n');
        await saveTextFile(`diary-entries-${Date.now()}.md`, full, 'text/markdown');
      } else if (ownExportPlugin) {
        /* `load()` is the manifest's own thunk (a literal `import('./notebook')` and so on, per
           registry.ts rule 2) — the same mechanism collectPluginMarkdown above uses, so this dialog
           never carries a byte of any plugin's code for a visitor who has it disabled, or never
           opens the dialog at all. */
        const { exportOwn } = (await ownExportPlugin.load()).default;
        if (!exportOwn) return; // guarded by registry.surfaces.test.tsx; unreachable in practice
        if (outputMode === 'zip') {
          const files = await exportOwn.buildZip();
          if (!files.length) {
            notifyError(t('settings.markdownExport.exportEmpty'));
            return;
          }
          const base64 = await zipTextFiles(files);
          await saveBinaryFile(
            `${ownExportPlugin.id}-${Date.now()}.zip`,
            base64,
            'application/zip',
          );
        } else {
          const markdown = await exportOwn.buildMerged();
          if (!markdown) {
            notifyError(t('settings.markdownExport.exportEmpty'));
            return;
          }
          await saveTextFile(`${ownExportPlugin.id}-${Date.now()}.md`, markdown, 'text/markdown');
        }
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
          /* Imported at the top rather than lazily: lib/zip is ~1 kB of archive headers over the
             browser's own DEFLATE, so it rides along in this already-lazy route's chunk instead of
             costing a second round trip on click. JSZip, which it replaced, was 96 kB and had to
             be fetched on demand. */
          const filenames = zipEntryNames(results.map(({ person }) => person.name));
          const base64 = await zipTextFiles(
            results.map(({ person, said, unsaidCount }, index) => ({
              name: filenames[index],
              content: buildPersonMarkdown(person, said, unsaidCount, personOptions),
            })),
          );
          await saveBinaryFile(`briefings-${Date.now()}.zip`, base64, 'application/zip');
        }
      }
      notifySuccess(t('settings.markdownExport.done'), { important: true });
      onOpenChange(false);
    } catch {
      notifyError(t('errors.unknown'));
    } finally {
      setExporting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] max-w-md flex-col">
        <DialogHeader>
          <DialogTitle>{t('settings.markdownExport.title')}</DialogTitle>
          <DialogDescription>{t('settings.markdownExport.description')}</DialogDescription>
        </DialogHeader>

        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          <div className="flex flex-col gap-4">
            <div className="flex flex-col gap-1.5">
              <Label>{t('settings.markdownExport.type')}</Label>
              <Select value={type} onValueChange={(v) => setType(v as ExportType)}>
                <SelectTrigger className="w-full" aria-label={t('settings.markdownExport.type')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="entries">
                    {t('settings.markdownExport.typeEntries')}
                  </SelectItem>
                  <SelectItem value="people">{t('settings.markdownExport.typePeople')}</SelectItem>
                  {/* Only offered once a plugin is both enabled and declares `ownExport` — an
                      export type for data that doesn't exist would be a menu item that only ever
                      produces an empty file. The label is the same name the Plugins list already
                      shows it by, so there is exactly one place that string is ever written. */}
                  {ownExportPlugins.map((plugin) => (
                    <SelectItem key={plugin.id} value={plugin.id}>
                      {pluginLabelsReady ? t(`plugins.${plugin.id}.name`) : '…'}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {ownExportPlugin ? (
              <div className="flex flex-col gap-1.5">
                <Label>{t('settings.markdownExport.outputMode')}</Label>
                <Select value={outputMode} onValueChange={(v) => setOutputMode(v as OutputMode)}>
                  <SelectTrigger
                    className="w-full"
                    aria-label={t('settings.markdownExport.outputMode')}
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="merge">
                      {t('settings.markdownExport.outputMerge')}
                    </SelectItem>
                    <SelectItem value="zip">{t('settings.markdownExport.outputZip')}</SelectItem>
                  </SelectContent>
                </Select>
                {pluginLabelsReady && (
                  <p className="text-xs text-muted-foreground">
                    {t(`plugins.${ownExportPlugin.id}.exportHint`)}
                  </p>
                )}
              </div>
            ) : type === 'entries' ? (
              <>
                <div className="flex gap-2">
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="md-from">{t('settings.markdownExport.from')}</Label>
                    <DatePicker
                      id="md-from"
                      value={from}
                      max={to || undefined}
                      rangeAnchor={to}
                      onChange={setFrom}
                    />
                  </div>
                  <div className="flex flex-1 flex-col gap-1.5">
                    <Label htmlFor="md-to">{t('settings.markdownExport.to')}</Label>
                    <DatePicker
                      id="md-to"
                      value={to}
                      min={from || undefined}
                      rangeAnchor={from}
                      onChange={setTo}
                    />
                  </div>
                </div>
                <div className="flex flex-col gap-1.5">
                  <Label>{t('settings.markdownExport.tags')}</Label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    {tagIds.map((id) => {
                      const tag = allTags.find((tg) => tg.id === id);
                      return tag ? (
                        <TagChip key={tag.id} tag={tag} onRemove={() => toggleTag(tag.id)} />
                      ) : null;
                    })}
                    <EntityPicker
                      trigger={
                        <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
                          {t('common.add')}
                        </Button>
                      }
                      items={allTags.map((tag) => ({
                        id: tag.id,
                        label: tag.name,
                        color: tag.color,
                      }))}
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
                          items={allTags.map((tag) => ({
                            id: tag.id,
                            label: tag.name,
                            color: tag.color,
                          }))}
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
                          ? t('settings.markdownExport.selectAllMatching', {
                              count: filteredPeople.length,
                            })
                          : t('settings.markdownExport.selectAll')}
                    </Button>
                  </div>
                  <div className="max-h-56 overflow-y-auto rounded-lg border">
                    {filteredPeople.length === 0 ? (
                      <p className="p-3 text-center text-xs text-muted-foreground">
                        {t('common.noResults')}
                      </p>
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
                                    <p className="truncate text-xs text-muted-foreground">
                                      {match.job}
                                    </p>
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
                    <Select
                      value={outputMode}
                      onValueChange={(v) => setOutputMode(v as OutputMode)}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label={t('settings.markdownExport.outputMode')}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="merge">
                          {t('settings.markdownExport.outputMerge')}
                        </SelectItem>
                        <SelectItem value="zip">
                          {t('settings.markdownExport.outputZip')}
                        </SelectItem>
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
