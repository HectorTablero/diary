import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import type { TranscriptFailure } from '@/hooks/useVoiceToSuggestions';

/** Shown when a take was transcribed but no entries came out of it, so what the user said is
    still on screen to copy instead of being lost with a toast. */
export function TranscriptFailureDialog({
  failure,
  onClose,
}: {
  failure: TranscriptFailure | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Dialog open={failure !== null} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{t('ai.noEntriesTitle')}</DialogTitle>
          <DialogDescription>
            {failure?.error
              ? t('ai.noEntriesError', { reason: failure.error })
              : t('ai.noEntriesEmpty')}
          </DialogDescription>
        </DialogHeader>
        <p className="max-h-64 overflow-y-auto rounded-lg border bg-muted p-3 text-sm whitespace-pre-wrap select-text">
          {failure?.transcript}
        </p>
        <DialogFooter>
          <Button onClick={onClose}>{t('common.close')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
