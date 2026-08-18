import type { PluginModule } from '../types';
import { exportNotebookMarkdown } from './markdown';
import { NotebookCalendarView } from './NotebookCalendarView';
import { NotebookDayWidget } from './NotebookDayWidget';
import NotebookPage from './NotebookPage';
import { notebookOnboardingSteps } from './onboarding/steps';

/* The notebook — prose, in a tree, with every day it changed kept.
 *
 * The first plugin to store documents rather than values, which is why `pluginDocument` exists at
 * all (see the block comment above MAX_PLUGIN_DOCUMENT_BYTES in @diary/shared). Everything else
 * about it follows the same contract as habits and the period tracker.
 *
 * Five surfaces, and the three it deliberately does **not** fill are as much of the design as the
 * ones it does:
 *
 *   - no `notifications` — a thought is not a task and has no due date. Nothing here should ever
 *     interrupt anyone, and the plugin has nothing to say that is worth an alarm.
 *   - no `widget` — the Android home screen is for one-tap recording. A paragraph is not that.
 *   - no `settings` — there is nothing device-local to configure. A settings card holding only a
 *     switch the Settings page already draws would be a card that exists to be a card.
 *
 * `describeRecord` is likewise absent: it describes a `pluginRecord`, and the only row this plugin
 * owns in that collection is the config row, which belongs to the app rather than to the plugin.
 */

const notebook: PluginModule = {
  DayWidget: NotebookDayWidget,
  Page: NotebookPage,
  exportMarkdown: exportNotebookMarkdown,
  CalendarView: NotebookCalendarView,
  onboardingSteps: notebookOnboardingSteps,
};

export default notebook;
