import {
  MAX_PLUGIN_DOCUMENT_DEPTH,
  MAX_PLUGIN_DOCUMENT_TITLE_LENGTH,
  NO_PARENT_KEY,
  UNDATED_KEY,
  type PluginDocumentDto,
} from '@diary/shared';

/**
 * What a notebook row is, and the handful of rules about the tree.
 *
 * The storage layer (`db/pluginDocuments.ts`) is deliberately ignorant of all of this — it moves
 * rows. Everything that knows a row is a *thought*, that a folder is just a thought with children,
 * or that a title falls back to the first line, is here.
 */

export const NOTEBOOK_PLUGIN_ID = 'notebook';

/** A row is a document when it isn't about a day. The discriminator, in one place. */
export const isDocument = (row: PluginDocumentDto): boolean => row.dateKey === UNDATED_KEY;

export const isRevision = (row: PluginDocumentDto): boolean => row.dateKey !== UNDATED_KEY;

export const ROOT_ID = NO_PARENT_KEY;

/**
 * What to call a document in a list.
 *
 * A title is optional on purpose: the point of the "New" button is to be writing a second later, and
 * demanding a name first is the friction that stops a thought being written down at all. So an
 * untitled document is labelled by its own first line, which is what someone would have called it
 * anyway — and typing a first line is the same keystrokes as typing a title, without the field.
 *
 * `untitled` is passed in rather than translated here so this file stays a pure module: it is
 * covered by the logic test project, which has no i18n.
 */
export function documentLabel(doc: PluginDocumentDto, untitled: string): string {
  const explicit = doc.title.trim();
  if (explicit) return explicit;
  const firstLine = doc.body
    .split('\n')
    .map((line) => line.replace(/^#{1,6}\s+/, '').trim())
    .find((line) => line.length > 0);
  if (!firstLine) return untitled;
  return firstLine.length > MAX_PLUGIN_DOCUMENT_TITLE_LENGTH
    ? `${firstLine.slice(0, MAX_PLUGIN_DOCUMENT_TITLE_LENGTH - 1)}…`
    : firstLine;
}

/** A one-line taste of what is inside, for the child rows under a document. */
export function documentPreview(doc: PluginDocumentDto, label: string, max = 140): string {
  const body = doc.body
    .split('\n')
    .map((line) => line.replace(/^[#>\-*\s]+/, '').trim())
    .filter(Boolean)
    /* The line the label was taken from is dropped, not shown twice — an untitled document would
       otherwise render its first line as both its name and its preview. */
    .filter((line) => line !== label)
    .join(' ');
  return body.length > max ? `${body.slice(0, max - 1)}…` : body;
}

export const sortDocuments = (docs: PluginDocumentDto[]): PluginDocumentDto[] =>
  [...docs].sort((a, b) => a.sortKey.localeCompare(b.sortKey));

/**
 * The chain from a root down to this document, root first, including the document itself.
 *
 * Walks `parentId` through a map rather than the database, so a breadcrumb costs no reads once the
 * tree's *rows* are in hand. Guarded against a cycle by the depth cap: a parent pointer that loops
 * would otherwise hang the render, and a cycle is reachable through nothing worse than two devices
 * reparenting the same pair of documents in opposite directions while offline.
 */
export function ancestorPath(
  documentId: string,
  byId: ReadonlyMap<string, PluginDocumentDto>,
): PluginDocumentDto[] {
  const path: PluginDocumentDto[] = [];
  let current = byId.get(documentId);
  const seen = new Set<string>();
  while (current && !seen.has(current.id) && path.length <= MAX_PLUGIN_DOCUMENT_DEPTH + 1) {
    seen.add(current.id);
    path.unshift(current);
    current = current.parentId === ROOT_ID ? undefined : byId.get(current.parentId);
  }
  return path;
}

/** Every id at or below this one — what a delete has to remove, since the route doesn't cascade. */
export function subtreeIds(
  documentId: string,
  documents: readonly PluginDocumentDto[],
): Set<string> {
  const childrenOf = new Map<string, PluginDocumentDto[]>();
  for (const doc of documents) {
    const siblings = childrenOf.get(doc.parentId) ?? [];
    siblings.push(doc);
    childrenOf.set(doc.parentId, siblings);
  }
  const ids = new Set<string>();
  const walk = (id: string) => {
    if (ids.has(id)) return; // a cycle, for the same reason ancestorPath guards against one
    ids.add(id);
    for (const child of childrenOf.get(id) ?? []) walk(child.id);
  };
  walk(documentId);
  return ids;
}

/** How deep the deepest descendant of this document sits below it. A leaf is 0. */
export function subtreeHeight(
  documentId: string,
  documents: readonly PluginDocumentDto[],
  depth = 0,
): number {
  if (depth > MAX_PLUGIN_DOCUMENT_DEPTH) return depth;
  const children = documents.filter((d) => d.parentId === documentId);
  if (!children.length) return depth;
  return Math.max(...children.map((c) => subtreeHeight(c.id, documents, depth + 1)));
}

/** How far below the root a document sits. A root is 0. */
export const documentDepth = (
  documentId: string,
  byId: ReadonlyMap<string, PluginDocumentDto>,
): number => Math.max(0, ancestorPath(documentId, byId).length - 1);

/**
 * Whether `documentId` may be moved under `targetId`.
 *
 * Three ways it may not, and each is a real accident rather than a theoretical one: into itself,
 * into its own descendant (which detaches the whole subtree from the tree and leaves it reachable
 * from nowhere), or somewhere that would push its deepest child past the depth cap.
 */
export function canMoveUnder(
  documentId: string,
  targetId: string,
  documents: readonly PluginDocumentDto[],
  byId: ReadonlyMap<string, PluginDocumentDto>,
): boolean {
  if (targetId === documentId) return false;
  if (targetId !== ROOT_ID && subtreeIds(documentId, documents).has(targetId)) return false;
  const targetDepth = targetId === ROOT_ID ? -1 : documentDepth(targetId, byId);
  return targetDepth + 1 + subtreeHeight(documentId, documents) <= MAX_PLUGIN_DOCUMENT_DEPTH;
}
