import { useState } from 'react';
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
import { saveTextFile } from '@/lib/fileSave';
import { buildEntriesMarkdown } from '@/lib/markdownExport/entries';
import { buildPersonMarkdown, type PersonMarkdownOptions } from '@/lib/markdownExport/person';

type ExportType = 'entries' | 'person';

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
  const [personId, setPersonId] = useState<string | null>(null);
  const [personOptions, setPersonOptions] = useState<PersonMarkdownOptions>(DEFAULT_PERSON_OPTIONS);
  const [exporting, setExporting] = useState(false);

  const toggleTag = (id: string) =>
    setTagIds((prev) => (prev.includes(id) ? prev.filter((existing) => existing !== id) : [...prev, id]));

  const selectedPerson = allPeople.find((p) => p.id === personId);

  const runExport = async () => {
    setExporting(true);
    try {
      if (type === 'entries') {
        const entries = await getEntriesInRange(from || null, to || null, tagIds);
        const markdown = buildEntriesMarkdown(entries, { from: from || null, to: to || null });
        await saveTextFile(`diary-entries-${Date.now()}.md`, markdown, 'text/markdown');
      } else if (personId) {
        const [person, talkingPoints, unsaidCount] = await Promise.all([
          getPerson(personId),
          getTalkingPoints(personId),
          getUnsaidCount(personId),
        ]);
        const markdown = buildPersonMarkdown(person, talkingPoints.said, unsaidCount, personOptions);
        await saveTextFile(`briefing-${person.name}-${Date.now()}.md`, markdown, 'text/markdown');
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
                <SelectItem value="person">{t('settings.markdownExport.typePerson')}</SelectItem>
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
                <Label>{t('settings.markdownExport.person')}</Label>
                <EntityPicker
                  trigger={
                    <Button variant="outline" size="sm" className="w-full justify-start">
                      {selectedPerson ? selectedPerson.name : t('settings.markdownExport.choosePerson')}
                    </Button>
                  }
                  items={allPeople.map((p) => ({ id: p.id, label: p.name }))}
                  selectedIds={personId ? [personId] : []}
                  onToggle={(id) => setPersonId(id)}
                  placeholder={t('common.search')}
                />
              </div>
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
            disabled={exporting || (type === 'person' && !personId)}
          >
            {exporting && <Spinner className="size-3.5" />}
            {t('settings.markdownExport.export')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
