import type { SettingsDto, SettingsInput } from '@diary/shared';
import { MAX_SUB_ENTRY_DEPTH } from '@diary/shared';

export const LEVELS = ['1', '2', '3', '4', '5'] as const;

export const clampDays = (value: number, min: number) =>
  Math.min(3650, Math.max(min, Math.round(value)));

/**
 * The draft as a payload the API will accept, or null while a number is mid-edit.
 *
 * That null is the whole reason this is a function rather than an inline object: clearing an
 * input to retype it leaves `valueAsNumber` as NaN for as long as the field is empty, and saving
 * *that* would quietly write a default over the value the user is halfway through replacing.
 * With a Save button the user chose when to submit and never noticed; without one, an invalid
 * draft simply isn't saved until it becomes valid again.
 */
export function buildPayload(
  draft: SettingsDto,
  checkupsEnabled: boolean,
  checkupIntervalDays: number,
): SettingsInput | null {
  const numbers = [
    ...LEVELS.map((level) => draft.halfLifeDays[level]),
    draft.memoryMinAgeDays,
    ...(checkupsEnabled ? [checkupIntervalDays] : []),
  ];
  if (numbers.some((value) => !Number.isFinite(value))) return null;

  return {
    halfLifeDays: {
      1: clampDays(draft.halfLifeDays['1'], 1),
      2: clampDays(draft.halfLifeDays['2'], 1),
      3: clampDays(draft.halfLifeDays['3'], 1),
      4: clampDays(draft.halfLifeDays['4'], 1),
      5: clampDays(draft.halfLifeDays['5'], 1),
    },
    epsilon: draft.epsilon,
    talkingPointsLimit: draft.talkingPointsLimit,
    memoryImportanceThreshold: draft.memoryImportanceThreshold,
    memoryMinAgeDays: clampDays(draft.memoryMinAgeDays, 0),
    broadcastLifeChangingEvents: draft.broadcastLifeChangingEvents,
    broadcastTagIds: draft.broadcastTagIds,
    forceEnglishAIEvents: draft.forceEnglishAIEvents,
    quietNotifications: draft.quietNotifications,
    defaultImportance: draft.defaultImportance,
    autoSaidOnMention: draft.autoSaidOnMention,
    maxSubEntryDepth: Math.min(
      MAX_SUB_ENTRY_DEPTH,
      Math.max(1, Math.round(draft.maxSubEntryDepth)),
    ),
    defaultCheckupIntervalDays: checkupsEnabled ? clampDays(checkupIntervalDays, 1) : null,
    /* No provider keys here on purpose. They are write-only and are not part of the draft at
       all, so the autosave below has nothing to send — and, more to the point, cannot resend a
       stale one. Setting a key is its own explicit save; see `saveApiKey`. */
  };
}
