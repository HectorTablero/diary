import type { PersonRefDto, TagDto } from '@diary/shared';
import { Plus, Tag as TagIcon, User } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { detectActiveToken, fuzzyEquals, fuzzyIncludes, segmentContent, type ActiveToken } from '@/lib/tokens';
import { cn } from '@/lib/utils';

interface Suggestion {
  key: string;
  label: string;
  icon: 'person' | 'tag' | 'create';
  apply: () => void;
}

interface TokenTextareaProps {
  value: string;
  onChange: (value: string) => void;
  people: PersonRefDto[];
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
      return people
        .filter((p) => !token.query || fuzzyIncludes(p.name, token.query))
        .slice(0, 6)
        .map((p) => ({
          key: p.id,
          label: p.name,
          icon: 'person' as const,
          apply: () => {
            onSelectPerson(p);
            insertToken(`@${p.name}`);
          },
        }));
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
      segmentContent(
        value,
        linkedPeople.map((p) => p.name),
        linkedTags.map((tag) => tag.name),
      ),
    [value, linkedPeople, linkedTags],
  );

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
                className={cn(
                  'rounded-sm font-medium',
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

      {suggestions.length > 0 && (
        <ul className="absolute inset-x-0 top-full z-50 mt-1 overflow-hidden rounded-lg border bg-popover text-popover-foreground shadow-md">
          {suggestions.map((s, i) => (
            <li key={s.key}>
              <button
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  s.apply();
                }}
                onMouseEnter={() => setSelectedIndex(i)}
                className={cn(
                  'flex w-full items-center gap-2 px-3 py-2 text-left text-sm',
                  i === selectedIndex && 'bg-accent text-accent-foreground',
                )}
              >
                {s.icon === 'person' && <User className="size-3.5 text-muted-foreground" />}
                {s.icon === 'tag' && <TagIcon className="size-3.5 text-muted-foreground" />}
                {s.icon === 'create' && <Plus className="size-3.5 text-muted-foreground" />}
                {s.icon === 'create' ? (
                  <span>{t('diary.createTag', { name: s.label })}</span>
                ) : (
                  <span>{s.label}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
