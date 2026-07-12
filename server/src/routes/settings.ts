import { settingsSchema } from '@diary/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { Tag } from '../models/tag';
import { UserSettings } from '../models/userSettings';
import { getSettings } from '../services/talkingPointsService';

async function ownedTagIds(userId: string, ids: string[]) {
  if (!ids.length) return [];
  const tags = await Tag.find({ userId, _id: { $in: ids } }, '_id').lean();
  return tags.map((t) => t._id);
}

export const settingsRouter = new Hono<AppEnv>()
  .get('/', async (c) => {
    return c.json(await getSettings(c.get('userId')));
  })
  .put('/', jsonValidator(settingsSchema), async (c) => {
    const userId = c.get('userId');
    const { groqApiKey, openRouterApiKey, ...input } = c.req.valid('json');
    await UserSettings.findOneAndUpdate(
      { userId },
      {
        // Both keys are optional in the schema so replayed offline payloads from older
        // clients (which never had the fields) can't wipe out the stored keys.
        $set: {
          ...input,
          broadcastTagIds: await ownedTagIds(userId, input.broadcastTagIds),
          ...(groqApiKey !== undefined ? { groqApiKey } : {}),
          ...(openRouterApiKey !== undefined ? { openRouterApiKey } : {}),
        },
        $setOnInsert: { userId },
      },
      { upsert: true },
    );
    return c.json(await getSettings(userId));
  });
