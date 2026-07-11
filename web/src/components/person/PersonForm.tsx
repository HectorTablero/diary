import type { PersonDto, TagDto } from '@diary/shared';
import { Hash } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import {
  useCreatePerson,
  useCreateTag,
  useSettings,
  useTags,
  useUpdatePerson,
} from '@/api/hooks';
import { TagChip } from '@/components/entry/chips';
import { EntityPicker } from '@/components/entry/EntityPicker';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/apiClient';

interface PersonFormProps {
  person?: PersonDto | null;
  onDone: () => void;
}

export function PersonForm({ person = null, onDone }: PersonFormProps) {
  const { t } = useTranslation();
  const { data: allTags = [] } = useTags();
  const { data: settings } = useSettings();
  const createTag = useCreateTag();
  const createPerson = useCreatePerson();
  const updatePerson = useUpdatePerson();

  const [name, setName] = useState(person?.name ?? '');
  const [notes, setNotes] = useState(person?.notes ?? '');
  const [tags, setTags] = useState<TagDto[]>(person?.tags ?? []);
  const [checkupEnabled, setCheckupEnabled] = useState(person?.checkupIntervalDays != null);
  const [checkupIntervalDays, setCheckupIntervalDays] = useState(person?.checkupIntervalDays ?? 30);
  // For new people, inherit the default checkup interval once settings have loaded.
  const [defaultsApplied, setDefaultsApplied] = useState(person !== null);

  useEffect(() => {
    if (defaultsApplied || !settings) return;
    setCheckupEnabled(settings.defaultCheckupIntervalDays != null);
    setCheckupIntervalDays(settings.defaultCheckupIntervalDays ?? 30);
    setDefaultsApplied(true);
  }, [defaultsApplied, settings]);

  const pending = createPerson.isPending || updatePerson.isPending;

  const toggleTag = (id: string) => {
    const tag = allTags.find((tg) => tg.id === id);
    if (!tag) return;
    setTags((prev) =>
      prev.some((tg) => tg.id === id) ? prev.filter((tg) => tg.id !== id) : [...prev, tag],
    );
  };

  const submit = async () => {
    if (!name.trim() || pending) return;
    const input = {
      name: name.trim(),
      notes,
      tags: tags.map((tag) => tag.id),
      checkupIntervalDays: checkupEnabled
        ? Math.min(3650, Math.max(1, Math.round(checkupIntervalDays) || 1))
        : null,
    };
    try {
      if (person) await updatePerson.mutateAsync({ id: person.id, input });
      else await createPerson.mutateAsync(input);
      toast.success(t('people.personSaved'));
      onDone();
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-name">{t('people.name')}</Label>
        <Input
          id="person-name"
          value={name}
          autoFocus
          placeholder={t('people.namePlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label>{t('people.tags')}</Label>
        <p className="text-xs text-muted-foreground">{t('people.tagsDescription')}</p>
        <div className="flex flex-wrap items-center gap-1.5">
          {tags.map((tag) => (
            <TagChip key={tag.id} tag={tag} onRemove={() => toggleTag(tag.id)} />
          ))}
          <EntityPicker
            trigger={
              <Button variant="outline" size="sm" className="h-6 gap-1 px-2 text-xs">
                <Hash className="size-3" />
                {t('common.add')}
              </Button>
            }
            items={allTags.map((tag) => ({ id: tag.id, label: tag.name, color: tag.color }))}
            selectedIds={tags.map((tag) => tag.id)}
            onToggle={toggleTag}
            onCreate={(tagName) =>
              void createTag
                .mutateAsync({ name: tagName })
                .then((tag) => setTags((prev) => [...prev, tag]))
                .catch((err) => toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown')))
            }
            placeholder={t('tags.namePlaceholder')}
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor="person-checkup">{t('people.checkupReminders')}</Label>
          <Switch id="person-checkup" checked={checkupEnabled} onCheckedChange={setCheckupEnabled} />
        </div>
        <p className="text-xs text-muted-foreground">{t('people.checkupRemindersDescription')}</p>
        {checkupEnabled && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">{t('people.checkupEvery')}</span>
            <Input
              type="number"
              min={1}
              max={3650}
              step={1}
              value={checkupIntervalDays}
              onChange={(e) => setCheckupIntervalDays(e.target.valueAsNumber)}
              className="w-20"
            />
            <span className="text-xs text-muted-foreground">{t('settings.memories.days')}</span>
          </div>
        )}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="person-notes">
          {t('people.notes')}{' '}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Textarea
          id="person-notes"
          value={notes}
          rows={3}
          placeholder={t('people.notesPlaceholder')}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} disabled={!name.trim() || pending}>
          {pending && <Spinner className="size-3.5" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
