import type { EntryCreateInput, PersonRefDto, SuggestedEntryNode, TagDto } from '@diary/shared';
import { newObjectId } from '@diary/shared';
import { AtSign, Hash, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateEntry, usePeople, useTags } from '@/api/hooks';
import { Spinner } from '@/components/common/Spinner';
import { PersonChip, TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { ImportancePicker } from '@/components/entry/ImportanceDot';
import { TokenTextarea } from '@/components/entry/TokenTextarea';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { ApiError } from '@/lib/apiClient';
import { cn } from '@/lib/utils';

interface DraftNode {
  /** Pre-generated so it can double as the eventual entry id (and its children's parentId). */
  id: string;
  content: string;
  importance: number;
  tags: TagDto[];
  people: PersonRefDto[];
  children: DraftNode[];
}

function buildDraft(
  nodes: SuggestedEntryNode[],
  tagsById: Map<string, TagDto>,
  peopleById: Map<string, PersonRefDto>,
): DraftNode[] {
  return nodes.map((node) => ({
    id: newObjectId(),
    content: node.content,
    importance: node.importance,
    tags: node.tags.flatMap((id) => tagsById.get(id) ?? []),
    people: node.people.flatMap((id) => peopleById.get(id) ?? []),
    children: buildDraft(node.children, tagsById, peopleById),
  }));
}

function countNodes(nodes: DraftNode[]): number {
  return nodes.reduce((sum, n) => sum + 1 + countNodes(n.children), 0);
}

function SuggestionNodeEditor({
  node,
  depth,
  allTags,
  allPeople,
  onChange,
  onRemove,
}: {
  node: DraftNode;
  depth: number;
  allTags: TagDto[];
  allPeople: PersonRefDto[];
  onChange: (id: string, patch: Partial<DraftNode>) => void;
  onRemove: (id: string) => void;
}) {
  const { t } = useTranslation();
  return (
    <div className={cn('flex flex-col gap-2', depth > 0 && 'ml-4 border-l border-border/70 pl-3')}>
      <div className="flex items-start gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <TokenTextarea
            value={node.content}
            onChange={(value) => onChange(node.id, { content: value })}
            people={allPeople}
            tags={allTags}
            linkedPeople={node.people}
            linkedTags={node.tags}
            onSelectPerson={(person) =>
              onChange(node.id, {
                people: node.people.some((p) => p.id === person.id) ? node.people : [...node.people, person],
              })
            }
            onSelectTag={(tag) =>
              onChange(node.id, {
                tags: node.tags.some((tg) => tg.id === tag.id) ? node.tags : [...node.tags, tag],
              })
            }
            // Suggestions only ever use existing tags at this stage; no inline creation here.
            onCreateTag={async () => null}
          />
          {(node.tags.length > 0 || node.people.length > 0) && (
            <div className="flex flex-wrap items-center gap-1.5">
              {node.tags.map((tag) => (
                <TagChip
                  key={tag.id}
                  tag={tag}
                  onRemove={() => onChange(node.id, { tags: node.tags.filter((tg) => tg.id !== tag.id) })}
                />
              ))}
              {node.people.map((person) => (
                <PersonChip
                  key={person.id}
                  person={person}
                  onRemove={() => onChange(node.id, { people: node.people.filter((p) => p.id !== person.id) })}
                />
              ))}
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <ImportancePicker
              value={node.importance}
              onChange={(importance) => onChange(node.id, { importance })}
            />
            <EntityPicker
              trigger={
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-muted-foreground">
                  <Hash className="size-3.5" />
                  {t('diary.addTags')}
                </Button>
              }
              items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
              selectedIds={node.tags.map((tg) => tg.id)}
              onToggle={(id) => {
                const tag = allTags.find((tg) => tg.id === id);
                if (!tag) return;
                onChange(node.id, {
                  tags: node.tags.some((tg) => tg.id === id)
                    ? node.tags.filter((tg) => tg.id !== id)
                    : [...node.tags, tag],
                });
              }}
              placeholder={t('tags.namePlaceholder')}
            />
            <EntityPicker
              trigger={
                <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-muted-foreground">
                  <AtSign className="size-3.5" />
                  {t('diary.addPeople')}
                </Button>
              }
              items={allPeople.map((p) => ({ id: p.id, label: p.name }))}
              selectedIds={node.people.map((p) => p.id)}
              onToggle={(id) => {
                const person = allPeople.find((p) => p.id === id);
                if (!person) return;
                onChange(node.id, {
                  people: node.people.some((p) => p.id === id)
                    ? node.people.filter((p) => p.id !== id)
                    : [...node.people, person],
                });
              }}
              placeholder={t('people.namePlaceholder')}
            />
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-7 shrink-0 text-muted-foreground"
          onClick={() => onRemove(node.id)}
          aria-label={t('ai.deletePoint')}
        >
          <Trash2 className="size-3.5" />
        </Button>
      </div>
      {node.children.map((child) => (
        <SuggestionNodeEditor
          key={child.id}
          node={child}
          depth={depth + 1}
          allTags={allTags}
          allPeople={allPeople}
          onChange={onChange}
          onRemove={onRemove}
        />
      ))}
    </div>
  );
}

interface SuggestionReviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: SuggestedEntryNode[];
  dateKey: string;
}

export function SuggestionReviewDialog({ open, onOpenChange, entries, dateKey }: SuggestionReviewDialogProps) {
  const { t } = useTranslation();
  const { data: allTags = [] } = useTags();
  const { data: allPeople = [] } = usePeople();
  const createEntry = useCreateEntry();
  const [draft, setDraft] = useState<DraftNode[]>([]);
  const [accepting, setAccepting] = useState(false);

  useEffect(() => {
    if (!open) return;
    const tagsById = new Map(allTags.map((tag) => [tag.id, tag] as const));
    const peopleById = new Map(allPeople.map((p) => [p.id, { id: p.id, name: p.name }] as const));
    setDraft(buildDraft(entries, tagsById, peopleById));
    // Rebuild only when the dialog opens with a fresh suggestion set, not on every keystroke.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const updateNode = (id: string, patch: Partial<DraftNode>): void => {
    const apply = (nodes: DraftNode[]): DraftNode[] =>
      nodes.map((n) => (n.id === id ? { ...n, ...patch } : { ...n, children: apply(n.children) }));
    setDraft((prev) => apply(prev));
  };

  const removeNode = (id: string): void => {
    const filterOut = (nodes: DraftNode[]): DraftNode[] =>
      nodes.filter((n) => n.id !== id).map((n) => ({ ...n, children: filterOut(n.children) }));
    setDraft((prev) => filterOut(prev));
  };

  const accept = async () => {
    setAccepting(true);
    let created = 0;
    try {
      // Strictly sequential, parent-first: the server rejects a child whose
      // parent doesn't exist yet, and the outbox replays in FIFO order anyway.
      const walk = async (nodes: DraftNode[], parentId: string | null): Promise<void> => {
        for (const node of nodes) {
          const content = node.content.trim();
          if (!content) continue; // skip nodes emptied during editing (subtree included)
          const payload: EntryCreateInput = {
            id: node.id,
            content,
            dateKey,
            importance: node.importance,
            tags: node.tags.map((tag) => tag.id),
            people: node.people.map((p) => p.id),
            parentId,
          };
          await createEntry.mutateAsync(payload);
          created += 1;
          await walk(node.children, node.id);
        }
      };
      await walk(draft, null);
      toast.success(t('ai.entriesCreated', { count: created }));
      onOpenChange(false);
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    } finally {
      setAccepting(false);
    }
  };

  const total = countNodes(draft);

  return (
    <Dialog open={open} onOpenChange={(next) => !accepting && onOpenChange(next)}>
      <DialogContent className="flex max-h-[85vh] flex-col sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('ai.reviewTitle')}</DialogTitle>
          <DialogDescription>{t('ai.reviewDescription')}</DialogDescription>
        </DialogHeader>
        <div className="-mx-1 flex-1 overflow-y-auto px-1">
          {draft.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">{t('ai.empty')}</p>
          ) : (
            <div className="flex flex-col gap-4">
              {draft.map((node) => (
                <SuggestionNodeEditor
                  key={node.id}
                  node={node}
                  depth={0}
                  allTags={allTags}
                  allPeople={allPeople}
                  onChange={updateNode}
                  onRemove={removeNode}
                />
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={accepting}>
            {t('ai.discard')}
          </Button>
          <Button onClick={() => void accept()} disabled={accepting || total === 0}>
            {accepting && <Spinner className="size-3.5" />}
            {t('ai.acceptAll', { count: total })}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
