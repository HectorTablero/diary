import { registerPlugin } from '@capacitor/core';

/**
 * The one thing the widget needs that SharedPreferences cannot carry: a nudge to redraw.
 *
 * Writing the snapshot is enough to make it *available*, but a home-screen widget only repaints
 * when something calls `AppWidgetManager.updateAppWidget` — otherwise it sits on whatever it last
 * drew until `updatePeriodMillis` comes round, which has a 30-minute floor and would make ticking a
 * habit look broken. So this exists purely to say "now".
 *
 * Deliberately a single void method with no arguments. Everything about *what* the widget shows
 * travels as data (see widgetBridge.ts), which is what keeps `HabitsWidgetPlugin.java` at a couple
 * of dozen lines that never need to change again. A plugin that grew a `setHabits` method would be
 * the same design mistake as putting the domain in Java.
 *
 * The web fallback is a no-op rather than an error: `refreshHabitsWidget` already guards on
 * `isNative`, and a plugin that throws in the browser would turn every test of the calling code
 * into a mocking exercise.
 */
export interface HabitsWidgetPlugin {
  /** Redraw every instance of the habits widget from the current snapshot. */
  refresh(): Promise<void>;
}

export const HabitsWidget = registerPlugin<HabitsWidgetPlugin>('HabitsWidget', {
  web: () => ({ refresh: async () => {} }),
});
