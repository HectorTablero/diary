/* Pure, dependency-free fuzzy search used by the AI assistant's query_people tool.
   Kept separate from the Mongo models so it's trivially unit-testable. */

export interface SearchablePerson {
  id: string;
  name: string;
  /** Nicknames the person also answers to — dictating "Ire" should still find "Irene". */
  aliases: string[];
  tagNames: string[];
  notes: string;
}

export interface ScoredPerson extends SearchablePerson {
  score: number;
}

/** Same normalization rule as web/src/lib/tokens.ts: NFD, strip diacritics, lowercase. */
export const normalize = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();

const tokenize = (s: string): string[] => normalize(s).split(/[^a-z0-9]+/).filter(Boolean);

function phoneticizeToken(token: string): string {
  return token
    .replace(/ph/g, 'f')
    .replace(/[bv]/g, 'b')
    .replace(/[ckq]/g, 'k')
    .replace(/[dt]/g, 't')
    .replace(/[gj]/g, 'g')
    .replace(/[szx]/g, 's')
    .replace(/y/g, 'i')
    .replace(/w/g, 'u')
    .replace(/h/g, '')
    .replace(/(.)\1+/g, '$1');
}

const phoneticizeTokens = (s: string): string[] => tokenize(s).map(phoneticizeToken).filter(Boolean);

/** Classic edit-distance DP, O(len(a) * len(b)). Inputs here are short tokens, not full text. */
function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  const prevRow = new Array<number>(b.length + 1);
  for (let j = 0; j <= b.length; j++) prevRow[j] = j;
  for (let i = 1; i <= a.length; i++) {
    let prevDiag = prevRow[0];
    prevRow[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prevRow[j];
      prevRow[j] =
        a[i - 1] === b[j - 1] ? prevDiag : 1 + Math.min(prevDiag, prevRow[j], prevRow[j - 1]);
      prevDiag = tmp;
    }
  }
  return prevRow[b.length];
}

/** Exact beats prefix beats substring beats fuzzy typo-tolerance; 0 when nothing matches well enough. */
function tokenScore(queryToken: string, targetToken: string): number {
  if (queryToken === targetToken) return 1.0;
  if (targetToken.startsWith(queryToken)) return 0.85;
  if (queryToken.length >= 3 && targetToken.includes(queryToken)) return 0.7;
  const maxLen = Math.max(queryToken.length, targetToken.length);
  if (maxLen === 0) return 0;
  const similarity = 1 - levenshtein(queryToken, targetToken) / maxLen;
  return similarity >= 0.6 ? similarity * 0.9 : 0;
}

/** Best per-query-token match averaged across the query, against a whole text field. */
function fieldScore(
  query: string,
  field: string,
  transformToken: (token: string) => string = (token) => token,
): number {
  if (!field) return 0;
  const queryTokens = tokenize(query).map(transformToken);
  const fieldTokens = tokenize(field).map(transformToken);
  if (!queryTokens.length || !fieldTokens.length) return 0;
  let total = 0;
  for (const qt of queryTokens) {
    let best = 0;
    for (const ft of fieldTokens) best = Math.max(best, tokenScore(qt, ft));
    total += best;
  }
  return total / queryTokens.length;
}

/**
 * Name outweighs tags outweighs notes, but all three contribute. An alias competes with the
 * canonical name rather than adding to it (best-of, slightly discounted), so a person doesn't
 * outrank everyone else just for carrying many nicknames.
 */
function score(
  query: string,
  person: SearchablePerson,
  transformToken?: (token: string) => string,
): number {
  const nameScore = fieldScore(query, person.name, transformToken);
  const aliasScore = person.aliases.reduce(
    (best, alias) => Math.max(best, fieldScore(query, alias, transformToken)),
    0,
  );
  const tagsScore = fieldScore(query, person.tagNames.join(' '), transformToken);
  const notesScore = fieldScore(query, person.notes, transformToken);
  return 1.0 * Math.max(nameScore, 0.9 * aliasScore) + 0.6 * tagsScore + 0.4 * notesScore;
}

export const scorePerson = (query: string, person: SearchablePerson): number =>
  score(query, person);

const scorePersonPhonetic = (query: string, person: SearchablePerson): number =>
  score(query, person, phoneticizeToken);

function searchPeopleDirect(query: string, people: SearchablePerson[]): ScoredPerson[] {
  return people
    .map((p) => ({ ...p, score: scorePerson(query, p) }))
    .filter((p) => p.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

function searchPeoplePhonetic(query: string, people: SearchablePerson[]): ScoredPerson[] {
  return people
    .map((p) => ({ ...p, score: scorePersonPhonetic(query, p) }))
    .filter((p) => p.score > 0.15)
    .sort((a, b) => b.score - a.score)
    .slice(0, 15);
}

export function searchPeople(query: string, people: SearchablePerson[]): ScoredPerson[] {
  const directMatches = searchPeopleDirect(query, people);
  if (directMatches.length) return directMatches;

  return searchPeoplePhonetic(query, people);
}

function csvField(value: string): string {
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/** RFC-4180-ish CSV the model reads back as a tool result. */
export function searchPeopleCsv(query: string, people: SearchablePerson[]): string {
  console.log(`searchPeopleCsv(${JSON.stringify(query)}, ${people.length} people)`);
  const header = 'name,aliases,id,tags,notes,score';
  const directMatches = searchPeopleDirect(query, people);
  const results = directMatches.length ? directMatches : searchPeoplePhonetic(query, people);
  if (!results.length) return `${header}\n# no matches`;
  const rows = results.map((p) => {
    const notes = p.notes.replace(/\r?\n+/g, ' ').slice(0, 200);
    return [p.name, p.aliases.join('|'), p.id, p.tagNames.join('|'), notes, p.score.toFixed(2)]
      .map(csvField)
      .join(',');
  });
  const csv = [header, ...rows].join('\n');
  if (directMatches.length) console.log(csv);
  if (directMatches.length) return csv;
  const prefix =
    'No direct matches were found. The transcript may be imperfect. These are the similar sounding names; if one is even close, prefer it over skipping the person.\n\n';
  return prefix + csv;
}
