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
| `web/` | React 19 + Vite 7 + TypeScript, Tailwind v4, shadcn/ui, TanStack Query, react-router 7, i18next, PWA (vite-plugin-pwa) |
| `server/` | Hono on Node, Mongoose 8 (MongoDB), Better Auth (Google OAuth) |
| `shared/` | zod schemas, DTO types and constants shared by both |

In production the server serves the built SPA (single origin, single container).

## Setup

1. `cp .env.example .env` and fill it in (`BETTER_AUTH_SECRET` via `openssl rand -base64 32`).
2. In Google Cloud Console, add the OAuth redirect URIs:
   - `http://localhost:5173/api/auth/callback/google` (dev)
   - `https://<your-domain>/api/auth/callback/google` (prod)
3. `npm ci`
4. `npm run dev` → http://localhost:5173 (API on the port from `.env`, proxied).

Optional demo data (after signing in once):

```sh
npm run seed -- --email you@example.com
```

## Production

```sh
npm run build && npm start          # or:
docker build -t diary . && docker run --env-file .env -p 3000:3000 diary
```

Set `BETTER_AUTH_URL` to the public origin in production.

## Scripts

- `npm run dev` — API (tsx watch) + web (Vite) concurrently
- `npm run build` / `npm start` — production build / run
- `npm run typecheck` — all workspaces
- `npm run seed -- --email <email>` — idempotent demo data
- `npx tsx src/scripts/smokeTest.ts` (from `server/`) — service-layer smoke tests against local MongoDB
