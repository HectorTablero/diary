import {
  AtSign,
  BellOff,
  BellRing,
  Check,
  ChevronDown,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  Sparkles,
  Trash2,
  Undo2,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate, useParams } from 'react-router';
import { toast } from 'sonner';
import {
  useDeletePerson,
  useMarkCheckup,
  useMemories,
  usePerson,
  usePersonHistory,
  useSetSaid,
  useSettings,
  useTalkingPoints,
  useUpdatePerson,
} from '@/api/hooks';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { EmptyState } from '@/components/common/EmptyState';
import { FullScreenSpinner } from '@/components/common/Spinner';
import { TagChip } from '@/components/entry/chips';
import { PageContainer } from '@/components/layout/PageHeader';
import { EntryRow } from '@/components/person/EntryRow';
import { PersonForm } from '@/components/person/PersonForm';
import { TalkingPointItem } from '@/components/person/TalkingPointItem';
import { Button } from '@/components/ui/button';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

function TalkingPointsTab({ personId, personName }: { personId: string; personName: string }) {
  const { t } = useTranslation();
  const { data, isLoading } = useTalkingPoints(personId);
  const setSaid = useSetSaid();

  if (isLoading) {
    return (
      <div className="flex flex-col gap-3">
        <Skeleton className="h-14" />
        <Skeleton className="h-14" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {data && data.active.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {data.active.map((node) => (
            <TalkingPointItem key={node.id} node={node} personId={personId} personName={personName} />
          ))}
        </ul>
      ) : (
        <EmptyState
          icon={MessageCircle}
          title={t('people.noTalkingPoints')}
          description={t('people.noTalkingPointsDescription', { name: personName })}
        />
      )}

      {data && data.said.length > 0 && (
        <Collapsible>
          <CollapsibleTrigger asChild>
            <Button variant="ghost" size="sm" className="gap-1.5 text-muted-foreground">
              <ChevronDown className="size-4" />
              {t('people.alreadyTold')} ({data.said.length})
            </Button>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <ul className="mt-2 flex flex-col gap-2">
              {data.said.map((entry) => (
                <li key={entry.id} className="rounded-xl border border-dashed p-3">
                  <EntryRow entry={entry} crossedOut showChips={false}>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 gap-1 px-2 text-xs text-muted-foreground"
                      onClick={() => setSaid.mutate({ entryId: entry.id, personId, said: false })}
                    >
                      <Undo2 className="size-3.5" />
                      {t('people.unmarkSaid')}
                    </Button>
                  </EntryRow>
                </li>
              ))}
            </ul>
          </CollapsibleContent>
        </Collapsible>
      )}
    </div>
  );
}

function MemoriesTab({ personId, personName }: { personId: string; personName: string }) {
  const { t } = useTranslation();
  const { data: memories, isLoading } = useMemories(personId);
  const { data: settings } = useSettings();

  if (isLoading) return <Skeleton className="h-24" />;

  if (!memories || memories.length === 0) {
    return (
      <EmptyState
        icon={Sparkles}
        title={t('people.noMemories')}
        description={t('people.noMemoriesDescription', {
          name: personName,
          months: Math.round((settings?.memoryMinAgeDays ?? 180) / 30),
        })}
      />
    );
  }

  const byYear = new Map<string, typeof memories>();
  for (const entry of memories) {
    const year = entry.dateKey.slice(0, 4);
    byYear.set(year, [...(byYear.get(year) ?? []), entry]);
  }

  return (
    <div className="flex flex-col gap-6">
      {[...byYear.entries()].map(([year, entries]) => (
        <div key={year}>
          <h3 className="mb-2 text-sm font-semibold text-muted-foreground">{year}</h3>
          <ul className="flex flex-col gap-3 border-l-2 border-border/70 pl-4">
            {entries.map((entry) => (
              <li key={entry.id}>
                <EntryRow entry={entry} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function HistoryTab({ personId, personName }: { personId: string; personName: string }) {
  const { t } = useTranslation();
  const [page, setPage] = useState(1);
  const { data, isLoading } = usePersonHistory(personId, page);

  if (isLoading) return <Skeleton className="h-24" />;
  if (!data || data.results.length === 0) {
    return <EmptyState icon={AtSign} title={t('people.noHistory', { name: personName })} />;
  }

  const totalPages = Math.max(1, Math.ceil(data.total / data.limit));

  return (
    <div className="flex flex-col gap-3">
      <ul className="flex flex-col gap-3">
        {data.results.map((entry) => (
          <li key={entry.id}>
            <EntryRow entry={entry} />
          </li>
        ))}
      </ul>
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 text-sm">
          <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹
          </Button>
          <span className="text-muted-foreground">
            {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            ›
          </Button>
        </div>
      )}
    </div>
  );
}

const DAY_MS = 86_400_000;

export default function PersonProfilePage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { data: person, isLoading, isError } = usePerson(id ?? '');
  const deletePerson = useDeletePerson();
  const markCheckup = useMarkCheckup();
  const updatePerson = useUpdatePerson();
  const [editing, setEditing] = useState(false);
  const [confirmingDelete, setConfirmingDelete] = useState(false);

  if (!id) return <Navigate to="/people" replace />;
  if (isLoading) return <FullScreenSpinner />;
  if (isError || !person) return <Navigate to="/people" replace />;

  const checkupDue =
    person.checkupIntervalDays != null &&
    Date.now() - Date.parse(person.lastCheckupAt) >= person.checkupIntervalDays * DAY_MS;

  return (
    <PageContainer>
      <div className="mb-6 flex items-start gap-4">
        <div className="flex size-14 shrink-0 items-center justify-center rounded-full bg-primary/10 text-lg font-semibold text-primary uppercase">
          {person.name.slice(0, 2)}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-xl font-semibold tracking-tight">{person.name}</h1>
          {person.tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {person.tags.map((tag) => (
                <TagChip key={tag.id} tag={tag} />
              ))}
            </div>
          )}
          {person.notes && (
            <p className="mt-2 text-sm whitespace-pre-wrap text-muted-foreground">{person.notes}</p>
          )}
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="ghost" size="icon" className="text-muted-foreground">
              <MoreHorizontal className="size-4" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onClick={() => setEditing(true)}>
              <Pencil className="size-3.5" /> {t('people.editPerson')}
            </DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onClick={() => setConfirmingDelete(true)}>
              <Trash2 className="size-3.5" /> {t('people.deletePerson')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {checkupDue && (
        <div className="mb-6 flex flex-col gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <BellRing className="mt-0.5 size-4 shrink-0 text-amber-600 dark:text-amber-400" />
            <div>
              <p className="text-sm font-medium">{t('people.checkupDueTitle', { name: person.name })}</p>
              <p className="text-xs text-muted-foreground">{t('people.checkupDueDescription')}</p>
            </div>
          </div>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                markCheckup.mutate(person.id, {
                  onSuccess: () => toast.success(t('people.checkupMarkedDone')),
                  onError: () => toast.error(t('errors.unknown')),
                })
              }
            >
              <Check className="size-3.5" />
              {t('people.markCheckupDone')}
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              onClick={() =>
                updatePerson.mutate(
                  { id: person.id, input: { checkupIntervalDays: null } },
                  {
                    onSuccess: () => toast.success(t('people.checkupsDisabled')),
                    onError: () => toast.error(t('errors.unknown')),
                  },
                )
              }
            >
              <BellOff className="size-3.5" />
              {t('people.disableCheckups')}
            </Button>
          </div>
        </div>
      )}

      <Tabs defaultValue="talking-points">
        <TabsList className="mb-4 w-full sm:w-auto">
          <TabsTrigger value="talking-points" className="gap-1.5">
            <MessageCircle className="size-4" />
            {t('people.talkingPoints')}
          </TabsTrigger>
          <TabsTrigger value="memories" className="gap-1.5">
            <Sparkles className="size-4" />
            {t('people.memories')}
          </TabsTrigger>
          <TabsTrigger value="history" className="gap-1.5">
            <AtSign className="size-4" />
            {t('people.history')}
          </TabsTrigger>
        </TabsList>
        <TabsContent value="talking-points">
          <TalkingPointsTab personId={person.id} personName={person.name} />
        </TabsContent>
        <TabsContent value="memories">
          <MemoriesTab personId={person.id} personName={person.name} />
        </TabsContent>
        <TabsContent value="history">
          <HistoryTab personId={person.id} personName={person.name} />
        </TabsContent>
      </Tabs>

      <Dialog open={editing} onOpenChange={setEditing}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{t('people.editPerson')}</DialogTitle>
          </DialogHeader>
          {editing && <PersonForm person={person} onDone={() => setEditing(false)} />}
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={confirmingDelete}
        onOpenChange={setConfirmingDelete}
        title={t('people.deleteConfirmTitle', { name: person.name })}
        description={t('people.deleteConfirmDescription')}
        confirmLabel={t('common.delete')}
        onConfirm={() => {
          setConfirmingDelete(false);
          deletePerson.mutate(person.id, {
            onSuccess: () => {
              toast.success(t('people.personDeleted'));
              navigate('/people');
            },
            onError: () => toast.error(t('errors.unknown')),
          });
        }}
      />
    </PageContainer>
  );
}
