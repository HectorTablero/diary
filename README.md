# Diary

A personal diary crossed with a tiny CRM. You write your days as bullet points; the app
tells you what to talk about with the people in your life.

## Concepts

- **Entries** — bullet points per day, with nested sub-entries (up to 5 levels, configurable)
  and an **importance** from 1 (life-changing) to 5 (passing thought). Drag or arrow-key the
  grip handle to reorder and re-nest them.
- **Tags** — colored labels that connect entries to people.
- **Threads** — a named topic running across days, so one ongoing story can be caught up on in
  a single action. An entry can belong to several.
- **People** — everyone you talk to: tags, notes, aliases (`@Mum` → Carmen), contact details,
  birthday, and a **checkup interval** ("nudge me if I haven't spoken to them in 30 days").
- **Events** — something happening in a person's life, with dates. When one ends, the profile
  asks you to follow up until you say you have.
- **Talking points** — on a person's profile, entries that mention them or share a tag are
  ranked by a decaying score: `importanceWeight · matchStrength · 2^(-age/halfLife)`.
  Important things stay relevant for months; trivia fades in days. Half-lives are
  configurable in Settings.
- **Said** — mentioning `@Ana` in an entry automatically marks it as _said to Ana_
  (untick in the composer if you haven't told her). One click on the profile marks a
  talking point as said; it moves to a crossed-out "already told" list.
- **Memories** — important entries (importance ≤ 2 by default) that directly mention a
  person resurface on their profile as shared memories once they're old enough
  (6 months by default).

## Views

Diary (day view with `@person` / `#tag` autocomplete composer, plus voice capture) · Calendar
(month heatmap + "on this day") · People (list + profile with talking points / events /
memories / history) · Search (full text + filters) · Tags · Threads · Settings.

## Voice entries

With a provider key set (Settings → AI), the mic in the composer records a note, the server
transcribes it with Groq Whisper and turns the transcript into a reviewable tree of suggested
entries — people and tags already linked. The ⋯ menu on any entry does the same thing nested
underneath it. Keys are stored server-side and never sent to the browser.

## Reminders (Android)

Three device-local alarms, each switchable in Settings: overdue checkups (batched into a digest
when several are due), birthdays, and a nightly "you haven't written today". Quiet hours defer
anything that has no time of its own. Event follow-ups are in-app only — they surface as a banner
on the person's profile and a badge in the people list, not as a notification.

All of it lives in `localStorage` rather than the synced settings, so signing out cannot silently
switch an alarm back on.

## Plugins

Optional features that live in the same repo but are **invisible to anyone who hasn't enabled
them** — no code, no strings, no storage, no requests. That property is the whole point of the
system, and it is not something the idea gives you for free: it is a handful of rules that are easy
to break by accident and that fail silently when broken.

A plugin fills any of five **surfaces**, all optional (`web/src/plugins/types.ts`):

| Surface         | What it is                                               |
| --------------- | -------------------------------------------------------- |
| `day`           | a card on the diary's day page, below the composer       |
| `page`          | its own screen at `/plugins/<id>`                        |
| `settings`      | a card in Settings                                       |
| `notifications` | reminders contributed to the app's single reconcile pass |
| `export`        | Markdown files added to the export archive               |

`web/src/plugins/registry.ts` is the catalogue and the only plugin file the entry chunk may reach:
an id, an icon, the surfaces list, and a dynamic-import thunk. The surfaces are declared **outside**
the chunk on purpose — that is what lets a day-page slot skip a plugin with no day widget for the
price of an array lookup instead of a network round-trip that ends in `undefined`. Slots must check
`enabled`, then `surfaces`, then `load()`, in that order.

Two checkers guard it, because none of this is observable from inside a running app:
`plugins/registry.test.ts` and `registry.surfaces.test.tsx` for what can be asserted in-process
(import paths are literals and point at the folder named by the id; declared surfaces match exported
members), and `web/scripts/checkBundle.ts` against real build output, for what cannot — plugin code
reaching the entry chunk, or plugin locales being precached for everyone. Both have caught real
regressions; the bundle one exists because Vite once inlined every plugin's strings, in all five
languages, into the day-page chunk as base64, and `dist` looked clean.

**Enablement syncs; reminders don't.** A plugin being on is a property of the diary, not of one
device, so it lives in a synced `config` row — one row per plugin, so two devices enabling different
plugins offline cannot clobber each other the way a merged settings document would. Anything that
arms an alarm stays in `localStorage` (`plugins/reminders.ts`), for the same reason as the rest of
the reminders: signing out must not resurrect a switched-off alarm.

**Storage.** Plugins write to one collection, `pluginRecord`, which rides the normal offline/sync
path. Each row is `{ pluginId, scope: 'record' | 'config', dateKey, data }`, where `dateKey` is a day
or `UNDATED_KEY` (`''`) for rows that aren't about one. **The server never inspects `data`** — that
is exactly what makes adding a plugin a client-only change — so it is validated on read, by the
plugin, in the same parse-don't-trust posture the backup importer takes. What the server does
enforce is shape and volume: `MAX_PLUGINS_PER_USER` (32), `MAX_PLUGIN_RECORDS_PER_PLUGIN` (20,000),
`MAX_PLUGIN_DATA_BYTES` (4096) and `MAX_PLUGIN_DATA_DEPTH` (3), since `pluginId` is deliberately
open and would otherwise be a way to grow the collection without bound.

**Documents are the exception.** `pluginRecord` is hostile to prose on purpose, and no amount of
raising the cap fixes the half that matters: a row holding a whole document is the one shape where
last-write-wins destroys an evening's work. So a second collection, `pluginDocument`, exists for
plugins that store writing rather than values — the notebook is the only one so far, and adding it
is what makes that plugin the **one plugin that is not a client-only change** (a shared schema, a
model, a route, a sync branch and a Dexie version). Two properties justify the cost:

- **`body` is a typed string, not an opaque blob.** That is what lets the app rewrite `@mentions`
  inside plugin prose when a person is renamed — `renamePersonMentionsInDocuments` in
  `web/src/db/mutations.ts` — **without loading the owning plugin**, which a rename must be able to
  do while that plugin is switched off. Nothing there consults the registry.
- **History is rows, not a field.** One row per document per day it changed, holding a forward patch
  rather than a snapshot. Two devices writing on two days write two rows and neither can clobber the
  other; only same-day edits collide, and a unique index on `(documentId, dateKey)` turns that into
  the ordinary 409-on-create the whole app already converges through.

Both row shapes live in the one collection, told apart by `dateKey` — the same idiom habits uses
inside `pluginRecord`. Bounds: `MAX_PLUGIN_DOCUMENT_BYTES` (256 KB per body, measured on the UTF-8
encoding), `MAX_PLUGIN_DOCUMENT_ROWS_PER_PLUGIN` (50,000) and `MAX_PLUGIN_DOCUMENT_DEPTH` (8, client
-side — the server never walks `parentId`).

Strings live in the plugin (`plugins/<id>/locales/{en,es,it,ja,zh}.json`, with
`plugins/<id>/translation-context.json` beside them), are fetched on enable, and merge under
`plugins.<id>.` — so a key written as `title` is used as `t('plugins.habits.title')`. `checkI18n`
holds each plugin to the same four rules as the core bundle, as its own key universe.

Adding one: a folder under `plugins/<id>/` with an `index.ts` default-exporting a `PluginModule`,
its locale files, and one entry in the registry. Nothing else in the app changes — in particular
**not** `pages/lazyPages.ts` (AppLayout warms every entry of that map on idle) and **not**
`VENDOR_CHUNKS` in `vite.config.ts` (naming a plugin's library hoists it in front of everyone's
first paint).

### Habits

The first plugin, and the one the API was shaped around. A habit is one of five kinds,
differing only in how a day's number is entered and read, never in how it is stored: `binary` (a
button), `numeric` (a stepper — push-ups, glasses of water), `time` (a stopwatch _and_ a stepper),
`scale` (a dragged track, for something judged rather than counted) and `mood` (five faces).

Every kind stores a plain number, which is what makes "did this happen" one question rather than
five. Time is stored in **seconds** because the stopwatch produces them — pausing at 14:09 and
resuming has to resume from 14:09 — and rounded only at the point of display. Zero is stored as
absence, never as `0`.

Three decisions are worth knowing before touching it:

- **Two row shapes, told apart by `dateKey`.** A _definition_ is undated, one row per habit; a _day_
  is dated, one row holding every habit's value for that day. One row per habit (rather than one
  list) means renaming on the phone and adding on the laptop are writes to different rows and cannot
  collide; one row per day (rather than per habit-day) keeps five habits over five years at 1,800
  rows instead of 9,000.
- **A goal is a property of a habit _on a day_, not of the habit.** Raising a target from 50 to 100
  would otherwise retroactively un-meet every day you hit 50 — three weeks of history rewritten by
  one edit. So each edit banks the configuration it replaced with the day it stopped applying
  (`revisions`), and everything that judges a day asks `configAt(habit, dateKey)`. The habit's own
  page shows that log, because the grid alone would misrepresent it.
- **Streaks and the day card's `M/N` count goals _reached_, not habits touched.** Twelve of a hundred
  push-ups is progress worth recording and it is not a day of the habit. The day page computes the
  run ending _yesterday_ once per habit and adds today's answer itself, so the badge is arithmetic on
  local state — it cannot flicker while a debounced write and the sync it triggers go past. Today
  being blank never breaks a streak; only yesterday can.

The stopwatch persists the _instant it started_, device-local and keyed by day, so a timer survives
a reload, a lock screen or a discarded tab, and one left running past midnight is banked against the
day it began. Recording is debounced (600 ms) and coalesced, because every enqueue kicks a sync and
a full notification reconcile — running down a checklist must not be one of those per tap.

Surfaces: the day card (record only — nothing is created or destroyed there), `/plugins/habits`
(create, retire, and a three-week grid), a Settings card for the device-local daily nudge,
`habits.md` in the export, and a one-line `describeRecord` so a backup import review shows habit
names rather than opaque blobs. A habit that was ever recorded can only be **retired**, not deleted:
those days are diary history.

### Period tracker

One row per marked day (`{ period: true, flow }`, three flow levels) — there is deliberately no
stored "cycle" row. A cycle is never anything but a maximal run of consecutive marked dateKeys,
computed fresh by `groupCycles` whenever one is needed, which is what keeps recording a single tap:
toggling a day on or off can never leave a stored cycle disagreeing with the days it was built from.

Predictions (`predict.ts`) count forward from the last cycle's start by the mean length and duration
of up to the 6 most recent cycles, falling back to population averages until a second cycle exists to
average at all. The day page turns that into an outlook — quiet, "in ~N days", or "due" through a
7-day grace period past the predicted end — never a day count within the window, since a prediction
is a guess at a window, not at which day inside it.

Surfaces: the day widget, a calendar view shading logged days by flow and predicted days lighter
still, `/plugins/period-tracker` for the history, a Settings card for a device-local heads-up a
couple of days before the next predicted start, and a plain-log export. No Android widget, unlike
habits.

### Notebook

Longer, more abstract writing than an entry: an entry is a fact about a day ("went to the pool with
`@A`"), a notebook document is a thought worked through in prose and expected to change over months.
The first plugin to store documents rather than values — see `pluginDocument` above.

Three decisions are worth knowing before touching it:

- **A folder is a document.** Containment is a real `parentId`, and a document that has children is
  still fully writable, so a group can explain itself. Obsidian's trick of making an index note that
  links to its members exists because a filesystem folder cannot hold prose; this isn't a filesystem,
  so the workaround isn't inherited. One page shape is reused at every level — the document's own
  text, the documents inside it beneath — and the open one lives in `?doc=`, which buys the back
  button, deep links and the Android hardware back key for free.
- **Every day it changed is kept, as a forward patch.** `patch.ts` is a dependency-free line diff;
  `history.ts` replays the chain. The document row holds the current text and is authoritative, the
  chain is the past, and a save always diffs against _where the day started_ — so fifty saves in an
  afternoon leave one revision holding the afternoon, not fifty holding a keystroke each. The two
  can legitimately disagree (a rename rewrites bodies and not patches); the next save reconciles them.
- **`@mentions` work, `#tags` don't.** `@Ana` in a thought means what it means in an entry — matched
  by name through the app's own `lib/tokens`, resolved on read, rewritten by core on rename. `#` is
  left alone because it is a Markdown heading here, and the notebook has no tags.

Each revision stores two numbers, and the two surfaces ask different questions of them. The day card
reports `+n −m` — both sides, because that is what happened to the document, and a day spent cutting
a thought down is work. The calendar shades by `netGained` (added less removed, floored at zero per
document), because a grid of a year is asking what is there now that wasn't before. Both readings
are honest; keeping them apart is deliberate, and `netGained` in `history.ts` is where the calendar's
choice is stated.

Surfaces: the day card (a question on today, and links to what was written on any day — absent
entirely on a past day with nothing in it), `/plugins/notebook`, a green contribution-graph calendar
shaded by net characters gained, one Markdown section in the export, and a tour. Deliberately **no**
notifications (a thought is not a task), **no** Android widget (a paragraph is not a one-tap record)
and **no** Settings card (there is nothing device-local to configure). Deleting leaves an Undo on the
toast, and a document created but never written in is discarded when you navigate away.

## Security and privacy

- **App lock** — an optional passcode (PBKDF2, device-local) in front of the diary, with the
  device's biometrics as the fast path and a configurable grace period after backgrounding. It
  survives sign-out and works with no account at all.
- **Provider API keys are write-only.** They are stored on the server and never returned; the
  client is told only whether one exists. Transcription is proxied through the API for the same
  reason.
- **Crash reporting is opt-out** in Settings → Data, on top of the build-time env vars below.
- **Deleting is undoable** — entries (with their whole subtree), people, tags, threads and
  events all leave an Undo on the toast. Signing out with unsynced changes asks first.

## Accessibility

Reordering works from the keyboard (Space to lift, arrows to move, Space to drop) with spoken
position/level announcements. Importance can be shown as distinct **shapes** as well as colours,
for anyone the red-to-green ramp doesn't separate. `prefers-reduced-motion` is honoured
throughout, including skipping the boot animation.

The composer's `@person` / `#tag` autocomplete is a real combobox, so arrowing through the
suggestions announces the one about to be inserted; each row's ⋯ menu is named after the row it
belongs to rather than being one of many identical "button"s; loading and going offline announce
themselves; and a skip link (web only) jumps past the sidebar's seven stops.

## Stack

npm workspaces monorepo:

| Workspace | Stack                                                                                                                                                                                    |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `web/`    | React 19 + Vite 7 + TypeScript, Tailwind v4, shadcn/ui, TanStack Query, react-router 7, i18next (es/en/it/ja/zh), Dexie (IndexedDB), dnd-kit, PWA (vite-plugin-pwa), Capacitor (Android) |
| `server/` | Hono on Node, Mongoose 8 (MongoDB), Better Auth (Google OAuth)                                                                                                                           |
| `shared/` | zod schemas, DTO types, constants and the talking-points scoring, shared by both                                                                                                         |

In production the server serves the built SPA (single origin, single container).

## Offline / sync

The app is **local-first**: every page reads from an IndexedDB mirror (`web/src/db`), so
reading _and writing_ work fully offline on both the website and the Android app.
Mutations apply locally and queue in an outbox that replays against the REST API when
online; `GET /api/sync?since=` then pulls everything that changed (deletes propagate via
tombstones). Conflicts resolve last-write-wins — fine for a single-user app.

Tombstones are kept for `TOMBSTONE_RETENTION_DAYS` (180, in `shared/src/constants.ts`) and then
swept by a Mongo TTL index, so the collection stays bounded. Past that window a delete has nothing
left to announce it, so a cursor older than the window can no longer be brought up to date by a
delta: the server answers it with the complete state and `reset: true`, and the client removes
every local doc that response doesn't name. The index is deliberately set a week beyond the window
— the sweep must never outrun the promise.

## Setup

1. `cp .env.example .env` and fill it in (`BETTER_AUTH_SECRET` via `openssl rand -base64 32`).
2. In Google Cloud Console, add the OAuth redirect URIs:
   - `http://localhost:5173/api/auth/callback/google` (dev)
   - `https://<your-domain>/api/auth/callback/google` (prod)
3. `npm ci`
4. `npm run dev` → http://localhost:5173 (API on the port from `.env`, proxied).

## Production

```sh
npm run build && npm start          # or:
docker build -t diary . && docker run --env-file .env -p 3000:3000 diary
```

Set `BETTER_AUTH_URL` to the public origin in production.

## Android app (Capacitor)

The Android app in `web/android/` bundles the same SPA and talks to the production API
(`web/.env.app` → `VITE_API_BASE`). Sign-in uses the platform's **native Google
Sign-In** (Google blocks OAuth pages inside webviews); the resulting idToken is handed
to Better Auth, which returns a **bearer token** stored in Capacitor Preferences.

One-time Google Cloud Console setup: create an **Android** OAuth client with package
`es.tablerus.diary` and the SHA-1 of the debug and release keystores
(`keytool -list -v -keystore <ks>`). The existing web client id keeps being the one
referenced in code.

Biometric unlock uses `@aparajita/capacitor-biometric-auth`. Adding it changed the native
plugin set, so the first APK carrying it has to be installed by hand — see the OTA note below.

### Deep links

Links to the production host open in the app rather than the browser: `/diary`, `/calendar`,
`/people`, `/search`, `/tags`, `/threads` and `/settings`, including everything under them.
Deliberately not `/api` — that is the app's own REST endpoint, and an app offering to handle
those URLs could intercept a request meant for the server — and not `/login`.

The host comes from a manifest placeholder (`-PappHost=`, defaulting to `diary.tablerus.es`) and
must match `VITE_API_BASE` in `web/.env.app`, because that origin is the one serving the
verification file. Set `ANDROID_CERT_FINGERPRINTS` (see `.env.example`) so the server can answer
`/.well-known/assetlinks.json`; without it links still work, they just prompt instead of opening
the app directly. `adb shell pm get-app-links es.tablerus.diary` reports what Android actually
decided.

The list of prefixes lives in two files that cannot import each other — `AndroidManifest.xml`
decides which URLs reach the app, `web/src/lib/deepLinks.ts` decides what becomes of them — so a
test asserts they agree.

```sh
npm run build:app   # web build (app mode) + cap sync android
npm run app:open    # open in Android Studio
# or from web/android: .\gradlew assembleDebug / assembleRelease
```

Release builds are signed with `web/android/app/diary-release.keystore` via the
untracked `web/android/app/keystore.properties` (both gitignored — **back the keystore
up**; losing it means new installs can't update in place). The signed APK lands in
`web/android/app/build/outputs/apk/release/app-release.apk` — sideload it directly.

## Versioning

The **root `package.json` `version`** is the single source of truth. Everything —
the git tag, the APK `versionName`/`versionCode`, the OTA bundle name, and the version
logged to the console on the diary page — derives from it.

A `pre-commit` hook (`.githooks/`, wired up by `npm ci` via the `prepare` script) asks
whether the commit is a major / minor / patch change, applies the bump with the lower
levels reset (`2.4.10` + major → `3.0.0`), and stages `package.json` into the commit.
Choose `none` to leave it untouched. With no terminal attached (GUI client, rebase, CI)
it keeps the version as-is rather than hanging.

Android needs a monotonically increasing integer, so `versionCode` is derived as
`major * 1_000_000 + minor * 1_000 + patch` (`2.4.10` → `2004010`). Keep minor and
patch below 1000.

## Releases and live updates

Every push to `main` that touches the app publishes a release tagged `v<version>` with
two assets:

- **`diary.apk`** — the full install.
- **`bundle-<version>-<fingerprint>.zip`** — just the web layer (JS/CSS/HTML), delivered
  **over the air** to installed Android apps via
  [`@capgo/capacitor-updater`](https://capgo.app) in manual mode. No Capgo cloud is
  involved: the plugin downloads the zip straight from the GitHub release.

The app (`web/src/lib/liveUpdate.ts`) checks for a newer release when it comes to the
foreground, downloads the bundle in the background, and swaps it in when the app is
backgrounded — so the reload is never seen. If a bundle fails to boot, Capgo rolls back
to the last working one automatically (`appReadyTimeout` in `capacitor.config.ts`).

A live update **cannot** carry native changes. The `<fingerprint>` is a hash of the
Capacitor plugin set + `capacitor.config.ts`; when it doesn't match the installed APK's,
OTA is skipped and the app shows a banner pointing at the APK instead. Nothing to
maintain by hand — adding or removing a plugin changes the hash on its own.

The web PWA updates itself through its service worker (re-checked hourly and on
reconnect); it needs none of the above.

> Adding the updater plugin is itself a native change, so the **first** OTA-capable APK
> has to be installed manually. Every JS-only release after that flows over the air.

## Telemetry (Better Stack)

Errors and request/usage metrics go to [Better Stack](https://telemetry.betterstack.com).
It is entirely optional — with the env vars unset, both the server and the client log to
the console only. The env vars decide whether reporting is _possible_; the switch in
Settings → Data decides whether it happens, and is shown only when a build has somewhere to
report to.

Create **two** sources (Sources → Connect source), because the client token is shipped
inside the bundle and must not be the server's:

| Source platform | Used by                        | Token env var                   | Host env var                  |
| --------------- | ------------------------------ | ------------------------------- | ----------------------------- |
| Node.js         | API server (runtime)           | `BETTERSTACK_SOURCE_TOKEN`      | `BETTERSTACK_INGEST_URL`      |
| JavaScript      | web + Android app (build time) | `VITE_BETTERSTACK_SOURCE_TOKEN` | `VITE_BETTERSTACK_INGEST_URL` |

Both values are on each source's **Configure** screen. For local development put all four
in `.env`. For CI, see below.

### What is reported

The two sources are joined by **`client_id`** — the random per-launch id the browser already sends
as `X-Client-Id` (live-sync uses it to skip echoing a device's own changes back). The client stamps
it on every event and the server records it on every request it logs, so the app's view of a slow
sync and the request that served it can be lined up. Nothing else crosses between them.

**Client** (`web/src/lib/telemetry.ts`)

| Event                                                | When                                                                  |
| ---------------------------------------------------- | --------------------------------------------------------------------- |
| `app_started` / `web_vitals`                         | launch, and LCP/CLS/long-tasks once per session                       |
| `sync_pass`                                          | every pass — see sampling below                                       |
| `sync_dead_letter`                                   | the server refused a write and the queue moved on without it          |
| `sync_reset`                                         | a full-state response replaced the local store, with what it erased   |
| `sync_blocked` / `sync_unblocked` / `sync_auth_lost` | reachability and session transitions                                  |
| `sync_backlog`                                       | the outbox crossed 50 / 200 / 1000 pending                            |
| `sync_conflict`, `live_channel_open/_failed`         | write conflicts and the live WebSocket                                |
| `background_fetch*`                                  | each Android background wake-up, and whether the OS grants them       |
| `live_update_*`                                      | OTA: downloaded, applying, booted, or blocked on a native change      |
| `transcribe`                                         | every voice note, including `empty` (silence transcribed to nothing)  |
| `db_opened` / `db_open_failed`                       | the IndexedDB open, with how full the origin's storage is             |
| `db_blocked` / `db_version_change`                   | another tab holding the schema open, or having upgraded past this one |
| `storage_pressure`                                   | past 80% of the storage quota (once per session)                      |
| `app_lock_unlock` / `app_lock_engaged`               | unlock outcomes by method, and grace-period re-locks                  |

**Server** (`server/src/lib/telemetry.ts`)

| Event                                      | When                                                         |
| ------------------------------------------ | ------------------------------------------------------------ |
| `http_request`                             | per API request — see sampling below                         |
| `sync_reset_served` / `sync_delta_slow`    | the expensive branch of `/api/sync`, and its early warning   |
| `ai_transcribe_upstream`                   | the Groq leg, including the silent fallback-model retry      |
| `rate_limited`                             | a 429, with how far past the cap the caller is               |
| `live_ws_ticket_rejected`                  | a WebSocket ticket that was expired or never issued          |
| `mongo_disconnected` / `mongo_reconnected` | database outages, which heal themselves and otherwise vanish |
| `auth_signin` / `auth_user_created`        | a session was created; a genuinely new account               |
| `runtime_metrics`                          | heap, event-loop lag, live-client and tombstone gauges       |

**Volume.** The free tier is a monthly allowance, and both ends spend it on the two events that
fire on a loop. The rule is the same on both sides: **sample the uneventful, never the eventful.**
A sync pass that pushed, pulled, reset or failed is always reported and an idle one is sampled at
2%; an API request that was non-2xx or took over a second is always reported and the rest are
sampled at 10%. Sampled rows carry the rate they were kept at (`sample_rate`, `sampled`), so a
count built from them can be corrected rather than quietly read low.

**Identifiers.** The server logs a salted, truncated hash of the user id (`user`), never the id
itself — enough to ask "one account or the whole fleet", not enough to point at a person. Paths are
reported as route shapes (`/people/:id/events/:id/asked`), and no entry content, name or tag ever
leaves either process. The app lock reports outcomes only: never the passcode, its hash or its salt.

### Alerts worth setting up

Configured in Better Stack's UI, not in this repo. Dashboards are for questions you thought to ask;
these four are the ones you want to be told about, and each one is silent-by-default damage:

| Alert                                | Why it can't wait for someone to look                                                                                          |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| `sync_dead_letter` above zero        | a write the user was told was saved and the server threw away. One is a bug report; a spike is a deploy eating everyone's data |
| `sync_reset` with a large `orphaned` | a full-state pull deleted a lot of local documents. Either retention is being outrun or the server is wrong about what exists  |
| `db_open_failed`                     | that device cannot open its diary at all. There is no degraded mode below this one                                             |
| `mongo_disconnected`                 | a total outage that heals itself, and therefore gets reported as "it was broken earlier" and never reproduced                  |

One worth a weekly glance rather than a page: `runtime_metrics.tombstone_oldest_h` climbing past
the retention window plus its week of grace means Mongo's TTL monitor has stopped sweeping — the
one promise in [Offline / sync](#offline--sync) that nothing else verifies.

### CI configuration

The `VITE_*` pair is **inlined into the bundle at build time**, so it must be available to
the build, not to the container at runtime.

Two GitHub **environments** hold the secrets, and the two publishing jobs in
`release.yml` declare the one they need (`environment: android` / `environment: docker`) —
environment secrets are invisible to a job that doesn't declare it. The Better Stack pair is
therefore **duplicated across both**:

| Environment          | Secret                            | Value                              |
| -------------------- | --------------------------------- | ---------------------------------- |
| `android` + `docker` | `BETTERSTACK_CLIENT_SOURCE_TOKEN` | _JavaScript_ source token          |
| `android` + `docker` | `BETTERSTACK_CLIENT_INGEST_URL`   | _JavaScript_ source ingesting host |

Both are **secrets**, not variables — `secrets.` and `vars.` are separate namespaces, and
reading one through the other yields an empty string with no error. If the bundle ever
comes out with telemetry off, that mismatch is the first thing to check: the app logs
`[telemetry] disabled` to the console when either value is missing.

The `android` job uses them for the APK + OTA bundle; the `docker` job passes them as Docker
build args for the web bundle.

### The release workflow

`.github/workflows/release.yml` is the only workflow. A single `verify` job — typecheck, all
three test suites, and `npm audit --omit=dev --audit-level=high` — runs first, and both
publishing jobs declare `needs: verify`, so one commit gets one verdict and nothing publishes
without it. `verify` needs no secrets: `config.ts` reads its required variables through
getters, so importing a module never demands a credential.

The `android` job is skipped when a commit changes nothing it builds from. That used to be a
workflow-level `paths:` filter, which cannot be expressed per-job, so it is now a diff against
the pushed range — see the `scope` step. In practice it rarely skips, because the pre-commit
hook touches `package.json` on most commits and `package.json` is in the list (as it was
before: a version bump _is_ a new release).

The **server**'s pair are plain runtime env vars — set `BETTERSTACK_SOURCE_TOKEN` and
`BETTERSTACK_INGEST_URL` wherever the container's environment is configured, alongside
`MONGODB_URI` and the Better Auth vars. They are not needed at image build time.

## Scripts

- `npm run dev` — API (tsx watch) + web (Vite) concurrently
- `npm run build` / `npm start` — production build / run
- `npm run build:app` / `npm run app:open` — Android app build / open in Android Studio
- `npm run typecheck` — all workspaces
- `npm test` — every workspace. In `web/` this is three things: `checkI18n.ts` (below), the
  `logic` vitest project (pure functions, Node) and the `components` one (jsdom + Testing
  Library, `*.test.tsx`)
- `npm run test:e2e` — the behaviour suite: real Chromium over the built SPA, `/api/**` answered by
  route interception. Builds `web/` first; `test:e2e:run` skips the build
- `npm run test:a11y` — the same suite's `@a11y` specs: axe (WCAG 2.0/2.1 A and AA) across every
  route in both themes, plus the open dialogs. Split out from `test:e2e` so the two report
  separately; `test:e2e:all` runs both in one pass. It lives in Playwright rather than vitest
  because contrast and visibility rules need real layout, which jsdom does not compute

## Translations

Five languages, kept in step by `web/scripts/checkI18n.ts`, which runs as part of `npm test` and
fails on a key used but undefined, a key present in one locale and not another, a lost or invented
`{{interpolation}}`, or a namespace missing from `translation-context.json` (the file a translator
reads for tone and context).

That check is load-bearing beyond tidiness: each locale is a **separate chunk**, fetched only when
it is the one in use, and `fallbackLng` therefore points at a bundle that may not be loaded. It is
safe only because no locale can be missing a key.

Its one blind spot is a string that never passes through `t()`: a literal in JSX is invisible to it
by construction. That is how the shadcn dialog's hardcoded "Close" stayed English in all five
languages, so vendored primitives dropped into `components/ui` are worth a read for bare strings.
