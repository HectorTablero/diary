import { describe, expect, it } from 'vitest';
import { PLUGINS } from './registry';
import type { PluginModule, PluginSurface } from './types';

/* Rule 3 of the plugin contract depends on `surfaces` being trustworthy. A plugin that declares a
   surface it doesn't fill makes a slot fetch its whole chunk to find `undefined` — the full cost of
   the plugin, paid by a user who then sees nothing. The reverse is milder but still a bug: an
   export nothing ever reaches is dead weight inside the chunk.
 *
 * Its own file, and `.tsx` so it lands in the jsdom project, because this is the one check that has
 * to *load* each plugin — and a plugin module pulls in the app's whole React UI layer. Run from the
 * node-environment `logic` project it took five seconds and timed out, and slowed every test file
 * running beside it. Same reason OnboardingFlow.native.test.tsx is split out: the environment a
 * test needs decides which file it lives in.
 */

const MEMBER_FOR: Record<PluginSurface, keyof PluginModule> = {
  day: 'DayWidget',
  page: 'Page',
  settings: 'SettingsSection',
  notifications: 'collectNotifications',
  export: 'exportMarkdown',
  calendar: 'CalendarView',
};

describe('declared surfaces match what each plugin exports', () => {
  it.each(PLUGINS.map((plugin) => [plugin.id, plugin] as const))('%s', async (_id, plugin) => {
    const module = (await plugin.load()).default;

    for (const surface of plugin.surfaces) {
      expect(
        module[MEMBER_FOR[surface]],
        `declares "${surface}" but exports nothing for it`,
      ).toBeDefined();
    }
    for (const [surface, member] of Object.entries(MEMBER_FOR) as [
      PluginSurface,
      keyof PluginModule,
    ][]) {
      if (plugin.surfaces.includes(surface)) continue;
      expect(module[member], `exports ${member} but does not declare "${surface}"`).toBeUndefined();
    }
  });
});
