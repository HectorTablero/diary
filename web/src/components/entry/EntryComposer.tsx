import type { EntryDto, PersonRefDto, TagDto } from '@diary/shared';
import { AtSign, CalendarIcon, Hash, Send } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useCreateEntry, useCreateTag, usePeople, useTags, useUpdateEntry } from '@/api/hooks';
import { PersonChip, TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { ImportancePicker } from '@/components/entry/ImportanceDot';
import { TokenTextarea } from '@/components/entry/TokenTextarea';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Spinner } from '@/components/common/Spinner';
import { ApiError } from '@/lib/apiClient';

interface EntryComposerProps {
  dateKey: string;
  /** Existing entry when editing; null when creating. */
  entry?: EntryDto | null;
  parentId?: string | null;
  autoFocus?: boolean;
  showDateInput?: boolean;
  onDone?: () => void;
}

export function EntryComposer({
  dateKey,
  entry = null,
  parentId = null,
  autoFocus = false,
  showDateInput = false,
  onDone,
}: EntryComposerProps) {
  const { t } = useTranslation();
  const { data: allTags = [] } = useTags();
  const { data: allPeople = [] } = usePeople();
  const createTag = useCreateTag();
  const createEntry = useCreateEntry();
  const updateEntry = useUpdateEntry();

  const [content, setContent] = useState(entry?.content ?? '');
  const [importance, setImportance] = useState(entry?.importance ?? 3);
  const [date, setDate] = useState(entry?.dateKey ?? dateKey);
  const [tags, setTags] = useState<TagDto[]>(entry?.tags ?? []);
  const [people, setPeople] = useState<PersonRefDto[]>(entry?.people ?? []);
  const [saidTo, setSaidTo] = useState<string[]>(entry?.saidTo.map((s) => s.personId) ?? []);

  const isEditing = entry !== null;
  const pending = createEntry.isPending || updateEntry.isPending;

  const addPerson = (person: PersonRefDto) => {
    setPeople((prev) => (prev.some((p) => p.id === person.id) ? prev : [...prev, person]));
    // Auto-said: mentioning someone pre-marks the entry as said to them (untickable).
    if (!isEditing) setSaidTo((prev) => (prev.includes(person.id) ? prev : [...prev, person.id]));
  };

  const removePerson = (id: string) => {
    setPeople((prev) => prev.filter((p) => p.id !== id));
    setSaidTo((prev) => prev.filter((pid) => pid !== id));
  };

  const addTag = (tag: TagDto) =>
    setTags((prev) => (prev.some((tg) => tg.id === tag.id) ? prev : [...prev, tag]));

  const handleCreateTag = async (name: string): Promise<TagDto | null> => {
    try {
      const tag = await createTag.mutateAsync({ name });
      addTag(tag);
      return tag;
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
      return null;
    }
  };

  const reset = () => {
    setContent('');
    setImportance(3);
    setTags([]);
    setPeople([]);
    setSaidTo([]);
    setDate(dateKey);
  };

  const submit = async () => {
    if (!content.trim() || pending) return;
    const payload = {
      content: content.trim(),
      dateKey: date,
      importance,
      tags: tags.map((tag) => tag.id),
      people: people.map((p) => p.id),
      saidTo,
    };
    try {
      if (isEditing) {
        await updateEntry.mutateAsync({ id: entry.id, input: payload });
      } else {
        await createEntry.mutateAsync({ ...payload, parentId });
        reset();
      }
      toast.success(t('diary.entrySaved'));
      onDone?.();
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  const toggleSaid = (personId: string) =>
    setSaidTo((prev) =>
      prev.includes(personId) ? prev.filter((id) => id !== personId) : [...prev, personId],
    );

  return (
    <div className="flex flex-col gap-2.5">
      <TokenTextarea
        value={content}
        onChange={setContent}
        people={allPeople}
        tags={allTags}
        linkedPeople={people}
        linkedTags={tags}
        onSelectPerson={addPerson}
        onSelectTag={addTag}
        onCreateTag={handleCreateTag}
        placeholder={t('diary.composerPlaceholder')}
        autoFocus={autoFocus}
        onSubmit={submit}
      />

      {(tags.length > 0 || people.length > 0) && (
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} onRemove={() => setTags((p) => p.filter((tg) => tg.id !== tag.id))} />
          ))}
          {people.map((person) => (
            <PersonChip key={person.id} person={person} onRemove={() => removePerson(person.id)} />
          ))}
        </div>
      )}

      {people.length > 0 && (
        <div className="flex flex-col gap-1 rounded-lg bg-muted/50 px-3 py-2">
          <span className="text-xs font-medium text-muted-foreground">{t('diary.willBeSaidTo')}</span>
          <div className="flex flex-wrap gap-x-4 gap-y-1">
            {people.map((person) => (
              <label key={person.id} className="flex cursor-pointer items-center gap-1.5 text-sm">
                <Checkbox
                  checked={saidTo.includes(person.id)}
                  onCheckedChange={() => toggleSaid(person.id)}
                />
                {person.name}
              </label>
            ))}
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <ImportancePicker value={importance} onChange={setImportance} />
        <div className="mx-1 h-5 w-px bg-border" />
        <EntityPicker
          trigger={
            <Button variant="ghost" size="sm" className="h-7 gap-1 px-2 text-muted-foreground">
              <Hash className="size-3.5" />
              {t('diary.addTags')}
            </Button>
          }
          items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
          selectedIds={tags.map((tag) => tag.id)}
          onToggle={(id) => {
            const tag = allTags.find((tg) => tg.id === id);
            if (!tag) return;
            if (tags.some((tg) => tg.id === id)) setTags((p) => p.filter((tg) => tg.id !== id));
            else addTag(tag);
          }}
          onCreate={(name) => void handleCreateTag(name)}
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
          selectedIds={people.map((p) => p.id)}
          onToggle={(id) => {
            const person = allPeople.find((p) => p.id === id);
            if (!person) return;
            if (people.some((p) => p.id === id)) removePerson(id);
            else addPerson(person);
          }}
          placeholder={t('people.namePlaceholder')}
        />
        {showDateInput && (
          <label className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <CalendarIcon className="size-3.5" />
            <input
              type="date"
              value={date}
              onChange={(e) => e.target.value && setDate(e.target.value)}
              className="rounded-md border bg-transparent px-1.5 py-1 text-xs"
            />
          </label>
        )}
        <Button
          size="sm"
          className="ml-auto h-8 gap-1.5"
          onClick={submit}
          disabled={!content.trim() || pending}
        >
          {pending ? <Spinner className="size-3.5" /> : <Send className="size-3.5" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
