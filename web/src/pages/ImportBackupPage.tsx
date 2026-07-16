import type { TFunction } from 'i18next';
import { ArrowLeft, DatabaseBackup } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { useEntryIds, usePeople, useTags } from '@/api/hooks';
import { BackupConflictRow, type BackupMergeTarget } from '@/components/backup/BackupConflictRow';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  importBackup,
  type EntryImportItem,
  type PersonImportItem,
  type TagImportItem,
} from '@/db/mutations';
import {
  defaultEntryResolution,
  defaultPersonResolution,
  defaultTagResolution,
  detectEntryConflicts,
  detectPersonBackupConflicts,
  detectTagConflicts,
  isPersonHardConflict,
  isTagHardConflict,
  type BackupResolution,
  type EntryConflictMatch,
  type PersonConflictMatch,
  type TagConflictMatch,
} from '@/lib/backup/conflicts';
import type { BackupEnvelope, EntryBackupRow, PersonBackupRow, TagBackupRow } from '@/lib/backup/schema';

function conflictLabel(kind: string, name: string, t: TFunction): string {
  switch (kind) {
    case 'idExists':
      return t('importBackup.conflictIdExists');
    case 'nameDuplicate':
      return t('importBackup.conflictDuplicate', { name });
    case 'containment':
      return t('importBackup.conflictContainment', { name });
    case 'phone':
      return t('importBackup.conflictPhone', { name });
    default:
      return '';
  }
}

export default function ImportBackupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const envelope = (location.state as { envelope?: BackupEnvelope } | null)?.envelope;

  const { data: existingPeople = [] } = usePeople();
  const { data: existingTags = [] } = useTags();
  const { data: existingEntryIds } = useEntryIds();

  const [tagRenames, setTagRenames] = useState<Record<string, string>>({});
  const [personRenames, setPersonRenames] = useState<Record<string, string>>({});
  const [tagResolutions, setTagResolutions] = useState<Record<string, BackupResolution>>({});
  const [personResolutions, setPersonResolutions] = useState<Record<string, BackupResolution>>({});
  const [entryResolutions, setEntryResolutions] = useState<Record<string, BackupResolution>>({});
  const [importing, setImporting] = useState(false);

  // A backup import always brings in everything — there's no per-category opt-out and no
  // per-row skip, only "resolved via insertion or merge" (see BackupResolution).
  const tagRows = useMemo<TagBackupRow[]>(
    () => (envelope ? envelope.tags.map((row) => ({ ...row, name: tagRenames[row.id] ?? row.name })) : []),
    [envelope, tagRenames],
  );
  const personRows = useMemo<PersonBackupRow[]>(
    () =>
      envelope ? envelope.people.map((row) => ({ ...row, name: personRenames[row.id] ?? row.name })) : [],
    [envelope, personRenames],
  );
  const entryRows = useMemo<EntryBackupRow[]>(() => envelope?.entries ?? [], [envelope]);

  const tagConflicts = useMemo(
    () => detectTagConflicts(tagRows, existingTags),
    [tagRows, existingTags],
  );
  const personConflicts = useMemo(
    () => detectPersonBackupConflicts(personRows, existingPeople),
    [personRows, existingPeople],
  );
  const entryConflicts = useMemo(
    () => (existingEntryIds ? detectEntryConflicts(entryRows, existingEntryIds) : new Map<string, EntryConflictMatch[]>()),
    [entryRows, existingEntryIds],
  );

  const tagResolutionFor = useCallback(
    (id: string): BackupResolution | null => tagResolutions[id] ?? defaultTagResolution(tagConflicts.get(id)),
    [tagResolutions, tagConflicts],
  );
  const personResolutionFor = useCallback(
    (id: string): BackupResolution | null =>
      personResolutions[id] ?? defaultPersonResolution(personConflicts.get(id)),
    [personResolutions, personConflicts],
  );
  const entryResolutionFor = useCallback(
    (id: string): BackupResolution => entryResolutions[id] ?? defaultEntryResolution(),
    [entryResolutions],
  );

  const conflictedTags = tagRows.filter((row) => tagConflicts.has(row.id));
  const conflictedPeople = personRows.filter((row) => personConflicts.has(row.id));
  const conflictedEntries = entryRows.filter((row) => entryConflicts.has(row.id));

  const unresolvedTags = conflictedTags.filter((row) => tagResolutionFor(row.id) === null);
  const unresolvedPeople = conflictedPeople.filter((row) => personResolutionFor(row.id) === null);
  const totalUnresolved = unresolvedTags.length + unresolvedPeople.length;

  const backButton = (
    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void navigate('/settings')}>
      <ArrowLeft className="size-4" />
      {t('common.back')}
    </Button>
  );

  if (!envelope) {
    return (
      <PageContainer>
        <PageHeader title={t('importBackup.title')} />
        <EmptyState
          icon={DatabaseBackup}
          title={t('importBackup.noFile')}
          description={t('importBackup.noFileDescription')}
        >
          <Button variant="outline" size="sm" className="mt-2" onClick={() => void navigate('/settings')}>
            {t('common.back')}
          </Button>
        </EmptyState>
      </PageContainer>
    );
  }

  const runImport = async () => {
    setImporting(true);
    try {
      const tags: TagImportItem[] = tagRows.map((row) => ({ row, resolution: tagResolutionFor(row.id)! }));
      const people: PersonImportItem[] = personRows.map((row) => ({
        row,
        resolution: personResolutionFor(row.id)!,
      }));
      const entries: EntryImportItem[] = entryRows.map((row) => ({
        row,
        resolution: entryResolutionFor(row.id),
      }));
      const summary = await importBackup({ tags, people, entries });
      toast.success(
        t('importBackup.done', {
          tagsCreated: summary.tags.created,
          tagsMerged: summary.tags.merged,
          peopleCreated: summary.people.created,
          peopleMerged: summary.people.merged,
          entriesCreated: summary.entries.created,
          entriesMerged: summary.entries.merged,
        }),
      );
      if (summary.entries.orphaned > 0) {
        toast.info(t('importBackup.orphaned', { count: summary.entries.orphaned }));
      }
      void navigate('/settings');
    } catch {
      toast.error(t('errors.unknown'));
      setImporting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title={t('importBackup.reviewTitle')} actions={backButton} />

      <div className="mb-4 flex flex-col gap-1 rounded-xl border bg-card p-3 text-sm">
        <p>{t('importBackup.sectionSummary', { label: t('importBackup.tags'), clean: tagRows.length - conflictedTags.length, conflicts: conflictedTags.length })}</p>
        <p>{t('importBackup.sectionSummary', { label: t('importBackup.people'), clean: personRows.length - conflictedPeople.length, conflicts: conflictedPeople.length })}</p>
        <p>{t('importBackup.sectionSummary', { label: t('importBackup.entries'), clean: entryRows.length - conflictedEntries.length, conflicts: conflictedEntries.length })}</p>
      </div>

      {conflictedTags.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold">{t('importBackup.tags')}</h2>
          <ul className="flex flex-col gap-2">
            {conflictedTags.map((row) => {
              const matches: TagConflictMatch[] = tagConflicts.get(row.id)!;
              const mergeTargets: BackupMergeTarget[] = matches.map((m) => ({ targetId: m.targetId, name: m.name }));
              return (
                <BackupConflictRow
                  key={row.id}
                  name={row.name}
                  conflictLabels={matches.map((m) => conflictLabel(m.kind, m.name, t))}
                  hard={isTagHardConflict(matches)}
                  resolution={tagResolutionFor(row.id)}
                  mergeTargets={mergeTargets}
                  createLabel={t('importBackup.keepBoth')}
                  allowCreate={!isTagHardConflict(matches)}
                  onResolve={(resolution) => setTagResolutions((prev) => ({ ...prev, [row.id]: resolution }))}
                  onRename={(name) => setTagRenames((prev) => ({ ...prev, [row.id]: name }))}
                />
              );
            })}
          </ul>
        </section>
      )}

      {conflictedPeople.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold">{t('importBackup.people')}</h2>
          <ul className="flex flex-col gap-2">
            {conflictedPeople.map((row) => {
              const matches: PersonConflictMatch[] = personConflicts.get(row.id)!;
              const mergeTargets: BackupMergeTarget[] = matches.map((m) => ({ targetId: m.targetId, name: m.name }));
              return (
                <BackupConflictRow
                  key={row.id}
                  name={row.name}
                  conflictLabels={matches.map((m) => conflictLabel(m.kind, m.name, t))}
                  hard={isPersonHardConflict(matches)}
                  resolution={personResolutionFor(row.id)}
                  mergeTargets={mergeTargets}
                  createLabel={t('importBackup.keepBoth')}
                  allowCreate={!isPersonHardConflict(matches)}
                  onResolve={(resolution) => setPersonResolutions((prev) => ({ ...prev, [row.id]: resolution }))}
                  onRename={(name) => setPersonRenames((prev) => ({ ...prev, [row.id]: name }))}
                />
              );
            })}
          </ul>
        </section>
      )}

      {conflictedEntries.length > 0 && (
        <section className="mb-4">
          <h2 className="mb-2 text-sm font-semibold">{t('importBackup.entries')}</h2>
          <ul className="flex flex-col gap-2">
            {conflictedEntries.map((row) => (
              <BackupConflictRow
                key={row.id}
                name={row.content.slice(0, 80)}
                conflictLabels={[t('importBackup.conflictIdExists')]}
                hard={false}
                resolution={entryResolutionFor(row.id)}
                mergeTargets={[]}
                createLabel={t('importBackup.addAsNew')}
                allowCreate
                allowOverwrite
                onResolve={(resolution) => setEntryResolutions((prev) => ({ ...prev, [row.id]: resolution }))}
              />
            ))}
          </ul>
        </section>
      )}

      <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background/95 py-3 backdrop-blur">
        {totalUnresolved > 0 && (
          <p className="text-center text-xs text-muted-foreground">
            {t('importBackup.resolveFirst', { count: totalUnresolved })}
          </p>
        )}
        <Button className="w-full gap-1.5" disabled={totalUnresolved > 0 || importing} onClick={() => void runImport()}>
          {importing && <Spinner className="size-3.5" />}
          {t('importBackup.confirm')}
        </Button>
      </div>
    </PageContainer>
  );
}
