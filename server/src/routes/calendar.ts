import { calendarQuerySchema, dayQuerySchema } from '@diary/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../middleware/session';
import { queryValidator } from '../middleware/validate';
import { getMonth, getOnThisDay } from '../services/calendarService';
import { getSettings } from '../services/talkingPointsService';

export const calendarRouter = new Hono<AppEnv>().get(
  '/',
  queryValidator(calendarQuerySchema),
  async (c) => {
    const { year, month } = c.req.valid('query');
    return c.json({ days: await getMonth(c.get('userId'), year, month) });
  },
);

export const onThisDayRouter = new Hono<AppEnv>().get(
  '/',
  queryValidator(dayQuerySchema),
  async (c) => {
    const userId = c.get('userId');
    const { date } = c.req.valid('query');
    const settings = await getSettings(userId);
    const entries = await getOnThisDay(userId, date, settings.memoryImportanceThreshold);
    return c.json({ entries });
  },
);
