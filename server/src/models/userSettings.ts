import { DEFAULT_SETTINGS } from '@diary/shared';
import { model, Schema } from 'mongoose';

const userSettingsSchema = new Schema(
  {
    userId: { type: String, required: true, unique: true },
    halfLifeDays: {
      1: { type: Number, default: DEFAULT_SETTINGS.halfLifeDays[1] },
      2: { type: Number, default: DEFAULT_SETTINGS.halfLifeDays[2] },
      3: { type: Number, default: DEFAULT_SETTINGS.halfLifeDays[3] },
      4: { type: Number, default: DEFAULT_SETTINGS.halfLifeDays[4] },
      5: { type: Number, default: DEFAULT_SETTINGS.halfLifeDays[5] },
    },
    epsilon: { type: Number, default: DEFAULT_SETTINGS.epsilon },
    talkingPointsLimit: { type: Number, default: DEFAULT_SETTINGS.talkingPointsLimit },
    memoryImportanceThreshold: {
      type: Number,
      default: DEFAULT_SETTINGS.memoryImportanceThreshold,
    },
    memoryMinAgeDays: { type: Number, default: DEFAULT_SETTINGS.memoryMinAgeDays },
    broadcastLifeChangingEvents: {
      type: Boolean,
      default: DEFAULT_SETTINGS.broadcastLifeChangingEvents,
    },
    broadcastTagIds: [{ type: Schema.Types.ObjectId, ref: 'Tag' }],
    defaultCheckupIntervalDays: {
      type: Number,
      default: DEFAULT_SETTINGS.defaultCheckupIntervalDays,
    },
    groqApiKey: { type: String, default: DEFAULT_SETTINGS.groqApiKey },
    openRouterApiKey: { type: String, default: DEFAULT_SETTINGS.openRouterApiKey },
    cerebrasApiKey: { type: String, default: DEFAULT_SETTINGS.cerebrasApiKey },
    forceEnglishAIEvents: { type: Boolean, default: DEFAULT_SETTINGS.forceEnglishAIEvents },
  },
  { timestamps: true },
);

export const UserSettings = model('UserSettings', userSettingsSchema);
