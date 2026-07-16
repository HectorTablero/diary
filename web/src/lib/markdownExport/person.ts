import type { EntryDto, PersonDto } from '@diary/shared';
import { ageOn } from '@/lib/birthday';
import { buildImportanceLegend } from './importanceLegend';

export interface PersonMarkdownOptions {
  aliases: boolean;
  tags: boolean;
  workInfo: boolean;
  notes: boolean;
  saidTimeline: boolean;
  unsaidCount: boolean;
  age: boolean;
  checkupInterval: boolean;
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
  if (options.aliases && person.aliases.length) {
    meta.push(`Also known as: ${person.aliases.join(', ')}`);
  }
  if (options.workInfo && (person.company || person.jobTitle)) {
    meta.push(
      [person.company && `Company: ${person.company}`, person.jobTitle && `Role: ${person.jobTitle}`]
        .filter(Boolean)
        .join(' · '),
    );
  }
  if (options.age) {
    // No birthday, or one without a year — age isn't knowable, so say nothing rather than a
    // placeholder line.
    const age = person.birthday ? ageOn(person.birthday) : null;
    if (age !== null) meta.push(`Age: ${age}`);
  }
  if (options.checkupInterval && person.checkupIntervalDays !== null) {
    meta.push(`Checkup reminder: every ${person.checkupIntervalDays} days`);
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
        : `Every entry mentioning ${person.name} has been marked as said.`,
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
        lines.push(`- [importance ${entry.importance}] **${entry.dateKey}** (said ${saidAt}) — ${entry.content}`);
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

/** Explains the shape of the per-person sections that follow, so an agent parsing a merged
    multi-person document knows what to expect — which lines are present at all depends on
    `options`, and most of those that are present can still be individually absent per person
    (e.g. a real `Age:` line only when a full birthday is on file). Generated fresh from
    `options` rather than hardcoded, since a field the user turned off shouldn't be described
    either. */
function buildStructureLegend(options: PersonMarkdownOptions): string {
  const lines: string[] = [
    '# Document structure',
    '',
    'Each person below follows this structure. A described field can still be missing for a given ' +
      'person when the condition next to it isn\'t met — that\'s expected, not an error.',
    '',
    '- `# Briefing: <name>` — one section per person.',
  ];

  const metaFields: string[] = [];
  if (options.aliases) {
    metaFields.push('`Also known as: <name>, <name>, ...` — present only if the person has aliases on file.');
  }
  if (options.workInfo) {
    metaFields.push(
      '`Company: <company> · Role: <job title>` — either half can be missing on its own; the whole line is absent if neither is on file.',
    );
  }
  if (options.age) {
    metaFields.push(
      '`Age: <number>` — present only with a full birthday (year included) on file; otherwise omitted rather than shown as "unknown".',
    );
  }
  if (options.checkupInterval) {
    metaFields.push('`Checkup reminder: every <N> days` — present only if checkups are enabled for this person.');
  }
  if (options.tags) {
    metaFields.push('`Tags: #tag, #tag, ...` — present only if the person has tags.');
  }
  if (metaFields.length) {
    lines.push('- A block of bold one-line facts right under the heading, each optional and independent:');
    for (const field of metaFields) lines.push(`  - ${field}`);
  }

  if (options.notes) {
    lines.push('- `## Notes` — the person\'s notes verbatim; the whole section is absent if notes are empty.');
  }
  if (options.events) {
    lines.push(
      '- `## Events` — one bullet per event: `- **<title>** (<start date>[ → <end date>]) — Asked: yes (<date>)|not yet`.' +
        ' The date range collapses to a single date for single-day events. Section absent if the person has no events.',
    );
  }
  if (options.unsaidCount) {
    lines.push(
      '- `## Not yet caught up on` — always present: a sentence with a count of unmarked mentions, or a sentence saying everything has been said.',
    );
  }
  if (options.saidTimeline) {
    lines.push(
      '- `## Timeline (said to <name>)` — always present: one bullet per entry already marked' +
        ' as said, `- [importance <1-5>] **<entry date>** (said <said date>) — <content>` (see the' +
        ' importance scale below), optionally followed by an indented `Tags: ... · Also mentions: ...`' +
        ' line when that entry has either. A single sentence replaces the list if nothing has been' +
        ' marked as said yet.',
    );
  }

  lines.push('', '---', '');
  return lines.join('\n');
}

/** Several people's briefings joined into one document — the "merge" output mode when more than
    one person is selected (the alternative being a zip of individually-named files, one per
    person, built by the caller from repeated buildPersonMarkdown calls). Opens with a structure
    legend (see buildStructureLegend) and, when the timeline section is included, the importance
    scale it references. */
export function buildPeopleMarkdown(
  people: { person: PersonDto; said: EntryDto[]; unsaidCount: number }[],
  options: PersonMarkdownOptions,
): string {
  const sections = people.map(({ person, said, unsaidCount }) =>
    buildPersonMarkdown(person, said, unsaidCount, options),
  );
  const legend = buildStructureLegend(options) + (options.saidTimeline ? `\n${buildImportanceLegend()}\n---\n\n` : '');
  return `${legend}${sections.join('\n---\n\n')}`;
}
