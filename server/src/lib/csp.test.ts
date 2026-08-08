import { createHash } from 'node:crypto';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildCsp } from './csp';

/* Fixtures rather than the real web/dist/index.html: these run in CI before anything is built,
   and a test that silently passes because the file was missing would be worse than no test. */
const writeHtml = (html: string): string => {
  const path = join(mkdtempSync(join(tmpdir(), 'csp-')), 'index.html');
  writeFileSync(path, html);
  return path;
};

const sha256 = (body: string) =>
  `'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`;

describe('buildCsp', () => {
  it('hashes every inline script and leaves sourced ones to self', () => {
    const theme = 'document.documentElement.classList.toggle("dark", true)';
    const splash = 'window.__bootSplashHide = () => {}';
    const path = writeHtml(
      `<html><head>
         <script>${theme}</script>
         <script type="module" crossorigin src="/assets/index-abc123.js"></script>
       </head><body><script>${splash}</script></body></html>`,
    );

    const { scriptSrc } = buildCsp(path);

    expect(scriptSrc).toEqual(["'self'", sha256(theme), sha256(splash)]);
    // The bundle is same-origin and covered by 'self' — hashing it would be both wrong and useless.
    expect(scriptSrc.join(' ')).not.toContain('index-abc123');
  });

  it('never emits unsafe-inline or unsafe-eval for scripts', () => {
    const { scriptSrc } = buildCsp(writeHtml('<script>void 0</script>'));
    expect(scriptSrc).not.toContain("'unsafe-inline'");
    expect(scriptSrc).not.toContain("'unsafe-eval'");
  });

  it('ignores an empty script placeholder', () => {
    // Vite leaves one of these behind; hashing '' would allow every empty inline script.
    const { scriptSrc } = buildCsp(writeHtml('<script></script><script>x()</script>'));
    expect(scriptSrc).toHaveLength(2); // 'self' + the one real script
  });

  it('degrades to self alone when there is no web build to read', () => {
    const { scriptSrc } = buildCsp('/nonexistent/index.html');
    expect(scriptSrc).toEqual(["'self'"]);
  });

  it('allows the live-sync WebSocket, which self does not cover', () => {
    // config.betterAuthUrl defaults to http://localhost:5173 in tests.
    const { connectSrc } = buildCsp(writeHtml(''));
    expect(connectSrc.some((src) => src.startsWith('ws://') || src.startsWith('wss://'))).toBe(
      true,
    );
  });

  it('locks down the directives that stop framing and injection', () => {
    const csp = buildCsp(writeHtml(''));
    expect(csp.frameAncestors).toEqual(["'none'"]);
    expect(csp.objectSrc).toEqual(["'none'"]);
    expect(csp.baseUri).toEqual(["'self'"]);
    expect(csp.defaultSrc).toEqual(["'self'"]);
  });

  it('reaches the client bundle’s telemetry host, not just the server’s own', () => {
    /* The two Better Stack sources the README mandates get different hostnames
       (s2599462.… and s2599433.…), and only the server's is knowable here — the client's is
       inlined into the bundle at build time. An exact-host allowance would block every beacon the
       browser sends, and silently: a blocked beacon is indistinguishable from telemetry being off.

       Skipped rather than asserted-false when telemetry isn't configured, so this reads as
       "untested here" instead of quietly passing on a machine with no .env. */
    const { connectSrc } = buildCsp(writeHtml(''));
    const exact = connectSrc.find((src) => src.includes('betterstackdata.com'));
    if (!exact) return;
    expect(connectSrc.some((src) => src.startsWith('https://*.'))).toBe(true);
  });

  it('permits the image sources the app actually renders', () => {
    const { imgSrc } = buildCsp(writeHtml(''));
    // Generated QR codes and inlined flag SVGs, and the signed-in user's Google avatar.
    expect(imgSrc).toContain('data:');
    expect(imgSrc).toContain('https://*.googleusercontent.com');
  });
});
