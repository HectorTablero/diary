import type { PluginModule } from '../types';
import { buildNotebookMergedMarkdown, buildNotebookZipEntries } from './markdown';
import { NotebookCalendarView } from './NotebookCalendarView';
import { NotebookDayWidget } from './NotebookDayWidget';
import NotebookPage from './NotebookPage';
import { NotebookSettingsSection } from './NotebookSettingsSection';
import { notebookOnboardingSteps } from './onboarding/steps';

/* The notebook — prose, in a tree, with every day it changed kept.
 *
 * The first plugin to store documents rather than values, which is why `pluginDocument` exists at
 * all (see the block comment above MAX_PLUGIN_DOCUMENT_BYTES in @diary/shared). Everything else
 * about it follows the same contract as habits and the period tracker.
 *
 * Six surfaces, and the two it deliberately does **not** fill are as much of the design as the ones
 * it does:
 *
 *   - no `notifications` — a thought is not a task and has no due date. Nothing here should ever
 *     interrupt anyone, and the plugin has nothing to say that is worth an alarm.
 *   - no `widget` — the Android home screen is for one-tap recording. A paragraph is not that.
 *
 * `settings` *is* filled, unlike when this comment first said otherwise — see
 * NotebookSettingsSection.tsx for the one device-local trade-off (caching images offline) that
 * turned out to be worth a card after all.
 *
 * `export` (the entries-export contribution habits and the period tracker use) is absent in favour
 * of `ownExport`: a tree of Markdown doesn't flatten into another document's headings the way
 * day-scoped plugin data does, so this plugin gets a type of its own in the Markdown export dialog
 * instead (see markdown.ts and PluginModule.exportOwn). The dialog discovers it purely off this
 * module's `exportOwn` and the manifest's `ownExport` surface — it never imports anything from this
 * plugin directly, and never spells out "notebook".
 *
 * `describeRecord` is likewise absent: it describes a `pluginRecord`, and the only row this plugin
 * owns in that collection is the config row, which belongs to the app rather than to the plugin.
 */

const notebook: PluginModule = {
  DayWidget: NotebookDayWidget,
  Page: NotebookPage,
  SettingsSection: NotebookSettingsSection,
  CalendarView: NotebookCalendarView,
  /* The dialog hands over `PluginExportOptions` — a plain `Record<string, boolean>` keyed by what
     the manifest declared. Narrowed to this plugin's own option here, at the boundary, so nothing
     below this line deals in loose string keys (see NotebookExportOptions in markdown.ts). */
  exportOwn: {
    buildMerged: (options) => buildNotebookMergedMarkdown({ history: options.history === true }),
    buildZip: (options) => buildNotebookZipEntries({ history: options.history === true }),
  },
  onboardingSteps: notebookOnboardingSteps,
};

export default notebook;
