import { Hono } from 'hono';
import mongoose from 'mongoose';
import { ObjectId } from 'mongodb';
import type { AppEnv } from '../middleware/session';
import { Deletion } from '../models/deletion';
import { Entry } from '../models/entry';
import { Person } from '../models/person';
import { PluginDocument } from '../models/pluginDocument';
import { PluginRecord } from '../models/pluginRecord';
import { Tag } from '../models/tag';
import { Thread } from '../models/thread';
import { UserSettings } from '../models/userSettings';

/**
 * Erasing an account and everything in it.
 *
 * The one endpoint here does what no other write in this API does: it destroys data the user cannot
 * get back, and it is meant to. Everything about how it is written is downstream of that.
 *
 * **Diary content first, credentials second.** If the content deletion fails halfway, the account
 * still exists and the request can simply be retried — nothing is stranded. Reversing the order
 * would mean a failure could leave documents behind with no account left that could ever reach or
 * delete them. The two are not atomic (MongoDB transactions need a replica set, which a
 * self-hosted single node isn't), so which half is left standing on a failure is a decision this
 * ordering makes deliberately.
 *
 * **No tombstones.** Every other delete in this codebase records one so the user's other devices
 * learn about it on their next pull (see models/deletion.ts) — but that channel is the sync
 * endpoint, and after this the account cannot authenticate to it. Other devices get a 401 instead,
 * which is the honest answer: their local copy stays until someone signs out on them, and the UI
 * says so before the button is pressed rather than implying a reach this doesn't have.
 *
 * **The scope of the id.** `userId` comes from the verified session and appears in every filter;
 * there is no id in the path or the body, so there is nothing to tamper with and no way to name
 * someone else's account. That is the whole authorisation model here, and it is why this route
 * takes no input at all.
 *
 * **What protects it.** In front of this sit `requireAuth`, the CORS allowlist, and
 * `requireTrustedOrigin` (middleware/origin.ts) — between them a hostile page cannot reach this
 * endpoint, whatever it does to a logged-in user's browser. What none of them stop is a caller
 * holding a genuine session token, and the typed word and the biometric prompt are the *client's*
 * gates, which this endpoint cannot see. So it keeps one of its own, and it is the only guard here
 * that is actually the server's: the session has to be a recent one. See `REAUTH_MAX_AGE_MS`.
 */

/**
 * How recently the caller must have signed in for the delete to go through.
 *
 * This is the re-authentication requirement, expressed the only way this deployment can express
 * one. Google OAuth is the sole credential — there is no password to re-enter and no mailer to
 * confirm through — so "re-authenticate" can only mean another sign-in round trip, and the evidence
 * that one happened is a session younger than this window. That evidence is trustworthy for a
 * reason worth stating: every sign-in *inserts* a session rather than refreshing one, so a caller
 * cannot keep an old session alive into the window by using it (see `sessionCreatedAt` in
 * middleware/session.ts).
 *
 * Five minutes is chosen against the two ways the number can be wrong. Too long and it stops being
 * a gate at all — a token lifted shortly after its owner signed in would still be inside it. Too
 * short and it starts refusing honest attempts, which matters more here than it looks: the Android
 * app re-authenticates in place, but the web has to leave for Google and come back, and a slow
 * page load, an account chooser, a two-factor prompt and a person who actually reads the final
 * confirmation all have to fit inside the same window. Being refused *after* re-authenticating is
 * the one failure that would teach someone the feature is broken.
 *
 * What it buys, and what it does not: a session token on its own can no longer erase the diary,
 * which is worth insisting on because it is the only loss here that nothing can undo. It does
 * nothing about a token stolen minutes after a sign-in, and was never going to — that token can
 * already read the whole diary, which is a different loss needing a different answer.
 */
const REAUTH_MAX_AGE_MS = 5 * 60 * 1000;

export const accountRouter = new Hono<AppEnv>().delete('/', async (c) => {
  const userId = c.get('userId');

  /* Ahead of every delete below, so a refusal costs the caller nothing and the same request can
     simply be sent again after signing in. The clients are expected to attempt the delete and
     re-authenticate on *this* response rather than pre-emptively counting minutes themselves —
     which keeps the rule stated once, here, instead of duplicated into two clients that would
     drift from it and from each other. */
  if (Date.now() - c.get('sessionCreatedAt').getTime() > REAUTH_MAX_AGE_MS) {
    return c.json({ error: 'errors.reauth_required' }, 403);
  }

  await Promise.all([
    Entry.deleteMany({ userId }),
    Person.deleteMany({ userId }),
    Tag.deleteMany({ userId }),
    Thread.deleteMany({ userId }),
    PluginRecord.deleteMany({ userId }),
    PluginDocument.deleteMany({ userId }),
    UserSettings.deleteMany({ userId }),
    // Including the tombstones: they describe documents that no longer exist for an account that
    // is about to stop existing, and nothing will ever pull them.
    Deletion.deleteMany({ userId }),
  ]);

  await deleteAuthRecords(userId);

  return c.body(null, 204);
});

/**
 * Remove the Better Auth user and everything that authenticates as it.
 *
 * Reaching into the collections rather than calling `auth.api.deleteUser`: that path is off by
 * default and, once enabled, wants an email round-trip to confirm — this deployment has no mailer,
 * and the confirmation has already happened in the app.
 *
 * The ids are matched as both an ObjectId and a string on purpose. The adapter stores `_id` and the
 * `userId` references as ObjectIds, but that is an implementation detail of a dependency, and the
 * cost of being wrong is asymmetric: a stale `session` row that outlives its user is a credential
 * nobody meant to leave behind. Matching both shapes costs one extra index probe and cannot miss.
 */
async function deleteAuthRecords(userId: string): Promise<void> {
  const db = mongoose.connection.getClient().db();
  const asObjectId = ObjectId.isValid(userId) ? new ObjectId(userId) : null;
  const anyShape = asObjectId ? { $in: [asObjectId, userId] } : userId;

  // Sessions before the user record, so a request racing this one can't be authorised by a session
  // whose user has already gone.
  await db.collection('session').deleteMany({ userId: anyShape });
  await Promise.all([
    db.collection('account').deleteMany({ userId: anyShape }),
    db.collection('user').deleteMany({ _id: anyShape as never }),
  ]);
}
