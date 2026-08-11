import { CircleCheckBig, type LucideIcon } from 'lucide-react';
import type { PluginModule, PluginSurface } from './types';

/**
 * The plugin catalogue — and the only plugin file the entry chunk is allowed to reach.
 *
 * ## The contract
 *
 * Plugins exist so a feature like the habit tracker can be added without a full-stack change. What
 * makes that worth having is that it costs nothing to anyone who doesn't use it, and *that* is not
 * a property of the idea — it is a property of five rules, all of which are easy to break by
 * accident and none of which fail loudly:
 *
 * 1. **This file holds no plugin code.** An id, an icon, a list of surfaces, and a thunk. Everything
 *    else lives behind the dynamic import.
 * 2. **The import path is a literal.** `import('./habits')`, never `` import(`./${id}`) `` — a
 *    template literal makes Rolldown emit a chunk for every directory under plugins/ and can merge
 *    them into one, which hands every visitor every plugin at once.
 * 3. **Slots check `enabled` before `surfaces`, and `surfaces` before `load()`.** A slot must be
 *    able to decide it has nothing to draw without fetching anything.
 * 4. **No plugin page goes in `pages/lazyPages.ts`.** AppLayout warms every entry of that map on
 *    idle, so a plugin registered there downloads for everyone, enabled or not.
 * 5. **No plugin-only dependency goes in `VENDOR_CHUNKS`** (web/vite.config.ts). Membership there is
 *    forced rather than inferred, so naming a plugin's library hoists it out of the plugin's chunk
 *    and in front of everybody's first paint. Leaving it unnamed is correct — Rolldown puts a
 *    package reached by one lazy route into that route's chunk.
 *
 * `registry.test.ts` enforces what can be enforced from inside the app; the bundle-budget check in
 * `scripts/checkBundle.ts` enforces the rest against real build output.
 *
 * ## Adding a plugin
 *
 * A folder under `plugins/<id>/` with an `index.ts` default-exporting a PluginModule, a
 * `locales/{en,es,it,ja,zh}.json`, a `locales/translation-context.json`, and one entry here.
 */

export interface PluginManifest {
  /** Matches PLUGIN_ID_REGEX. Also the i18n key prefix (`plugins.<id>.*`) and the folder name. */
  id: string;
  icon: LucideIcon;
  /**
   * Which slots this plugin fills, readable *without* loading it.
   *
   * This is the whole mechanism behind rule 3: a day-page slot can skip a plugin that has no day
   * widget for the price of an array lookup, instead of a network round-trip that ends in
   * `undefined`.
   */
  surfaces: readonly PluginSurface[];
  /** Literal path. See rule 2. */
  load: () => Promise<{ default: PluginModule }>;
}

export const PLUGINS: readonly PluginManifest[] = [
  {
    id: 'habits',
    icon: CircleCheckBig,
    surfaces: ['day', 'page', 'settings', 'notifications', 'export', 'calendar', 'widget'],
    load: () => import('./habits'),
  },
];

export const findPlugin = (id: string): PluginManifest | undefined =>
  PLUGINS.find((plugin) => plugin.id === id);

/**
 * Each plugin's slice of the notification id space, fixed by its position here.
 *
 * Position rather than a hash of the id, because the reconcile needs the *reverse* lookup: when a
 * plugin's chunk fails to load, its already-armed reminders must be left alone rather than swept,
 * and recognising them means turning an id back into a plugin with the chunk unavailable. A
 * contiguous slice makes that a range check. See lib/notificationIds.
 *
 * The consequence to know: reordering this array reassigns slices. That is harmless — the reconcile
 * cancels ids it did not just schedule, so the next pass re-arms everything at its new id — but it
 * is not free of effect, so append rather than insert.
 */
export const pluginSlot = (id: string): number => PLUGINS.findIndex((plugin) => plugin.id === id);
