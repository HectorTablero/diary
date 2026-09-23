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

/* Most surfaces are one slot and one member. `export` is two: a plugin may put lines under each day
   (`exportDayLines`), a section after the diary (`exportMarkdown`), or both — the expenses plugin
   does both. Declaring the surface means filling at least one of them, and neither may appear
   without the surface being declared, which is the direction rule 3 actually depends on. */
const MEMBERS_FOR: Record<PluginSurface, readonly (keyof PluginModule)[]> = {
  day: ['DayWidget'],
  page: ['Page'],
  settings: ['SettingsSection'],
  notifications: ['collectNotifications'],
  export: ['exportMarkdown', 'exportDayLines'],
  ownExport: ['exportOwn'],
  calendar: ['CalendarView'],
  widget: ['syncNativeWidget'],
  onboarding: ['onboardingSteps'],
};

describe('declared surfaces match what each plugin exports', () => {
  it.each(PLUGINS.map((plugin) => [plugin.id, plugin] as const))('%s', async (_id, plugin) => {
    const module = (await plugin.load()).default;

    for (const surface of plugin.surfaces) {
      expect(
        MEMBERS_FOR[surface].some((member) => module[member] !== undefined),
        `declares "${surface}" but exports nothing for it`,
      ).toBe(true);
    }
    for (const [surface, members] of Object.entries(MEMBERS_FOR) as [
      PluginSurface,
      readonly (keyof PluginModule)[],
    ][]) {
      if (plugin.surfaces.includes(surface)) continue;
      for (const member of members) {
        expect(
          module[member],
          `exports ${member} but does not declare "${surface}"`,
        ).toBeUndefined();
      }
    }
  });
});
