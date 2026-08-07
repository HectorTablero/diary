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
- **Said** — mentioning `@Ana` in an entry automatically marks it as *said to Ana*
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

| Workspace | Stack |
|---|---|
| `web/` | React 19 + Vite 7 + TypeScript, Tailwind v4, shadcn/ui, TanStack Query, react-router 7, i18next (es/en/it/ja/zh), Dexie (IndexedDB), dnd-kit, PWA (vite-plugin-pwa), Capacitor (Android) |
| `server/` | Hono on Node, Mongoose 8 (MongoDB), Better Auth (Google OAuth) |
| `shared/` | zod schemas, DTO types, constants and the talking-points scoring, shared by both |

In production the server serves the built SPA (single origin, single container).

## Offline / sync

The app is **local-first**: every page reads from an IndexedDB mirror (`web/src/db`), so
reading *and writing* work fully offline on both the website and the Android app.
Mutations apply locally and queue in an outbox that replays against the REST API when
online; `GET /api/sync?since=` then pulls everything that changed (deletes propagate via
tombstones). Conflicts resolve last-write-wins — fine for a single-user app.

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
the console only. The env vars decide whether reporting is *possible*; the switch in
Settings → Data decides whether it happens, and is shown only when a build has somewhere to
report to.

Create **two** sources (Sources → Connect source), because the client token is shipped
inside the bundle and must not be the server's:

| Source platform | Used by | Token env var | Host env var |
| --- | --- | --- | --- |
| Node.js | API server (runtime) | `BETTERSTACK_SOURCE_TOKEN` | `BETTERSTACK_INGEST_URL` |
| JavaScript | web + Android app (build time) | `VITE_BETTERSTACK_SOURCE_TOKEN` | `VITE_BETTERSTACK_INGEST_URL` |

Both values are on each source's **Configure** screen. For local development put all four
in `.env`. For CI, see below.

### CI configuration

The `VITE_*` pair is **inlined into the bundle at build time**, so it must be available to
the build, not to the container at runtime.

Two GitHub **environments** hold the secrets, and the two publishing jobs in
`release.yml` declare the one they need (`environment: android` / `environment: docker`) —
environment secrets are invisible to a job that doesn't declare it. The Better Stack pair is
therefore **duplicated across both**:

| Environment | Secret | Value |
| --- | --- | --- |
| `android` + `docker` | `BETTERSTACK_CLIENT_SOURCE_TOKEN` | *JavaScript* source token |
| `android` + `docker` | `BETTERSTACK_CLIENT_INGEST_URL` | *JavaScript* source ingesting host |

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
before: a version bump *is* a new release).

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
- `npx tsx src/scripts/syncSmoke.ts` (from `server/`) — sync-foundation smoke tests against local MongoDB
- `npx tsx scripts/dbSmoke.ts` (from `web/`) — local-first data layer smoke tests (Node + fake-indexeddb)

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
