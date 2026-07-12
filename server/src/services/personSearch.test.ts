import { describe, expect, it } from 'vitest';
import { searchPeople, searchPeopleCsv, type SearchablePerson } from './personSearch';

const person = (overrides: Partial<SearchablePerson>): SearchablePerson => ({
  id: '1',
  name: '',
  tagNames: [],
  notes: '',
  ...overrides,
});

describe('searchPeople', () => {
  it('matches accented names against an unaccented query', () => {
    const people = [person({ id: 'a', name: 'María' })];
    const results = searchPeople('maria', people);
    expect(results.map((r) => r.id)).toEqual(['a']);
  });

  it('tolerates small typos via edit-distance fallback', () => {
    const people = [person({ id: 'a', name: 'Jonathan' })];
    const results = searchPeople('Jonatan', people);
    expect(results.map((r) => r.id)).toEqual(['a']);
  });

  it('weighs name matches above tag matches above note matches', () => {
    const people = [
      person({ id: 'name-match', name: 'Climbing' }),
      person({ id: 'tag-match', name: 'Someone', tagNames: ['Climbing'] }),
      person({ id: 'notes-match', name: 'Someone Else', notes: 'Likes climbing on weekends' }),
    ];
    const results = searchPeople('climbing', people);
    const order = results.map((r) => r.id);
    expect(order.indexOf('name-match')).toBeLessThan(order.indexOf('tag-match'));
    expect(order.indexOf('tag-match')).toBeLessThan(order.indexOf('notes-match'));
  });

  it('excludes people below the score threshold', () => {
    const people = [person({ id: 'a', name: 'Zzz' })];
    expect(searchPeople('Alice', people)).toEqual([]);
  });
});

describe('searchPeopleCsv', () => {
  it('emits a header-only "no matches" row when nothing scores', () => {
    const csv = searchPeopleCsv('nobody', [person({ id: 'a', name: 'Alice' })]);
    expect(csv).toBe('id,name,tags,notes,score\n# no matches');
  });

  it('quotes fields containing commas or quotes', () => {
    const people = [
      person({ id: 'a', name: 'Anne, "Annie"', tagNames: ['friends'], notes: 'met at work' }),
    ];
    const csv = searchPeopleCsv('Anne', people);
    const [, row] = csv.split('\n');
    expect(row).toContain('"Anne, ""Annie"""');
  });
});
