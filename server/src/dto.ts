import type { EntryDto, EntryNode, PersonDto, PersonRefDto, SaidMark, TagDto } from '@diary/shared';
import { Types } from 'mongoose';
import type { PopulateOptions } from 'mongoose';

/* Lean documents come out of mongoose with ObjectId instances and populated refs;
   these mappers normalize them into the shared DTO shapes. */

type LeanRef = Types.ObjectId | { _id: Types.ObjectId };

const refId = (ref: LeanRef): string =>
  ref instanceof Types.ObjectId ? ref.toString() : ref._id.toString();

export interface LeanTag {
  _id: Types.ObjectId;
  name: string;
  color: string;
}

export interface LeanPerson {
  _id: Types.ObjectId;
  name: string;
  tags: LeanTag[];
  notes?: string;
  checkupIntervalDays?: number | null;
  lastCheckupAt?: Date;
  createdAt: Date;
}

export interface LeanSaidMark {
  person: LeanRef;
  at: Date;
}

export interface LeanEntry {
  _id: Types.ObjectId;
  content: string;
  dateKey: string;
  importance: number;
  tags: LeanTag[];
  people: { _id: Types.ObjectId; name: string }[];
  saidTo: LeanSaidMark[];
  hiddenFor: LeanRef[];
  parentId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

export const tagToDto = (tag: LeanTag): TagDto => ({
  id: tag._id.toString(),
  name: tag.name,
  color: tag.color,
});

export const personRefToDto = (person: { _id: Types.ObjectId; name: string }): PersonRefDto => ({
  id: person._id.toString(),
  name: person.name,
});

export const personToDto = (person: LeanPerson): PersonDto => ({
  id: person._id.toString(),
  name: person.name,
  tags: person.tags.map(tagToDto),
  notes: person.notes ?? '',
  checkupIntervalDays: person.checkupIntervalDays ?? null,
  lastCheckupAt: (person.lastCheckupAt ?? person.createdAt).toISOString(),
  createdAt: person.createdAt.toISOString(),
});

const saidMarkToDto = (mark: LeanSaidMark): SaidMark => ({
  personId: refId(mark.person),
  at: mark.at.toISOString(),
});

export const entryToDto = (entry: LeanEntry): EntryDto => ({
  id: entry._id.toString(),
  content: entry.content,
  dateKey: entry.dateKey,
  importance: entry.importance,
  tags: entry.tags.map(tagToDto),
  people: entry.people.map(personRefToDto),
  saidTo: entry.saidTo.map(saidMarkToDto),
  hiddenFor: entry.hiddenFor.map(refId),
  parentId: entry.parentId ? entry.parentId.toString() : null,
  createdAt: entry.createdAt.toISOString(),
  updatedAt: entry.updatedAt.toISOString(),
});

/** Assemble a flat list of entries into parent/children trees, oldest first per level. */
export function buildEntryTree(entries: LeanEntry[]): EntryNode[] {
  const nodes = new Map<string, EntryNode>();
  for (const entry of entries) {
    nodes.set(entry._id.toString(), { ...entryToDto(entry), children: [] });
  }
  const roots: EntryNode[] = [];
  for (const node of nodes.values()) {
    const parent = node.parentId ? nodes.get(node.parentId) : undefined;
    if (parent) parent.children.push(node);
    else roots.push(node);
  }
  const byCreation = (a: EntryNode, b: EntryNode) => a.createdAt.localeCompare(b.createdAt);
  const sortTree = (list: EntryNode[]) => {
    list.sort(byCreation);
    list.forEach((n) => sortTree(n.children));
  };
  sortTree(roots);
  return roots;
}

export const ENTRY_POPULATE: PopulateOptions[] = [
  { path: 'tags', select: 'name color' },
  { path: 'people', select: 'name' },
];
