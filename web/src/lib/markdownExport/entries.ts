import type { EntryDto } from '@diary/shared';
import { normalize } from '@/lib/tokens';
import { buildImportanceLegend } from './importanceLegend';

/**
 * Whether an entry's `Tags:` / `Mentions:` lines leave out what its text already names. Off: every
 * link is listed under its entry, so a reader never has to infer one from the sentence. Flip to
 * `true` to go back to listing only the links the text does not already say.
 */
export const OMIT_LINKS_NAMED_IN_TEXT = false;

export interface EntriesMarkdownOptions {
  from: string | null;
  to: string | null;
  /** Overrides `OMIT_LINKS_NAMED_IN_TEXT` for this export. */
  omitLinksNamedInText?: boolean;
}

/**
 * What enabled plugins want added to the document (see `collectPluginMarkdown`), already filtered
 * to the range and ordered by the manifest.
 *
 * Passed in rather than fetched here so this file stays what it is: a pure function from entries to
 * Markdown, with no database and no knowledge that plugins exist beyond these two shapes.
 */
export interface EntriesPluginContent {
  /** Blocks to place under a day's entries, keyed by `dateKey` — one inner array per plugin. */
  dayLines: ReadonlyMap<string, readonly (readonly string[])[]>;
  /** Each contributing plugin's note on how to read its lines, for the preamble. */
  notes: readonly (readonly string[])[];
}

/** A letter or a digit in any script — what has to sit either side of a name for it to be part of a
    longer word rather than the name itself. */
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

/**
 * Whether an entry's own text already names this tag or person.
 *
 * Matched on word boundaries over `normalize`d text, so "@Ana", "Ana" and "aná" all count and
 * "Anabel" does not. The marker forms fall out of the same rule for free: `@` and `#` are not word
 * characters, so a mention typed as a token is a boundary match on the bare name.
 *
 * Deliberately generous about what counts as "written down". The risk it takes is a name that is
 * also an ordinary word — a person called Mark in an entry about marking a calendar — where the
 * line is dropped although the text does not really name them. That is a line of metadata lost from
 * one entry; the alternative is repeating a name under every entry that already says it, on every
 * entry, which is what makes a long export tiring to read and easy to skim past.
 */
function writtenInText(name: string, content: string): boolean {
  const haystack = normalize(content);
  const needle = normalize(name.trim());
  if (!needle) return false;
  for (let at = haystack.indexOf(needle); at !== -1; at = haystack.indexOf(needle, at + 1)) {
    const before = haystack[at - 1];
    const after = haystack[at + needle.length];
    if ((!before || !WORD_CHARACTER.test(before)) && (!after || !WORD_CHARACTER.test(after))) {
      return true;
    }
  }
  return false;
}

/* Flat per-entry blocks, grouped by date — not a tree reconstruction. A date-range slice can
   legitimately include a child without its out-of-range parent, so tree fidelity isn't attempted.
   Mentioned people appear as names only (EntryDto.people is already {id, name}), so no contact
   info about them can leak into the export by construction.

   Plugin blocks land under the day they are about, after its entries. A day is therefore any date
   that either side has something for: a day with an expense and no entry written still gets its
   heading, because it is a day the diary can answer a question about. */
export function buildEntriesMarkdown(
  entries: EntryDto[],
  options: EntriesMarkdownOptions,
  plugins: Partial<EntriesPluginContent> = {},
): string {
  const { dayLines = new Map<string, readonly (readonly string[])[]>(), notes = [] } = plugins;
  const omitNamed = options.omitLinksNamedInText ?? OMIT_LINKS_NAMED_IN_TEXT;
  const range =
    options.from || options.to ? ` (${options.from ?? '…'} – ${options.to ?? '…'})` : '';
  const lines: string[] = [
    `# Diary export${range}`,
    '',
    buildMentionNote(omitNamed),
    buildImportanceLegend(),
    /* Beside the document's own two notes, and for the same reason they exist: everything this
       export uses a notation for explains it before using it, because the reader is an agent with
       no app to check against. A plugin only gets a paragraph here if it actually put lines in the
       document below — see `collectPluginMarkdown`. */
    ...notes.map((note) => `${note.join('\n')}\n`),
    '---',
    '',
  ];

  const byDate = new Map<string, EntryDto[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.dateKey);
    if (list) list.push(entry);
    else byDate.set(entry.dateKey, [entry]);
  }

  const dates = [...new Set([...byDate.keys(), ...dayLines.keys()])].sort();
  for (const date of dates) {
    lines.push(`## ${date}`, '');
    const dayEntries = (byDate.get(date) ?? []).sort((a, b) =>
      a.createdAt.localeCompare(b.createdAt),
    );
    for (const entry of dayEntries) {
      lines.push(`- [importance ${entry.importance}] ${entry.content}`);
      /* With `omitNamed`, only what the entry does not already say. A tag typed as #work, or a
         person the sentence names outright, is repeated by a line underneath it — and an export of
         a year of entries is mostly such repetition, which buries the handful of links that
         genuinely add something. Without it, every link is listed, so none has to be inferred. */
      const tags = omitNamed
        ? entry.tags.filter((tag) => !writtenInText(tag.name, entry.content))
        : entry.tags;
      const people = omitNamed
        ? entry.people.filter((person) => !writtenInText(person.name, entry.content))
        : entry.people;
      if (tags.length) lines.push(`  Tags: ${tags.map((t) => `#${t.name}`).join(', ')}`);
      if (people.length) lines.push(`  Mentions: ${people.map((p) => p.name).join(', ')}`);
    }
    /* Each plugin's block set off by a blank line, from the entries and from each other — they are
       separate lists that would otherwise run together into one, with the second plugin's heading
       reading as an item of the first's. Not before the first block on a day that has no entries,
       though: the heading has already left a blank line, and a second one reads as a day whose
       entries went missing. */
    const blocks = dayLines.get(date) ?? [];
    blocks.forEach((block, index) => {
      if (index > 0 || dayEntries.length) lines.push('');
      lines.push(...block);
    });
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** What the absence of a `Tags:` or `Mentions:` line means, said once at the top rather than left
    for the reader to infer. Without it an agent has no way to tell "no tags" from "the tags are in
    the sentence already", and would read the second as the first. English for the reason
    `buildImportanceLegend` is: these exports are meant for an agent, so they stay in one language
    regardless of what the app is set to. */
function buildMentionNote(omitNamed: boolean): string {
  const rule = omitNamed
    ? [
        'An entry can be linked to tags and to people. Those links are listed under it as `Tags:` and',
        "`Mentions:` lines — but only the ones the entry's own text does not already name, whether as an",
        '`#tag` / `@name` token or as a plain word. So a missing line means the text already says it, not',
        'that the entry has no tags or mentions.',
      ]
    : [
        'An entry can be linked to tags and to people. All of those links are listed under it as `Tags:`',
        "and `Mentions:` lines, whether or not the entry's own text also names them. A missing line means",
        'the entry has no tags or no mentions.',
      ];
  return ['## Tags and mentions', '', ...rule, ''].join('\n');
}
