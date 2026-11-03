import { getMeta, setMeta } from './db';

/**
 * How likely you are to @mention each person next — what orders the mention autocomplete and the
 * person picker (see usePeopleByAffinity).
 *
 * Built up as you act rather than derived from the diary: each mutation that involves someone adds
 * points here, and every point halves every 30 days. Decay is applied lazily — a stored score plus
 * when it was last touched is all it takes to know its value now. Local to this device and starts
 * empty; nothing syncs and nothing backfills, which is fine for a sort order.
 */
type Stored = Record<string, { score: number; at: number }>;

const KEY = 'peopleAffinity';
const HALF_LIFE_MS = 30 * 86_400_000;

/** Mentions are the point of the whole system — what the autocomplete exists to predict. */
export const AFFINITY_POINTS = { mention: 10, created: 5, interaction: 1 } as const;

const decayed = ({ score, at }: { score: number; at: number }, now: number) =>
  score * 0.5 ** (Math.max(0, now - at) / HALF_LIFE_MS);

// ponytail: read-modify-write on one meta row, so two bumps racing can drop one; harmless for a sort order.
export async function addAffinity(personIds: string[], points: number, now = Date.now()) {
  if (!personIds.length) return;
  const stored = (await getMeta<Stored>(KEY)) ?? {};
  for (const id of new Set(personIds)) {
    const prev = stored[id];
    stored[id] = { score: (prev ? decayed(prev, now) : 0) + points, at: now };
  }
  await setMeta(KEY, stored);
}

export async function getAffinity(now = Date.now()): Promise<Record<string, number>> {
  const stored = (await getMeta<Stored>(KEY)) ?? {};
  return Object.fromEntries(Object.entries(stored).map(([id, s]) => [id, decayed(s, now)]));
}
