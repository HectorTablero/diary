import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config } from '../config';

/**
 * The Content-Security-Policy for the SPA this server hands out.
 *
 * Exploitability today is low — there is no `dangerouslySetInnerHTML`, no `innerHTML` and no
 * `eval` anywhere in the app, so React's escaping is already doing the work. This is the structural
 * version of that guarantee: it holds even for code nobody has written yet, and it is the only
 * thing that makes framing and injection impossible rather than merely absent.
 */

/**
 * SHA-256 hashes of the inline <script> blocks in the built index.html.
 *
 * Computed from the file rather than hardcoded, because the alternatives both rot. A literal list
 * of hashes goes stale the moment the theme snippet or the boot splash is edited — and it fails
 * *silently*, as a blank page in production only, since dev is served by Vite and never sees this
 * header. `'unsafe-inline'` would avoid that by giving up most of what script-src is for.
 *
 * There are two of them and they are unavoidable: the theme IIFE has to run before the first paint
 * or the page flashes white before going dark, and the boot splash has to exist before the bundle
 * loads. Both are static, so both hash cleanly.
 */
function inlineScriptHashes(indexHtmlPath: string): string[] | null {
  let html: string;
  try {
    html = readFileSync(indexHtmlPath, 'utf8');
  } catch {
    return null; // no web build here; distinct from "a build with no inline scripts"
  }
  const hashes: string[] = [];
  // Only tags with no src= are inline; the bundle's own <script src> is covered by 'self'.
  const pattern = /<script(?![^>]*\ssrc=)[^>]*>([\s\S]*?)<\/script>/gi;
  for (const [, body] of html.matchAll(pattern)) {
    if (!body) continue; // <script></script> placeholder, nothing to hash
    hashes.push(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`);
  }
  return hashes;
}

/** The origin part of a URL, or nothing if it isn't one. Used to widen connect-src by host only. */
function originOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/** The subset of Hono's directive options this policy sets. */
export interface CspDirectives {
  defaultSrc: string[];
  scriptSrc: string[];
  styleSrc: string[];
  imgSrc: string[];
  fontSrc: string[];
  connectSrc: string[];
  workerSrc: string[];
  manifestSrc: string[];
  mediaSrc: string[];
  baseUri: string[];
  formAction: string[];
  frameAncestors: string[];
  objectSrc: string[];
}

export function buildCsp(indexHtmlPath: string): CspDirectives {
  const hashes = inlineScriptHashes(indexHtmlPath);
  if (hashes === null) {
    /* No index.html to read — a source checkout run without a web build, where the server never
       serves the SPA and Vite is the one delivering the page. Said out loud rather than shipping a
       policy that would silently blank the app if this ever happened in production. */
    console.warn(
      `[csp] no built SPA at ${indexHtmlPath}; inline scripts would be blocked if served`,
    );
  }
  const scriptSrc = ["'self'", ...(hashes ?? [])];

  const connectSrc = new Set(["'self'"]);
  // The live-sync socket is same-origin, but ws: is a different scheme and 'self' does not cover it.
  const selfOrigin = originOf(config.betterAuthUrl);
  if (selfOrigin) connectSrc.add(selfOrigin.replace(/^http/, 'ws'));

  /* Telemetry goes to a Better Stack host the server cannot name exactly.

     The browser posts to whichever ingest host the *client bundle* was built against
     (VITE_BETTERSTACK_INGEST_URL, inlined at build time); the server only knows its own
     (BETTERSTACK_INGEST_URL). Those are deliberately two different sources — the README requires
     it, because the client token ships inside the bundle and must not be the server's — and Better
     Stack allocates each source its own `s<id>.<region>.betterstackdata.com`. So the two hosts
     differ in practice, not just in theory.

     Allowing the sibling wildcard rather than the exact host is what makes this work with no
     configuration. The alternative — an env var naming the client host — is a footgun: a blocked
     telemetry beacon looks exactly like telemetry being switched off, so getting it wrong is
     invisible until someone goes looking for logs that were never sent. The policy stays tight:
     one vendor's ingest domain, reachable only by fetch, and it is only added at all when
     telemetry is configured in the first place. */
  const ingest = originOf(config.betterStackIngestUrl);
  if (ingest) {
    connectSrc.add(ingest);
    const { protocol, hostname } = new URL(ingest);
    const parentDomain = hostname.split('.').slice(1).join('.');
    // Guard against a single-label host (localhost, a mock) producing `*.` on its own.
    if (parentDomain.includes('.')) connectSrc.add(`${protocol}//*.${parentDomain}`);
  }

  // Escape hatch for anything else a deployment needs to reach — a self-hosted log sink, say.
  for (const extra of (process.env.CSP_CONNECT_SRC ?? '').split(/[\s,]+/).filter(Boolean)) {
    connectSrc.add(extra);
  }

  return {
    defaultSrc: ["'self'"],
    scriptSrc,
    /* 'unsafe-inline' here is not laziness and cannot be hashed away: Radix positions every popover,
       dialog and tooltip with inline style attributes, and element-attribute styles are not covered
       by hashes (only by 'unsafe-hashes', which is unevenly supported). Injecting CSS is also a far
       smaller prize than injecting script, which is the one this policy actually locks down. */
    styleSrc: ["'self'", "'unsafe-inline'"],
    // data: for the inlined flag SVGs; the Google host for the signed-in user's profile
    // picture, which is rendered with referrerPolicy="no-referrer".
    imgSrc: ["'self'", 'data:', 'blob:', 'https://*.googleusercontent.com'],
    fontSrc: ["'self'"],
    connectSrc: [...connectSrc],
    workerSrc: ["'self'"], // the PWA service worker
    manifestSrc: ["'self'"],
    mediaSrc: ["'self'", 'blob:'], // voice recordings before they are uploaded
    baseUri: ["'self'"],
    formAction: ["'self'"],
    // A diary is worth clickjacking. Nothing here is ever meant to be embedded.
    frameAncestors: ["'none'"],
    objectSrc: ["'none'"],
  };
}
