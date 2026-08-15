import { LayoutGrid } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { metTarget } from '../model';
import { buildDemoExamples, demoDateKey, demoStreak } from './demoExamples';
import { WidgetHabitRow } from './WidgetHabitRow';

/**
 * The diary's own mark, exactly as drawn by android/.../res/drawable/widget_logo.xml: the same
 * three strokes, the same 500-unit viewport, `currentColor` standing in for that file's
 * `@color/widget_logo_ink` (which itself just points at the widget's foreground token) — so the
 * mark sits on the same optical line as the title beside it instead of being the only coloured
 * thing on an otherwise neutral card, in either theme, without a second colour to keep in step.
 */
function WidgetLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 500 500" className={className} aria-hidden>
      <path
        d="M 100 100 L 100 400"
        fill="none"
        stroke="currentColor"
        strokeWidth={50}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 175 100 L 400 250 L 175 400"
        fill="none"
        stroke="currentColor"
        strokeWidth={50}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M 200 250 L 100 250"
        fill="none"
        stroke="currentColor"
        strokeWidth={50}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * What the Android home-screen widget looks like, without a screenshot of one — built from the
 * app's own logo mark and, in `WidgetHabitRow`, the app's own controls resized and relaid out to
 * the native widget's own row shape, rather than an invented look. It is a faithful *shape*, not a
 * pixel clone: the native widget is drawn by Android's RemoteViews in a process with no WebView
 * (see `PluginModule.syncNativeWidget`'s own note on that), but its layout XML is the one this
 * component follows — name, a reserved streak slot, then the control, all on one line, with a goal
 * bar below only for the two kinds that have one.
 *
 * Two things it copies exactly, because they are what make a home-screen widget a widget rather
 * than another card: the logo-and-title header with a "met/total" counter, and a fixed, scrollable
 * height — a widget is exactly as tall as the space it was dragged to on the home screen, never as
 * tall as its content, so its list scrolls in place instead of pushing anything below it.
 */
export function WidgetStep() {
  const { t } = useTranslation();
  const dateKey = demoDateKey();
  // The same cast TypesStep shows on the day page — one diary followed across two surfaces,
  // instead of a fresh example invented for each screen of the tour.
  const examples = useMemo(() => buildDemoExamples(t), [t]);
  const met = examples.filter(({ habit, value }) => metTarget(habit, value, dateKey)).length;

  return (
    <div className="flex flex-col gap-4">
      {/* Narrower than the dialog around it and given its own outer margin, so the widget reads as
          a tile dropped onto a home screen rather than another full-width card in this list — the
          one thing a screenshot would show at a glance that a same-width mock cannot. The kicker
          above it shares this same width and left edge rather than spanning the full step, so it
          reads as a caption *of the tile* instead of a heading sitting above an unrelated column. */}
      <div className="mx-auto flex w-full max-w-72 flex-col gap-2">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <LayoutGrid className="size-4" aria-hidden />
          {t('plugins.habits.onboarding.widget.label')}
        </div>

        <section
          className="flex flex-col rounded-xl border bg-card p-4 shadow-xs"
          aria-label={t('plugins.habits.onboarding.widget.label')}
        >
          <div className="mb-1 flex items-center gap-1.5">
            <WidgetLogo className="size-4 shrink-0 text-foreground" />
            <span className="flex-1 truncate text-sm font-bold">{t('plugins.habits.title')}</span>
            <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
              {t('plugins.habits.doneOf', { done: met, total: examples.length })}
            </span>
          </div>

          {/* Fixed height, not "as tall as five rows": the real widget's list is a ListView inside
              a launcher-sized frame, so it scrolls rather than growing — squashing or slicing the
              last row is exactly the bug that shape was chosen to avoid. Short enough here that the
              five examples do not all fit, so the scroll is demonstrably needed even though nothing
              draws a scrollbar for it — `android:scrollbars="none"` on the real ListView, matched
              here rather than left as a web-only tell. */}
          <ul className="max-h-44 divide-y divide-border/60 overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {examples.map((example) => (
              <WidgetHabitRow
                key={example.habit.id}
                habit={example.habit}
                value={example.value}
                dateKey={dateKey}
                streak={demoStreak(example, dateKey)}
              />
            ))}
          </ul>
        </section>
      </div>

      <p className="text-sm text-muted-foreground">{t('plugins.habits.onboarding.widget.note')}</p>
    </div>
  );
}
