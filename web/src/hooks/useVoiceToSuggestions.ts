import type { SuggestedEntryNode } from '@diary/shared';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useAiSuggestions, useSettings } from '@/api/hooks';
import { useVoiceRecorder } from '@/hooks/useVoiceRecorder';
import { notifyError } from '@/lib/notify';
import { ApiError } from '@/lib/apiClient';
import { transcribeAudio } from '@/lib/transcribe';

/* The whole voice-to-entries pipeline in one place: record → send the audio to our API, which
   transcribes it with the user's own Groq key → ask it to turn the transcript into entry
   suggestions → hand them back for review. Both entry points share it — the composer's inline mic
   button and the ⋯ menu's sub-entry recorder — so the two only differ in how they render the
   phases, never in what they do.

   `parentPath` is what makes a recording a *sub*-entry one: the ancestor contents, outermost
   first. The server derives the remaining nesting depth from its length and quotes its contents to
   the model as context, so the caller never has to reason about depth arithmetic itself. */

export type VoicePhase = 'idle' | 'transcribing' | 'thinking';

/** A take that was transcribed but produced no entries — kept so the words aren't lost. */
export interface TranscriptFailure {
  transcript: string;
  /** Translated reason when the suggestions call failed; absent when it found nothing. */
  error?: string;
}

interface UseVoiceToSuggestionsOptions {
  dateKey: string;
  /** Contents of the entries these suggestions will be nested under; empty = top-level. */
  parentPath?: string[];
  /** Called once a take is fully resolved (success, failure or empty) and the UI is idle again —
      for a transcript that yielded no entries, once its dialog has been dismissed. */
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
  const [failure, setFailure] = useState<TranscriptFailure | null>(null);

  const handleStop = async (blob: Blob | null) => {
    if (!blob || !settings?.hasGroqKey) {
      setPhase('idle');
      onSettled?.();
      return;
    }
    setPhase('transcribing');
    let transcript = '';
    try {
      transcript = await transcribeAudio(blob);
      if (!transcript) {
        notifyError(t('ai.empty'));
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
      if (entries.length) setSuggestions(entries);
      else setFailure({ transcript });
      setPhase('idle');
    } catch (err) {
      const error = t(err instanceof ApiError ? err.code : 'errors.unknown');
      setPhase('idle');
      // Transcribed but not interpreted: show the words rather than dropping them with a toast.
      if (transcript) {
        setFailure({ transcript, error });
        return;
      }
      notifyError(error);
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
      notifyError(t(err instanceof ApiError ? err.code : 'errors.unknown'));
      return false;
    }
  }, [recorder, t]);

  const clearSuggestions = useCallback(() => setSuggestions(null), []);
  const clearFailure = () => {
    setFailure(null);
    onSettled?.();
  };

  return { phase, recorder, start, suggestions, clearSuggestions, failure, clearFailure };
}
