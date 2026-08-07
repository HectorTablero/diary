# Language flags

Circular SVG language flags shown beside each option in the Settings language picker.

## Where they came from

[circle-flags](https://github.com/HatScripts/circle-flags) by HatScripts, MIT licensed, from
`https://hatscripts.github.io/circle-flags/flags/language/{code}.svg` — the repository's
`language/` set, not its `country/` one, so `en` is the split UK/US mark rather than either flag
on its own.

## Why they are committed rather than fetched

Two reasons, and the first is the whole point of the picker they appear in:

- **They must work offline.** The picker exists to tell the user which languages this device can
  and cannot reach without a network. Icons that themselves needed a network would undercut that
  every time it mattered, and the app is offline-first throughout.
- **No build-time network.** Downloading them during `vite build` would make CI fail whenever
  GitHub Pages is slow or down, for five files totalling four kilobytes.

They are inlined as `data:` URIs (see `index.ts`) rather than emitted as separate assets, so they
cannot 404 and do not depend on the service-worker precache having completed.

## Adding one

Drop `<code>.svg` in here, named for the same code used in `LANGUAGES` (`../index.ts`).
`index.ts` picks it up by filename — nothing else to wire. A language with no file here renders
without a flag rather than breaking.
