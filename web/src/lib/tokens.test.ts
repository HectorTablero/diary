import { expect, test } from 'vitest';
import { detectActiveToken } from './tokens';

test('tag token ends at punctuation but keeps - and _', () => {
  expect(detectActiveToken('hi #ABC.', 8)).toBeNull();
  expect(detectActiveToken('hi #a-b_c', 9)?.query).toBe('a-b_c');
  expect(detectActiveToken('hi #café', 8)?.query).toBe('café');
  expect(detectActiveToken('hi @Ana', 7)?.query).toBe('Ana');
});
