# Diary

A personal diary crossed with a tiny CRM. You write your days as bullet points; the app
tells you what to talk about with the people in your life.

## Concepts

- **Entries** — bullet points per day, with nested sub-entries (up to 3 levels) and an
  **importance** from 1 (life-changing) to 5 (passing thought).
- **Tags** — colored labels that connect entries to people.
- **People** — everyone you talk to. A person has tags and optional notes.
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

Diary (day view with `@person` / `#tag` autocomplete composer) · Calendar (month grid +
"on this day") · People (list + profile with talking points / memories / history) ·
Search (full text + filters) · Tags · Settings (decay half-lives, memories, theme,
language es/en).

## Stack

npm workspaces monorepo:

| Workspace | Stack |
|---|---|
| `web/` | React 19 + Vite 7 + TypeScript, Tailwind v4, shadcn/ui, TanStack Query, react-router 7, i18next, Dexie (IndexedDB), PWA (vite-plugin-pwa), Capacitor (Android) |
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
the console only.

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

Two GitHub **environments** hold the secrets, and both workflows declare the one they
need (`environment: android` / `environment: docker`) — environment secrets are invisible
to a job that doesn't declare it. The Better Stack pair is therefore **duplicated across
both**:

| Environment | Secret | Value |
| --- | --- | --- |
| `android` + `docker` | `BETTERSTACK_CLIENT_SOURCE_TOKEN` | *JavaScript* source token |
| `android` + `docker` | `BETTERSTACK_CLIENT_INGEST_URL` | *JavaScript* source ingesting host |

Both are **secrets**, not variables — `secrets.` and `vars.` are separate namespaces, and
reading one through the other yields an empty string with no error. If the bundle ever
comes out with telemetry off, that mismatch is the first thing to check: the app logs
`[telemetry] disabled` to the console when either value is missing.

`android-release.yml` uses them for the APK + OTA bundle; `docker-publish.yml` passes them
as Docker build args for the web bundle.

The **server**'s pair are plain runtime env vars — set `BETTERSTACK_SOURCE_TOKEN` and
`BETTERSTACK_INGEST_URL` wherever the container's environment is configured, alongside
`MONGODB_URI` and the Better Auth vars. They are not needed at image build time.

## Scripts

- `npm run dev` — API (tsx watch) + web (Vite) concurrently
- `npm run build` / `npm start` — production build / run
- `npm run build:app` / `npm run app:open` — Android app build / open in Android Studio
- `npm run typecheck` — all workspaces
- `npx tsx src/scripts/syncSmoke.ts` (from `server/`) — sync-foundation smoke tests against local MongoDB
- `npx tsx scripts/dbSmoke.ts` (from `web/`) — local-first data layer smoke tests (Node + fake-indexeddb)
