import type { PluginDocumentDto } from '@diary/shared';
import type { ZipTextFile } from '@/lib/zip';
import { getAllPluginDocuments, getDocumentRevisions } from '@/db/pluginDocuments';
import i18n from '@/i18n';
import { documentLabel, NOTEBOOK_PLUGIN_ID, ROOT_ID, sortDocuments } from './model';

/**
 * The notebook's own export: one YAML-frontmatter block per document, not a flattened heading tree.
 *
 * ## Why this replaced the entries-export contribution
 *
 * The notebook allows Markdown, so a document's own headings sit at whatever level the author chose
 * — flattening the tree into `##`/`###`/`####` (the previous approach here) meant a document's own
 * `### Structure` interleaved with the structural heading marking *where* it sat in the tree, with no
 * way to tell them apart. Frontmatter carries the structure instead (`path`, `parent`, `id`) and
 * leaves a document's own Markdown untouched. That is also why this is a *separate* export rather
 * than another `exportMarkdown` contribution to the entries export: the entries export concatenates
 * everything into one shared document, which is right for day-scoped plugin data (a habit log is
 * another thing that happened on the days the entries describe) and wrong for a tree of prose that
 * keeps growing independently of any one day.
 *
 * `[[id]]` references are rewritten to `[[Title]]` — Obsidian's own wikilink form — using the label
 * every other document has *right now*, so the export reads sensibly to a human or an agent outside
 * this app, where an opaque id means nothing. An id that no longer resolves is left exactly as
 * written rather than guessed at.
 *
 * History is deliberately not exported, same as before: a patch chain is meaningless outside the app.
 */

interface ExportRow {
  doc: PluginDocumentDto;
  /** Ancestor labels, root first, not including this document's own. */
  ancestry: string[];
}

interface Collected {
  rows: ExportRow[];
  labelOf: ReadonlyMap<string, string>;
  editsOf: ReadonlyMap<string, number>;
}

/** Walks the tree once (same order every other tree walk in this plugin uses — root first, siblings
    in sortKey order) and gathers what every row's frontmatter needs. `null` when the notebook is
    empty, so callers can tell "nothing to export" from "exported nothing went wrong". */
async function collect(): Promise<Collected | null> {
  const documents = await getAllPluginDocuments(NOTEBOOK_PLUGIN_ID);
  if (!documents.length) return null;

  const untitled = i18n.t('plugins.notebook.untitled');
  const labelOf = new Map(documents.map((doc) => [doc.id, documentLabel(doc, untitled)]));

  const childrenOf = new Map<string, PluginDocumentDto[]>();
  for (const doc of documents) {
    childrenOf.set(doc.parentId, [...(childrenOf.get(doc.parentId) ?? []), doc]);
  }

  const rows: ExportRow[] = [];
  const walk = (parentId: string, ancestry: string[]) => {
    for (const doc of sortDocuments(childrenOf.get(parentId) ?? [])) {
      rows.push({ doc, ancestry });
      walk(doc.id, [...ancestry, labelOf.get(doc.id) ?? untitled]);
    }
  };
  walk(ROOT_ID, []);

  // "Edits" is the number of distinct days a document has a revision for — the same day-granularity
  // the calendar view and the day card already report writing in, not a keystroke count.
  const editsOf = new Map(
    await Promise.all(
      rows.map(async ({ doc }) => [doc.id, (await getDocumentRevisions(doc.id)).length] as const),
    ),
  );

  return { rows, labelOf, editsOf };
}

/** Quotes a YAML scalar only when a bare one would mean something else to a parser: a leading or
    trailing space, a `key: value`-shaped colon, a comment marker, or a value opening with a YAML
    indicator character. Not a general emitter — every field this export writes is a plain string,
    number, or ISO date, and that's all this needs to get right. */
function quoteScalar(value: string): string {
  const needsQuoting =
    value === '' ||
    /^\s|\s$/.test(value) ||
    /: |#/.test(value) ||
    /^[-?:,[\]{}#&*!|>'"%@`]/.test(value);
  if (!needsQuoting) return value;
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;
}

function toFrontmatter(fields: [string, string | number | undefined][]): string {
  const lines = fields
    .filter((field): field is [string, string | number] => field[1] !== undefined)
    .map(([key, value]) => `${key}: ${typeof value === 'number' ? value : quoteScalar(value)}`);
  return `---\n${lines.join('\n')}\n---`;
}

/** Rewrites every `[[id]]` in `body` to `[[Title]]`, the wikilink form a human or another tool can
    actually read. An id that isn't in `labelOf` (a link to a document since deleted) is left as the
    raw token it already is — the same "never silently rewrite what can't be resolved" rule the
    in-app preview follows. */
function rewriteDocumentLinks(body: string, labelOf: ReadonlyMap<string, string>): string {
  return body.replace(/\[\[([^\]]+)\]\]/g, (token, id: string) => {
    const label = labelOf.get(id);
    return label ? `[[${label}]]` : token;
  });
}

function buildBlock(row: ExportRow, labelOf: ReadonlyMap<string, string>, edits: number): string {
  const { doc, ancestry } = row;
  const label = labelOf.get(doc.id) ?? '';
  const frontmatter = toFrontmatter([
    ['id', doc.id],
    ['title', label],
    ['path', [...ancestry, label].join(' / ')],
    ['parent', doc.parentId === ROOT_ID ? undefined : doc.parentId],
    ['created', doc.createdAt],
    ['updated', doc.updatedAt],
    ['edits', edits],
  ]);
  const body = rewriteDocumentLinks(doc.body, labelOf).trim();
  return body ? `${frontmatter}\n\n${body}` : frontmatter;
}

/** The whole notebook as one file: every document's frontmatter block, tree order, blank-line
    separated. `null` when there is nothing to export. */
export async function buildNotebookMergedMarkdown(): Promise<string | null> {
  const collected = await collect();
  if (!collected) return null;
  const { rows, labelOf, editsOf } = collected;
  return rows.map((row) => buildBlock(row, labelOf, editsOf.get(row.doc.id) ?? 0)).join('\n\n');
}

/** Path characters a filesystem (or a ZIP reader disagreeing about one) would choke on, replaced the
    same way the people export's zipEntryNames already does. */
function sanitizeSegment(name: string, fallback: string): string {
  const base = name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '-').trim();
  return base || fallback;
}

/**
 * The whole notebook as a ZIP, with the tree as real nested folders — the approach this file's own
 * comment used to name as the better fit once a filename was a plugin's to spend (see git history).
 * A document with children becomes both `Name.md` (its own content) *and* a same-named directory
 * holding them, which a real filesystem — and `lib/zip.ts`, which stores a `name` verbatim — has no
 * trouble with.
 *
 * Deduplication (`Notes`, `Notes (2)`) is scoped per directory rather than globally, so two unrelated
 * branches of the tree that each happen to hold a document called "Notes" don't collide with, or
 * rename, each other.
 */
export async function buildNotebookZipEntries(): Promise<ZipTextFile[]> {
  const collected = await collect();
  if (!collected) return [];
  const { rows, labelOf, editsOf } = collected;
  const untitled = i18n.t('plugins.notebook.untitled');

  const usedInDir = new Map<string, Set<string>>();
  const dirOf = new Map<string, string>();
  const files: ZipTextFile[] = [];

  for (const row of rows) {
    const { doc } = row;
    const parentDir = doc.parentId === ROOT_ID ? '' : (dirOf.get(doc.parentId) ?? '');
    const used = usedInDir.get(parentDir) ?? new Set<string>();
    usedInDir.set(parentDir, used);

    const base = sanitizeSegment(labelOf.get(doc.id) ?? untitled, untitled);
    let candidate = base;
    for (let n = 2; used.has(candidate); n++) candidate = `${base} (${n})`;
    used.add(candidate);

    dirOf.set(doc.id, parentDir ? `${parentDir}/${candidate}` : candidate);
    files.push({
      name: `${parentDir ? `${parentDir}/` : ''}${candidate}.md`,
      content: buildBlock(row, labelOf, editsOf.get(doc.id) ?? 0),
    });
  }

  return files;
}
