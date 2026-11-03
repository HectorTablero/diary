import 'fake-indexeddb/auto';
import { expect, test } from 'vitest';
import { addAffinity, getAffinity } from './affinity';

test('points accumulate and halve every 30 days', async () => {
  const day = 86_400_000;
  await addAffinity(['a', 'b'], 10, 0);
  await addAffinity(['b'], 1, 30 * day); // b: 10 decayed to 5, plus 1
  const now = await getAffinity(30 * day);
  expect(now.a).toBeCloseTo(5);
  expect(now.b).toBeCloseTo(6);
  expect((await getAffinity(60 * day)).b).toBeCloseTo(3);
});
