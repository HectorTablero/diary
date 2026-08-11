import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { ComponentType } from 'react';
import type { PluginRecordDto } from '@diary/shared';

/* Type-only. Nothing here emits a byte, which is why the manifest can describe a plugin's shape
   without any of its code being reachable from the entry chunk. */

export type PluginSurface = 'day' | 'page' | 'settings' | 'notifications' | 'export' | 'calendar';

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
  /** A one-line, human-readable description of a row, for the backup import review — which
      otherwise has nothing to show but an opaque blob. */
  describeRecord?: (record: PluginRecordDto) => string;
}

export interface PluginNotificationContext {
  /** This plugin's slice of the notification id space. Pass to pluginNotificationId. */
  slot: number;
}
