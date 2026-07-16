import type { EntryDto, PersonDto } from '@diary/shared';
import { ageOn } from '@/lib/birthday';

export interface PersonMarkdownOptions {
  tags: boolean;
  workInfo: boolean;
  notes: boolean;
  saidTimeline: boolean;
  unsaidCount: boolean;
  age: boolean;
  events: boolean;
}

/* A briefing sheet for one person: everything worth telling an agent before asking it to help
   catch them up. `said` is the entries already marked as said to them (see
   repo.ts's getTalkingPoints), `unsaidCount` the number that mention them but haven't been. Every
   section is independently toggleable per `options` — nothing here is fixed. */
export function buildPersonMarkdown(
  person: PersonDto,
  said: EntryDto[],
  unsaidCount: number,
  options: PersonMarkdownOptions,
): string {
  const lines: string[] = [`# Briefing: ${person.name}`, ''];

  const meta: string[] = [];
  if (options.workInfo && (person.company || person.jobTitle)) {
    meta.push(
      [person.company && `Company: ${person.company}`, person.jobTitle && `Role: ${person.jobTitle}`]
        .filter(Boolean)
        .join(' · '),
    );
  }
  if (options.age) {
    if (!person.birthday) meta.push('Age: unknown (no birthday on file)');
    else {
      const age = ageOn(person.birthday);
      meta.push(age === null ? 'Age: unknown (birthday without year)' : `Age: ${age}`);
    }
  }
  if (options.tags && person.tags.length) {
    meta.push(`Tags: ${person.tags.map((t) => `#${t.name}`).join(', ')}`);
  }
  if (meta.length) lines.push(...meta.map((m) => `**${m}**`), '');

  if (options.notes && person.notes.trim()) {
    lines.push('## Notes', '', person.notes.trim(), '');
  }

  if (options.events && person.events.length) {
    lines.push('## Events', '');
    for (const event of person.events) {
      const range = event.endDate ? `${event.startDate} → ${event.endDate}` : event.startDate;
      const asked = event.askedAt ? `yes (${event.askedAt.slice(0, 10)})` : 'not yet';
      lines.push(`- **${event.title}** (${range}) — Asked: ${asked}`);
    }
    lines.push('');
  }

  if (options.unsaidCount) {
    lines.push('## Not yet caught up on', '');
    lines.push(
      unsaidCount > 0
        ? `${unsaidCount} entr${unsaidCount === 1 ? 'y mentions' : 'ies mention'} ${person.name} since they were added that haven't been marked as said to them yet.`
        : `Nothing outstanding — every entry mentioning ${person.name} has been marked as said.`,
    );
    lines.push('');
  }

  if (options.saidTimeline) {
    lines.push(`## Timeline (said to ${person.name})`, '');
    if (!said.length) {
      lines.push('Nothing marked as said yet.', '');
    } else {
      for (const entry of said) {
        const saidAt = entry.saidTo.find((s) => s.personId === person.id)?.at.slice(0, 10) ?? '?';
        lines.push(`- **${entry.dateKey}** (said ${saidAt}) — ${entry.content}`);
        const otherTags = entry.tags.map((t) => `#${t.name}`);
        const otherPeople = entry.people.filter((p) => p.id !== person.id).map((p) => p.name);
        const extras = [
          otherTags.length ? `Tags: ${otherTags.join(', ')}` : null,
          otherPeople.length ? `Also mentions: ${otherPeople.join(', ')}` : null,
        ].filter((x): x is string => x !== null);
        if (extras.length) lines.push(`  ${extras.join(' · ')}`);
      }
      lines.push('');
    }
  }

  return `${lines.join('\n').trimEnd()}\n`;
}
