import type { TFunction } from 'i18next';
import {
  ArrowLeft,
  BookOpen,
  CheckCheck,
  DatabaseBackup,
  FilePenLine,
  GitBranch,
  Merge,
  Tag,
  Users,
  UserPlus,
  MessageSquarePlus,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { notifyError, notifySuccess } from '@/lib/notify';
import { useEntryIndex, usePeople, useTags, useThreads } from '@/api/hooks';
import { BackupConflictRow } from '@/components/backup/BackupConflictRow';
import { ConflictSection, type ConflictBulkButton } from '@/components/backup/ConflictSection';
import { ImportSummary } from '@/components/backup/ImportSummary';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Button } from '@/components/ui/button';
import {
  importBackup,
  type EntryImportItem,
  type PersonImportItem,
  type TagImportItem,
  type ThreadImportItem,
} from '@/db/mutations';
import { bulkActions, type BulkCandidate } from '@/lib/backup/bulk';
import {
  backupMergeTargets,
  defaultEntryResolution,
  defaultPersonResolution,
  defaultTagResolution,
  defaultThreadResolution,
  detectEntryConflicts,
  detectPersonBackupConflicts,
  detectTagConflicts,
  detectThreadConflicts,
  isPersonHardConflict,
  isTagHardConflict,
  isThreadHardConflict,
  type BackupResolution,
  type EntryConflictMatch,
} from '@/lib/backup/conflicts';
import type {
  BackupEnvelope,
  EntryBackupRow,
  PersonBackupRow,
  TagBackupRow,
  ThreadBackupRow,
} from '@/lib/backup/schema';

interface ConflictMatchLike {
  kind: string;
  targetId: string;
  name: string;
}

/** Every conflict kind, across all four entity kinds, in the user's words. */
function conflictLabel(match: ConflictMatchLike, t: TFunction): string {
  const { name } = match;
  switch (match.kind) {
    case 'idExists':
      return t('importBackup.conflictIdExists', { name });
    case 'nameDuplicate':
      return t('importBackup.conflictDuplicate', { name });
    case 'containment':
      return t('importBackup.conflictContainment', { name });
    case 'phone':
      return t('importBackup.conflictPhone', { name });
    case 'duplicate':
      return t('importBackup.conflictEntryDuplicate');
    default:
      return '';
  }
}

/**
 * A row's reasons, with the ones that say the same thing twice taken out.
 *
 * A plain restore matches every row by id *and* by name against the same local row, and stacking
 * both lines under the name gave every one of a few hundred cards a generic "already here" above a
 * sentence that says that and more — the name it clashes with, and why "keep both" is not on offer.
 * The id line is dropped only when the row it points at is the one the name line is already about:
 * an id match against a locally renamed row, or alongside a *different* person's soft match, is the
 * only thing saying the row is already here at all, and it stays.
 */
function conflictLabels(matches: ConflictMatchLike[], t: TFunction): string[] {
  return matches
    .filter(
      (match) =>
        match.kind !== 'idExists' ||
        !matches.some(
          (other) => other.kind === 'nameDuplicate' && other.targetId === match.targetId,
        ),
    )
    .map((match) => conflictLabel(match, t));
}

/** Labels and icons for a section's bulk buttons — deliberately the same words and glyphs the row
    buttons use, since pressing one is meant to read as pressing that button on every row. */
type BulkLabels = Partial<Record<BackupResolution['action'], { label: string; icon: LucideIcon }>>;

function bulkButtons(
  candidates: BulkCandidate[],
  labels: BulkLabels,
  apply: (patch: Record<string, BackupResolution>) => void,
): ConflictBulkButton[] {
  return bulkActions(candidates).flatMap((action) => {
    const label = labels[action.kind];
    return label
      ? [
          {
            key: action.kind,
            label: label.label,
            icon: label.icon,
            selected: action.selected,
            onApply: () => apply(action.patch),
          },
        ]
      : [];
  });
}

export default function ImportBackupPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const envelope = (location.state as { envelope?: BackupEnvelope } | null)?.envelope;

  const { data: existingPeople = [] } = usePeople();
  const { data: existingTags = [] } = useTags();
  const { data: existingThreads = [] } = useThreads();
  const { data: existingEntryIndex } = useEntryIndex();

  const [tagResolutions, setTagResolutions] = useState<Record<string, BackupResolution>>({});
  const [threadResolutions, setThreadResolutions] = useState<Record<string, BackupResolution>>({});
  const [personResolutions, setPersonResolutions] = useState<Record<string, BackupResolution>>({});
  const [entryResolutions, setEntryResolutions] = useState<Record<string, BackupResolution>>({});
  const [importing, setImporting] = useState(false);

  /* A backup import always brings in everything — there's no per-category opt-out, no per-row skip
     and nothing here edits what is in the file, only "resolved via insertion or merge" (see
     BackupResolution). Renaming a clashing row on the way in was offered once and taken out: it is
     the one action on this screen that changes the diary being restored rather than deciding what
     to do with it, and every clash it was there to resolve is already answerable by merging into
     the thing that clashed. */
  const tagRows = useMemo<TagBackupRow[]>(() => envelope?.tags ?? [], [envelope]);
  const threadRows = useMemo<ThreadBackupRow[]>(() => envelope?.threads ?? [], [envelope]);
  const personRows = useMemo<PersonBackupRow[]>(() => envelope?.people ?? [], [envelope]);
  const entryRows = useMemo<EntryBackupRow[]>(() => envelope?.entries ?? [], [envelope]);

  const tagConflicts = useMemo(
    () => detectTagConflicts(tagRows, existingTags),
    [tagRows, existingTags],
  );
  const threadConflicts = useMemo(
    () => detectThreadConflicts(threadRows, existingThreads),
    [threadRows, existingThreads],
  );
  const personConflicts = useMemo(
    () => detectPersonBackupConflicts(personRows, existingPeople),
    [personRows, existingPeople],
  );
  const entryConflicts = useMemo(
    () =>
      existingEntryIndex
        ? detectEntryConflicts(entryRows, existingEntryIndex)
        : new Map<string, EntryConflictMatch[]>(),
    [entryRows, existingEntryIndex],
  );

  const tagResolutionFor = useCallback(
    (id: string): BackupResolution | null =>
      tagResolutions[id] ?? defaultTagResolution(tagConflicts.get(id)),
    [tagResolutions, tagConflicts],
  );
  const threadResolutionFor = useCallback(
    (id: string): BackupResolution | null =>
      threadResolutions[id] ?? defaultThreadResolution(threadConflicts.get(id)),
    [threadResolutions, threadConflicts],
  );
  const personResolutionFor = useCallback(
    (id: string): BackupResolution | null =>
      personResolutions[id] ?? defaultPersonResolution(personConflicts.get(id)),
    [personResolutions, personConflicts],
  );
  const entryResolutionFor = useCallback(
    (id: string): BackupResolution =>
      entryResolutions[id] ?? defaultEntryResolution(entryConflicts.get(id)),
    [entryResolutions, entryConflicts],
  );

  const conflictedTags = tagRows.filter((row) => tagConflicts.has(row.id));
  const conflictedThreads = threadRows.filter((row) => threadConflicts.has(row.id));
  const conflictedPeople = personRows.filter((row) => personConflicts.has(row.id));
  const conflictedEntries = entryRows.filter((row) => entryConflicts.has(row.id));

  const unresolvedTags = conflictedTags.filter((row) => tagResolutionFor(row.id) === null);
  const unresolvedThreads = conflictedThreads.filter((row) => threadResolutionFor(row.id) === null);
  const unresolvedPeople = conflictedPeople.filter((row) => personResolutionFor(row.id) === null);
  /* Entries appear in the denominator but never in the numerator, and that asymmetry is the point:
     every entry conflict arrives with a valid default (see defaultEntryResolution), so none of them
     can ever be outstanding, but they are conflicts the summary tiles above have already counted.
     Leaving them out of the total made the footer read "288 of 288" under tiles adding up to 384,
     which reads as a page that has lost track of a category rather than as one that is finished. */
  const totalUnresolved =
    unresolvedTags.length + unresolvedThreads.length + unresolvedPeople.length;
  const totalConflicts =
    conflictedTags.length +
    conflictedThreads.length +
    conflictedPeople.length +
    conflictedEntries.length;

  /* Section-wide buttons, built from the same three facts each row exposes to its own buttons —
     what it can merge into, whether "keep both" is legal for it, whether it can be overwritten — so
     a bulk press and the equivalent run of row presses cannot drift apart. */
  const mergeLabel = { label: t('importBackup.merge'), icon: Merge };
  const keepBothLabel = { label: t('importBackup.keepBoth'), icon: UserPlus };

  const tagBulk = bulkButtons(
    conflictedTags.map((row) => {
      const matches = tagConflicts.get(row.id)!;
      return {
        id: row.id,
        mergeTargetId: backupMergeTargets(matches)[0]?.targetId ?? null,
        allowCreate: !isTagHardConflict(matches),
        allowOverwrite: false,
        resolution: tagResolutionFor(row.id),
      };
    }),
    { merge: mergeLabel, create: keepBothLabel },
    (patch) => setTagResolutions((prev) => ({ ...prev, ...patch })),
  );

  const threadBulk = bulkButtons(
    conflictedThreads.map((row) => {
      const matches = threadConflicts.get(row.id)!;
      return {
        id: row.id,
        mergeTargetId: backupMergeTargets(matches)[0]?.targetId ?? null,
        allowCreate: !isThreadHardConflict(matches),
        allowOverwrite: false,
        resolution: threadResolutionFor(row.id),
      };
    }),
    { merge: mergeLabel, create: keepBothLabel },
    (patch) => setThreadResolutions((prev) => ({ ...prev, ...patch })),
  );

  const personBulk = bulkButtons(
    conflictedPeople.map((row) => {
      const matches = personConflicts.get(row.id)!;
      return {
        id: row.id,
        mergeTargetId: backupMergeTargets(matches)[0]?.targetId ?? null,
        allowCreate: !isPersonHardConflict(matches),
        allowOverwrite: false,
        resolution: personResolutionFor(row.id),
      };
    }),
    { merge: mergeLabel, create: keepBothLabel },
    (patch) => setPersonResolutions((prev) => ({ ...prev, ...patch })),
  );

  const entryBulk = bulkButtons(
    conflictedEntries.map((row) => {
      const matches = entryConflicts.get(row.id) ?? [];
      return {
        id: row.id,
        mergeTargetId: backupMergeTargets(matches)[0]?.targetId ?? null,
        allowCreate: true,
        allowOverwrite: true,
        resolution: entryResolutionFor(row.id),
      };
    }),
    {
      merge: mergeLabel,
      create: { label: t('importBackup.addAsNew'), icon: MessageSquarePlus },
      overwrite: { label: t('importBackup.overwrite'), icon: FilePenLine },
    },
    (patch) => setEntryResolutions((prev) => ({ ...prev, ...patch })),
  );

  const backButton = (
    <Button
      variant="ghost"
      size="sm"
      className="gap-1.5"
      onClick={() => void navigate('/settings')}
    >
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
          <Button
            variant="outline"
            size="sm"
            className="mt-2"
            onClick={() => void navigate('/settings')}
          >
            {t('common.back')}
          </Button>
        </EmptyState>
      </PageContainer>
    );
  }

  const runImport = async () => {
    setImporting(true);
    try {
      const tags: TagImportItem[] = tagRows.map((row) => ({
        row,
        resolution: tagResolutionFor(row.id)!,
      }));
      const threads: ThreadImportItem[] = threadRows.map((row) => ({
        row,
        resolution: threadResolutionFor(row.id)!,
      }));
      const people: PersonImportItem[] = personRows.map((row) => ({
        row,
        resolution: personResolutionFor(row.id)!,
      }));
      const entries: EntryImportItem[] = entryRows.map((row) => ({
        row,
        resolution: entryResolutionFor(row.id),
      }));
      const summary = await importBackup({ tags, threads, people, entries });
      notifySuccess(
        t('importBackup.done', {
          tagsCreated: summary.tags.created,
          tagsMerged: summary.tags.merged,
          threadsCreated: summary.threads.created,
          threadsMerged: summary.threads.merged,
          peopleCreated: summary.people.created,
          peopleMerged: summary.people.merged,
          entriesCreated: summary.entries.created,
          entriesMerged: summary.entries.merged,
        }),
        { important: true },
      );
      if (summary.entries.skipped > 0) {
        toast.info(t('importBackup.entriesSkipped', { count: summary.entries.skipped }));
      }
      if (summary.entries.orphaned > 0) {
        toast.info(t('importBackup.orphaned', { count: summary.entries.orphaned }));
      }
      void navigate('/settings');
    } catch (err) {
      /* The toast can only ever say "something went wrong" — by this point the user has spent real
         time on decisions and there is nothing actionable left to tell them. The console line is
         the part that matters: an import failing mid-way is exactly the bug worth reproducing, and
         without it the failure leaves no trace of which write threw. */
      console.error('backup: import failed', err);
      notifyError(t('errors.unknown'));
      setImporting(false);
    }
  };

  return (
    <PageContainer>
      <PageHeader title={t('importBackup.reviewTitle')} actions={backButton} />

      <ImportSummary
        exportedAt={envelope.exportedAt}
        version={envelope.version}
        categories={[
          {
            label: t('importBackup.tags'),
            icon: Tag,
            total: tagRows.length,
            conflicts: conflictedTags.length,
          },
          {
            label: t('importBackup.threads'),
            icon: GitBranch,
            total: threadRows.length,
            conflicts: conflictedThreads.length,
          },
          {
            label: t('importBackup.people'),
            icon: Users,
            total: personRows.length,
            conflicts: conflictedPeople.length,
          },
          {
            label: t('importBackup.entries'),
            icon: BookOpen,
            total: entryRows.length,
            conflicts: conflictedEntries.length,
          },
        ]}
      />

      {/* Nothing to decide is a state in its own right, and it used to render as a blank gap between
          the summary and the button — which reads as a page that failed to load rather than as good
          news. Entries are excluded from the count deliberately: an id clash on an entry resolves
          itself with a default, so it never blocks and never needs announcing here. */}
      {conflictedTags.length +
        conflictedThreads.length +
        conflictedPeople.length +
        conflictedEntries.length ===
        0 && (
        <EmptyState
          icon={CheckCheck}
          title={t('importBackup.allClear')}
          description={t('importBackup.allClearDescription')}
        />
      )}

      {conflictedTags.length > 0 && (
        <ConflictSection
          title={t('importBackup.tags')}
          icon={Tag}
          total={conflictedTags.length}
          unresolved={unresolvedTags.length}
          bulk={tagBulk}
        >
          {conflictedTags.map((row) => {
            const matches = tagConflicts.get(row.id)!;
            return (
              <BackupConflictRow
                key={row.id}
                name={row.name}
                conflictLabels={conflictLabels(matches, t)}
                hard={isTagHardConflict(matches)}
                resolution={tagResolutionFor(row.id)}
                mergeTargets={backupMergeTargets(matches)}
                createLabel={t('importBackup.keepBoth')}
                allowCreate={!isTagHardConflict(matches)}
                onResolve={(resolution) =>
                  setTagResolutions((prev) => ({ ...prev, [row.id]: resolution }))
                }
              />
            );
          })}
        </ConflictSection>
      )}

      {conflictedThreads.length > 0 && (
        <ConflictSection
          title={t('importBackup.threads')}
          icon={GitBranch}
          total={conflictedThreads.length}
          unresolved={unresolvedThreads.length}
          bulk={threadBulk}
        >
          {conflictedThreads.map((row) => {
            const matches = threadConflicts.get(row.id)!;
            return (
              <BackupConflictRow
                key={row.id}
                name={row.name}
                conflictLabels={conflictLabels(matches, t)}
                hard={isThreadHardConflict(matches)}
                resolution={threadResolutionFor(row.id)}
                mergeTargets={backupMergeTargets(matches)}
                createLabel={t('importBackup.keepBoth')}
                allowCreate={!isThreadHardConflict(matches)}
                onResolve={(resolution) =>
                  setThreadResolutions((prev) => ({ ...prev, [row.id]: resolution }))
                }
              />
            );
          })}
        </ConflictSection>
      )}

      {conflictedPeople.length > 0 && (
        <ConflictSection
          title={t('importBackup.people')}
          icon={Users}
          total={conflictedPeople.length}
          unresolved={unresolvedPeople.length}
          bulk={personBulk}
        >
          {conflictedPeople.map((row) => {
            const matches = personConflicts.get(row.id)!;
            return (
              <BackupConflictRow
                key={row.id}
                name={row.name}
                conflictLabels={conflictLabels(matches, t)}
                hard={isPersonHardConflict(matches)}
                resolution={personResolutionFor(row.id)}
                mergeTargets={backupMergeTargets(matches)}
                createLabel={t('importBackup.keepBoth')}
                allowCreate={!isPersonHardConflict(matches)}
                onResolve={(resolution) =>
                  setPersonResolutions((prev) => ({ ...prev, [row.id]: resolution }))
                }
              />
            );
          })}
        </ConflictSection>
      )}

      {conflictedEntries.length > 0 && (
        /* `unresolved={0}` is a fact, not a shortcut: an entry id clash always has a valid default
           (see defaultEntryResolution), so these rows are shown to be changed, never to be
           unblocked. Nothing here can hold up the import. */
        <ConflictSection
          title={t('importBackup.entries')}
          icon={BookOpen}
          total={conflictedEntries.length}
          unresolved={0}
          bulk={entryBulk}
        >
          {conflictedEntries.map((row) => {
            const matches: EntryConflictMatch[] = entryConflicts.get(row.id) ?? [];
            return (
              <BackupConflictRow
                key={row.id}
                name={row.content.slice(0, 80)}
                conflictLabels={conflictLabels(matches, t)}
                hard={false}
                resolution={entryResolutionFor(row.id)}
                mergeTargets={backupMergeTargets(matches)}
                createLabel={t('importBackup.addAsNew')}
                allowCreate
                createIcon={MessageSquarePlus}
                allowOverwrite
                onResolve={(resolution) =>
                  setEntryResolutions((prev) => ({ ...prev, [row.id]: resolution }))
                }
              />
            );
          })}
        </ConflictSection>
      )}

      <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background/95 py-3 backdrop-blur">
        {totalConflicts > 0 && (
          /* A bar, not just a sentence. "Resolve 12 conflicts to continue" is the same message on
             the first decision and the eleventh — it counts what is left and says nothing about what
             has been done, so a long review gives no sign of being finite. This does, and it stays
             up once complete rather than vanishing: the last thing the user needs to know before
             pressing the button is that nothing is outstanding. */
          <div className="flex flex-col gap-1.5">
            <div className="flex items-baseline justify-between gap-2 text-xs">
              <span className={totalUnresolved > 0 ? 'text-muted-foreground' : 'font-medium'}>
                {totalUnresolved > 0
                  ? t('importBackup.resolveFirst', { count: totalUnresolved })
                  : t('importBackup.allResolved')}
              </span>
              <span className="shrink-0 text-muted-foreground tabular-nums">
                {t('importBackup.resolvedProgress', {
                  resolved: totalConflicts - totalUnresolved,
                  total: totalConflicts,
                })}
              </span>
            </div>
            <div
              className="h-1 overflow-hidden rounded-full bg-muted"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={totalConflicts}
              aria-valuenow={totalConflicts - totalUnresolved}
            >
              <div
                className="h-full rounded-full bg-foreground transition-[width] duration-300"
                style={{
                  width: `${((totalConflicts - totalUnresolved) / totalConflicts) * 100}%`,
                }}
              />
            </div>
          </div>
        )}
        <Button
          className="w-full gap-1.5"
          disabled={totalUnresolved > 0 || importing}
          onClick={() => void runImport()}
        >
          {importing && <Spinner className="size-3.5" />}
          {t('importBackup.confirm')}
        </Button>
      </div>
    </PageContainer>
  );
}
