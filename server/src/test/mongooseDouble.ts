import { Types } from 'mongoose';
import { vi } from 'vitest';

/* Stand-ins for the two Mongoose shapes the routes touch: a Query and a Document.
 *
 * The routes are thin handlers over Mongoose, and what they decide — which status a miss becomes,
 * which errors are conflicts, whether `userId` is in the filter — is entirely separable from
 * whether Mongo can run a `$pull`. These doubles draw the line there: the filters the routes build
 * are captured and asserted, and everything past the driver is somebody else's tested code.
 *
 * What this deliberately cannot prove: that an index is unique, that a cascade actually detaches a
 * tag, or that a populate resolves. Those need a real database, and the assertions here are written
 * so they never *look* like they cover them.
 */

/**
 * A chainable Query double.
 *
 * Mongoose queries are thenable *and* chainable — `Person.findOneAndUpdate(...).populate(...).lean()`
 * and a bare `await Person.findOne(...)` are both valid, and the people router uses both — so this
 * has to answer to `.lean()`, `.populate()`, `.sort()` and `await` alike. Returning itself from the
 * chain methods is what lets a test say `query(doc)` once and not care which form the handler picks.
 */
export function query<T>(result: T) {
  const q = {
    lean: () => Promise.resolve(result),
    populate: () => q,
    sort: () => q,
    select: () => q,
    limit: () => q,
    then: <R1, R2>(
      onFulfilled?: ((value: T) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ) => Promise.resolve(result).then(onFulfilled, onRejected),
  };
  return q as typeof q & Promise<T>;
}

/** A query that rejects — for driving the duplicate-key branches. */
export function failingQuery(err: unknown) {
  const q = {
    lean: () => Promise.reject(err),
    populate: () => q,
    sort: () => q,
    select: () => q,
    limit: () => q,
    then: <R1, R2>(
      onFulfilled?: ((value: never) => R1 | PromiseLike<R1>) | null,
      onRejected?: ((reason: unknown) => R2 | PromiseLike<R2>) | null,
    ) => Promise.reject(err).then(onFulfilled, onRejected),
  };
  return q as typeof q & Promise<never>;
}

/**
 * A Document double: assignable fields, plus the four methods the routes call on one.
 *
 * The people router's PATCH is why this is a mutable object rather than a frozen value — it reads
 * the document, assigns only the keys the client sent, saves, and re-populates. `toObject()`
 * returning the current field values (minus the methods) is what makes "did the PATCH blank a field
 * the client never mentioned?" an answerable question.
 */
export function doc<T extends Record<string, unknown>>(value: T) {
  const methods = {
    set: vi.fn((path: string, next: unknown) => {
      (document as Record<string, unknown>)[path] = next;
    }),
    save: vi.fn(async () => document),
    populate: vi.fn(async () => document),
    toObject: () => {
      const { set, save, populate, toObject, ...fields } = document as Record<string, unknown> & {
        set: unknown;
        save: unknown;
        populate: unknown;
        toObject: unknown;
      };
      return fields;
    },
  };
  const document = { ...value, ...methods };
  return document;
}

/**
 * Every model method the routers call, each a spy returning an empty result by default.
 *
 * Every one takes `...args: unknown[]` rather than no parameters, and that is load-bearing for the
 * tests rather than for the doubles: a `vi.fn(() => …)` types its own `mock.calls` as `[]`, so the
 * single most valuable assertion in these files — reading back the *filter* a route built, to check
 * it carries the caller's `userId` — will not type-check at all. A rest parameter makes each call a
 * plain `unknown[]` that a test can narrow to the tuple it expects.
 */
export function modelDouble() {
  return {
    find: vi.fn((..._args: unknown[]) => query([] as unknown[])),
    findOne: vi.fn((..._args: unknown[]) => query(null as unknown)),
    findById: vi.fn((..._args: unknown[]) => query(null as unknown)),
    findOneAndUpdate: vi.fn((..._args: unknown[]) => query(null as unknown)),
    findOneAndDelete: vi.fn((..._args: unknown[]) => query(null as unknown)),
    /* Answers `null` by default, like the finders, which for this one reads as "no such row". The
       plugin-documents PATCH is the only caller: it asks after a conditional update matched
       nothing, to tell a row that has moved on from a row that is gone. */
    exists: vi.fn(async (..._args: unknown[]) => null as unknown),
    create: vi.fn(async (...args: unknown[]) => args[0] as unknown[]),
    updateMany: vi.fn(async (..._args: unknown[]) => ({ modifiedCount: 0 })),
    deleteMany: vi.fn(async (..._args: unknown[]) => ({ deletedCount: 0 })),
    insertMany: vi.fn(async (..._args: unknown[]) => [] as unknown[]),
    estimatedDocumentCount: vi.fn(async (..._args: unknown[]) => 0),
  };
}

export type ModelDouble = ReturnType<typeof modelDouble>;

/** Reset every spy on a set of model doubles between tests, without discarding the objects the
    mocked module already handed to the router at import time. */
export function resetModels(...models: ModelDouble[]): void {
  for (const model of models) {
    for (const value of Object.values(model)) value.mockClear();
    model.find.mockReturnValue(query([]));
    model.findOne.mockReturnValue(query(null));
    model.findById.mockReturnValue(query(null));
    model.findOneAndUpdate.mockReturnValue(query(null));
    model.findOneAndDelete.mockReturnValue(query(null));
    model.exists.mockResolvedValue(null);
    model.create.mockImplementation(async (...args: unknown[]) => args[0] as unknown[]);
    model.updateMany.mockResolvedValue({ modifiedCount: 0 });
    model.deleteMany.mockResolvedValue({ deletedCount: 0 });
    model.insertMany.mockResolvedValue([]);
  }
}

/** Mongo's duplicate-key error, as the driver actually raises it. `keyPattern` names the index that
    collided, which is the whole basis of the replayed-create decision (see errors.ts). */
export const duplicateKeyError = (index: string) =>
  Object.assign(new Error('E11000 duplicate key error'), {
    code: 11000,
    keyPattern: { [index]: 1 },
  });

/**
 * A stable 24-hex id derived from a readable name.
 *
 * Derived rather than written out because an ObjectId has to be exactly 24 hex characters, and a
 * literal that isn't — `'tag1'.padStart(24, '0')` looks fine and contains a `t` — fails inside BSON
 * with a message about Uint8Arrays that says nothing about the test. Encoding the name's own bytes
 * keeps ids readable in a failure diff (`…007461673100` is `tag1`) and impossible to get wrong.
 */
export const oid = (seed: string) => {
  let hex = '';
  for (const char of seed) hex += char.charCodeAt(0).toString(16).padStart(2, '0');
  return hex.padStart(24, '0').slice(-24);
};

export const objectId = (seed: string) => new Types.ObjectId(oid(seed));
