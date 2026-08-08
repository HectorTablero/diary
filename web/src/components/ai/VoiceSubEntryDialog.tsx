import { DEFAULT_SUB_ENTRY_DEPTH } from '@diary/shared';
import { Square, X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSettings } from '@/api/hooks';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { useVoiceToSuggestions } from '@/hooks/useVoiceToSuggestions';
import { SuggestionReviewDialog } from './SuggestionReviewDialog';

interface VoiceSubEntryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dateKey: string;
  /** The entry the suggestions become children of. */
  parentId: string;
  /** That entry's ancestors' contents plus its own, outermost first — so its length is the depth
      the suggestions land at, which is exactly what the server spends from the nesting budget. */
  parentPath: string[];
}

/**
 * Voice capture for sub-entries, opened from an entry's ⋯ menu. Recording starts by itself: the
 * user already committed to it by picking the menu item, and making them tap a second button
 * inside the dialog they just opened only loses them the first second of what they wanted to say.
 *
 * The recorder and the review dialog are siblings rather than nested, so the recorder is gone by
 * the time the suggestions are on screen — a review modal inside a recording modal would trap
 * focus in the wrong layer and leave a dead backdrop behind it.
 */
export function VoiceSubEntryDialog({
  open,
  onOpenChange,
  dateKey,
  parentId,
  parentPath,
}: VoiceSubEntryDialogProps) {
  const { t } = useTranslation();
  const { data: settings } = useSettings();
  const { phase, recorder, start, suggestions, clearSuggestions } = useVoiceToSuggestions({
    dateKey,
    parentPath,
    // A take that yields nothing (silence, a denied mic, an upstream error) has already toasted;
    // closing here means the user is never left staring at a dialog with nothing left to do.
    onSettled: () => onOpenChange(false),
  });

  // Guarded so React 19 StrictMode's double-effect doesn't open the mic twice.
  const startedRef = useRef(false);
  useEffect(() => {
    if (!open) {
      startedRef.current = false;
      return;
    }
    if (startedRef.current) return;
    startedRef.current = true;
    void start().then((ok) => {
      if (!ok) onOpenChange(false); // permission denied or no mic — the hook already toasted
    });
    // `start` is recreated whenever the recorder re-renders (every timer tick); depending on it
    // would re-run this on every tick. The ref guard is what actually keeps this to one call.
  }, [open]);

  const parentContent = parentPath[parentPath.length - 1] ?? '';
  const seconds = Math.floor(recorder.elapsedMs / 1000);
  const mm = String(Math.floor(seconds / 60)).padStart(2, '0');
  const ss = String(seconds % 60).padStart(2, '0');

  const close = () => {
    recorder.cancel(); // discards the take; a no-op once the recorder already stopped
    onOpenChange(false);
  };

  return (
    <>
      {/* Not dismissable once the take is being transcribed/interpreted: the recording is already
          spent, and closing here would throw away a result that is seconds from arriving. */}
      <Dialog
        open={open && suggestions === null}
        onOpenChange={(next) => !next && phase === 'idle' && close()}
      >
        {/* The recorder has its own cancel/stop pair, and during processing there is nothing to
            close — so no corner ✕ that either duplicates a button or does nothing. */}
        <DialogContent className="sm:max-w-sm" showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('ai.subEntryTitle')}</DialogTitle>
            <DialogDescription>
              {t('ai.subEntryDescription', { parent: parentContent })}
            </DialogDescription>
          </DialogHeader>
          {phase === 'idle' ? (
            <div className="flex items-center justify-center gap-4 py-4">
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 text-muted-foreground"
                onClick={close}
                aria-label={t('ai.cancelRecording')}
              >
                <X className="size-5" />
              </Button>
              <span className="font-mono text-2xl tabular-nums text-destructive">
                {mm}:{ss}
              </span>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="size-10 animate-pulse text-destructive"
                onClick={() => recorder.stop()}
                disabled={!recorder.recording}
                aria-label={t('ai.stopRecording')}
              >
                <Square className="size-5 fill-current" />
              </Button>
            </div>
          ) : (
            <div className="flex items-center justify-center gap-2 py-6 text-sm text-muted-foreground">
              <Spinner className="size-4" />
              {t(phase === 'transcribing' ? 'ai.transcribing' : 'ai.thinking')}
            </div>
          )}
        </DialogContent>
      </Dialog>

      <SuggestionReviewDialog
        open={suggestions !== null}
        entries={suggestions ?? []}
        dateKey={dateKey}
        parentId={parentId}
        // Roots of this draft are created at parentPath.length, so the tree the user can drag
        // together in the review dialog has exactly the depth the server was willing to generate.
        maxDepth={(settings?.maxSubEntryDepth ?? DEFAULT_SUB_ENTRY_DEPTH) - parentPath.length}
        parentContent={parentContent}
        onOpenChange={(next) => {
          if (next) return;
          clearSuggestions();
          onOpenChange(false);
        }}
      />
    </>
  );
}
