import type { LocalNotificationSchema } from '@capacitor/local-notifications';
import type { ComponentType } from 'react';
import type { PluginRecordDto } from '@diary/shared';

/* Type-only. Nothing here emits a byte, which is why the manifest can describe a plugin's shape
   without any of its code being reachable from the entry chunk. */

export type PluginSurface =
  | 'day'
  | 'page'
  | 'settings'
  | 'notifications'
  | 'export'
  | 'ownExport'
  | 'calendar'
  | 'widget'
  | 'onboarding';

/**
 * The extra checkboxes an `ownExport` plugin asked for, as `{ <key>: <ticked> }`.
 *
 * The keys — and their defaults — come from the plugin's *manifest* (`PluginManifest.exportOptions`)
 * rather than from the module, because the dialog has to draw the boxes before anyone presses
 * Export, and rule 3 forbids it loading a chunk to find out what to draw. The module receives the
 * answers; the manifest declares the questions.
 *
 * Every key is always present, defaults filled in, so a builder can read `options.history` without
 * guarding it.
 */
export type PluginExportOptions = Readonly<Record<string, boolean>>;

/**
 * The slice of time an Entries export covers, as the user picked it in the export dialog.
 *
 * Passed to `exportMarkdown` because a plugin's data is day-scoped and gets appended to a document
 * whose entries have already been filtered to this range — a habit log or an expense table that
 * ran from the first day of the diary to the last, under a heading saying "March", is not a longer
 * answer to the question asked, it is a different one. `null` on either side means unbounded, the
 * same convention `getEntriesInRange` uses.
 *
 * Both ends are inclusive, and both are `dateKey`s (`YYYY-MM-DD`), so a plugin can compare them to
 * its own rows' keys as plain strings — which is what `inExportRange` in plugins/markdown.ts does,
 * and what every plugin's export should filter with so they cannot disagree at the edges.
 */
export interface PluginExportRange {
  from: string | null;
  to: string | null;
}

/**
 * A plugin's per-day contribution to an entries export: the blocks themselves, and the paragraph
 * that teaches the reader to parse them.
 *
 * The note exists because these exports are written to be read by an agent with no app to check
 * against, which is the same reason the document already explains its own `Tags:` lines and its
 * importance scale before using them. A block of `- €4.00: Metro (Transport)` under a date is
 * perfectly clear to the person who recorded it and guesswork to anything else.
 *
 * It is a *brief* note about notation, not a description of the feature — the reader needs to know
 * what the fields are and when one is omitted, and nothing else. It is dropped automatically when
 * `days` turns out empty, so an export that happens to contain no spending does not carry a
 * paragraph explaining a line that never appears.
 */
export interface PluginDayContribution {
  /** Markdown lines for the document's preamble, heading included. Omit when there is nothing the
      reader could not work out from the lines themselves. */
  note?: readonly string[];
  /** The blocks, keyed by `dateKey`. */
  days: ReadonlyMap<string, readonly string[]>;
}

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
  /**
   * Markdown sections appended after the whole diary, covering `range` and nothing outside it.
   *
   * Honouring the range is the plugin's own job, not the collector's: only the plugin knows which
   * of its rows are day-scoped, which are definitions that describe the whole period, and what a
   * clipped count should say — so a filter applied over the finished Markdown could only cut rows
   * out of a table and leave every total above it wrong.
   *
   * Return `[]` when nothing of this plugin's falls inside the range. A section consisting of a
   * heading and an empty table is worse than no section: the reader cannot tell it apart from a
   * plugin that has never recorded anything.
   *
   * What belongs down here is what reads as a *whole*: a habit grid scanned column by column, a
   * month-by-month total. What belongs beside the day it happened on goes in `exportDayLines`
   * instead, and a plugin may well fill both.
   */
  exportMarkdown?: (range: PluginExportRange) => Promise<{ filename: string; markdown: string }[]>;
  /**
   * Lines to place under a day's own entries, keyed by `dateKey` — this plugin's account of what
   * else happened that day.
   *
   * The other half of `exportMarkdown`, and the right half for anything that is *about* a
   * particular day. A ledger of every expense ever recorded, parked under a heading at the end of
   * the document, asks the reader to carry a date back and forth between two places to answer
   * "what did I spend on the day I wrote this" — which is the only question a diary's reader is
   * likely to have. Three lines under the day answer it where it is asked.
   *
   * So the division is by what the data is, not by which plugin it came from: the same plugin can
   * put its per-day lines here and its totals in `exportMarkdown`, and the expenses plugin does
   * exactly that.
   *
   * Each day's lines are written verbatim as a block, blank-line separated from the entries above
   * and from any other plugin's block. A day that only appears in this map — something recorded on
   * a day with no entry written — still gets its heading, because it is a day the diary has
   * something to say about.
   *
   * Keys outside `range` are ignored rather than trusted, so a plugin that forgets to filter cannot
   * widen an export past what was asked for.
   */
  exportDayLines?: (range: PluginExportRange) => Promise<PluginDayContribution>;
  /**
   * A whole export type of its own in the Markdown export dialog, for plugin data that doesn't fit
   * the Entries export's day-scoped concatenation (`exportMarkdown` above) — a tree of documents,
   * say, where flattening into another document's headings would scramble the user's own heading
   * levels (see the notebook plugin, the first to need this).
   *
   * The dialog discovers this generically off the `ownExport` surface and its own `id` — it never
   * names a plugin. Every plugin-specific string it shows (the option's label, a hint under the
   * output-mode picker) comes from that plugin's own locale bundle instead: `plugins.<id>.name` for
   * the label it already has for the Plugins list, and `plugins.<id>.exportHint` for the hint,
   * which every plugin declaring this surface must define.
   */
  exportOwn?: {
    /** Everything as one merged Markdown file, or `null` when there is nothing to export. */
    buildMerged: (options: PluginExportOptions) => Promise<string | null>;
    /** Everything as a set of files for a ZIP archive. A `name` may contain `/` to lay out real
        folders, when the plugin's own data has a shape that wants one (`lib/zip.ts` stores it
        verbatim). */
    buildZip: (options: PluginExportOptions) => Promise<{ name: string; content: string }[]>;
  };
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
