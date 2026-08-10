import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { ComponentType } from 'react';
import type { PluginRecordDto } from '@diary/shared';

/* Type-only. Nothing here emits a byte, which is why the manifest can describe a plugin's shape
   without any of its code being reachable from the entry chunk. */

export type PluginSurface = 'day' | 'page' | 'settings' | 'notifications' | 'export';

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
  /** A one-line, human-readable description of a row, for the backup import review — which
      otherwise has nothing to show but an opaque blob. */
  describeRecord?: (record: PluginRecordDto) => string;
}

export interface PluginNotificationContext {
  /** This plugin's slice of the notification id space. Pass to pluginNotificationId. */
  slot: number;
}
