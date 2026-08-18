import type { PluginDocumentDto } from '@diary/shared';
import { getAllPluginDocuments } from '@/db/pluginDocuments';
import i18n from '@/i18n';
import { documentLabel, NOTEBOOK_PLUGIN_ID, ROOT_ID, sortDocuments } from './model';

/**
 * The whole notebook, as one Markdown section.
 *
 * ## Why one section rather than a folder of files
 *
 * The tree would map beautifully onto a directory — the ZIP writer stores a path verbatim, so
 * `psychology/enneagram/type-1.md` would just work. But the entries export *concatenates* every
 * plugin's contribution into a single document (see MarkdownExportDialog.runExport), so a filename
 * is not currently something a plugin can spend. Producing a hierarchy of headings instead keeps the
 * shape of the notebook legible in the one file the export actually writes, and needs no change to
 * a core screen for the sake of one plugin.
 *
 * ## Depth becomes heading level
 *
 * A root document is `##` (below the `#` the export's own title takes), its children `###`, and so
 * on to Markdown's limit of six. Past that the level simply stops deepening — a notebook nested that
 * far is already beyond what headings can express, and clamping is better than emitting `#######`,
 * which is not a heading at all and would render as literal hashes.
 *
 * Note the one thing this cannot fix: a document whose own body contains headings will interleave
 * them with the structural ones. That is inherent to flattening a tree of Markdown into Markdown,
 * and the alternative — rewriting the user's own heading levels — would change what they wrote.
 *
 * History is deliberately not exported. It is a patch chain against a text, meaningless outside this
 * app, and one thought's year of revisions can be longer than every document in the notebook.
 */
export async function exportNotebookMarkdown(): Promise<{ filename: string; markdown: string }[]> {
  const documents = await getAllPluginDocuments(NOTEBOOK_PLUGIN_ID);
  if (!documents.length) return [];

  const childrenOf = new Map<string, PluginDocumentDto[]>();
  for (const doc of documents) {
    childrenOf.set(doc.parentId, [...(childrenOf.get(doc.parentId) ?? []), doc]);
  }

  const untitled = i18n.t('plugins.notebook.untitled');
  const lines: string[] = [`## ${i18n.t('plugins.notebook.title')}`];

  const walk = (parentId: string, depth: number) => {
    for (const doc of sortDocuments(childrenOf.get(parentId) ?? [])) {
      lines.push('', `${'#'.repeat(Math.min(6, depth + 3))} ${documentLabel(doc, untitled)}`);
      const body = doc.body.trim();
      if (body) lines.push('', body);
      walk(doc.id, depth + 1);
    }
  };
  walk(ROOT_ID, 0);

  return [{ filename: 'notebook.md', markdown: lines.join('\n') }];
}
