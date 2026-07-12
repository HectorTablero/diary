import { aiSuggestionsRequestSchema } from '@diary/shared';
import { Hono } from 'hono';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { generateSuggestions } from '../services/aiSuggestionService';

export const aiRouter = new Hono<AppEnv>().post(
  '/suggestions',
  jsonValidator(aiSuggestionsRequestSchema),
  async (c) => {
    const { transcript, dateKey, language } = c.req.valid('json');
    const entries = await generateSuggestions(c.get('userId'), transcript, dateKey, language);
    return c.json({ entries });
  },
);
