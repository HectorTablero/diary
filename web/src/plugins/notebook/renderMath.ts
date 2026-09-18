import katex from 'katex';
import 'katex/dist/katex.min.css';

/**
 * LaTeX to markup — and the only module in the app that imports KaTeX.
 *
 * Reached solely through the `import('./renderMath')` in TexMath.tsx, which is what makes this file
 * the front of a chunk of its own: KaTeX, its stylesheet and (through that stylesheet) its twenty
 * font files load the first time a document with a formula in it is shown — previewed or edited —
 * and never for anyone who doesn't write any. A static import of this module from anywhere else
 * would fold ~260 kB of KaTeX into whatever imported it, and since the service worker precaches every
 * script it can see, that would be ~260 kB for every visitor to the app — notebook or not. The name
 * matters too: vite.config.ts keeps `renderMath-*` and `KaTeX_*` out of the precache by pattern, and
 * scripts/checkBundle.ts fails the build if either rule stops holding.
 */

export type RenderedMath = { html: string } | { error: string };

/* Every answer, kept. The editor re-checks every formula in a document on every keystroke to know
   which to paint red (see `useInvalidFormulas`), and typesetting costs up to a millisecond each — so
   the one being typed in is the only one that should cost anything. Keyed by mode as well as source,
   since the same LaTeX can typeset inline and fail displayed (or the reverse). Cleared wholesale past
   a size no one session of writing reaches, rather than tracked for recency. */
const answers = new Map<string, RenderedMath>();
const MAX_ANSWERS = 2000;

export function renderMath(tex: string, display: boolean): RenderedMath {
  const key = `${display ? 'D' : 'I'}${tex}`;
  let answer = answers.get(key);
  if (!answer) {
    if (answers.size >= MAX_ANSWERS) answers.clear();
    answer = typeset(tex, display);
    answers.set(key, answer);
  }
  return answer;
}

function typeset(tex: string, display: boolean): RenderedMath {
  try {
    return {
      html: katex.renderToString(tex, {
        displayMode: display,
        /* Thrown rather than drawn: KaTeX's own error rendering paints the source in a fixed colour
           of its choosing, where the caller can show it in the theme's own. */
        throwOnError: true,
        /* KaTeX's defaults, spelled out because they are what makes the markup safe to insert:
           no `\href`, `\url`, `\includegraphics` or `\htmlClass`, and a cap on macro expansion so
           a recursive `\def` ends in an error rather than a hung tab. */
        trust: false,
        maxExpand: 1000,
        /* Accented letters in math mode (`$café$`) are fine to render and not worth a console
           warning each — this is prose written in five languages, not a paper headed for arXiv. */
        strict: 'ignore',
        // Visible HTML for the eye, hidden MathML for screen readers — KaTeX's default, on purpose.
        output: 'htmlAndMathml',
      }),
    };
  } catch (error) {
    return {
      error: error instanceof katex.ParseError ? error.rawMessage : String(error),
    };
  }
}
