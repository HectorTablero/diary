import { Mic, Square, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { useVoiceToSuggestions } from '@/hooks/useVoiceToSuggestions';
import { cn } from '@/lib/utils';
import { SuggestionReviewDialog } from './SuggestionReviewDialog';

/** Mic button in the entry composer: records a take and hands the resulting suggestions to the
    review dialog (see useVoiceToSuggestions for the pipeline itself). Always top-level — the
    sub-entry flavour lives in VoiceSubEntryDialog, reached from an entry's ⋯ menu. `disabled`
    covers the "no live session" case: the suggestions call always needs a real authenticated
    request. */
export function VoiceEntryButton({ dateKey, disabled = false }: { dateKey: string; disabled?: boolean }) {
  const { t } = useTranslation();
  const { phase, recorder, start, suggestions, clearSuggestions } = useVoiceToSuggestions({ dateKey });

  const startRecording = () => {
    if (disabled) {
      toast.info(t('ai.signInRequiredForVoice'));
      return;
    }
    void start();
  };

  if (phase !== 'idle') {
    return (
      <Button type="button" variant="ghost" size="icon" className="size-8 shrink-0" disabled>
        <Spinner className="size-4" />
      </Button>
    );
  }

  if (recorder.recording) {
    const seconds = Math.floor(recorder.elapsedMs / 1000);
    const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
    const ss = String(seconds % 60).padStart(2, '0');
    return (
      <div className="flex items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 text-muted-foreground"
          onClick={() => recorder.cancel()}
          aria-label={t('ai.cancelRecording')}
        >
          <X className="size-4" />
        </Button>
        <span className="font-mono text-xs tabular-nums text-destructive">
          {mm}:{ss}
        </span>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="size-8 shrink-0 animate-pulse text-destructive"
          onClick={() => recorder.stop()}
          aria-label={t('ai.stopRecording')}
        >
          <Square className="size-4 fill-current" />
        </Button>
      </div>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className={cn('size-8 shrink-0 text-muted-foreground', disabled && 'opacity-50')}
        onClick={startRecording}
        aria-label={t('ai.record')}
      >
        <Mic className="size-4" />
      </Button>
      <SuggestionReviewDialog
        open={suggestions !== null}
        entries={suggestions ?? []}
        dateKey={dateKey}
        onOpenChange={(open) => {
          if (!open) clearSuggestions();
        }}
      />
    </>
  );
}
