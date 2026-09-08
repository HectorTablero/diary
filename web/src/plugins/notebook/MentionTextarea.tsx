import type { PersonDto } from '@diary/shared';
import { FileText, User } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { detectActiveToken, fuzzyIncludes } from '@/lib/tokens';
import { cn } from '@/lib/utils';
import { caretOffset } from './caret';
import { documentReferenceAt, highlightSource, type HighlightKind } from './syntax';

/**
 * The notebook's writing surface: a plain textarea with `@person` and `[[document]]` autocomplete,
 * and a highlight layer drawn behind it.
 *
 * ## What is shared with the composer's TokenTextarea, and what isn't
 *
 * The shared part is the part worth sharing: `detectActiveToken` and `fuzzyIncludes` from
 * `lib/tokens`, which are what make `@Ana` in a thought mean exactly what `@Ana` in an entry means —
 * matched by name, resolved on read, and rewritten by the app when Ana is renamed. The overlay
 * technique below is the composer's too, down to the faux-bold trick, and the note there
 * (components/entry/TokenTextarea.tsx) is still the best explanation of why the two layers have to
 * agree glyph for glyph.
 *
 * What is not shared is the rest of that component: it caps its own height at 200px, because it is a
 * composer, and it carries a whole second half for `#tags`, which the notebook deliberately has none
 * of. `[[` is likewise not added to `lib/tokens.ts`, because that module is also the composer's and
 * the composer must never grow a meaning for `[[`. It is detected locally, just below. A document
 * link resolves by id rather than by name (see MarkdownView's note on `[[id]]`), so unlike
 * `@mentions` there is nothing here for a rename to keep in step with — the label shown is always
 * read live.
 *
 * ## The overlay
 *
 * This used to say a highlight layer was too expensive for a document: laying a thousand words out
 * twice on every keystroke is a real cost where a one-line bullet's isn't. Two things make it pay
 * anyway. The first is that a document is *where the syntax is* — the composer has mentions and
 * nothing else, while a page of prose has headings, quotes, code, links and cross-references, and
 * reading `[[68a1f2c3d4e5f60718293a4b]]` in the middle of a sentence is not reading. The second is
 * that `highlightSource` merges neighbouring runs of the same kind, so the span list is proportional
 * to how many *tokens* a document has and not to how long it is; ordinary prose between two
 * headings is one node. The parse is memoized on the text, so a caret move costs nothing at all.
 *
 * Nothing painted over a run of characters changes its advance width — see the rule at the top of
 * syntax.ts, which is the whole reason this can sit under a real caret without drifting. Which trick
 * each kind of emphasis uses to manage that, and why each one is safe, is in `KIND_CLASS` below.
 *
 * The single exception is a `[[id]]`, which is *replaced* by the title it points at, because an id
 * is not something anyone can read. It is replaced inside its own box rather than in place of it, so
 * the token keeps the width it has in the textarea and the rest of the line never moves — see
 * `DocumentReference` at the bottom of this file, which is also where the caret gets its id back.
 *
 * ## The popup, and the label under the caret
 *
 * A composer can hang its suggestions off the bottom edge, because the caret is never more than a
 * line or two away from it. In a full-page document the bottom edge can be a screen and a half
 * below what you are typing, so the list is positioned at the caret instead — measured by
 * `caretOffset` in caret.ts, which is the only way to ask a textarea where its caret actually is.
 * The same anchor carries the title of the reference the caret is inside, which is the one place
 * that title cannot be drawn over the reference itself.
 */

/** The `[[` trigger — see the note above on why this lives here rather than in `lib/tokens.ts`. Stays
    active through everything but `[` or `]`, so `[[Ana` keeps suggesting while `[[Ana]]` (closed by
    a pick or typed by hand) and a stray `[[[` both end it. */
function detectDocumentToken(
  value: string,
  caret: number,
): { start: number; query: string } | null {
  const before = value.slice(0, caret);
  const match = /\[\[([^[\]]*)$/.exec(before);
  return match ? { start: caret - match[0].length, query: match[1] } : null;
}

type Token =
  | { kind: 'person'; query: string; start: number }
  | { kind: 'document'; query: string; start: number };

/* Every property that decides where a line breaks, on both layers. The textarea's own `border` and
   `padding` are zero — the box around it belongs to DocumentEditorPanel — so there is nothing else
   for the mirror to copy. */
const SHARED_TEXT_CLASSES =
  'w-full p-0 font-sans text-[15px] leading-7 whitespace-pre-wrap break-words';

/**
 * How each kind of span is painted.
 *
 * Every emphasis Markdown has gets a shape here, and each is drawn the only way that keeps the two
 * layers glyph-for-glyph:
 *
 *  - **bold** is a stroke rather than a weight. See the long note on the same declaration in
 *    components/entry/TokenTextarea.tsx — a real `font-weight` widens these glyphs relative to the
 *    weight-400 copy in the textarea underneath, and everything after them on the line stops lining
 *    up. A stroke thickens the paint and changes no advance width.
 *  - *italic* is a real `font-style`, which is safe here for a reason worth writing down: the app
 *    loads Geist's upright faces only (`@fontsource-variable/geist`'s index.css has no
 *    `font-style: italic` rule, and neither do the CJK fallbacks). With no italic face to switch to,
 *    every browser synthesizes one by shearing the upright glyphs — which leaves the advance widths
 *    exactly as they were. If an italic face is ever added to the bundle, this line has to become a
 *    skew transform instead, or the layers will drift apart on every emphasized word.
 *  - a heading is bold rather than bigger, because a bigger one is a different line height and the
 *    whole paragraph below it would slide. It is a `span.heading` modifier rather than a kind, so
 *    that a bold word inside a heading is still both — see `HighlightSpan.heading`.
 *  - `code` is a tinted background rather than a monospace face, which is the one place this rule
 *    genuinely costs something: a monospace font is a different width for every character in the
 *    span, so it is the one kind of emphasis that cannot be shown at all.
 */
const KIND_CLASS: Record<HighlightKind, string> = {
  text: '',
  // Dimmed rather than hidden. Hiding a `#` would leave a space the caret still walks through,
  // which reads as a stuck arrow key; this way the marks recede and the words come forward.
  syntax: 'text-muted-foreground/60',
  strong: '',
  emphasis: 'italic',
  code: 'rounded bg-muted',
  person: 'text-sky-700 dark:text-sky-300',
  document: '',
  label: 'text-sky-700 dark:text-sky-300',
  url: 'text-muted-foreground',
};

/** Kinds carrying no colour of their own, so a ticked task item can grey them out without fighting a
    tint. Its mentions and references keep theirs, exactly as the preview keeps them clickable — see
    `HighlightSpan.struck`. */
const UNTINTED = new Set<HighlightKind>(['text', 'strong', 'emphasis']);

/** Faux bold — see the note above. Inline style rather than a class because Tailwind has no
    `-webkit-text-stroke` utility. */
const STROKE = { WebkitTextStroke: '0.3px currentColor' } as const;

export function MentionTextarea({
  value,
  onChange,
  people,
  documents,
  documentLabels,
  documentLabelsLoading,
  onDocumentTokenActive,
  placeholder,
  autoFocus,
  className,
  textareaRef: externalRef,
}: {
  value: string;
  onChange: (value: string) => void;
  people: PersonDto[];
  /** Every other document, for `[[` autocomplete — the caller excludes the one being edited, and may
      supply it lazily (empty until the first call to `onDocumentTokenActive`). */
  documents: { id: string; label: string }[];
  /** Live titles for the `[[id]]`s this text actually contains, from `useDocumentLabels`. */
  documentLabels: ReadonlyMap<string, string>;
  /** True while those titles are still being read. An id missing from the map means the document is
      gone — but only once this is false; before it, it means nobody has looked yet, and the two must
      not paint the same. See `DocumentLabels` in useNotebook.ts. */
  documentLabelsLoading: boolean;
  /** Fired the moment a `[[` token becomes active — the caller's cue to load `documents` if it
      hasn't yet. Called again on every subsequent keystroke while the token stays open; the caller
      is expected to no-op after its first real fetch. */
  onDocumentTokenActive?: () => void;
  placeholder?: string;
  autoFocus?: boolean;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
}) {
  const { t } = useTranslation();
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef ?? internalRef;
  const listboxId = useId();
  const [token, setToken] = useState<Token | null>(null);
  const [anchor, setAnchor] = useState<{ top: number; left: number }>({ top: 0, left: 0 });
  const [selectedIndex, setSelectedIndex] = useState(0);
  /** The closed `[[id]]` the caret is inside: which one (`start`, since the same document can be
      linked twice), what it points at, and where to hang its title. */
  const [reference, setReference] = useState<{
    id: string;
    start: number;
    top: number;
    left: number;
  } | null>(null);

  const refreshToken = () => {
    const el = textareaRef.current;
    if (!el) {
      setToken(null);
      return setReference(null);
    }
    const caret = el.selectionStart ?? 0;
    // `#` means a Markdown heading here, not a tag: the notebook has no tags, and swallowing the
    // character to offer a suggestion list would make headings unwritable.
    const person = detectActiveToken(value, caret);
    const next: Token | null =
      person?.type === '@'
        ? { kind: 'person', query: person.query, start: person.start }
        : (() => {
            const doc = detectDocumentToken(value, caret);
            return doc && { kind: 'document', query: doc.query, start: doc.start };
          })();
    if (next?.kind === 'document') onDocumentTokenActive?.();
    setToken(next);
    if (next) setAnchor(caretOffset(el, caret));

    /* Measured from the token's own start rather than from the caret, so the title sits under the
       reference it belongs to and stops jittering sideways as the caret moves through it. */
    const inside = documentReferenceAt(value, caret);
    setReference(
      inside && { id: inside.id, start: inside.start, ...caretOffset(el, inside.start) },
    );
  };

  useEffect(() => {
    refreshToken();
    // Only on text changes — caret moves come through the click/key handlers, which is what keeps
    // this from measuring a mirror on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  useEffect(() => setSelectedIndex(0), [token?.query]);

  const suggestions = useMemo(() => {
    if (!token) return [];
    if (token.kind === 'document') {
      return documents
        .filter((doc) => !token.query || fuzzyIncludes(doc.label, token.query))
        .slice(0, 6)
        .map((doc) => ({ id: doc.id, inserted: `[[${doc.id}]]`, label: doc.label }));
    }
    const matchedAlias = (person: PersonDto) =>
      person.aliases.find((alias) => fuzzyIncludes(alias, token.query));
    return people
      .filter(
        (p) => !token.query || fuzzyIncludes(p.name, token.query) || matchedAlias(p) !== undefined,
      )
      .slice(0, 6)
      .map((p) => {
        // Show the nickname that matched, so picking "Carmen" after typing "@Mum" isn't a surprise.
        const alias = fuzzyIncludes(p.name, token.query) ? undefined : matchedAlias(p);
        return {
          id: p.id,
          inserted: `@${p.name}`,
          label: alias ? `${p.name} (${alias})` : p.name,
        };
      });
  }, [token, people, documents]);

  /* The second layout of the text, and the only expensive thing this component does. Keyed on the
     text and the people list alone: a caret move, a suggestion opening or a title arriving must
     never re-parse a thousand words. */
  const spans = useMemo(() => highlightSource(value, people), [value, people]);

  const insert = (suggestion: { inserted: string }) => {
    const el = textareaRef.current;
    if (!el || !token) return;
    const caret = el.selectionStart ?? value.length;
    /* No trailing space, unlike the composer. A bullet is a list of mentions and a sentence is not:
       "@Ana." and "@Ana," are both ordinary prose, and a space forced in front of the punctuation is
       something to delete every single time. Same reasoning extends to `[[id]]`. */
    const next = `${value.slice(0, token.start)}${suggestion.inserted}${value.slice(caret)}`;
    onChange(next);
    const position = token.start + suggestion.inserted.length;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(position, position);
    });
    setToken(null);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!suggestions.length) return;
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setSelectedIndex((i) => (i + 1) % suggestions.length);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
    } else if (event.key === 'Enter' || event.key === 'Tab') {
      /* Enter picks a suggestion *only* while the list is open — everywhere else it is a new
         paragraph, which in a prose editor is the one key that must never be stolen. */
      event.preventDefault();
      const picked = suggestions[selectedIndex];
      if (picked) insert(picked);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      setToken(null);
    }
  };

  /* Same combobox exposure as the composer's, and for the same reason: focus never leaves the
     textarea, so the row ArrowDown just landed on has to be *named* through aria-activedescendant
     rather than merely tinted. See the long note in components/entry/TokenTextarea.tsx. */
  const expanded = suggestions.length > 0;
  const optionId = (id: string) => `${listboxId}-${id}`;

  return (
    <div className="relative">
      {/* The highlight layer: identical metrics to the textarea, sitting behind it. Hidden from
          assistive technology outright — every character of it is already in the textarea, and a
          screen reader reading the document twice would be the accessibility cost of a purely
          visual convenience. */}
      <div
        aria-hidden="true"
        className={cn(
          SHARED_TEXT_CLASSES,
          'pointer-events-none absolute inset-0 overflow-hidden text-foreground',
        )}
      >
        {spans.map((span, index) => {
          /* What the *line* does to this span, on top of what the span is. Applied to a reference's
             title as readily as to prose — a link inside a quote is quoted, and one inside a ticked
             task is finished, which is exactly what the preview shows. Colour is not part of it:
             tinted kinds keep their own, so a mention in a struck line is still visibly a mention. */
          const line = cn(
            span.quoted && 'italic',
            span.struck && 'line-through',
            (span.quoted || span.struck) && UNTINTED.has(span.kind) && 'text-muted-foreground',
          );
          return span.kind === 'document' ? (
            <DocumentReference
              key={index}
              raw={span.text}
              title={documentLabels.get(span.id!)}
              // Nobody has looked the id up yet: not a title, and not a broken link either.
              unresolved={documentLabelsLoading}
              // The caret is in this one. Not merely "in a reference to the same document" — the
              // same id can be linked twice in a paragraph, and only the one being edited reveals.
              revealed={span.start === reference?.start}
              line={line}
            />
          ) : (
            <span
              key={index}
              style={span.heading || span.kind === 'strong' ? STROKE : undefined}
              className={cn(KIND_CLASS[span.kind], line)}
            >
              {span.text}
            </span>
          );
        })}
      </div>

      <textarea
        ref={textareaRef}
        value={value}
        autoFocus={autoFocus}
        placeholder={placeholder}
        spellCheck
        role="combobox"
        aria-expanded={expanded}
        aria-controls={expanded ? listboxId : undefined}
        aria-autocomplete="list"
        aria-activedescendant={
          expanded && suggestions[selectedIndex]
            ? optionId(suggestions[selectedIndex].id)
            : undefined
        }
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        onClick={refreshToken}
        onKeyUp={(event) => {
          if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) refreshToken();
        }}
        onBlur={() => {
          // The caret has gone, so the reference it was in goes with it — otherwise a document left
          // unfocused keeps one token showing its raw id, and a label hanging under it.
          setReference(null);
          setTimeout(() => setToken(null), 150);
        }}
        className={cn(
          SHARED_TEXT_CLASSES,
          /* Transparent text over the layer above, with the caret painted back in — the standard
             shape of this technique. The selection has to be translucent for the same reason: a
             textarea paints its selection above everything behind it, and an opaque one would black
             out the very highlighting it is selecting. */
          'relative block resize-none bg-transparent text-transparent caret-foreground outline-none selection:bg-foreground/20 placeholder:text-muted-foreground',
          className,
        )}
      />

      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t(
            token?.kind === 'document'
              ? 'plugins.notebook.documentMentionSuggestions'
              : 'plugins.notebook.mentionSuggestions',
          )}
          style={{ top: anchor.top, left: anchor.left }}
          className="absolute z-50 mt-6 max-w-[min(18rem,90%)] min-w-40 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
        >
          {suggestions.map((suggestion, index) => (
            <li
              key={suggestion.id}
              id={optionId(suggestion.id)}
              role="option"
              aria-selected={index === selectedIndex}
              // Stops the textarea losing focus, which would fire the blur that clears the token
              // before the click could apply it.
              onMouseDown={(event) => {
                event.preventDefault();
                insert(suggestion);
              }}
              onMouseEnter={() => setSelectedIndex(index)}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                index === selectedIndex && 'bg-accent text-accent-foreground',
              )}
            >
              {token?.kind === 'document' ? (
                <FileText aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              ) : (
                <User aria-hidden className="size-3.5 shrink-0 text-muted-foreground" />
              )}
              <span className="truncate">{suggestion.label}</span>
            </li>
          ))}
        </ul>
      )}

      {/* The reference under the caret has given up its title to show the id being edited (see
          `DocumentReference`), so the title is said here instead — the one place it can be said
          without standing on the characters the caret is walking through. It is also where a
          reference that resolves to nothing gets named, rather than only tinted.

          Never while the suggestion list is open: they share an anchor, and that list is already
          naming documents. Never before the lookup has answered either, since "not found" and "not
          asked yet" would otherwise read the same. */}
      {reference && !expanded && !documentLabelsLoading && (
        <div
          style={{ top: reference.top, left: reference.left }}
          className="pointer-events-none absolute z-40 mt-7 flex max-w-[min(18rem,90%)] items-center gap-1.5 rounded-md border bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm"
        >
          <FileText aria-hidden className="size-3 shrink-0 text-muted-foreground" />
          <span className="truncate">
            {documentLabels.get(reference.id) ?? t('plugins.notebook.documentNotFound')}
          </span>
        </div>
      )}
    </div>
  );
}

/**
 * One `[[id]]`, showing the title it points at.
 *
 * The only place the overlay stops mirroring the text underneath it, and the only place it is
 * allowed to: an id is twenty-four characters of hexadecimal and there is nothing in it to read,
 * which is the whole reason a reference resolves live rather than storing a name (see MarkdownView's
 * note on `[[id]]`).
 *
 * ## How it can be a different length and still line up
 *
 * The raw token stays in the flow, painted in transparent ink. It keeps exactly the width it has in
 * the textarea below, so every word after it on the line still sits over its own glyphs. The title
 * is drawn *into* that box, absolutely positioned, centred, and clipped to it with an ellipsis when
 * it is the longer of the two — which is what limiting its length properly amounts to: the limit is
 * the space the reference actually takes up, measured by the browser at the size it is really being
 * drawn, rather than a character count guessed at in advance.
 *
 * A reference that wraps across a line break is the one case this cannot serve: the token has two
 * fragments and an absolutely positioned child has one box to sit in, so the title is drawn into the
 * first of them. It degrades to a clipped title rather than to misaligned prose, which is the right
 * way round.
 *
 * ## Why it goes back to the id under the caret
 *
 * Because that is where the difference in length would be felt. Everywhere else the caret is outside
 * the token and only the token's *width* matters, which is preserved exactly; inside it, the caret
 * would be walking through twenty-four characters while the screen showed eight, and every arrow
 * key would look broken. Revealing the source under the cursor is also what every editor with a
 * live preview does, for the same reason — and the title is not lost, it moves to the label anchored
 * just below (see the caret chip above).
 */
function DocumentReference({
  raw,
  title,
  unresolved,
  revealed,
  line,
}: {
  /** The token exactly as typed, `[[id]]` and all. */
  raw: string;
  title: string | undefined;
  unresolved: boolean;
  revealed: boolean;
  /** What the line this sits on does to it — struck through, italicised. Never its colour: a
      reference inside a ticked task or a quote is still a live reference, exactly as the preview
      keeps it clickable. */
  line: string;
}) {
  /* Red only for a reference that has been *looked up* and not found: a document deleted since it
     was linked to. Nothing else in the editor can tell you that — the id looks exactly the same
     either way, and the preview says it only by quietly declining to make a link. */
  const broken = !unresolved && title === undefined;
  /* Kept apart from the ink, because the replaced form needs the one without the other: the raw
     token has to go fully transparent there, and a text colour listed after `text-transparent`
     would quietly win it back (tailwind-merge keeps the last of two colours, so the id stayed
     legible under its own title). */
  const background = broken ? 'bg-destructive/10' : 'bg-sky-500/15';
  const ink = broken ? 'text-destructive' : 'text-sky-700 dark:text-sky-300';

  if (revealed || title === undefined) {
    return <span className={cn('rounded-sm', background, ink, line)}>{raw}</span>;
  }

  return (
    <span className={cn('relative rounded-sm', background, 'text-transparent')}>
      {raw}
      <span className="absolute inset-0 flex items-center overflow-hidden">
        <span className={cn('w-full truncate text-center leading-none', ink, line)}>{title}</span>
      </span>
    </span>
  );
}
