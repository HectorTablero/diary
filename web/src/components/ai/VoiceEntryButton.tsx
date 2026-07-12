import type { SuggestedEntryNode } from '@diary/shared';
import { Mic, Square, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAiSuggestions, useSettings } from '@/api/hooks';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { ApiError } from '@/lib/apiClient';
import { transcribeAudio } from '@/lib/groq';
import { SuggestionReviewDialog } from './SuggestionReviewDialog';

type Phase = 'idle' | 'transcribing' | 'thinking';

/** Mic button in the entry composer: record → transcribe with Groq Whisper (the
    user's own key) → ask the server to turn the transcript into entry suggestions
    → let the user review them before anything is actually created. */
export function VoiceEntryButton({ dateKey }: { dateKey: string }) {
  const { t, i18n } = useTranslation();
  const { data: settings } = useSettings();
  const aiSuggestions = useAiSuggestions();
  const [phase, setPhase] = useState<Phase>('idle');
  const [suggestions, setSuggestions] = useState<SuggestedEntryNode[] | null>(null);

  const handleStop = async (blob: Blob | null) => {
    const apiKey = settings?.groqApiKey?.trim();
    if (!blob || !apiKey) {
      setPhase('idle');
      return;
    }
    setPhase('transcribing');
    try {
      const transcript = await transcribeAudio(apiKey, blob);
      if (!transcript) {
        toast.error(t('ai.empty'));
        setPhase('idle');
        return;
      }
      setPhase('thinking');
      const { entries } = await aiSuggestions.mutateAsync({
        transcript,
        dateKey,
        language: i18n.language.startsWith('en') ? 'en' : 'es',
      });
      if (!entries.length) {
        toast.error(t('ai.empty'));
        setPhase('idle');
        return;
      }
      setSuggestions(entries);
      setPhase('idle');
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
      setPhase('idle');
    }
  };

  const recorder = useVoiceRecorder({ onStop: (blob) => void handleStop(blob) });

  const startRecording = async () => {
    try {
      await recorder.start();
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
    }
  };

  const cancelRecording = () => recorder.cancel();

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
          onClick={cancelRecording}
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
        className="size-8 shrink-0 text-muted-foreground"
        onClick={() => void startRecording()}
        aria-label={t('ai.record')}
      >
        <Mic className="size-4" />
      </Button>
      <SuggestionReviewDialog
        open={suggestions !== null}
        entries={suggestions ?? []}
        dateKey={dateKey}
        onOpenChange={(open) => {
          if (!open) setSuggestions(null);
        }}
      />
    </>
  );
}
