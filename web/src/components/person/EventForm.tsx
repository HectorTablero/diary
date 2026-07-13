import type { PersonEventDto } from '@diary/shared';
import { MAX_EVENT_TITLE_LENGTH, newObjectId } from '@diary/shared';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useSaveEvent } from '@/api/hooks';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/apiClient';
import { todayKey } from '@/lib/dates';

interface EventFormProps {
  personId: string;
  /** Omit to create a new event. */
  event?: PersonEventDto | null;
  onDone: () => void;
}

/** Create or edit an event. Plain useState like PersonForm — there's no form library in this app. */
export function EventForm({ personId, event = null, onDone }: EventFormProps) {
  const { t } = useTranslation();
  const saveEvent = useSaveEvent();

  const [title, setTitle] = useState(event?.title ?? '');
  const [startDate, setStartDate] = useState(event?.startDate ?? todayKey());
  const [endDate, setEndDate] = useState(event?.endDate ?? '');
  const [notes, setNotes] = useState(event?.notes ?? '');

  // An end date before the start would be rejected by the schema; catch it here instead.
  const endBeforeStart = endDate !== '' && endDate < startDate;
  const canSave = !!title.trim() && !!startDate && !endBeforeStart && !saveEvent.isPending;

  const submit = async () => {
    if (!canSave) return;
    try {
      await saveEvent.mutateAsync({
        personId,
        event: {
          // Client-generated on create, preserved on edit — an offline create keeps its identity.
          id: event?.id ?? newObjectId(),
          title: title.trim(),
          startDate,
          endDate: endDate || null,
          notes,
          askedAt: event?.askedAt ?? null,
          createdAt: event?.createdAt ?? new Date().toISOString(),
        },
      });
      toast.success(t('people.eventSaved'));
      onDone();
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-title">{t('people.eventTitle')}</Label>
        <Input
          id="event-title"
          value={title}
          autoFocus
          maxLength={MAX_EVENT_TITLE_LENGTH}
          placeholder={t('people.eventTitlePlaceholder')}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
        />
      </div>

      <div className="flex gap-2">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="event-start">{t('people.eventStart')}</Label>
          <Input
            id="event-start"
            type="date"
            value={startDate}
            className="w-full min-w-0"
            onChange={(e) => setStartDate(e.target.value)}
          />
        </div>
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <Label htmlFor="event-end">
            {t('people.eventEnd')}{' '}
            <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
          </Label>
          <Input
            id="event-end"
            type="date"
            value={endDate}
            min={startDate}
            aria-invalid={endBeforeStart}
            className="w-full min-w-0"
            onChange={(e) => setEndDate(e.target.value)}
          />
        </div>
      </div>
      <p className={'text-xs ' + (endBeforeStart ? 'text-destructive' : 'text-muted-foreground')}>
        {endBeforeStart ? t('people.eventEndBeforeStart') : t('people.eventEndHint')}
      </p>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-notes">
          {t('people.notes')}{' '}
          <span className="font-normal text-muted-foreground">({t('common.optional')})</span>
        </Label>
        <Textarea
          id="event-notes"
          value={notes}
          rows={3}
          placeholder={t('people.eventNotesPlaceholder')}
          onChange={(e) => setNotes(e.target.value)}
        />
      </div>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        <Button onClick={submit} disabled={!canSave}>
          {saveEvent.isPending && <Spinner className="size-3.5" />}
          {t('common.save')}
        </Button>
      </div>
    </div>
  );
}
