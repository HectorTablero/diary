import { AI_MAX_RECORDING_BYTES, aiSuggestionsRequestSchema } from '@diary/shared';
import { Hono } from 'hono';
import { badRequest } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { generateSuggestions } from '../services/aiSuggestionService';
import { transcribe } from '../services/transcriptionService';

export const aiRouter = new Hono<AppEnv>()
  .post('/suggestions', jsonValidator(aiSuggestionsRequestSchema), async (c) => {
    const { transcript, dateKey, language, parentPath } = c.req.valid('json');
    const entries = await generateSuggestions(
      c.get('userId'),
      transcript,
      dateKey,
      language,
      parentPath,
    );
    return c.json({ entries });
  })
  /* Audio in, text out. This exists so the Groq key never has to reach the browser — see
     transcriptionService. Multipart rather than JSON so the recording isn't base64-inflated by
     a third on the way up. */
  .post('/transcribe', async (c) => {
    const form = await c.req.formData();
    const audio = form.get('file');
    if (!(audio instanceof File)) throw badRequest('ai.no_audio');
    // A recording is capped at AI_MAX_RECORDING_MS client-side; this is the same limit expressed
    // in bytes, for a request that didn't come from our own recorder.
    if (audio.size > AI_MAX_RECORDING_BYTES) throw badRequest('ai.recording_too_large');
    return c.json({ text: await transcribe(c.get('userId'), audio) });
  });
