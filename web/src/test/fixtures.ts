import type { EntryDto, PersonDto, TagDto, ThreadDto } from '@diary/shared';

/* Test data as the DTOs the *server* sends, not as the rows Dexie stores.
 *
 * That choice is what lets one fixture serve both suites. `seed()` maps these through the app's own
 * `entryFromDto` / `personFromDto`, and the Playwright API mock serves the same objects verbatim
 * inside a `SyncResponse` — so a component test and an e2e test are looking at the same diary, and
 * a DTO field that changes shape breaks both rather than silently diverging one from the other.
 *
 * Every builder takes a patch and fills the rest, because almost no test cares about most of these
 * fields and a test that spells out all fourteen properties of a PersonDto is a test whose point is
 * buried. */

const T = '2026-08-01T09:00:00.000Z';

export const aTag = (patch: Partial<TagDto> & Pick<TagDto, 'id' | 'name'>): TagDto => ({
  color: '#4ECDC4',
  ...patch,
});

export const aThread = (patch: Partial<ThreadDto> & Pick<ThreadDto, 'id' | 'name'>): ThreadDto => ({
  createdAt: T,
  updatedAt: T,
  ...patch,
});

export const aPerson = (patch: Partial<PersonDto> & Pick<PersonDto, 'id' | 'name'>): PersonDto => ({
  events: [],
  aliases: [],
  phone: null,
  email: null,
  wechatId: null,
  birthday: null,
  company: null,
  jobTitle: null,
  contactId: null,
  tags: [],
  notes: '',
  checkupIntervalDays: null,
  lastCheckupAt: T,
  createdAt: T,
  ...patch,
});

export const anEntry = (
  patch: Partial<EntryDto> & Pick<EntryDto, 'id' | 'content' | 'dateKey'>,
): EntryDto => ({
  importance: 3,
  tags: [],
  people: [],
  threads: [],
  saidTo: [],
  hiddenFor: [],
  parentId: null,
  /* Empty by default, and filled in by `seed()` rather than here.
     A real key cannot be invented per-entry in isolation — fractional indices are only meaningful
     relative to their siblings — and leaving it empty is not harmless: repo.ts's `ensureOrderKeys`
     treats an unkeyed row as legacy data to heal, which writes to Dexie *and* enqueues a PATCH per
     row. A test asserting what is in the outbox would then find rows it never caused. */
  orderKey: '',
  createdAt: T,
  updatedAt: T,
  ...patch,
});
