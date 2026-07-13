import {
  ArrowLeft,
  Ban,
  Check,
  ContactRound,
  Merge,
  Pencil,
  Search,
  ShieldAlert,
  TriangleAlert,
  UserPlus,
} from 'lucide-react';
import type { TFunction } from 'i18next';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { toast } from 'sonner';
import { usePeople } from '@/api/hooks';
import { EmptyState } from '@/components/common/EmptyState';
import { Spinner } from '@/components/common/Spinner';
import { PageContainer, PageHeader } from '@/components/layout/PageHeader';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { importPeople, type ImportItem } from '@/db/mutations';
import { canImportContacts, checkContactsPermission, readContacts, requestContactsPermission } from '@/lib/contacts';
import {
  canKeepBoth,
  defaultResolution,
  detectConflicts,
  isHardConflict,
  mergeTargets,
  type ConflictMatch,
  type ContactCandidate,
  type Resolution,
} from '@/lib/conflicts';
import { fuzzyIncludes } from '@/lib/tokens';

/* Two steps, on purpose:

   1. Select — plain checkboxes, no conflict checking at all. Picking who to import shouldn't be
      cluttered with warnings about people you haven't chosen yet.
   2. Review — only the selected contacts that actually clash. Nothing is written until every
      hard conflict is settled, because a duplicate name that reaches the server comes back as a
      409, and sync.ts answers a 409-on-POST by *deleting the local person* (sync.ts:102). An
      import that "worked" would quietly lose people on the next pull. */

type Step = 'select' | 'review';
/** `failed` is distinct from `denied`: the plugin threw, rather than the user saying no. */
type LoadState = 'loading' | 'ready' | 'denied' | 'failed';

/** Description of what a conflict actually is, in the user's words. */
function conflictLabel(match: ConflictMatch, t: TFunction): string {
  switch (match.kind) {
    case 'imported':
      return t('import.conflictImported', { name: match.name });
    case 'duplicate':
      return t('import.conflictDuplicate', { name: match.name });
    case 'containment':
      return t('import.conflictContainment', { name: match.name });
    case 'phone':
      return t('import.conflictPhone', { name: match.name });
  }
}

function ContactRow({
  candidate,
  checked,
  alreadyImported,
  onToggle,
}: {
  candidate: ContactCandidate;
  checked: boolean;
  alreadyImported: boolean;
  onToggle: () => void;
}) {
  const { t } = useTranslation();
  const details = [candidate.phone, candidate.email].filter(Boolean).join(' · ');
  return (
    <li>
      <label className="flex cursor-pointer items-center gap-3 rounded-xl border bg-card p-3 shadow-xs transition-colors hover:bg-accent/40">
        <Checkbox checked={checked} onCheckedChange={onToggle} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium">{candidate.name}</p>
          {details && <p className="truncate text-xs text-muted-foreground">{details}</p>}
        </div>
        {alreadyImported && (
          <Badge variant="secondary" className="shrink-0 text-xs">
            {t('import.alreadyImported')}
          </Badge>
        )}
      </label>
    </li>
  );
}

function ConflictRow({
  candidate,
  matches,
  resolution,
  onResolve,
  onRename,
}: {
  candidate: ContactCandidate;
  matches: ConflictMatch[];
  resolution: Resolution | null;
  onResolve: (resolution: Resolution) => void;
  onRename: (name: string) => void;
}) {
  const { t } = useTranslation();
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(candidate.name);

  const hard = isHardConflict(matches);
  const targets = mergeTargets(matches);
  const keepAllowed = canKeepBoth(matches);
  const isChosen = (action: Resolution['action'], personId?: string) =>
    resolution?.action === action &&
    (action !== 'merge' || (resolution as { personId: string }).personId === personId);

  const commitRename = () => {
    const value = draft.trim();
    if (value) onRename(value);
    setRenaming(false);
  };

  return (
    <li
      className={
        'flex flex-col gap-2 rounded-xl border p-3 ' +
        (resolution
          ? 'border-border bg-card'
          : hard
            ? 'border-destructive/50 bg-destructive/5'
            : 'border-amber-500/50 bg-amber-500/5')
      }
    >
      <div className="flex items-start gap-2">
        {resolution ? (
          <Check className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
        ) : hard ? (
          <ShieldAlert className="mt-0.5 size-4 shrink-0 text-destructive" />
        ) : (
          <TriangleAlert className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
        )}
        <div className="min-w-0 flex-1">
          {renaming ? (
            <div className="flex items-center gap-1.5">
              <Input
                value={draft}
                autoFocus
                className="h-8"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') commitRename();
                  if (e.key === 'Escape') setRenaming(false);
                }}
              />
              <Button size="sm" className="h-8" onClick={commitRename}>
                {t('common.save')}
              </Button>
            </div>
          ) : (
            <p className="truncate text-sm font-medium">{candidate.name}</p>
          )}
          <ul className="mt-0.5 flex flex-col text-xs text-muted-foreground">
            {matches.map((match, index) => (
              <li key={`${match.kind}-${match.personId ?? index}`}>{conflictLabel(match, t)}</li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {targets.map((target) => (
          <Button
            key={target.personId}
            size="sm"
            variant={isChosen('merge', target.personId!) ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs"
            onClick={() => onResolve({ action: 'merge', personId: target.personId! })}
          >
            <Merge className="size-3" />
            {t('import.mergeInto', { name: target.name })}
          </Button>
        ))}
        {keepAllowed && (
          <Button
            size="sm"
            variant={isChosen('create') ? 'default' : 'outline'}
            className="h-7 gap-1 text-xs"
            onClick={() => onResolve({ action: 'create' })}
          >
            <UserPlus className="size-3" />
            {t('import.keepBoth')}
          </Button>
        )}
        <Button
          size="sm"
          variant="outline"
          className="h-7 gap-1 text-xs"
          onClick={() => {
            setDraft(candidate.name);
            setRenaming(true);
          }}
        >
          <Pencil className="size-3" />
          {t('import.rename')}
        </Button>
        <Button
          size="sm"
          variant={isChosen('skip') ? 'default' : 'outline'}
          className="h-7 gap-1 text-xs"
          onClick={() => onResolve({ action: 'skip' })}
        >
          <Ban className="size-3" />
          {t('import.skip')}
        </Button>
      </div>
    </li>
  );
}

export default function ImportContactsPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: people = [] } = usePeople();

  const [state, setState] = useState<LoadState>('loading');
  const [error, setError] = useState<string | null>(null);
  const [contacts, setContacts] = useState<ContactCandidate[]>([]);
  const [step, setStep] = useState<Step>('select');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Names edited in the review step, keyed by contactId. */
  const [renames, setRenames] = useState<Record<string, string>>({});
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>({});
  const [importing, setImporting] = useState(false);

  /* Every step here can fail (permission rejected, plugin not implemented, address book
     unreadable). Each one must land on a *terminal* state — an earlier version let a rejected
     promise escape, which left the spinner up forever with nothing in the logs. */
  const load = useCallback(async () => {
    setState('loading');
    setError(null);

    if (!canImportContacts()) {
      setState('denied');
      return;
    }
    try {
      const granted = (await checkContactsPermission()) || (await requestContactsPermission());
      if (!granted) {
        setState('denied');
        return;
      }
      setContacts(await readContacts());
      setState('ready');
    } catch (err) {
      console.error('contacts: import failed', err);
      setError(err instanceof Error ? err.message : String(err));
      setState('failed');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  /** Contacts as they'd be imported — i.e. with any review-step rename applied. */
  const candidates = useMemo<ContactCandidate[]>(
    () =>
      contacts.map((contact) =>
        renames[contact.contactId]
          ? { ...contact, name: renames[contact.contactId] }
          : contact,
      ),
    [contacts, renames],
  );

  const importedContactIds = useMemo(
    () => new Set(people.map((person) => person.contactId).filter(Boolean) as string[]),
    [people],
  );

  const visible = useMemo(
    () => candidates.filter((c) => !query || fuzzyIncludes(c.name, query)),
    [candidates, query],
  );

  const selectedCandidates = useMemo(
    () => candidates.filter((c) => selected.has(c.contactId)),
    [candidates, selected],
  );

  // Recomputed on every rename, so fixing a name clears its conflict live.
  const conflicts = useMemo(
    () => detectConflicts(selectedCandidates, people),
    [selectedCandidates, people],
  );

  const conflicted = selectedCandidates.filter((c) => conflicts.has(c.contactId));
  const clean = selectedCandidates.length - conflicted.length;

  /** A row counts as resolved once it has an explicit choice, or a default (re-imports only). */
  const resolutionFor = (contactId: string): Resolution | null =>
    resolutions[contactId] ?? defaultResolution(conflicts.get(contactId));
  const unresolved = conflicted.filter((c) => resolutionFor(c.contactId) === null);

  const toggle = (contactId: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(contactId)) next.delete(contactId);
      else next.add(contactId);
      return next;
    });

  const runImport = async () => {
    setImporting(true);
    try {
      const items: ImportItem[] = selectedCandidates.map((candidate) => ({
        candidate,
        resolution: resolutionFor(candidate.contactId) ?? { action: 'create' },
      }));
      const { created, merged } = await importPeople(items);
      toast.success(t('import.done', { created, merged }));
      void navigate('/people');
    } catch {
      toast.error(t('errors.unknown'));
      setImporting(false);
    }
  };

  const backButton = (
    <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => void navigate('/people')}>
      <ArrowLeft className="size-4" />
      {t('common.back')}
    </Button>
  );

  // Reading a large address book takes a moment; keep the page chrome so it never looks hung,
  // and stay inside PageContainer so the loading view can't grow past the viewport.
  if (state === 'loading') {
    return (
      <PageContainer>
        <PageHeader title={t('import.title')} actions={backButton} />
        <div className="flex flex-col items-center justify-center gap-3 py-20">
          <Spinner className="size-7" />
          <p className="text-sm text-muted-foreground">{t('import.loading')}</p>
        </div>
      </PageContainer>
    );
  }

  if (state === 'denied' || state === 'failed') {
    const failed = state === 'failed';
    return (
      <PageContainer>
        <PageHeader title={t('import.title')} actions={backButton} />
        <EmptyState
          icon={failed ? TriangleAlert : ContactRound}
          title={failed ? t('import.failed') : t('import.noPermission')}
          description={
            failed
              ? (error ?? t('errors.unknown'))
              : canImportContacts()
                ? t('import.noPermissionDescription')
                : t('import.nativeOnly')
          }
        >
          {canImportContacts() && (
            <Button variant="outline" size="sm" className="mt-2" onClick={() => void load()}>
              {t('common.retry')}
            </Button>
          )}
        </EmptyState>
      </PageContainer>
    );
  }

  if (step === 'review') {
    return (
      <PageContainer>
        <PageHeader
          title={t('import.reviewTitle')}
          actions={
            <Button variant="ghost" size="sm" className="gap-1.5" onClick={() => setStep('select')}>
              <ArrowLeft className="size-4" />
              {t('common.back')}
            </Button>
          }
        />

        <div className="mb-4 flex flex-col gap-1 rounded-xl border bg-card p-3 text-sm">
          <p>{t('import.summaryNew', { count: clean })}</p>
          {conflicted.length > 0 && (
            <p className="text-muted-foreground">
              {t('import.summaryConflicts', { count: conflicted.length })}
            </p>
          )}
        </div>

        {conflicted.length > 0 && (
          <ul className="mb-4 flex flex-col gap-2">
            {conflicted.map((candidate) => (
              <ConflictRow
                key={candidate.contactId}
                candidate={candidate}
                matches={conflicts.get(candidate.contactId)!}
                resolution={resolutionFor(candidate.contactId)}
                onResolve={(resolution) =>
                  setResolutions((prev) => ({ ...prev, [candidate.contactId]: resolution }))
                }
                onRename={(name) =>
                  setRenames((prev) => ({ ...prev, [candidate.contactId]: name }))
                }
              />
            ))}
          </ul>
        )}

        <div className="sticky bottom-0 flex flex-col gap-2 border-t bg-background/95 py-3 backdrop-blur">
          {unresolved.length > 0 && (
            <p className="text-center text-xs text-muted-foreground">
              {t('import.resolveFirst', { count: unresolved.length })}
            </p>
          )}
          <Button
            className="w-full gap-1.5"
            disabled={unresolved.length > 0 || importing || selectedCandidates.length === 0}
            onClick={() => void runImport()}
          >
            {importing && <Spinner className="size-3.5" />}
            {t('import.confirm', { count: selectedCandidates.length })}
          </Button>
        </div>
      </PageContainer>
    );
  }

  return (
    <PageContainer>
      <PageHeader title={t('import.title')} actions={backButton} />

      {contacts.length === 0 ? (
        <EmptyState icon={ContactRound} title={t('import.noContacts')} />
      ) : (
        <>
          <div className="mb-3 flex flex-col gap-2">
            <div className="relative">
              <Search className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t('common.search')}
                className="pl-9"
              />
            </div>
            <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
              <span>{t('import.selectedCount', { count: selected.size })}</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs"
                onClick={() =>
                  setSelected((prev) =>
                    prev.size === visible.length
                      ? new Set()
                      : new Set(visible.map((c) => c.contactId)),
                  )
                }
              >
                {selected.size === visible.length ? t('import.selectNone') : t('import.selectAll')}
              </Button>
            </div>
          </div>

          <ul className="flex flex-col gap-2 pb-24">
            {visible.map((candidate) => (
              <ContactRow
                key={candidate.contactId}
                candidate={candidate}
                checked={selected.has(candidate.contactId)}
                alreadyImported={importedContactIds.has(candidate.contactId)}
                onToggle={() => toggle(candidate.contactId)}
              />
            ))}
          </ul>

          <div className="sticky bottom-0 border-t bg-background/95 py-3 backdrop-blur">
            <Button
              className="w-full"
              disabled={selected.size === 0}
              onClick={() => setStep('review')}
            >
              {t('import.continue', { count: selected.size })}
            </Button>
          </div>
        </>
      )}
    </PageContainer>
  );
}
