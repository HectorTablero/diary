import { ensurePluginLocales } from './i18n';
import { PLUGINS } from './registry';

/**
 * Markdown that enabled plugins want appended to an entries export.
 *
 * Appended to the diary's own export rather than offered as a separate download, because that is
 * what the data *is*: plugin rows are day-scoped, and a habit log is another thing that happened on
 * the days the entries describe. Splitting it into its own file would hand the reader two documents
 * to line up by date.
 *
 * Same failure discipline as the notification collector, for the same reason — a plugin whose chunk
 * will not load must not take the export down with it. It contributes nothing and the rest of the
 * document is written as normal, because a diary export missing its habits is far better than no
 * export at all.
 */
export async function collectPluginMarkdown(
  enabled: ReadonlySet<string>,
): Promise<{ filename: string; markdown: string }[]> {
  const active = PLUGINS.filter(
    (plugin) => enabled.has(plugin.id) && plugin.surfaces.includes('export'),
  );
  if (!active.length) return [];

  const sections: { filename: string; markdown: string }[] = [];
  for (const plugin of active) {
    try {
      const [module] = await Promise.all([plugin.load(), ensurePluginLocales(plugin.id)]);
      const produced = await module.default.exportMarkdown?.();
      if (produced?.length) sections.push(...produced);
    } catch (err) {
      console.warn(`export: plugin "${plugin.id}" contributed nothing`, err);
    }
  }
  return sections;
}
