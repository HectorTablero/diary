import { AnimatePresence, motion, type PanInfo } from 'framer-motion';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { isNative } from '@/lib/native';
import { cn } from '@/lib/utils';
import { ImportanceStep } from './steps/ImportanceStep';
import { LanguageStep } from './steps/LanguageStep';
import { PeopleStep } from './steps/PeopleStep';
import { PluginsStep } from './steps/PluginsStep';
import { RemindersStep } from './steps/RemindersStep';
import { ThreadsStep } from './steps/ThreadsStep';
import { WritingStep } from './steps/WritingStep';

interface Step {
  /** Also the i18n sub-namespace: `onboarding.<id>.title` and `.lede`. */
  id: string;
  Component: ComponentType;
}

/* Ordered as a sentence: which language, what an entry is, what the numbers on it mean, what the
   app does with them — then threads, then phone reminders (if native), and finally plugins. */
const WEB_STEPS: Step[] = [
  { id: 'language', Component: LanguageStep },
  { id: 'writing', Component: WritingStep },
  { id: 'importance', Component: ImportanceStep },
  { id: 'people', Component: PeopleStep },
  { id: 'threads', Component: ThreadsStep },
];

const NATIVE_STEPS: Step[] = [{ id: 'reminders', Component: RemindersStep }];

const FINAL_STEPS: Step[] = [{ id: 'plugins', Component: PluginsStep }];

export default function OnboardingFlow({ onDone }: { onDone: () => void }) {
  const { t } = useTranslation();
  const steps = useMemo(
    () =>
      isNative ? [...WEB_STEPS, ...NATIVE_STEPS, ...FINAL_STEPS] : [...WEB_STEPS, ...FINAL_STEPS],
    [],
  );
  const [index, setIndex] = useState(0);
  /* Which way the next panel slides in from. Kept in state rather than derived, because the exiting
     panel has to animate out the same way the entering one came in, and by the time it exits the
     index has already moved. */
  const [direction, setDirection] = useState(1);

  /**
   * Focus follows the step, so a screen reader announces the new title instead of leaving the
   * listener on a "Next" button whose page silently changed underneath it.
   *
   * A callback ref rather than an effect on `index`, and the difference is not stylistic: with
   * `mode="wait"` the outgoing panel animates away *before* the incoming one mounts, so an effect
   * firing on the index change would run while the new heading does not exist yet and focus
   * nothing at all. The ref fires exactly when the node attaches, which is the moment being waited
   * for. `useCallback([])` keeps it stable — an inline function would be a new ref every render,
   * detaching and reattaching the node, and the heading would steal focus back every time
   * something on the step changed (toggling the shapes switch, for one).
   */
  const focusHeading = useCallback((node: HTMLHeadingElement | null) => {
    node?.focus();
  }, []);

  const step = steps[index];
  const isLast = index === steps.length - 1;

  const go = (delta: number) => {
    const next = index + delta;
    if (next < 0) return;
    if (next >= steps.length) {
      onDone();
      return;
    }
    setDirection(delta);
    setIndex(next);
  };

  /**
   * Whether the gesture in progress turned out to be a drag, so the click it ends with can be
   * thrown away.
   *
   * A swipe that starts on top of a control is still a press *of that control* as far as the DOM is
   * concerned: the panel travels with the pointer, so the pointer never leaves the element it went
   * down on and a click fires on release. On the language step that meant swiping to the next screen
   * from anywhere over the list silently switched the app's language to whichever row the thumb
   * happened to start on — the tour changing a setting nobody chose.
   *
   * Reset on every pointer-down rather than only after a swallowed click, so a drag that ends
   * somewhere with no click at all cannot leave the flag set and eat an unrelated press later.
   */
  const dragged = useRef(false);

  /* Hands the tour the scrollbar gutter for as long as it is open. `scrollbar-gutter: stable` on
     <html> shrinks the initial containing block, so this dialog — fixed and inset-0 — comes up a
     scrollbar's width short of the right edge and its footer bar stops there too. The rule this
     switches on, and why giving the strip up is safe under a modal, is in index.css. */
  useEffect(() => {
    document.documentElement.setAttribute('data-fullbleed', '');
    return () => document.documentElement.removeAttribute('data-fullbleed');
  }, []);

  const onDragEnd = (_: unknown, info: PanInfo) => {
    const far = Math.abs(info.offset.x) > 60;
    const fast = Math.abs(info.velocity.x) > 400;
    if (!far && !fast) return;
    go(info.offset.x < 0 ? 1 : -1);
  };

  return (
    <Dialog open>
      <DialogContent
        showCloseButton={false}
        /* Escape steps back rather than closing, and only leaves from the first screen. This is the
           Android back button as much as it is a keyboard: App.tsx turns a hardware back press into
           a synthetic Escape on whatever dialog is open, so without preventDefault here, back on
           step 3 would dismiss the entire tour — invisible on the web, and the most likely bug in
           this component. */
        onEscapeKeyDown={(event) => {
          event.preventDefault();
          if (index === 0) onDone();
          else go(-1);
        }}
        // A tour is dismissed by finishing or skipping it, both of which are on screen. Clicking
        // the backdrop is not a third answer, and on a full-screen panel there is barely a backdrop.
        onInteractOutside={(event) => event.preventDefault()}
        // Prevented, not redirected: `focusHeading` has already put focus on the step title by the
        // time this fires, and Radix's default would pull it onto the Skip button.
        onOpenAutoFocus={(event) => event.preventDefault()}
        onKeyDown={(event) => {
          if (event.key === 'ArrowRight') go(1);
          if (event.key === 'ArrowLeft') go(-1);
        }}
        className="inset-0 top-0 left-0 grid h-dvh max-h-none w-full max-w-none translate-x-0 translate-y-0 grid-rows-[auto_1fr_auto] gap-0 overflow-hidden rounded-none p-0 pt-[var(--inset-top)] pb-[var(--inset-bottom)] sm:max-w-none"
      >
        <div className="flex items-center justify-between gap-2 px-4 pt-4">
          {/* The count as a sentence, for the people the dots below are not for. `role="status"`
              rather than an aria-label on the dots: it is one fact, and polite, so it arrives after
              the heading the focus move has just announced. */}
          <p className="sr-only" role="status">
            {t('onboarding.progress', { current: index + 1, total: steps.length })}
          </p>
          <Button variant="ghost" size="sm" className="ml-auto" onClick={onDone}>
            {t('onboarding.skip')}
          </Button>
        </div>

        {/* Scrolling lives here, on the fixed-height grid row, so the panel inside can be dragged
            horizontally without the two gestures fighting over the same element. */}
        <div className="min-h-0 overflow-y-auto">
          <AnimatePresence mode="wait" initial={false} custom={direction}>
            <motion.div
              key={step.id}
              custom={direction}
              initial={{ opacity: 0, x: direction * 24 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: direction * -24 }}
              transition={{ duration: 0.18 }}
              drag="x"
              dragDirectionLock
              dragMomentum={false}
              dragConstraints={{ left: 0, right: 0 }}
              dragElastic={0.15}
              onDragStart={() => {
                dragged.current = true;
              }}
              onDragEnd={onDragEnd}
              onPointerDownCapture={() => {
                dragged.current = false;
              }}
              /* Capture phase, so a click that was really the end of a swipe is stopped here on the
                 way *down* to whatever it landed on, before that control's own handler runs. See
                 the note on `dragged`. */
              onClickCapture={(event) => {
                if (!dragged.current) return;
                dragged.current = false;
                event.preventDefault();
                event.stopPropagation();
              }}
              /* The generous `pb` is the step's own bottom margin: without it the last thing on a
                 tall step sits flush against the footer bar, which reads as content cut off rather
                 than content ended. */
              className={cn(
                'mx-auto flex w-full max-w-md flex-col gap-4 px-4 pt-2 pb-8',
                step.id === 'people' || step.id === 'threads' || step.id === 'plugins'
                  ? 'lg:max-w-5xl'
                  : 'lg:max-w-3xl',
              )}
            >
              <div
                className={cn(
                  'mx-auto flex w-full flex-col gap-1.5',
                  (step.id === 'people' || step.id === 'threads' || step.id === 'plugins') &&
                    'lg:max-w-3xl',
                )}
              >
                {/* The Radix title, so it is also the dialog's accessible name — which changes per
                    step, correctly: the name of this dialog right now *is* the step you are on. */}
                <DialogTitle ref={focusHeading} tabIndex={-1} className="text-lg outline-none">
                  {t(`onboarding.${step.id}.title`)}
                </DialogTitle>
                <DialogDescription>{t(`onboarding.${step.id}.lede`)}</DialogDescription>
              </div>
              <step.Component />
            </motion.div>
          </AnimatePresence>
        </div>

        <div className="flex items-center justify-between gap-3 border-t bg-muted/50 px-4 py-3">
          {/* Kept in the layout when hidden, so the dots stay centred and Next doesn't jump
              sideways between the first step and the second. */}
          <Button
            variant="ghost"
            onClick={() => go(-1)}
            className={cn('min-h-11', index === 0 && 'invisible')}
          >
            {t('common.back')}
          </Button>
          {/* Decorative: they encode the same fact as the status line above, and making each one a
              stop would have a screen reader walk four inert elements to learn one number. */}
          <div aria-hidden className="flex items-center gap-1.5">
            {steps.map((dot, i) => (
              <span
                key={dot.id}
                className={cn(
                  'size-1.5 rounded-full transition-colors',
                  i === index ? 'bg-primary' : 'bg-muted-foreground/30',
                )}
              />
            ))}
          </div>
          <Button onClick={() => go(1)} className="min-h-11">
            {isLast ? t('onboarding.start') : t('onboarding.next')}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
