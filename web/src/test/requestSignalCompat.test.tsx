import { expect, test } from 'vitest';

test('Request accepts AbortController signals in the component test runtime', () => {
  expect(
    () => new Request('http://localhost/', { signal: new AbortController().signal }),
  ).not.toThrow();
});
