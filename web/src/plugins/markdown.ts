import { ensurePluginLocales } from './i18n';
import { PLUGINS, type PluginManifest } from './registry';
import type { PluginExportRange } from './types';

/**
 * Whether a `dateKey` falls inside an export's range.
 *
 * Lexicographic, which is chronological for `YYYY-MM-DD`, and inclusive at both ends. Here rather
 * than in types.ts so that file stays type-only — nothing in it may emit a byte, which is what lets
 * the manifest describe a plugin's shape without any plugin code being reachable from the entry
 * chunk. Every `exportMarkdown` filters with this one function so two plugins' tables cannot
 * disagree about whether the last day of the range is in it.
 */
export const inExportRange = (dateKey: string, range: PluginExportRange): boolean =>
  (!range.from || dateKey >= range.from) && (!range.to || dateKey <= range.to);

/**
 * The enabled plugins that can contribute a section to an Entries export, in manifest order.
 *
 * Readable without loading a single chunk — it is `enabled` and `surfaces` and nothing else (rule
 * 3) — which is what lets the export dialog draw a checkbox per plugin for someone who has never
 * opened any of them.
 */
export const entriesExportPlugins = (enabled: ReadonlySet<string>): PluginManifest[] =>
  PLUGINS.filter((plugin) => enabled.has(plugin.id) && plugin.surfaces.includes('export'));

/** Which of those start ticked, per manifest. See `PluginManifest.entriesExportDefault`. */
export const defaultEntriesExportSelection = (
  enabled: ReadonlySet<string>,
): Record<string, boolean> =>
  Object.fromEntries(
    entriesExportPlugins(enabled).map((plugin) => [
      plugin.id,
      plugin.entriesExportDefault === true,
    ]),
  );

/**
 * Everything the chosen plugins want to add to an entries export, in the two places they can add
 * it: blocks of lines under individual days, and whole sections after the diary.
 *
 * `dayLines` is keyed by `dateKey`, and each value is the blocks for that day in manifest order —
 * one array per contributing plugin, kept apart rather than concatenated so the writer can put a
 * blank line between two plugins' blocks without guessing where one ends.
 */
export interface PluginExportContribution {
  dayLines: ReadonlyMap<string, readonly (readonly string[])[]>;
  /** One per plugin that contributed day lines and explained them — for the document's preamble,
      beside the diary's own notes on its tags and its importance scale. */
  notes: readonly (readonly string[])[];
  sections: { filename: string; markdown: string }[];
}

/**
 * Markdown the chosen plugins want woven into an entries export.
 *
 * Added to the diary's own export rather than offered as a separate download, because that is what
 * the data *is*: plugin rows are day-scoped, and a habit log is another thing that happened on the
 * days the entries describe. Splitting it into its own file would hand the reader two documents to
 * line up by date — and for the day-scoped half, even one document with the rows at the end is that
 * same lining-up, just with a shorter walk.
 *
 * `selected` is the user's answer from the export dialog, and a plugin missing from it is left out
 * — an id absent from the map counts as unticked, so nothing is contributed by default if the two
 * ever drift apart. `range` is the same one the entries themselves were filtered by, and is passed
 * down rather than applied here: only a plugin knows which of its rows are days and which are
 * definitions describing the whole period (see `PluginModule.exportMarkdown`). Day keys that come
 * back outside it are dropped anyway, so a plugin that forgets cannot widen the export.
 *
 * Same failure discipline as the notification collector, for the same reason — a plugin whose chunk
 * will not load must not take the export down with it. It contributes nothing and the rest of the
 * document is written as normal, because a diary export missing its habits is far better than no
 * export at all.
 */
export async function collectPluginMarkdown(
  enabled: ReadonlySet<string>,
  range: PluginExportRange,
  selected: Readonly<Record<string, boolean>>,
): Promise<PluginExportContribution> {
  const active = entriesExportPlugins(enabled).filter((plugin) => selected[plugin.id] === true);
  const dayLines = new Map<string, (readonly string[])[]>();
  const notes: (readonly string[])[] = [];
  const sections: { filename: string; markdown: string }[] = [];

  for (const plugin of active) {
    try {
      const [module] = await Promise.all([plugin.load(), ensurePluginLocales(plugin.id)]);
      const { exportDayLines, exportMarkdown } = module.default;

      const contributed = await exportDayLines?.(range);
      let placed = 0;
      for (const [dateKey, lines] of contributed?.days ?? []) {
        if (!lines.length || !inExportRange(dateKey, range)) continue;
        const blocks = dayLines.get(dateKey);
        if (blocks) blocks.push(lines);
        else dayLines.set(dateKey, [lines]);
        placed++;
      }
      /* Only once a block actually survived. A note explaining a notation the document never uses
         is the export telling its reader about a feature, which is not what it is for — and the
         range makes this a real case rather than a defensive one: a month with no spending in it
         would otherwise still be prefaced by a paragraph on how to read expense lines. */
      if (placed && contributed?.note?.length) notes.push(contributed.note);

      const produced = await exportMarkdown?.(range);
      if (produced?.length) sections.push(...produced);
    } catch (err) {
      console.warn(`export: plugin "${plugin.id}" contributed nothing`, err);
    }
  }
  return { dayLines, notes, sections };
}
