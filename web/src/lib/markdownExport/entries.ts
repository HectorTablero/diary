import type { EntryDto } from '@diary/shared';
import { normalize } from '@/lib/tokens';
import { buildImportanceLegend } from './importanceLegend';

export interface EntriesMarkdownOptions {
  from: string | null;
  to: string | null;
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
   info about them can leak into the export by construction. */
export function buildEntriesMarkdown(entries: EntryDto[], options: EntriesMarkdownOptions): string {
  const range =
    options.from || options.to ? ` (${options.from ?? '…'} – ${options.to ?? '…'})` : '';
  const lines: string[] = [
    `# Diary export${range}`,
    '',
    buildMentionNote(),
    buildImportanceLegend(),
    '---',
    '',
  ];

  const byDate = new Map<string, EntryDto[]>();
  for (const entry of entries) {
    const list = byDate.get(entry.dateKey);
    if (list) list.push(entry);
    else byDate.set(entry.dateKey, [entry]);
  }

  for (const date of [...byDate.keys()].sort()) {
    lines.push(`## ${date}`, '');
    const dayEntries = byDate.get(date)!.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    for (const entry of dayEntries) {
      lines.push(`- [importance ${entry.importance}] ${entry.content}`);
      /* Only what the entry does not already say. A tag typed as #work, or a person the sentence
         names outright, is repeated by a line underneath it — and an export of a year of entries is
         mostly such repetition, which buries the handful of links that genuinely add something: the
         person an entry is about without naming, the tag chosen from the picker and never typed. */
      const tags = entry.tags.filter((tag) => !writtenInText(tag.name, entry.content));
      const people = entry.people.filter((person) => !writtenInText(person.name, entry.content));
      if (tags.length) lines.push(`  Tags: ${tags.map((t) => `#${t.name}`).join(', ')}`);
      if (people.length) lines.push(`  Mentions: ${people.map((p) => p.name).join(', ')}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}

/** What the absence of a `Tags:` or `Mentions:` line means, said once at the top rather than left
    for the reader to infer. Without it an agent has no way to tell "no tags" from "the tags are in
    the sentence already", and would read the second as the first. English for the reason
    `buildImportanceLegend` is: these exports are meant for an agent, so they stay in one language
    regardless of what the app is set to. */
function buildMentionNote(): string {
  return [
    '## Tags and mentions',
    '',
    'An entry can be linked to tags and to people. Those links are listed under it as `Tags:` and',
    "`Mentions:` lines — but only the ones the entry's own text does not already name, whether as an",
    '`#tag` / `@name` token or as a plain word. So a missing line means the text already says it, not',
    'that the entry has no tags or mentions.',
    '',
  ].join('\n');
}
