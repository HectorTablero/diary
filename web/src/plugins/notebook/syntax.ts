import { segmentContent, type MentionEntity } from '@/lib/tokens';

/**
 * What the notebook's Markdown *is*, as spans over the raw source.
 *
 * Two surfaces read a document: the preview renders it (MarkdownView.tsx) and the editor paints an
 * overlay behind the textarea (MentionTextarea.tsx). Both have to agree on where a token starts and
 * ends — a preview that turns `[[id]]` into a link while the editor thinks that `[` opens an
 * ordinary bracket link is two answers to the same question, and the one nobody is looking at is
 * always the wrong one. So the inline grammar lives here, once, and both import it.
 *
 * ## Why the editor needs something the preview doesn't
 *
 * MarkdownView parses into *blocks* and returns React elements; it never has to say which character
 * of the source it is looking at, because it is not drawing the source. The overlay draws exactly
 * the source, glyph for glyph, underneath a real caret — so it needs a flat list of pieces whose
 * text concatenates back to the input, exactly. That invariant is the whole contract of this file
 * and is the first thing its tests check: break it and the highlight slides off the text.
 *
 * ## The rule the decoration follows
 *
 * **Nothing painted over a run of characters may change its advance width.** The textarea underneath
 * is what positions the caret and paints the selection, and it is laying out weight-400 upright text
 * at one size. A real `font-weight: 600` on a heading would widen the copy on top, and every
 * character after it on that line would sit beside its own highlight rather than under it. So the
 * kinds below are shown with colour, background, stroke, slant and strikethrough — every one of
 * which leaves the metrics alone. Which trick each kind uses, and why each is safe, is the subject
 * of the class table in MentionTextarea.tsx.
 *
 * The single exception is `document`, and it is an exception on purpose: a `[[id]]` is *replaced* on
 * screen by the title it points at, because an id is not something anyone can read. That is done by
 * painting the title inside the box the raw token already occupies rather than in place of it, so
 * the token keeps its own width and nothing after it moves — see the note on `DocumentReference` in
 * MentionTextarea.tsx.
 */

/** How one run of characters should be painted. Never how *wide* it should be — see above. */
export type HighlightKind =
  /** Ordinary prose. */
  | 'text'
  /** The Markdown characters themselves — hashes, asterisks, backticks, brackets. Dimmed, not hidden. */
  | 'syntax'
  /** The inside of a `**strong**` span. */
  | 'strong'
  /** The inside of an `*emphasis*` or `_emphasis_` span. */
  | 'emphasis'
  /** A code span, or any line inside a fence. */
  | 'code'
  /** The LaTeX inside a formula — inline, a display block, or a ` ```math ` fence. Delimiters are
      `syntax`, like every other mark. */
  | 'math'
  /** An `@mention` that resolves to a real person. */
  | 'person'
  /** A `[[id]]` cross-reference, whole. Carries the id so the caller can resolve it. */
  | 'document'
  /** The visible half of a `[label](url)` or `![alt](url)`. */
  | 'label'
  /** The target half of the same. */
  | 'url';

export interface HighlightSpan {
  text: string;
  kind: HighlightKind;
  /** The id between the brackets. On `document` spans, and only on those. */
  id?: string;
  /** Where this span starts in the source. On `document` spans, and only on those: it is what tells
      two references to the *same* document apart, which is what the editor needs to know in order to
      reveal the raw id of the one the caret is actually in. */
  start?: number;
  /** Whether the formula is set on a line of its own (`$$`, `\[`, ` ```math `) rather than in the
      running text. On `math` spans, and only on those — it is what the editor's hover preview needs
      to typeset a formula the way the preview will. */
  display?: boolean;
  /**
   * This span is inside a ticked `- [x]` item.
   *
   * A modifier rather than a kind of its own, because a finished task is still a task: the
   * `@mentions` and `[[references]]` in it are the same links they were before it was ticked, and
   * the preview keeps them live and clickable under the strikethrough (see the task branch of
   * MarkdownView's list renderer). Painting the whole line one flat grey would be the editor
   * disagreeing with the preview about what the line *is*.
   */
  struck?: boolean;
  /**
   * This span is inside a `>` quote.
   *
   * The same reasoning, and the same shape the preview gives a blockquote: italic and muted, with
   * everything inside it — mentions, references, code, links — keeping its own colour and meaning.
   */
  quoted?: boolean;
  /**
   * This span is part of a `#` heading's own words.
   *
   * A modifier for the same reason as the two above, and it is the one that makes the set make
   * sense: `kind` says what a run of characters *is* (a mention, a link, an emphasis), and these
   * three say what the line it sits on does to all of them. A `**bold**` word in a heading is bold
   * and a heading, which two kinds could not both be.
   */
  heading?: boolean;
}

/**
 * Inline math, in the spellings people actually paste.
 *
 * `$…$` and `$$…$$` are what Obsidian, Pandoc, Typora and Jupyter write — and what this plugin's own
 * export hands to them, since it passes a document's source through untouched. `\(…\)` and `\[…\]`
 * are LaTeX's own, and what a chatbot's answer arrives in when it is pasted here.
 *
 * A single `$` follows Pandoc's rule, because this is a diary and prices are the common case: the
 * opener must be followed by something other than a space, the closer preceded by something other
 * than a space and *not* followed by a digit. So `$5 and $10` stays prose, `$x$` and `$a_1 + b_2$`
 * are math, and a `\$` never opens or closes anything.
 *
 * One line each, like every other inline token here: the editor's overlay walks the source line by
 * line, and a span that could run across lines is one the two surfaces would read differently.
 */
const INLINE_MATH = [
  String.raw`\$\$(?:\\.|[^\\$\n])+?\$\$`,
  String.raw`(?<![\\$])\$(?![\s$])(?:\\.|[^\\$\n])*?(?<!\s)\$(?!\d)`,
  String.raw`\\\((?:\\.|[^\\\n])+?\\\)`,
  String.raw`\\\[(?:\\.|[^\\\n])+?\\\]`,
].join('|');

/**
 * Inline syntax, innermost-binding first.
 *
 * Code spans come first and are not descended into, which is what lets a document explain
 * `**bold**` without the explanation turning bold. Math comes straight after, and for the same
 * reason: the inside of a formula is LaTeX, where `_` is a subscript and `*` is a star, and reading
 * either as emphasis would tear `$a_1 + b_2$` in half.
 *
 * The three link-shaped forms are checked before the code/emphasis marks resolve their own inner
 * text — `[[id]]` before the single-bracket link, so a document reference is never partially
 * swallowed by the plainer pattern, and image before link, so `!` is never left dangling in front of
 * a rendered link. None of the three is parsed recursively for nested emphasis inside its own
 * label/alt text, matching the rest of this hand-rolled, one-pass grammar.
 */
export const INLINE_PATTERN = new RegExp(
  [
    '(`[^`]+`)',
    `(${INLINE_MATH})`,
    String.raw`(\*\*[^*]+\*\*)`,
    String.raw`(\*[^*]+\*)`,
    '(_[^_]+_)',
    String.raw`(\[\[[^\]]+\]\])`,
    String.raw`(!\[[^\]]*\]\([^)]+\))`,
    String.raw`(\[[^\]]+\]\([^)]+\))`,
  ].join('|'),
);

/** A math token, taken apart: the delimiters, the LaTeX between them, and whether it is displayed
    on a line of its own (`$$`, `\[`) or set in the running text (`$`, `\(`). */
export interface MathToken {
  open: string;
  tex: string;
  close: string;
  display: boolean;
}

/* Longest first, so `$$x$$` is never read as `$` + `$x$` + `$`. */
const MATH_DELIMITERS: readonly (readonly [string, string, boolean])[] = [
  ['$$', '$$', true],
  ['$', '$', false],
  ['\\(', '\\)', false],
  ['\\[', '\\]', true],
];

/** `piece` read as math, or `null` if it is some other token. Only meaningful on a whole match of
    `INLINE_PATTERN` — it checks delimiters, not the rules that decided the match. */
export function readMathToken(piece: string): MathToken | null {
  for (const [open, close, display] of MATH_DELIMITERS) {
    if (
      piece.length > open.length + close.length &&
      piece.startsWith(open) &&
      piece.endsWith(close)
    ) {
      return { open, tex: piece.slice(open.length, -close.length), close, display };
    }
  }
  return null;
}

/** A ` ```math ` fence: GitHub's and GitLab's way of writing a display formula. */
export const MATH_FENCE = /^\s*```\s*math\s*$/i;

/** A display formula set on lines of its own, as `mathBlockAt` found it. */
export interface MathBlock {
  /** The line it closes on. The same line it opened on, for `$$ x $$`. */
  end: number;
  /** Where the LaTeX starts on the opening line: past its indentation and the `$$` or `\[`. */
  texStart: number;
  /** Where the closing delimiter starts on the closing line — everything from here is syntax. */
  closeAt: number;
  tex: string;
}

/**
 * The display formula opening on `lines[index]`, if one does — and only if it also *closes*.
 *
 * A line opens one when it starts with `$$` or `\[`. It is the whole formula when it also ends with
 * the matching delimiter (`$$ x $$`), and otherwise the formula runs to the first later line that
 * ends with one. A line that closes the delimiter somewhere in the middle (`$$x$$ and then prose`) is
 * not a block at all: that is a display formula *inside* a paragraph, and the inline grammar above
 * already reads it.
 *
 * An opener with no closer is not a block either, unlike an unclosed code fence, which runs to the
 * end of the document. A fence is a deliberate three backticks; a `$$` is also what a half-written
 * formula looks like, and turning every line below it into LaTeX that cannot parse would punish the
 * document for being in the middle of an edit.
 *
 * Shared by the preview's block parser and the editor's overlay, so the two can never disagree about
 * where a formula begins and ends.
 */
export function mathBlockAt(lines: readonly string[], index: number): MathBlock | null {
  const line = lines[index];
  const indent = line.length - line.trimStart().length;
  for (const [open, close, display] of MATH_DELIMITERS) {
    if (!display || !line.startsWith(open, indent)) continue;
    const texStart = indent + open.length;
    const rest = line.slice(texStart).trimEnd();

    if (rest.includes(close)) {
      const closeAt = texStart + rest.length - close.length;
      const alone = rest.indexOf(close) === rest.length - close.length;
      return alone && closeAt > texStart
        ? { end: index, texStart, closeAt, tex: line.slice(texStart, closeAt) }
        : null;
    }

    for (let end = index + 1; end < lines.length; end++) {
      const candidate = lines[end].trimEnd();
      if (!candidate.endsWith(close)) continue;
      const closeAt = candidate.length - close.length;
      const tex = [
        line.slice(texStart),
        ...lines.slice(index + 1, end),
        lines[end].slice(0, closeAt),
      ].join('\n');
      return { end, texStart, closeAt, tex };
    }
    return null;
  }
  return null;
}

/** Every `[[id]]` referenced anywhere in `text`, deduplicated — what `useDocumentLabels` needs. */
export function referencedDocumentIds(text: string): string[] {
  const ids = new Set<string>();
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) ids.add(match[1]);
  return [...ids];
}

/**
 * The `[[id]]` the caret is sitting inside, if any — what the editor shows a title for.
 *
 * A *closed* token only. While `[[` is still being typed the suggestion list is open and already
 * naming every document it would link to; a second floating label over the top of it would be the
 * same answer twice.
 */
export function documentReferenceAt(
  text: string,
  caret: number,
): { id: string; start: number; end: number } | null {
  for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
    const start = match.index;
    if (start > caret) break; // matchAll walks left to right; nothing after this can contain it
    const end = start + match[0].length;
    if (caret <= end) return { id: match[1], start, end };
  }
  return null;
}

/* Line shapes. Each captures its marker *including* the trailing space, so slicing the capture off
   the line leaves exactly the words — and the marker keeps its own width in the overlay. */
const FENCE = /^\s*```/;
const RULE = /^\s*(?:---+|\*\*\*+|___+)\s*$/;
const HEADING = /^(#{1,6}\s+)/;
const QUOTE = /^(\s*>\s?)/;
const LIST = /^(\s*(?:[-*+]|\d+[.)])\s+)/;
const TASK = /^(\[([ xX])\]\s?)/;

const IMAGE_OR_LINK = /^(!?\[)([^\]]*)(\]\()([^)]+)(\))$/;

/**
 * Split a document's source into the spans to paint over it.
 *
 * `spans.map((span) => span.text).join('')` is always the input, unchanged — see the note at the
 * top of this file.
 *
 * Line-based, exactly like MarkdownView's block parser: a fence swallows everything until the next
 * one, and a line's leading marker is decided before its inline content is looked at. Adjacent
 * spans of the same kind are merged as they are pushed, so a page of ordinary prose costs a handful
 * of DOM nodes rather than one per line.
 */
export function highlightSource(text: string, people: MentionEntity[]): HighlightSpan[] {
  const spans: HighlightSpan[] = [];
  let at = 0;
  /* The two things a *line* can do to everything on it. Kept apart from `kind`, which is about one
     run of characters, so that what is inside a quoted or ticked line keeps its own meaning — see
     `HighlightSpan.struck`. Both are reset at the end of every line. */
  let struck = false;
  let quoted = false;
  let heading = false;

  const push = (piece: string, kind: HighlightKind, id?: string, display?: boolean) => {
    if (!piece) return;
    const start = at;
    at += piece.length;
    const last = spans.at(-1);
    const mergeable =
      last &&
      last.kind === kind &&
      last.id === undefined &&
      id === undefined &&
      last.display === display &&
      !last.struck === !struck &&
      !last.quoted === !quoted &&
      !last.heading === !heading;
    if (mergeable) {
      last.text += piece;
      return;
    }
    const span: HighlightSpan = { text: piece, kind };
    if (id !== undefined) {
      span.id = id;
      span.start = start;
    }
    if (display !== undefined) span.display = display;
    if (struck) span.struck = true;
    if (quoted) span.quoted = true;
    if (heading) span.heading = true;
    spans.push(span);
  };

  /** Plain text, with every `@Name` that resolves to a real person tinted. */
  const mentions = (source: string, kind: HighlightKind = 'text') => {
    // No tags in the notebook, so `#` is left alone for Markdown headings to use.
    for (const segment of segmentContent(source, people, [])) {
      push(segment.text, segment.kind === 'person' ? 'person' : kind);
    }
  };

  const token = (piece: string) => {
    const math = readMathToken(piece);
    if (math) {
      // Never through `mentions`: an `@` inside LaTeX is a character, not a person.
      push(math.open, 'syntax');
      push(math.tex, 'math', undefined, math.display);
      push(math.close, 'syntax');
      return;
    }
    if (piece.startsWith('[[')) {
      /* Whole, rather than brackets-then-id: it is one thing to the reader, and the id inside it is
         what the caller needs in order to look a title up. */
      push(piece, 'document', piece.slice(2, -2));
      return;
    }
    if (piece.startsWith('[') || piece.startsWith('![')) {
      const parts = IMAGE_OR_LINK.exec(piece)!;
      push(parts[1], 'syntax');
      push(parts[2], 'label');
      push(parts[3], 'syntax');
      push(parts[4], 'url');
      push(parts[5], 'syntax');
      return;
    }
    if (piece.startsWith('`')) {
      push('`', 'syntax');
      push(piece.slice(1, -1), 'code');
      push('`', 'syntax');
      return;
    }
    const marks = piece.startsWith('**') ? 2 : 1;
    push(piece.slice(0, marks), 'syntax');
    mentions(piece.slice(marks, -marks), marks === 2 ? 'strong' : 'emphasis');
    push(piece.slice(-marks), 'syntax');
  };

  const inline = (source: string) => {
    let rest = source;
    for (;;) {
      const match = INLINE_PATTERN.exec(rest);
      if (!match) return mentions(rest);
      mentions(rest.slice(0, match.index));
      token(match[0]);
      rest = rest.slice(match.index + match[0].length);
    }
  };

  /** What an open fence holds: `code`, or `math` for a ` ```math ` one. `null` outside a fence. */
  let fenced: 'code' | 'math' | null = null;
  /** The display formula the current line is inside, once its opening line has been painted. */
  let formula: MathBlock | null = null;

  /** A piece of a display formula — a `$$`/`\[` block or a ` ```math ` fence, never inline math. */
  const displayed = (piece: string) => push(piece, 'math', undefined, true);

  const lines = text.split('\n');
  lines.forEach((line, index) => {
    if (formula && index > formula.end) formula = null;

    /* The separators the split removed. Inside a fence or a formula they belong to the block, so its
       paint reads as one piece rather than as a stack of ragged strips. */
    if (index > 0) {
      const inside = fenced ?? (formula ? 'math' : 'text');
      if (inside === 'math') displayed('\n');
      else push('\n', inside);
    }

    if (formula) {
      const { closeAt, end } = formula;
      if (index < end) return displayed(line);
      displayed(line.slice(0, closeAt));
      return push(line.slice(closeAt), 'syntax');
    }

    if (FENCE.test(line)) {
      push(line, 'syntax');
      fenced = fenced ? null : MATH_FENCE.test(line) ? 'math' : 'code';
      return;
    }
    if (fenced === 'math') return displayed(line);
    if (fenced) return push(line, fenced);

    const block = mathBlockAt(lines, index);
    if (block) {
      push(line.slice(0, block.texStart), 'syntax');
      if (block.end > index) {
        formula = block;
        return displayed(line.slice(block.texStart));
      }
      displayed(line.slice(block.texStart, block.closeAt));
      return push(line.slice(block.closeAt), 'syntax');
    }

    if (RULE.test(line)) return push(line, 'syntax');

    let rest = line;
    const hashes = HEADING.exec(rest);
    if (hashes) {
      // The hashes stay plain, like the quote marker and the checkbox: punctuation, not the heading.
      push(hashes[1], 'syntax');
      heading = true;
      inline(rest.slice(hashes[1].length));
      heading = false;
      return;
    }

    const quote = QUOTE.exec(rest);
    if (quote) {
      // The marker stays plain, like the checkbox below: it is punctuation, not quoted words.
      push(quote[1], 'syntax');
      rest = rest.slice(quote[1].length);
      quoted = true;
    }

    const list = LIST.exec(rest);
    if (list) {
      push(list[1], 'syntax');
      rest = rest.slice(list[1].length);
      const task = TASK.exec(rest);
      if (task) {
        // The box itself is never struck: the preview draws it as a real checkbox, upright.
        push(task[1], 'syntax');
        rest = rest.slice(task[1].length);
        struck = task[2] !== ' ';
      }
    }

    inline(rest);
    struck = false;
    quoted = false;
  });

  return spans;
}
