import type { SuggestedEntryNode } from '@diary/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { useAiSuggestions, useSettings } from '@/api/hooks';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { ApiError } from '@/lib/apiClient';
import { transcribeAudio } from '@/lib/groq';

/* The whole voice-to-entries pipeline in one place: record → transcribe with Groq Whisper (the
   user's own key) → ask the server to turn the transcript into entry suggestions → hand them back
   for review. Both entry points share it — the composer's inline mic button and the ⋯ menu's
   sub-entry recorder — so the two only differ in how they render the phases, never in what they do.

   `parentPath` is what makes a recording a *sub*-entry one: the ancestor contents, outermost
   first. The server derives the remaining nesting depth from its length and quotes its contents to
   the model as context, so the caller never has to reason about depth arithmetic itself. */

export type VoicePhase = 'idle' | 'transcribing' | 'thinking';

interface UseVoiceToSuggestionsOptions {
  dateKey: string;
  /** Contents of the entries these suggestions will be nested under; empty = top-level. */
  parentPath?: string[];
  /** Called once a take is fully resolved (success, failure or empty) and the UI is idle again. */
  onSettled?: () => void;
}

export function useVoiceToSuggestions({
  dateKey,
  parentPath,
  onSettled,
}: UseVoiceToSuggestionsOptions) {
  const { t, i18n } = useTranslation();
  const { data: settings } = useSettings();
  const aiSuggestions = useAiSuggestions();
  const [phase, setPhase] = useState<VoicePhase>('idle');
  const [suggestions, setSuggestions] = useState<SuggestedEntryNode[] | null>(null);

  const handleStop = async (blob: Blob | null) => {
    const apiKey = settings?.groqApiKey?.trim();
    if (!blob || !apiKey) {
      setPhase('idle');
      onSettled?.();
      return;
    }
    setPhase('transcribing');
    try {
      const transcript = await transcribeAudio(apiKey, blob);
      if (!transcript) {
        toast.error(t('ai.empty'));
        setPhase('idle');
        onSettled?.();
        return;
      }
      setPhase('thinking');
      const { entries } = await aiSuggestions.mutateAsync({
        transcript,
        dateKey,
        // Region subtags carry no meaning for the model, and hardcoding a two-language
        // ternary here silently mislabels every locale added since.
        language: i18n.language.split('-')[0],
        parentPath,
      });
      if (!entries.length) {
        toast.error(t('ai.empty'));
        setPhase('idle');
        onSettled?.();
        return;
      }
      setSuggestions(entries);
      setPhase('idle');
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
      setPhase('idle');
      onSettled?.();
    }
  };

  const recorder = useVoiceRecorder({ onStop: (blob) => void handleStop(blob) });

  /** Resolves once the mic is live; rejections are surfaced as a toast, never thrown at callers. */
  const start = useCallback(async (): Promise<boolean> => {
    try {
      await recorder.start();
      return true;
    } catch (err) {
      toast.error(t(err instanceof ApiError ? err.code : 'errors.unknown'));
      return false;
    }
  }, [recorder, t]);

  const clearSuggestions = useCallback(() => setSuggestions(null), []);

  return { phase, recorder, start, suggestions, clearSuggestions };
}
