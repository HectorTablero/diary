import {
  AI_MAX_RECORDING_BYTES,
  AI_RATE_LIMIT,
  AI_RATE_WINDOW_MS,
  aiSuggestionsRequestSchema,
} from '@diary/shared';
import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { badRequest } from '../errors';
import type { AppEnv } from '../middleware/session';
import { jsonValidator } from '../middleware/validate';
import { rateLimit } from '../middleware/rateLimit';
import { generateSuggestions } from '../services/aiSuggestionService';
import { transcribe } from '../services/transcriptionService';

/* The two routes that cost money.
 *
 * Both spend the caller's own provider quota, and both are reachable from a client that can retry
 * — which is a far likelier way to burn a month's credits than anyone attacking the thing. One
 * shared window across both, because they are two halves of the same action: a voice note is
 * transcribed and then turned into suggestions, so limiting them separately would let a loop run
 * at twice the intended rate. */
const aiRateLimit = rateLimit({
  limit: AI_RATE_LIMIT,
  windowMs: AI_RATE_WINDOW_MS,
  code: 'ai.too_many_requests',
});

export const aiRouter = new Hono<AppEnv>()
  .use(aiRateLimit)
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
  .post(
    '/transcribe',
    /* Enforced before the body is read, which the check inside the handler cannot be.
       `c.req.formData()` buffers the entire upload into memory to parse it, so by the time
       `audio.size` can be compared to anything, the allocation the comparison is meant to prevent
       has already happened. bodyLimit rejects on Content-Length and aborts the stream if the body
       overruns what it declared, so an oversized request never gets that far.

       The in-handler check stays: this one covers the whole multipart envelope, that one covers
       the file itself, and only the second can say *which* part was too big. */
    bodyLimit({
      // The envelope is the file plus multipart boundaries and headers — a little slack, not a
      // second limit.
      maxSize: AI_MAX_RECORDING_BYTES + 1024 * 1024,
      onError: (c) => c.json({ error: 'ai.recording_too_large' }, 413),
    }),
    async (c) => {
      const form = await c.req.formData();
      const audio = form.get('file');
      if (!(audio instanceof File)) throw badRequest('ai.no_audio');
      // A recording is capped at AI_MAX_RECORDING_MS client-side; this is the same limit expressed
      // in bytes, for a request that didn't come from our own recorder.
      if (audio.size > AI_MAX_RECORDING_BYTES) throw badRequest('ai.recording_too_large');
      return c.json({ text: await transcribe(c.get('userId'), audio) });
    },
  );
