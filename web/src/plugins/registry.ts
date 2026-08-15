import { CircleCheckBig, Droplet, type LucideIcon } from 'lucide-react';
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
  /**
   * Where this plugin's `day` widget sits among other plugins' — low to high, ties broken by
   * registration order. Purely a display concern, deliberately kept apart from position in `PLUGINS`
   * itself: that position also fixes the notification-id slice above, which the comment on
   * `pluginSlot` asks to keep append-only, so it must stay free to answer a different question
   * (arrival order) without the day page's preferred order dragging on it. Defaults to `0` — a
   * plugin that doesn't care sorts before one that asked to come later, after one that asked to
   * come earlier.
   */
  dayOrder?: number;
  /**
   * The colour a `calendar` surface's cells shade with, in place of the default violet every plugin
   * used to share. Declared here rather than reported through `PluginCalendarDay` because it is a
   * property of the *plugin*, not of a day — one fixed choice, not a per-cell field repeated across
   * a month of data — and because CalendarPage needs it to paint before (and even without) that
   * plugin's chunk ever loading, the same reason `icon` lives on the manifest rather than the module.
   *
   * Optional: a plugin with no calendar view, or one content with the shared violet, leaves it unset.
   */
  hue?: { light: string; dark: string };
  /** Literal path. See rule 2. */
  load: () => Promise<{ default: PluginModule }>;
}

export const PLUGINS: readonly PluginManifest[] = [
  {
    id: 'habits',
    icon: CircleCheckBig,
    surfaces: [
      'day',
      'page',
      'settings',
      'notifications',
      'export',
      'calendar',
      'widget',
      'onboarding',
    ],
    load: () => import('./habits'),
  },
  {
    id: 'period-tracker',
    icon: Droplet,
    surfaces: ['day', 'page', 'settings', 'notifications', 'export', 'calendar', 'onboarding'],
    // Above habits' day widget: a period warrants the more prominent slot.
    dayOrder: -1,
    // A reddish hue distinct from habits' violet, so the two plugins' tabs don't read as the same
    // kind of thing shaded two different amounts. Brighter in dark mode for the same reason the
    // entries heatmap's own five colours are, further down this file's CalendarPage counterpart.
    hue: { light: '220, 38, 38', dark: '248, 113, 113' },
    load: () => import('./period-tracker'),
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
