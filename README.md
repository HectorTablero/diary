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

## Scripts

- `npm run dev` — API (tsx watch) + web (Vite) concurrently
- `npm run build` / `npm start` — production build / run
- `npm run build:app` / `npm run app:open` — Android app build / open in Android Studio
- `npm run typecheck` — all workspaces
- `npx tsx src/scripts/syncSmoke.ts` (from `server/`) — sync-foundation smoke tests against local MongoDB
- `npx tsx scripts/dbSmoke.ts` (from `web/`) — local-first data layer smoke tests (Node + fake-indexeddb)
