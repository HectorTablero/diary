import type { SettingsDto } from '@diary/shared';
import { DEFAULT_SETTINGS } from '@diary/shared';
import { Types } from 'mongoose';
import { UserSettings } from '../models/userSettings';

/** Read the user's settings, creating the defaults row on first access. */
export async function getSettings(userId: string): Promise<SettingsDto> {
  const doc = await UserSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, returnDocument: 'after', setDefaultsOnInsert: true },
  ).lean();
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
