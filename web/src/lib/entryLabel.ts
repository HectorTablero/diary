/** One-line stand-in for an entry's text, for the places that have to *name* an entry rather than
    show it — chiefly the accessible label on a row's ⋯ menu, so twenty rows read as twenty distinct
    controls instead of twenty identical "button"s (the shape people.personActions already uses for
    the People list).

    Deliberately short: a name is read out in full every time the control is focused, while an entry
    can run to several paragraphs. Only the first line survives, cut at `max` graphemes-ish. */
export function entrySummary(content: string, max = 40): string {
  const [line = ''] = content.trim().split('\n');
  const trimmed = line.trim();
  return trimmed.length > max ? `${trimmed.slice(0, max).trimEnd()}…` : trimmed;
}
