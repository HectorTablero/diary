import type { SettingsDto } from '@diary/shared';
import { Types } from 'mongoose';
import { UserSettings } from '../models/userSettings';

/** Read the user's settings, creating the defaults row on first access. */
export async function getSettings(userId: string): Promise<SettingsDto> {
  const doc = await UserSettings.findOneAndUpdate(
    { userId },
    { $setOnInsert: { userId } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
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
    defaultCheckupIntervalDays: doc.defaultCheckupIntervalDays,
    groqApiKey: doc.groqApiKey ?? '',
    openRouterApiKey: doc.openRouterApiKey ?? '',
    cerebrasApiKey: doc.cerebrasApiKey ?? '',
  };
}
