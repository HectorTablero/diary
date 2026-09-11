import type { PluginDocumentDto } from '@diary/shared';
import type { ZipTextFile } from '@/lib/zip';
import { getAllPluginDocuments, getDocumentRevisions } from '@/db/pluginDocuments';
import i18n from '@/i18n';
import { changesBetween, replay } from './history';
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
 * History is off by default and available on request — see `NotebookExportOptions.history` and
 * `buildHistorySection`. What is never exported is the patch *chain*, which is meaningless outside
 * this app; the option narrates it instead, as dated prose about what changed.
 */

/** Which of the optional sections this export writes. The keys are the ones the notebook's manifest
    declares in `exportOptions`, which is what puts a checkbox for each in the export dialog. */
export interface NotebookExportOptions {
  /** Append each document's day-by-day history, as labelled changes under a `## History` heading. */
  history: boolean;
}

/* A caller that passes nothing gets exactly the export that existed before this option did. */
const DEFAULTS: NotebookExportOptions = { history: false };

const resolve = (options?: Partial<NotebookExportOptions>): NotebookExportOptions => ({
  ...DEFAULTS,
  ...options,
});

interface ExportRow {
  doc: PluginDocumentDto;
  /** Ancestor labels, root first, not including this document's own. */
  ancestry: string[];
}

interface Collected {
  rows: ExportRow[];
  labelOf: ReadonlyMap<string, string>;
  revisionsOf: ReadonlyMap<string, PluginDocumentDto[]>;
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

  /* Fetched here rather than at each use because both things that want them want them per document
     and once: the `edits` count every block carries, and — when the option is on — the history
     section that replays them. */
  const revisionsOf = new Map(
    await Promise.all(
      rows.map(async ({ doc }) => [doc.id, await getDocumentRevisions(doc.id)] as const),
    ),
  );

  return { rows, labelOf, revisionsOf };
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

/**
 * One document's history as readable Markdown, or `''` when there is nothing to say.
 *
 * A heading per day carrying that day's `+n −m` — the same two numbers the day card and the history
 * dialog show, read off the row rather than recomputed, so the three can never disagree — then one
 * bullet per change beneath it.
 *
 * Each day's changes are the diff against the *previous listed day*, which is what makes the section
 * cumulative prose rather than a stack of snapshots: `replay` hands back the full text as of the end
 * of every day, and a day it leaves out (`+0 −0` — an edit typed and undone) left the text where it
 * found it, so skipping it loses nothing. A day whose changes all settle to nothing is dropped for
 * the same reason the history dialog hides one: a dated heading with no bullets under it is an entry
 * offering to show you nothing.
 *
 * Labelled in English like every other word this export writes (`id`, `path`, `edits`) — the file is
 * addressed to whatever reads it next, not to the app's UI.
 */
function buildHistorySection(revisions: readonly PluginDocumentDto[]): string {
  const blocks: string[] = [];
  let before = '';

  for (const day of replay(revisions)) {
    const changes = changesBetween(before, day.text);
    before = day.text;
    if (!changes.length) continue;

    const delta = [day.added > 0 ? `+${day.added}` : '', day.removed > 0 ? `−${day.removed}` : '']
      .filter(Boolean)
      .join(' ');
    const bullets = changes.map((change) =>
      change.kind === 'replaced'
        ? `- Replaced: "${change.before}" → "${change.after}"`
        : `- ${change.kind === 'added' ? 'Added' : 'Removed'}: "${change.text}"`,
    );
    blocks.push(`### ${day.dateKey}${delta ? ` — ${delta}` : ''}\n\n${bullets.join('\n')}`);
  }

  return blocks.length ? `## History\n\n${blocks.join('\n\n')}` : '';
}

function buildBlock(
  row: ExportRow,
  labelOf: ReadonlyMap<string, string>,
  revisions: readonly PluginDocumentDto[],
  options: NotebookExportOptions,
): string {
  const { doc, ancestry } = row;
  const label = labelOf.get(doc.id) ?? '';
  const frontmatter = toFrontmatter([
    ['id', doc.id],
    ['title', label],
    ['path', [...ancestry, label].join(' / ')],
    ['parent', doc.parentId === ROOT_ID ? undefined : doc.parentId],
    ['created', doc.createdAt],
    ['updated', doc.updatedAt],
    /* "Edits" is the number of distinct days a document has a revision for — the same
       day-granularity the calendar view and the day card already report writing in, not a keystroke
       count. Every row, including the ones the history section leaves out, which is why it is
       counted here rather than off that section. */
    ['edits', revisions.length],
  ]);
  /* The document's own Markdown, then its history under it — the one place this export adds a
     heading to prose it otherwise never touches. A document that already has its own `## History`
     ends up with two, which is part of what the option costs and part of why it is off by default. */
  const parts = [
    rewriteDocumentLinks(doc.body, labelOf).trim(),
    options.history ? buildHistorySection(revisions) : '',
  ].filter(Boolean);
  return [frontmatter, ...parts].join(`\n\n`);
}

/** The whole notebook as one file: every document's frontmatter block, tree order, blank-line
    separated. `null` when there is nothing to export. */
export async function buildNotebookMergedMarkdown(
  options?: Partial<NotebookExportOptions>,
): Promise<string | null> {
  const collected = await collect();
  if (!collected) return null;
  const { rows, labelOf, revisionsOf } = collected;
  const resolved = resolve(options);
  return rows
    .map((row) => buildBlock(row, labelOf, revisionsOf.get(row.doc.id) ?? [], resolved))
    .join('\n\n');
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
export async function buildNotebookZipEntries(
  options?: Partial<NotebookExportOptions>,
): Promise<ZipTextFile[]> {
  const collected = await collect();
  if (!collected) return [];
  const { rows, labelOf, revisionsOf } = collected;
  const resolved = resolve(options);
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
      content: buildBlock(row, labelOf, revisionsOf.get(doc.id) ?? [], resolved),
    });
  }

  return files;
}
