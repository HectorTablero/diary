import { highlightSource, type HighlightKind } from './syntax';

/**
 * A one-line taste of what is inside a document, for the child rows under it — as plain text.
 *
 * Built from the same spans the editor paints (syntax.ts) rather than by stripping characters off
 * the source with a regex, so the markup is recognised exactly where the rest of the notebook
 * recognises it: `**bold**` loses its asterisks but a price like `$5` keeps its dollar, and a `*`
 * in a formula is left alone. What is kept is the words; what is dropped is the markup — heading
 * hashes, bullets, checkboxes, fences, formula delimiters, the target half of a link — and a
 * diagram's source, which is a small language nobody wants to read a line of in a list.
 *
 * Nothing is *rendered*: the row is a glance at the words, and bold, italics or a typeset formula at
 * that size would just be noise. A `[[id]]` is the one exception to "just the text", because the id
 * is not text anyone can read — it becomes the title it points at, or disappears if that is unknown.
 */

/** The kinds whose characters are words. Everything else is markup, and is left out. */
const KEPT = new Set<HighlightKind>([
  'text',
  'strong',
  'emphasis',
  'code',
  'math',
  'person',
  'label',
]);

/* A formula's LaTeX, made a little easier to read without typesetting it: the few symbols that turn
   up in everyday notes become their characters, and the grouping braces and spacing commands go.
   Anything not listed stays as it was typed — a readable approximation, not a renderer. */
// prettier-ignore
const TEX_SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ',
  psi: 'ψ', omega: 'ω', Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Pi: 'Π', Sigma: 'Σ',
  Phi: 'Φ', Omega: 'Ω', cdot: '·', times: '×', div: '÷', pm: '±', leq: '≤', le: '≤', geq: '≥',
  ge: '≥', neq: '≠', ne: '≠', approx: '≈', infty: '∞', to: '→', rightarrow: '→', leftarrow: '←',
  in: '∈', sum: 'Σ', prod: 'Π', int: '∫', partial: '∂', nabla: '∇', sqrt: '√',
};

function plainTex(tex: string): string {
  return tex
    .replace(/\\(left|right)\b/g, '')
    .replace(/\\(?:text|mathrm|mathbf|mathit|operatorname)\{([^{}]*)\}/g, '$1')
    .replace(/\\[dt]?frac\{([^{}]*)\}\{([^{}]*)\}/g, '$1/$2')
    .replace(/\\[,;:! ]/g, ' ')
    .replace(/\\([A-Za-z]+)/g, (whole, name: string) => TEX_SYMBOLS[name] ?? whole)
    .replace(/[{}]/g, '');
}

/**
 * The words of `body`, on one line and at most `max` characters long.
 *
 * The line `label` was taken from is dropped, not shown twice — an untitled document would otherwise
 * render its first line as both its name and its preview. Only the first such line: a line that
 * happens to repeat the title further down is still content.
 *
 * `documentLabels` resolves `[[id]]` references; one it doesn't know (still loading, or gone) is left
 * out rather than shown as an id.
 */
export function documentPreview(
  body: string,
  label: string,
  documentLabels: ReadonlyMap<string, string> = new Map(),
  max = 140,
): string {
  const lines = body.split('\n');
  // Compared as plain text, since that is how documentLabel (model.ts) reads the line too.
  /* Never a line of pure markup, which reads as '' — removing a fence's opening line would turn the
     rest of the document inside out. */
  const own = label ? lines.findIndex((line) => plainText(line) === label) : -1;
  if (own >= 0) lines.splice(own, 1);
  return plainText(lines.join('\n'), documentLabels, max);
}

/**
 * Markdown source as the words it shows, on one line — the whole of what a preview is, and what an
 * untitled document's label is made of (see documentLabel in model.ts).
 */
export function plainText(
  source: string,
  documentLabels: ReadonlyMap<string, string> = new Map(),
  max = Infinity,
): string {
  let out = '';
  for (const span of highlightSource(source, [])) {
    let piece: string;
    if (span.kind === 'document') piece = documentLabels.get(span.id!) ?? '';
    else if (span.kind === 'math') piece = plainTex(span.text);
    else if (KEPT.has(span.kind)) piece = span.text;
    // A dropped marker still separated two words: `a\n- b` is "a b", never "ab".
    else piece = /\s/.test(span.text) ? ' ' : '';
    // Collapsed as it goes, so the cutoff below measures what will actually be shown.
    out = (out + piece).replace(/\s+/g, ' ').trimStart();
    if (out.length > max) break; // the rest could only be cut off below
  }

  const text = out.trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}
