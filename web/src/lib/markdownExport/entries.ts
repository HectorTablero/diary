import type { EntryDto } from '@diary/shared';

export interface EntriesMarkdownOptions {
  from: string | null;
  to: string | null;
}

/* Flat per-entry blocks, grouped by date — not a tree reconstruction. A date-range slice can
   legitimately include a child without its out-of-range parent, so tree fidelity isn't attempted.
   Mentioned people appear as names only (EntryDto.people is already {id, name}), so no contact
   info about them can leak into the export by construction. */
export function buildEntriesMarkdown(entries: EntryDto[], options: EntriesMarkdownOptions): string {
  const range = options.from || options.to ? ` (${options.from ?? '…'} – ${options.to ?? '…'})` : '';
  const lines: string[] = [`# Diary export${range}`, ''];

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
      if (entry.tags.length) lines.push(`  Tags: ${entry.tags.map((t) => `#${t.name}`).join(', ')}`);
      if (entry.people.length) lines.push(`  Mentions: ${entry.people.map((p) => p.name).join(', ')}`);
    }
    lines.push('');
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
