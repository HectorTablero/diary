import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { ComponentType } from 'react';
import type { PluginRecordDto } from '@diary/shared';

/* Type-only. Nothing here emits a byte, which is why the manifest can describe a plugin's shape
   without any of its code being reachable from the entry chunk. */

export type PluginSurface =
  'day' | 'page' | 'settings' | 'notifications' | 'export' | 'calendar' | 'widget' | 'onboarding';

/**
 * One day's worth of a plugin's calendar data — just enough to colour and label a cell.
 *
 * `level` is 0 (nothing to show) to 1 (fully met), on the same scale regardless of what the plugin
 * actually tracks, because the calendar page owns the colour and only needs a number to drive it
 * with. `label` is read out in the cell's tooltip, so it has to stand alone — the tab that picked
 * this view is the only other context a screen reader will have given first.
 */
export interface PluginCalendarDay {
  level: number;
  label: string;
}

export interface PluginCalendarViewProps {
  /** The visible month's first and last date key, inclusive. */
  start: string;
  end: string;
  /** Reports this plugin's per-day data for [start, end]. Call again whenever it changes. */
  onData: (data: ReadonlyMap<string, PluginCalendarDay>) => void;
}

/**
 * What a plugin's module may export. Every member is optional: a plugin fills the surfaces it
 * declares in its manifest and nothing else.
 *
 * The manifest's `surfaces` list and these members must agree, and the direction that matters is
 * declaring a surface you don't fill — a slot that loads a chunk to find nothing there has paid the
 * whole cost of the plugin for a user who sees no benefit. A test asserts the two line up.
 */
export interface PluginModule {
  /** Rendered on the day page, below the composer. */
  DayWidget?: ComponentType<{ dateKey: string }>;
  /** The plugin's own screen, at /plugins/<id>. Split again inside the plugin if it is large. */
  Page?: ComponentType;
  /** A card in Settings, built from the app's Section/ToggleRow primitives. */
  SettingsSection?: ComponentType;
  /**
   * Reminders this plugin wants armed right now, contributed to the app's single reconcile pass.
   *
   * A plugin never talks to the notification plugin itself: the reconcile cancels every pending id
   * it did not just schedule, so a second scheduler would silently disarm the first. Ids must come
   * from `pluginNotificationId(slot, key)` with the slot the app passes in.
   */
  collectNotifications?: (context: PluginNotificationContext) => Promise<LocalNotificationSchema[]>;
  /** Markdown files to add to the export archive. */
  exportMarkdown?: () => Promise<{ filename: string; markdown: string }[]>;
  /**
   * A view in the calendar page's switcher: replaces the diary's own entry heatmap with this
   * plugin's data when picked.
   *
   * Headless, like `collectNotifications` — it computes and reports data through `onData` rather
   * than drawing cells itself. The calendar page owns the cell (today's ring, the tap target, the
   * birthday marker); a plugin that drew its own grid on top is how the calendar would end up
   * wearing a different icon per plugin instead of one switcher that scales to any number of them.
   */
  CalendarView?: ComponentType<PluginCalendarViewProps>;
  /**
   * Bring this plugin's Android home-screen widget up to date.
   *
   * Headless, like `collectNotifications`, and for a stronger version of the same reason: there is
   * no React on the other side of this at all. A home-screen widget is drawn by a native provider in
   * a process with no WebView, so a plugin cannot render it — it can only restate its data somewhere
   * the provider can read, and say when.
   *
   * Called on boot, on resume, after a sync applies and on each background-fetch wake-up, so it must
   * be cheap, idempotent, and safe to call when no widget has been placed at all. It must also never
   * throw: the callers are lifecycle hooks doing several other things, and a widget that failed to
   * repaint is not a reason for any of them to stop.
   *
   * Both directions belong here, not just the outbound one. A widget that can be pressed collects
   * changes while the app is closed, and this is the hook that banks them — see `syncHabitsWidget`.
   */
  syncNativeWidget?: () => Promise<void>;
  /** A one-line, human-readable description of a row, for the backup import review — which
      otherwise has nothing to show but an opaque blob. */
  describeRecord?: (record: PluginRecordDto) => string;
  /**
   * A short tour of what this plugin does, opened from a button beside its switch in Settings.
   *
   * Deliberately not part of the app's own first-run onboarding (see components/onboarding/), and
   * not merely "reusing" it — it is a *second*, separate flow with the same shape: its own dialog,
   * driven by `PluginOnboarding.tsx` rather than `OnboardingFlow.tsx`. Three reasons it has to be
   * its own thing rather than a slot inside the first-run tour: it must open on demand at any point
   * from Settings, not only once at signup; it must work for a plugin that is currently switched
   * *off* (touring a feature is how someone decides whether to turn it on); and it has none of the
   * first-run tour's one-per-account "has this been seen" bookkeeping — replaying it is free, and
   * does not need Settings' `replayOnboarding` escape hatch.
   */
  onboardingSteps?: readonly PluginOnboardingStep[];
}

export interface PluginNotificationContext {
  /** This plugin's slice of the notification id space. Pass to pluginNotificationId. */
  slot: number;
}

/**
 * One screen of a plugin's own onboarding tour (see `PluginModule.onboardingSteps`).
 *
 * The same shape as the app's own onboarding `Step` (OnboardingFlow.tsx): an id that doubles as the
 * i18n sub-namespace, and the component that renders the screen. `PluginOnboarding.tsx` reads
 * `plugins.<pluginId>.onboarding.<id>.title` and `.lede` for the two lines above `Component`.
 */
export interface PluginOnboardingStep {
  id: string;
  Component: ComponentType;
}
