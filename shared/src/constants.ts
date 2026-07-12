/** Importance goes from 1 (highest) to 5 (lowest), matching the original app. */
export const IMPORTANCE_LEVELS = [1, 2, 3, 4, 5] as const;
export type ImportanceLevel = (typeof IMPORTANCE_LEVELS)[number];

export const MAX_SUB_ENTRY_DEPTH = 3;

export const MAX_CONTENT_LENGTH = 2000;
export const MAX_NOTES_LENGTH = 5000;

/** Weight applied per importance level in the talking-points score: 1 → 1.0 … 5 → 0.2 */
export const importanceWeight = (importance: number): number => (6 - importance) / 5;

/** Match strength multipliers: a direct mention beats a shared tag beats a broadcast. */
export const MATCH_STRENGTH = { mention: 1.0, tag: 0.6, broadcast: 0.4 } as const;
export type MatchType = keyof typeof MATCH_STRENGTH;

/** Default half-lives (days) per importance level for talking-point decay. */
export const DEFAULT_HALF_LIFE_DAYS: Record<ImportanceLevel, number> = {
  1: 90,
  2: 30,
  3: 14,
  4: 7,
  5: 3,
};

export const DEFAULT_SETTINGS = {
  halfLifeDays: DEFAULT_HALF_LIFE_DAYS,
  epsilon: 0.05,
  talkingPointsLimit: 50,
  memoryImportanceThreshold: 2,
  memoryMinAgeDays: 180,
  broadcastLifeChangingEvents: false,
  broadcastTagIds: [] as string[],
  /** Default checkup interval inherited by new people. `null` = checkups off by default. */
  defaultCheckupIntervalDays: null as number | null,
};

/** Palette cycled through when creating tags without an explicit color. */
export const DEFAULT_TAG_COLORS = [
  '#4ECDC4', // Teal
  '#45B7D1', // Blue
  '#96CEB4', // Green
  '#FFEAA7', // Yellow
  '#DDA0DD', // Plum
  '#98D8C8', // Mint
  '#F7DC6F', // Light Yellow
  '#BB8FCE', // Light Purple
  '#85C1E9', // Light Blue
  '#F8C471', // Light Orange
] as const;

export const DATE_KEY_REGEX = /^\d{4}-\d{2}-\d{2}$/;
export const HEX_COLOR_REGEX = /^#[0-9A-Fa-f]{6}$/;
export const OBJECT_ID_REGEX = /^[0-9a-fA-F]{24}$/;

/** ObjectId-shaped id (timestamp prefix + random) generated client-side for offline creates. */
export function newObjectId(): string {
  const time = Math.floor(Date.now() / 1000)
    .toString(16)
    .padStart(8, '0');
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  return time + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
