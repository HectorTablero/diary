import type { PersonRefDto, TagDto } from '@diary/shared';
import { Plus, Tag as TagIcon, User } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { detectActiveToken, fuzzyEquals, fuzzyIncludes, segmentContent, type ActiveToken } from '@/lib/tokens';
import { cn } from '@/lib/utils';

interface Suggestion {
  key: string;
  label: string;
  icon: 'person' | 'tag' | 'create';
  apply: () => void;
}

/** Autocomplete can be *found* by an alias, but the token inserted is always the canonical
    name — so segmentContent/renameMentions keep working off `name` alone. */
export type MentionablePerson = PersonRefDto & { aliases?: string[] };

interface TokenTextareaProps {
  value: string;
  onChange: (value: string) => void;
  people: MentionablePerson[];
  tags: TagDto[];
  linkedPeople: PersonRefDto[];
  linkedTags: TagDto[];
  onSelectPerson: (person: PersonRefDto) => void;
  onSelectTag: (tag: TagDto) => void;
  onCreateTag: (name: string) => Promise<TagDto | null>;
  placeholder?: string;
  autoFocus?: boolean;
  onSubmit?: () => void;
}

const SHARED_TEXT_CLASSES =
  'w-full whitespace-pre-wrap break-words px-3 py-2 text-sm leading-6 font-sans';

export function TokenTextarea({
  value,
  onChange,
  people,
  tags,
  linkedPeople,
  linkedTags,
  onSelectPerson,
  onSelectTag,
  onCreateTag,
  placeholder,
  autoFocus,
  onSubmit,
}: TokenTextareaProps) {
  const { t } = useTranslation();
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();
  const [token, setToken] = useState<ActiveToken | null>(null);
  const [selectedIndex, setSelectedIndex] = useState(0);

  // Auto-grow the textarea with its content.
  const resize = () => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  };
  useEffect(resize, [value]);

  const refreshToken = () => {
    const el = textareaRef.current;
    if (!el) return setToken(null);
    setToken(detectActiveToken(value, el.selectionStart ?? 0));
  };

  // Recompute the active token whenever value or caret changes.
  useEffect(() => {
    refreshToken();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);

  const insertToken = (text: string) => {
    const el = textareaRef.current;
    if (!el || !token) return;
    const caret = el.selectionStart ?? value.length;
    const next = `${value.slice(0, token.start)}${text} ${value.slice(caret)}`;
    onChange(next);
    const pos = token.start + text.length + 1;
    requestAnimationFrame(() => {
      el.focus();
      el.setSelectionRange(pos, pos);
    });
    setToken(null);
  };

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!token) return [];
    if (token.type === '@') {
      const matchedAlias = (person: MentionablePerson) =>
        person.aliases?.find((alias) => fuzzyIncludes(alias, token.query));
      return people
        .filter(
          (p) =>
            !token.query || fuzzyIncludes(p.name, token.query) || matchedAlias(p) !== undefined,
        )
        .slice(0, 6)
        .map((p) => {
          // Show the nickname that matched, so picking "Carmen" after typing "@Mum" isn't a surprise.
          const alias = fuzzyIncludes(p.name, token.query) ? undefined : matchedAlias(p);
          return {
            key: p.id,
            label: alias ? `${p.name} (aka. ${alias})` : p.name,
            icon: 'person' as const,
            apply: () => {
              onSelectPerson(p);
              insertToken(`@${p.name}`);
            },
          };
        });
    }
    const matches: Suggestion[] = tags
      .filter((tag) => !token.query || fuzzyIncludes(tag.name, token.query))
      .slice(0, 6)
      .map((tag) => ({
        key: tag.id,
        label: tag.name,
        icon: 'tag' as const,
        apply: () => {
          onSelectTag(tag);
          insertToken(`#${tag.name}`);
        },
      }));
    const query = token.query.trim();
    const exact = tags.some((tag) => fuzzyEquals(tag.name, query));
    if (query && !exact) {
      matches.push({
        key: '__create__',
        label: query,
        icon: 'create' as const,
        apply: () => {
          void onCreateTag(query).then((tag) => {
            if (tag) {
              onSelectTag(tag);
              insertToken(`#${tag.name}`);
            }
          });
        },
      });
    }
    return matches;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, people, tags]);

  useEffect(() => setSelectedIndex(0), [token?.query, token?.type]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedIndex((i) => (i + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedIndex((i) => (i - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        suggestions[selectedIndex]?.apply();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setToken(null);
        return;
      }
    }
    if (e.key === 'Enter' && !e.shiftKey && onSubmit) {
      e.preventDefault();
      onSubmit();
    }
  };

  const segments = useMemo(
    () =>
      segmentContent(value, linkedPeople, linkedTags),
    [value, linkedPeople, linkedTags],
  );

  /* The suggestion list is a combobox popup, and the only cue a screen reader gets about which row
     ArrowDown just landed on is aria-activedescendant — focus never leaves the textarea, so the
     highlighted row has to be *named* rather than merely tinted. Everything the pattern needs is
     already in state; these three lines just expose it.

     `role="combobox"` on a <textarea> is the one liberty taken here: ARIA-in-HTML allows a textarea
     no role but its implicit textbox. A textbox does support aria-activedescendant and
     aria-autocomplete, but not aria-expanded — and without "expanded" nothing announces that a
     popup opened at all, which is the whole finding. The element stays a real textarea, so multi-
     line editing and the caret behave as before. */
  const expanded = suggestions.length > 0;
  const optionId = (key: string) => `${listboxId}-${key}`;
  const activeKey = suggestions[selectedIndex]?.key;

  return (
    <div className="relative">
      <div className="relative overflow-hidden rounded-lg border bg-transparent focus-within:ring-2 focus-within:ring-ring/40">
        {/* Highlight layer: identical metrics to the textarea, sits behind it. */}
        <div
          ref={overlayRef}
          aria-hidden="true"
          className={cn(SHARED_TEXT_CLASSES, 'pointer-events-none absolute inset-0 overflow-hidden text-foreground')}
        >
          {segments.map((seg, i) =>
            seg.kind === 'text' ? (
              <span key={i}>{seg.text}</span>
            ) : (
              <span
                key={i}
                /* Faux bold. A real font-weight would widen these glyphs relative to the
                   weight-400 copy in the textarea underneath, pushing the two layers out of
                   sync — text after a token would no longer sit under its highlight, and the
                   caret would land in the wrong place. A stroke thickens the paint without
                   changing any advance width, so the layers stay glyph-for-glyph aligned. */
                style={{ WebkitTextStroke: '0.3px currentColor' }}
                className={cn(
                  'rounded-sm',
                  seg.kind === 'person'
                    ? 'bg-sky-500/15 text-sky-700 dark:text-sky-300'
                    : 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-300',
                )}
              >
                {seg.text}
              </span>
            ),
          )}
          {/* Trailing newline so the overlay keeps the same height as the textarea. */}
          {'\n'}
        </div>
        <textarea
          ref={textareaRef}
          value={value}
          rows={1}
          autoFocus={autoFocus}
          placeholder={placeholder}
          role="combobox"
          aria-expanded={expanded}
          aria-controls={expanded ? listboxId : undefined}
          aria-autocomplete="list"
          aria-activedescendant={activeKey ? optionId(activeKey) : undefined}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          onClick={refreshToken}
          onKeyUp={(e) => {
            if (['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) refreshToken();
          }}
          onScroll={() => {
            if (overlayRef.current && textareaRef.current) {
              overlayRef.current.scrollTop = textareaRef.current.scrollTop;
            }
          }}
          onBlur={() => setTimeout(() => setToken(null), 150)}
          className={cn(
            SHARED_TEXT_CLASSES,
            'relative block max-h-50 min-h-10 resize-none bg-transparent text-transparent caret-foreground outline-none placeholder:text-muted-foreground',
          )}
        />
      </div>

      {expanded && (
        <ul
          id={listboxId}
          role="listbox"
          aria-label={t('diary.suggestions')}
          className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md"
        >
          {suggestions.map((s, i) => (
            /* The row is the option itself — the <button> it used to wrap was both invalid inside
               role="option" (an option may not hold a focusable descendant) and pointless, since
               every keystroke is handled on the textarea. onMouseDown/preventDefault stays where it
               was: it stops the textarea losing focus, which would fire the blur that clears the
               token before the click could apply it. */
            <li
              key={s.key}
              id={optionId(s.key)}
              role="option"
              aria-selected={i === selectedIndex}
              onMouseDown={(e) => {
                e.preventDefault();
                s.apply();
              }}
              onMouseEnter={() => setSelectedIndex(i)}
              className={cn(
                'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm',
                i === selectedIndex && 'bg-accent text-accent-foreground',
              )}
            >
              {s.icon === 'person' && <User aria-hidden className="size-3.5 text-muted-foreground" />}
              {s.icon === 'tag' && <TagIcon aria-hidden className="size-3.5 text-muted-foreground" />}
              {s.icon === 'create' && <Plus aria-hidden className="size-3.5 text-muted-foreground" />}
              {s.icon === 'create' ? (
                <span>{t('diary.createTag', { name: s.label })}</span>
              ) : (
                <span>{s.label}</span>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
