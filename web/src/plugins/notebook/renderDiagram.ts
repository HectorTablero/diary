import mermaid from 'mermaid';
import { readTokens, themeCSSFrom, themeVariablesFrom } from './mermaidTheme';
import { mermaidMath } from './syntax';

/**
 * Mermaid source to SVG — and the only module in the app that imports Mermaid.
 *
 * Reached solely through the `import('./renderDiagram')` in MermaidDiagram.tsx, the same arrangement
 * renderMath.ts has with KaTeX: Mermaid is ~630 kB compressed across some thirty files, fetched the
 * first time a document with a diagram in it is previewed, and never for anyone who doesn't write
 * one. vite.config.ts keeps every file reachable only through here out of the service worker's
 * precache (see `onDemandChunks` there), and scripts/checkBundle.ts fails the build if Mermaid turns
 * up anywhere it would be downloaded by everyone.
 *
 * Math inside a label is typeset by the app's own KaTeX: Mermaid imports it lazily, and the root
 * package.json's `overrides` gives it the same 0.18 the notebook uses rather than a copy of its own.
 * Mermaid only reads `$$…$$` as math, so a label written the notebook's way (`$n$`, `\(n\)`) is
 * respelled on the way in — see `mermaidMath` in syntax.ts.
 */

export type RenderedDiagram = { svg: string } | { error: string };

/* One diagram at a time. Mermaid's configuration is global — the theme and the gantt width below
   are set on it before each render — so two renders interleaving would draw one with the other's
   settings. */
let queue: Promise<unknown> = Promise.resolve();
let count = 0;

/* Every answer, kept: the preview re-renders its whole document when a task is ticked or the
   preview is reopened, and a diagram that hasn't changed shouldn't be drawn again. Keyed by source,
   theme and — for a gantt, the one kind that is laid out to a width — the column's width. */
const drawn = new Map<string, RenderedDiagram>();
const MAX_DRAWN = 100;

const isDark = () => document.documentElement.classList.contains('dark');

/** The diagram's type keyword — the first word after any front matter and `%%` comments. */
function kindOf(source: string): string {
  const body = source.replace(/^\s*---\n[\s\S]*?\n---\s*\n/, '');
  const line = body
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l && !l.startsWith('%%'));
  return line?.split(/\s/)[0] ?? '';
}

/** Mermaid's reason for refusing a diagram, without the stack it sometimes carries. */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.length > 600 ? `${message.slice(0, 600)}…` : message;
}

export function renderDiagram(source: string, width: number): Promise<RenderedDiagram> {
  const dark = isDark();
  const layoutWidth = kindOf(source) === 'gantt' ? width : 0;
  const key = `${dark ? 'dark' : 'light'}:${layoutWidth}\n${source}`;
  const known = drawn.get(key);
  if (known) return Promise.resolve(known);

  const job = queue.then(async () => {
    const result = await draw(source, layoutWidth);
    /* The theme can flip while a render waits its turn; the result is still right for the page it
       was drawn on, but it is only remembered under the key it actually answers. */
    if (isDark() === dark) {
      if (drawn.size >= MAX_DRAWN) drawn.clear();
      drawn.set(key, result);
    }
    return result;
  });
  queue = job.catch(() => {});
  return job;
}

async function draw(source: string, width: number): Promise<RenderedDiagram> {
  const tokens = readTokens();
  mermaid.initialize({
    startOnLoad: false,
    /* Labels are sanitised and interactive features (`click` callbacks, links that run script)
       are off — which is what makes the SVG safe to insert, see MermaidDiagram.tsx. */
    securityLevel: 'strict',
    // A broken diagram throws rather than drawing Mermaid's own error graphic; the caller shows
    // the source with the reason instead, the way a formula that won't typeset is shown.
    suppressErrorRendering: true,
    theme: 'base',
    themeVariables: themeVariablesFrom(
      tokens,
      isDark(),
      getComputedStyle(document.body).fontFamily,
    ),
    themeCSS: themeCSSFrom(tokens),
    /* Mermaid 12 widens every flowchart label to 120px so short ones line up — a seven-letter label
       in a 160px box — and a small graph outgrows the column at full size. 64 keeps boxes even
       without padding them out; the spacing is tightened to match. */
    flowchart: { minNodeWidth: 64, nodeSpacing: 32, rankSpacing: 40, diagramPadding: 8 },
    /* A gantt has no natural width — Mermaid assumes 1200px — so it is laid out to the column's;
       and its axis gets short dates, since `2026-09-01` runs into its neighbours at that width. */
    gantt: {
      ...(width ? { useWidth: width } : {}),
      axisFormat: '%e %b',
      barHeight: 22,
      barGap: 6,
      fontSize: 12,
      sectionFontSize: 13,
    },
  });

  const id = `notebook-diagram-${++count}`;
  try {
    const { svg } = await mermaid.render(id, mermaidMath(source));
    return { svg };
  } catch (error) {
    return { error: describe(error) };
  } finally {
    // Mermaid measures text in a scratch element it normally removes itself; after a parse error it
    // can be left behind in <body>.
    document.getElementById(`d${id}`)?.remove();
  }
}
