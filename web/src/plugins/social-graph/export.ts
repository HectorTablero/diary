import { getPeople } from '@/db/repo';
import { getUndatedRecords } from '@/db/pluginRecords';
import type { ZipTextFile } from '@/lib/zip';
import type { PluginExportOptions } from '../types';
import en from './locales/en.json';
import { ME_ID, parseGraph, PLUGIN_ID, STRENGTHS, type Strength } from './model';

/**
 * The social graph's own export, in the export dialog's two modes:
 *
 * - **One file**: a Markdown document to read — the closeness scale, the groups and their members,
 *   and every connection in one table — for a person, or an agent, without the app.
 * - **ZIP**: that document plus `nodes.csv` and `edges.csv`, which Gephi, Cytoscape, networkx or a
 *   spreadsheet open as they are. Column names are the ones those tools look for (`Id`, `Label`,
 *   `Source`, `Target`, `Weight`), so they stay in English whatever the app's language.
 *
 * People are named, never identified by id: the app keeps names unique. Everything is sorted by
 * name, so the same graph always exports to the same bytes.
 *
 * English whatever the app is set to, like the diary export (see buildImportanceLegend): these are
 * written for an agent, and one language is what keeps them comparable. So the closeness words come
 * from en.json directly, and "you" is always `You`.
 */

export interface GraphExportOptions {
  /** "You", with your connections and groups. */
  me: boolean;
  /** Each connection's note. Off unless asked for: they can be personal. */
  notes: boolean;
  /** Leave out people with no connections and no groups. */
  skipIsolated: boolean;
}

export const readOptions = (options: PluginExportOptions): GraphExportOptions => ({
  me: options.me === true,
  notes: options.notes === true,
  skipIsolated: options.skipIsolated !== false,
});

const byName = (a: string, b: string) => a.localeCompare(b);
const YOU = 'You';
const word = (strength: Strength): string => en[`strength${strength}`];
const closeness = (strength: Strength) => `${strength} – ${word(strength)}`;

async function collect({ me, skipIsolated }: GraphExportOptions) {
  const [rows, people] = await Promise.all([getUndatedRecords(PLUGIN_ID), getPeople()]);
  const { links, groups } = parseGraph(rows);
  const names = new Map(people.map((person) => [person.id, person.name]));
  if (me) names.set(ME_ID, YOU);

  const edges = links
    .filter((link) => names.has(link.a) && names.has(link.b))
    .map((link) => {
      const [a, b] = [names.get(link.a)!, names.get(link.b)!].sort(byName);
      return { a, b, strength: link.strength, note: link.note.replace(/\s+/g, ' ').trim() };
    })
    .sort((x, y) => byName(x.a, y.a) || byName(x.b, y.b));

  const named = groups
    .map((group) => ({
      name: group.name,
      members: group.members.flatMap((id) => names.get(id) ?? []).sort(byName),
    }))
    .filter((group) => group.members.length > 0)
    .sort((x, y) => byName(x.name, y.name));

  const groupsOf = new Map<string, string[]>();
  for (const group of named) {
    for (const member of group.members) {
      groupsOf.set(member, [...(groupsOf.get(member) ?? []), group.name]);
    }
  }
  const linked = new Set(edges.flatMap((edge) => [edge.a, edge.b]));
  const isolated = (name: string) => !linked.has(name) && !groupsOf.has(name);
  const you = names.get(ME_ID);
  const nodes = [...names.values()]
    .filter((name) => !skipIsolated || !isolated(name))
    // "You" first, as on the graph; everyone else by name.
    .sort((x, y) => Number(y === you) - Number(x === you) || byName(x, y));

  return { edges, groups: named, groupsOf, nodes, isolated };
}

/** A pipe inside a name or note would end its table cell early. */
const cell = (text: string) => text.replace(/\|/g, '\\|');

/**
 * What the document's notation means, said once before it is used — the diary export's preamble,
 * for the same reason: the reader is an agent with no app to check against. Each paragraph only
 * says what this particular export did (with or without you, notes, the unconnected).
 */
function preamble(data: Collected, { me, notes, skipIsolated }: GraphExportOptions): string[] {
  return [
    '## Closeness scale',
    '',
    'Each connection joins two people and says how close they are, from 1 to 5:',
    '',
    ...STRENGTHS.map((strength) => `- **${strength} — ${word(strength)}**`),
    '',
    '## Groups and connections',
    '',
    'A group is a named set of people, such as a family or a team. Someone can be in any number of',
    'groups, or in none; each group below lists its members.',
    '',
    'Each pair of people appears once, in one row of the table, so a row reads in both directions:',
    '"Ana | Luis" also means Luis knows Ana. Two people with no row are simply not recorded as',
    'knowing each other, which is not the same as being strangers.',
    ...(notes
      ? [
          '',
          "The `Note` column is what the diary's author wrote about how the two know each other; it",
          'is empty where they wrote nothing.',
        ]
      : []),
    '',
    '## Names',
    '',
    'People are named exactly as in the diary, and no two share a name.',
    ...(me && data.nodes.includes(YOU)
      ? ["`You` is the diary's author, with their own connections and groups."]
      : ["The diary's author is left out, along with their own connections and groups."]),
    skipIsolated
      ? 'People with no connections and no groups are left out.'
      : 'People with no connections and no groups are listed at the end.',
    '',
    '---',
    '',
  ];
}

type Collected = Awaited<ReturnType<typeof collect>>;

function markdown(data: Collected, options: GraphExportOptions) {
  const lines = ['# Social graph export', '', ...preamble(data, options)];
  if (data.groups.length) {
    lines.push('## Groups');
    for (const group of data.groups) {
      lines.push('', `### ${group.name}`, '', ...group.members.map((member) => `- ${member}`));
    }
    lines.push('');
  }
  if (data.edges.length) {
    const head = ['Person', 'Person', 'Closeness'];
    if (options.notes) head.push('Note');
    lines.push(
      '## Connections',
      '',
      `| ${head.join(' | ')} |`,
      `| ${head.map(() => '---').join(' | ')} |`,
      ...data.edges.map((edge) => {
        const row = [edge.a, edge.b, closeness(edge.strength)];
        if (options.notes) row.push(edge.note);
        return `| ${row.map(cell).join(' | ')} |`;
      }),
      '',
    );
  }
  const alone = data.nodes.filter(data.isolated);
  if (alone.length) {
    lines.push('## Not connected to anyone', '', ...alone.map((name) => `- ${name}`), '');
  }
  return lines.join('\n');
}

/** RFC 4180: quoted only when it has to be, quotes doubled. */
const csvField = (value: string | number) => {
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};
const csv = (rows: (string | number)[][]) =>
  `${rows.map((row) => row.map(csvField).join(',')).join('\r\n')}\r\n`;

const isEmpty = (data: Awaited<ReturnType<typeof collect>>) =>
  !data.edges.length && !data.groups.length;

export async function buildGraphMerged(options: PluginExportOptions): Promise<string | null> {
  const resolved = readOptions(options);
  const data = await collect(resolved);
  return isEmpty(data) ? null : markdown(data, resolved);
}

export async function buildGraphZip(options: PluginExportOptions): Promise<ZipTextFile[]> {
  const resolved = readOptions(options);
  const data = await collect(resolved);
  if (isEmpty(data)) return [];
  const edgeHead = ['Source', 'Target', 'Weight', 'Closeness'];
  if (resolved.notes) edgeHead.push('Note');
  return [
    { name: 'social-graph.md', content: markdown(data, resolved) },
    {
      name: 'nodes.csv',
      content: csv([
        ['Id', 'Label', 'Groups'],
        ...data.nodes.map((name) => [name, name, (data.groupsOf.get(name) ?? []).join('; ')]),
      ]),
    },
    {
      name: 'edges.csv',
      content: csv([
        edgeHead,
        ...data.edges.map((edge) => {
          const row: (string | number)[] = [edge.a, edge.b, edge.strength, word(edge.strength)];
          if (resolved.notes) row.push(edge.note);
          return row;
        }),
      ]),
    },
  ];
}

/** "Include you" starts ticked only for someone who has connected themselves to anyone. */
export async function graphExportDefaults(): Promise<PluginExportOptions> {
  const [rows, people] = await Promise.all([getUndatedRecords(PLUGIN_ID), getPeople()]);
  const ids = new Set(people.map((person) => person.id));
  const other = (link: { a: string; b: string }) => (link.a === ME_ID ? link.b : link.a);
  return {
    me: parseGraph(rows).links.some(
      (link) => (link.a === ME_ID || link.b === ME_ID) && ids.has(other(link)),
    ),
  };
}
