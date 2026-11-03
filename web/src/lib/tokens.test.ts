import { expect, test } from 'vitest';
import { detectActiveToken, matchNamed } from './tokens';

test('tag token ends at punctuation but keeps - and _', () => {
  expect(detectActiveToken('hi #ABC.', 8)).toBeNull();
  expect(detectActiveToken('hi #a-b_c', 9)?.query).toBe('a-b_c');
  expect(detectActiveToken('hi #café', 8)?.query).toBe('café');
  expect(detectActiveToken('hi @Ana', 7)?.query).toBe('Ana');
});

test('matchNamed keeps the given order and names a matching alias', () => {
  const people = [
    { name: 'Marjorie' },
    { name: 'Carmen', aliases: ['Rita'] },
    { name: 'Ana Jones' },
  ];
  const rows = (q: string) => matchNamed(people, q).map((r) => r.alias ?? r.match.name);
  expect(rows('jo')).toEqual(['Marjorie', 'Ana Jones']);
  expect(rows('ri')).toEqual(['Marjorie', 'Rita']);
  expect(rows('')).toEqual(['Marjorie', 'Carmen', 'Ana Jones']);
});
