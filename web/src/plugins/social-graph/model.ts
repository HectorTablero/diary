import {
  DEFAULT_TAG_COLORS,
  HEX_COLOR_REGEX,
  OBJECT_ID_REGEX,
  type PluginRecordDto,
} from '@diary/shared';

/**
 * The social graph's two row shapes, both undated, one row each.
 *
 * - A **link** is one relationship between two people, stored with its pair sorted (`a < b`) so
 *   "Ana–Luis" and "Luis–Ana" are the same row. One row per link rather than one list means editing
 *   two different relationships on two devices can't collide.
 * - A **group** is a name, a colour and its members. A person can be in any number of them.
 *
 * Neither row is cleaned up when a person is deleted: the read side drops ids it doesn't recognise
 * (see `useSocialGraph`), which is the only place that has the people list to check against.
 */

export const PLUGIN_ID = 'social-graph';

/**
 * Stands for the diary's owner, who isn't a row in the People list. A valid ObjectId on purpose, so
 * links and group memberships involving "you" are stored and parsed exactly like anyone else's;
 * all zeros is a timestamp of 1970, which no generated id will ever be.
 */
export const ME_ID = '000000000000000000000000';

export const STRENGTHS = [1, 2, 3, 4, 5] as const;
export type Strength = (typeof STRENGTHS)[number];
/** What a link starts as when nothing was picked — "connect everyone", say. The middle, on purpose. */
export const DEFAULT_STRENGTH: Strength = 3;

export const MAX_NOTE_LENGTH = 1000;
export const MAX_GROUP_NAME_LENGTH = 60;
/** 24-char ids, quoted and comma-separated, inside MAX_PLUGIN_DATA_BYTES (4096) with room to spare. */
export const MAX_GROUP_MEMBERS = 120;

/** Same palette tags cycle through, so a group's colour sits comfortably beside a tag chip. */
export const GROUP_COLORS = DEFAULT_TAG_COLORS;

export interface Link {
  id: string;
  a: string;
  b: string;
  strength: Strength;
  note: string;
  updatedAt: string;
}

export interface Group {
  id: string;
  name: string;
  color: string;
  members: string[];
}

export const pairKey = (x: string, y: string): string => (x < y ? `${x}:${y}` : `${y}:${x}`);

export const linkData = (x: string, y: string, strength: Strength, note: string) => {
  const [a, b] = x < y ? [x, y] : [y, x];
  return { kind: 'link', a, b, strength, note: note.slice(0, MAX_NOTE_LENGTH) };
};

export const groupData = (name: string, color: string, members: readonly string[]) => ({
  kind: 'group',
  name: name.trim().slice(0, MAX_GROUP_NAME_LENGTH),
  color,
  members: [...new Set(members)].slice(0, MAX_GROUP_MEMBERS),
});

const isStrength = (value: unknown): value is Strength =>
  typeof value === 'number' && (STRENGTHS as readonly number[]).includes(value);

const isId = (value: unknown): value is string =>
  typeof value === 'string' && OBJECT_ID_REGEX.test(value);

/** Parse-don't-trust: another build, or a hand-edited backup, may have written this. */
export function parseLink(row: PluginRecordDto): Link | null {
  const { kind, a, b, strength, note } = row.data;
  if (kind !== 'link' || !isId(a) || !isId(b) || a === b || !isStrength(strength)) return null;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  return {
    id: row.id,
    a: lo,
    b: hi,
    strength,
    note: typeof note === 'string' ? note.slice(0, MAX_NOTE_LENGTH) : '',
    updatedAt: row.updatedAt,
  };
}

export function parseGroup(row: PluginRecordDto): Group | null {
  const { kind, name, color, members } = row.data;
  if (kind !== 'group' || typeof name !== 'string' || !name.trim()) return null;
  return {
    id: row.id,
    name: name.slice(0, MAX_GROUP_NAME_LENGTH),
    color: typeof color === 'string' && HEX_COLOR_REGEX.test(color) ? color : GROUP_COLORS[0],
    members: Array.isArray(members) ? [...new Set(members.filter(isId))] : [],
  };
}

/**
 * Every row, split and cleaned: unparseable rows dropped, and two links for the same pair —
 * possible when two offline devices connected the same people — collapsed to the newest. The
 * loser's row id is returned in `duplicateLinkIds` so the caller can delete it rather than carry
 * it forever.
 */
export function parseGraph(rows: readonly PluginRecordDto[]) {
  const byPair = new Map<string, Link>();
  const duplicateLinkIds: string[] = [];
  const groups: Group[] = [];
  for (const row of rows) {
    const link = parseLink(row);
    if (link) {
      const key = pairKey(link.a, link.b);
      const existing = byPair.get(key);
      if (!existing) byPair.set(key, link);
      else if (existing.updatedAt < link.updatedAt) {
        duplicateLinkIds.push(existing.id);
        byPair.set(key, link);
      } else duplicateLinkIds.push(link.id);
      continue;
    }
    const group = parseGroup(row);
    if (group) groups.push(group);
  }
  groups.sort((x, y) => x.name.localeCompare(y.name));
  return { links: [...byPair.values()], groups, duplicateLinkIds };
}

/**
 * How much less an entry about someone a person knows is worth telling them than one about them:
 * a talking point via a connection scores CONNECTION_PENALTY × strength/5 of a direct mention, so
 * even a very close friend's news (0.5) sits below a shared tag (0.6).
 */
export const CONNECTION_PENALTY = 0.5;

/** Everyone `personId` is linked to, weighted for talking points. "You" never appear in entries. */
export function connectionWeights(links: readonly Link[], personId: string): Map<string, number> {
  const weights = new Map<string, number>();
  for (const link of links) {
    const other = link.a === personId ? link.b : link.b === personId ? link.a : null;
    if (other && other !== ME_ID) weights.set(other, (CONNECTION_PENALTY * link.strength) / 5);
  }
  return weights;
}

/** The first palette colour no group uses yet, so a new group is distinguishable without asking. */
export function nextGroupColor(groups: readonly Group[]): string {
  const used = new Set(groups.map((group) => group.color.toLowerCase()));
  return (
    GROUP_COLORS.find((color) => !used.has(color.toLowerCase())) ??
    GROUP_COLORS[groups.length % GROUP_COLORS.length]
  );
}
