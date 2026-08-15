import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { captureError } from '@/lib/telemetry';
import { cn } from '@/lib/utils';
import { ensurePluginLocales } from './i18n';
import { findPlugin } from './registry';
import type { PluginOnboardingStep } from './types';

/**
 * A plugin's own guided tour — the dialog behind `PluginModule.onboardingSteps`.
 *
 * ## Why this is not the app's OnboardingFlow, reused
 *
 * It borrows that dialog's *shape* on purpose — full-bleed, a titled step, dot progress, Back/Next
 * — because a second kind of tour with a different feel would read as a different feature bolted
 * on rather than as more of the same app. But it is driven separately rather than sharing the
 * component, for three reasons that all come down to this one opening on its own schedule:
 * OnboardingFlow is gated by a single account-wide "have they seen it" flag and runs once, at
 * signup, over a fixed set of steps decided at build time; this opens any number of times, from a
 * button in Settings, over one plugin's steps, loaded from that plugin's own chunk — which a
 * first-run tour must never touch (rule 4 in registry.ts: no plugin page may be warmed for every
 * visitor). Threading a per-plugin, load-on-demand, replay-anytime step list through the component
 * built for a fixed once-only sequence would have complicated both without benefit to either.
 *
 * ## Why there is no drag-to-swipe
 *
 * OnboardingFlow's panels are draggable horizontally, with a click-vs-drag guard because a swipe
 * starting over a control still fires that control's click on release. A plugin's steps can hold a
 * *second* horizontal drag surface of their own — the habit tracker's rating slider is exactly
 * that — and a panel-level pan gesture layered over a control-level one is a fight over the same
 * pointer, not a bug that guard could paper over. Back and Next only.
 */
export function PluginOnboarding({ pluginId, onDone }: { pluginId: string; onDone: () => void }) {
  const { t, i18n } = useTranslation();
  const [steps, setSteps] = useState<readonly PluginOnboardingStep[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [index, setIndex] = useState(0);
  const [direction, setDirection] = useState(1);

  useEffect(() => {
    const manifest = findPlugin(pluginId);
    if (!manifest) {
      setFailed(true);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const [module] = await Promise.all([manifest.load(), ensurePluginLocales(pluginId)]);
        if (cancelled) return;
        setSteps(module.default.onboardingSteps ?? []);
      } catch (err) {
        captureError(err, { scope: 'plugin.onboarding', plugin: pluginId });
        if (!cancelled) setFailed(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [pluginId, i18n.language]);

  /* Nothing to show — a chunk that failed to load, or a manifest that declared the surface but
     shipped no steps. Closed rather than left open on an empty dialog; an effect because calling
     `onDone` straight from the render that discovers this would update the parent (which owns
     whether this component is mounted at all) while this one is still committing. */
  const empty = failed || steps?.length === 0;
  useEffect(() => {
    if (empty) onDone();
  }, [empty, onDone]);

  /* Same reasoning as OnboardingFlow's own copy of this ref: a callback ref rather than an effect
     on `index`, so focus lands the instant the new heading mounts rather than a tick later once
     `mode="wait"` has finished animating the previous one out. Declared unconditionally, above the
     early return below — React hooks cannot follow a branch that skips them. */
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);

  /* See OnboardingFlow's own note on `data-fullbleed`: this dialog is fixed and inset-0, and
     without the attribute it comes up a scrollbar's width short of the right edge whenever the page
     behind it (Settings) had one. */
  useEffect(() => {
    document.documentElement.setAttribute('data-fullbleed', '');
    return () => document.documentElement.removeAttribute('data-fullbleed');
  }, []);

  if (empty) return null;

  const loading = steps === null;
  const step = steps?.[index];
  const isLast = steps !== null && index === steps.length - 1;

  const go = (delta: number) => {
    if (!steps) return;
    const next = index + delta;
    if (next < 0) return;
    if (next >= steps.length) {
      onDone();
      return;
    }
    setDirection(delta);
    setIndex(next);
  };

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (index === 0) onDone();
          else go(-1);
        }}
        onInteractOutside={(event) => event.preventDefault()}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (loading) return;
          if (event.key === 'ArrowRight') go(1);
          if (event.key === 'ArrowLeft') go(-1);
        }}
        className="inset-0 top-0 left-0 grid h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none p-0 pt-[var(--inset-top)] pb-[var(--inset-bottom)] sm:max-w-none"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          {!loading && (
            <p className="sr-only" role="status">
              {t('onboarding.progress', { current: index + 1, total: steps.length })}
            </p>
          )}
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onDone}>
            {t('common.close')}
          </Button>
        </div>

        <div className="min-h-0 overflow-y-auto">
          {loading || !step ? (
            <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pt-2 pb-8">
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-72" />
              <Skeleton className="mt-2 h-32 w-full" />
            </div>
          ) : (
            <AnimatePresence mode="wait" initial={false} custom={direction}>
              <motion.div
                key={step.id}
                custom={direction}
                initial={{ opacity: 0, x: direction * 24 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0, x: direction * -24 }}
                transition={{ duration: 0.18 }}
                className="mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-2 pb-8 lg:max-w-3xl"
              >
                <div className="mx-auto flex w-full flex-col gap-1.5">
                  <DialogTitle ref={focusHeading} tabIndex={-1} className="text-lg outline-none">
                    {t(`plugins.${pluginId}.onboarding.${step.id}.title`)}
                  </DialogTitle>
                  <DialogDescription>
                    {t(`plugins.${pluginId}.onboarding.${step.id}.lede`)}
                  </DialogDescription>
                </div>
                <step.Component />
              </motion.div>
            </AnimatePresence>
          )}
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/50 px-4 py-3">
          <Button
            variant="ghost"
            onClick={() => go(-1)}
            disabled={loading}
            className={cn('min-h-11', index === 0 && 'invisible')}
          >
            {t('common.back')}
          </Button>
          <div aria-hidden className="flex items-center gap-1.5">
            {(steps ?? []).map((dot, i) => (
              <span
                key={dot.id}
                className={cn(
                  'size-1.5 rounded-full transition-colors',
                  i === index ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
              />
            ))}
          </div>
          <Button onClick={() => go(1)} disabled={loading} className="min-h-11">
            {isLast ? t('common.close') : t('onboarding.next')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
