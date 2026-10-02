import type { SettingsDto } from '@diary/shared';
import { DEFAULT_SETTINGS } from '@diary/shared';
import { Types } from 'mongoose';
import { Thread } from '../models/thread';
import { UserSettings } from '../models/userSettings';

/**
 * The user's settings row, creating the defaults row on first access.
 *
 * A read first, and the upsert only when there is nothing to read. The upsert alone answered both
 * cases, but it is a *write* every time — Mongoose's timestamps turn even a no-op `$setOnInsert`
 * into a `$set` of `updatedAt` — and settings are consulted on the write path: every sub-entry
 * create checks the depth limit, every person create without an interval reads the default. A
 * restore did one of those per row, each a durable write that changed nothing anyone reads.
 */
async function settingsDoc(userId: string) {
  const existing = await UserSettings.findOne({ userId }).lean();
  if (existing) return existing;
  return UserSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
}

/** The settings the write routes consult — without the extra lookup `getSettings` may make. */
export async function getWriteSettings(
  userId: string,
): Promise<Pick<SettingsDto, 'maxSubEntryDepth' | 'defaultCheckupIntervalDays'>> {
  const doc = await settingsDoc(userId);
  return {
    maxSubEntryDepth: doc.maxSubEntryDepth ?? DEFAULT_SETTINGS.maxSubEntryDepth,
    defaultCheckupIntervalDays: doc.defaultCheckupIntervalDays,
  };
}

/** Read the user's settings, creating the defaults row on first access. */
export async function getSettings(userId: string): Promise<SettingsDto> {
  const doc = await settingsDoc(userId);
  return {
    halfLifeDays: doc.halfLifeDays as SettingsDto['halfLifeDays'],
    epsilon: doc.epsilon,
    talkingPointsLimit: doc.talkingPointsLimit,
    memoryImportanceThreshold: doc.memoryImportanceThreshold,
    memoryMinAgeDays: doc.memoryMinAgeDays,
    broadcastLifeChangingEvents: doc.broadcastLifeChangingEvents,
    broadcastTagIds: (doc.broadcastTagIds as Types.ObjectId[]).map((id) => id.toString()),
    forceEnglishAIEvents: doc.forceEnglishAIEvents,
    quietNotifications: doc.quietNotifications,
    defaultImportance: doc.defaultImportance ?? null,
    autoSaidOnMention: doc.autoSaidOnMention,
    // Never chosen → on for an account that already has a thread, off otherwise. Resolved on every
    // read (settings ride every sync pull), so it follows threads arriving from an import too.
    threadsEnabled: doc.threadsEnabled ?? !!(await Thread.exists({ userId })),
    maxSubEntryDepth: doc.maxSubEntryDepth ?? DEFAULT_SETTINGS.maxSubEntryDepth,
    defaultCheckupIntervalDays: doc.defaultCheckupIntervalDays,
    // Presence only. The keys stay here; see getProviderKeys.
    hasGroqKey: !!doc.groqApiKey?.trim(),
    hasOpenRouterKey: !!doc.openRouterApiKey?.trim(),
    hasCerebrasKey: !!doc.cerebrasApiKey?.trim(),
  };
}

/** The stored provider keys, in the clear. */
export interface ProviderKeys {
  groqApiKey: string;
  openRouterApiKey: string;
  cerebrasApiKey: string;
}

/**
 * Read the raw provider keys — server-side callers only.
 *
 * Kept apart from `getSettings` so the keys cannot reach a response by accident: `getSettings` is
 * what the settings route and the sync payload return, and it now has no field that could carry
 * one. Anything that needs an actual key has to ask for it by this name, which is a grep away
 * from an audit.
 */
export async function getProviderKeys(userId: string): Promise<ProviderKeys> {
  const doc = await UserSettings.findOne(
    { userId },
    'groqApiKey openRouterApiKey cerebrasApiKey',
  ).lean();
  return {
    groqApiKey: doc?.groqApiKey?.trim() ?? '',
    openRouterApiKey: doc?.openRouterApiKey?.trim() ?? '',
    cerebrasApiKey: doc?.cerebrasApiKey?.trim() ?? '',
  };
}
