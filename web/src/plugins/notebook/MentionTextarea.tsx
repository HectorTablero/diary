import type { PersonDto } from '@diary/shared';
import { FileText, User } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { detectActiveToken, fuzzyIncludes } from '@/lib/tokens';
import { cn } from '@/lib/utils';

/**
 * The notebook's writing surface: a plain textarea with `@person` and `[[document]]` autocomplete.
 *
 * ## Why not the composer's TokenTextarea
 *
 * Three things it does that a document must not. It highlights mentions through a mirrored overlay,
 * which means laying out the whole text twice on every keystroke — fine for a one-line bullet, a
 * real cost for a thousand-word essay. It caps its own height at 200px, because it is a composer.
 * And it carries a whole second half for `#tags`, which the notebook deliberately has none of.
 *
 * What is shared is the part worth sharing: `detectActiveToken` and `fuzzyIncludes` from
 * `lib/tokens`, which are what make `@Ana` in a thought mean exactly what `@Ana` in an entry means —
 * matched by name, resolved on read, and rewritten by the app when Ana is renamed.
 *
 * `[[` is deliberately *not* added to that shared module. It is detected locally, just below, because
 * `lib/tokens.ts` is also the composer's, and the composer must never grow a meaning for `[[`. A
 * document link resolves by id rather than by name (see MarkdownView's note on `[[id]]`), so unlike
 * `@mentions` there is nothing here for a rename to keep in step with — the label shown is always
 * read live.
 *
 * ## The popup follows the caret
 *
 * A composer can hang its suggestions off the bottom edge, because the caret is never more than a
 * line or two away from it. In a full-page document the bottom edge can be a screen and a half
 * below what you are typing, so the list is positioned at the caret instead — measured by laying the
 * text out in a mirror div, which is the only way to ask a textarea where its caret actually is.
 */

/** The properties a mirror must copy for its line breaks to fall where the textarea's do. */
const MIRRORED_STYLES = [
  'font-family',
  'font-size',
  'font-weight',
  'font-style',
  'letter-spacing',
  'line-height',
  'text-indent',
  'text-transform',
  'padding-top',
  'padding-right',
  'padding-bottom',
  'padding-left',
  'border-top-width',
  'border-right-width',
  'border-bottom-width',
  'border-left-width',
  'box-sizing',
] as const;

/** Where the caret sits inside the textarea's box, in CSS pixels, scroll accounted for. */
function caretOffset(textarea: HTMLTextAreaElement, index: number): { top: number; left: number } {
  const mirror = document.createElement('div');
  const computed = window.getComputedStyle(textarea);
  for (const property of MIRRORED_STYLES) {
    mirror.style.setProperty(property, computed.getPropertyValue(property));
  }
  mirror.style.position = 'absolute';
  mirror.style.top = '0';
  mirror.style.left = '-9999px';
  mirror.style.visibility = 'hidden';
  mirror.style.whiteSpace = 'pre-wrap';
  mirror.style.overflowWrap = 'break-word';
  mirror.style.width = `${textarea.clientWidth}px`;

  mirror.textContent = textarea.value.slice(0, index);
  const marker = document.createElement('span');
  /* The rest of the text goes *inside* the marker so the marker wraps exactly as the real text
     does. Without it a caret at the end of a line would measure at the start of the next one. A
     full stop stands in for an empty tail, since a zero-width span has no position to report. */
  marker.textContent = textarea.value.slice(index) || '.';
  mirror.appendChild(marker);

  document.body.appendChild(mirror);
  const top = marker.offsetTop - textarea.scrollTop;
  const left = marker.offsetLeft;
  mirror.remove();
  return { top, left };
}

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

export function MentionTextarea({
  value,
  onChange,
  people,
  documents,
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

  const refreshToken = () => {
    const el = textareaRef.current;
    if (!el) return setToken(null);
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
        onBlur={() => setTimeout(() => setToken(null), 150)}
        className={cn(
          'w-full resize-none bg-transparent font-sans text-[15px] leading-7 outline-none placeholder:text-muted-foreground',
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
    </div>
  );
}
