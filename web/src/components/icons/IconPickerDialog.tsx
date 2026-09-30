import { Icon as LucideRenderer, Search, type LucideIcon } from 'lucide-react';
import {
  useCallback,
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import {
  canonicalIconName,
  iconLabel,
  iconNode,
  loadIconCatalog,
  useIconCatalog,
  type IconCatalog,
} from './iconCatalog';
import { matchIcons } from './iconMatch';
import { gridWindow, moveInGrid } from './virtualGrid';

/** One cell's height, and its minimum width. 44px is the smallest comfortable touch target. */
const CELL = 44;
/** Rows drawn past each edge of the viewport. */
const OVERSCAN = 3;
/* What the grid assumes before it has been measured — the first frame, and jsdom, which never
   measures anything. Roughly the dialog's real size on a phone, so the first frame is not wrong. */
const FALLBACK_WIDTH = 8 * CELL;
const FALLBACK_HEIGHT = 288;

type Tags = Readonly<Record<string, readonly string[]>>;

export interface IconPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Defaults to the generic "Choose an icon". */
  title?: string;
  /** The stored icon name, or null for the empty option. */
  value: string | null;
  /** Called with the chosen name, or null for the empty option. The dialog closes itself. */
  onChange: (icon: string | null) => void;
  /**
   * The choice that stores no icon, and what it looks like: "Default" beside the icon that will be
   * drawn instead (an expense category), or "No icon" with nothing (a notebook document).
   *
   * `iconName` is the default icon's Lucide name. While nothing is chosen, that icon is marked
   * selected in the grid too — it *is* what is being shown — and picking it stores no icon rather
   * than a copy of the default, so the choice stays "whatever the default is".
   */
  emptyOption: { label: string; icon?: LucideIcon; iconName?: string };
}

/**
 * Pick any Lucide icon, by scrolling or by searching.
 *
 * The whole set is ~1,800 icons, which is too many to mount at once on a phone — each is an SVG with
 * a handful of children, and all of them together is thousands of elements laid out and painted to
 * show forty. So the grid is virtualised: only the rows in view (and a few either side) exist, over
 * a spacer the height of the full grid that keeps the scrollbar truthful. See virtualGrid.ts.
 *
 * Keyboard use is a single tab stop with arrow keys inside it, the usual grid pattern. The cell with
 * focus is always rendered even when scrolled out of view, so Tab can always get back into the grid.
 */
export function IconPickerDialog({
  open,
  onOpenChange,
  title,
  value,
  onChange,
  emptyOption,
}: IconPickerDialogProps) {
  const { t } = useTranslation();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[90dvh] flex-col gap-3 sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? t('iconPicker.title')}</DialogTitle>
          <DialogDescription>{t('iconPicker.description')}</DialogDescription>
        </DialogHeader>
        {/* Mounted only while open, so its search and scroll position start fresh each time. */}
        {open && (
          <PickerBody
            value={value}
            emptyOption={emptyOption}
            onPick={(icon) => {
              onChange(icon !== null && icon === emptyOption.iconName ? null : icon);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function PickerBody({
  value,
  emptyOption,
  onPick,
}: {
  value: string | null;
  emptyOption: IconPickerDialogProps['emptyOption'];
  onPick: (icon: string | null) => void;
}) {
  const { t, i18n } = useTranslation();
  const { status, catalog } = useIconCatalog();
  const [tags, setTags] = useState<Tags | null>(null);
  const [query, setQuery] = useState('');
  const deferredQuery = useDeferredValue(query);

  /* Both loads start with the dialog. The catalog is retried here even after a failure elsewhere —
     opening the picker is the moment someone is actually asking for it. The tags are optional: a
     search without them still matches names. */
  useEffect(() => {
    void loadIconCatalog().catch(() => {});
    let cancelled = false;
    void import('./iconSearch').then(
      (module) => !cancelled && setTags(module.iconTags),
      () => {},
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const names = useMemo(() => (catalog ? Object.keys(catalog.icons) : []), [catalog]);
  const results = useMemo(
    () => matchIcons(names, tags ?? {}, deferredQuery),
    [names, tags, deferredQuery],
  );
  const shown = value ?? emptyOption.iconName ?? null;
  const selected = catalog && shown ? (canonicalIconName(catalog, shown) ?? null) : null;

  const EmptyIcon = emptyOption.icon;
  const english = (i18n.resolvedLanguage ?? i18n.language).startsWith('en');

  return (
    <>
      <div className="relative">
        <Search
          aria-hidden
          className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
        />
        <Input
          type="search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('iconPicker.search')}
          aria-label={t('iconPicker.search')}
          className="pl-8"
          autoFocus
        />
      </div>
      {!english && (
        <p className="-mt-1 text-xs text-muted-foreground">{t('iconPicker.englishOnly')}</p>
      )}

      <button
        type="button"
        aria-pressed={value === null}
        onClick={() => onPick(null)}
        className={cn(
          'flex items-center gap-3 rounded-lg border px-3 py-2 text-left text-sm transition-colors hover:bg-muted/60',
          value === null && 'border-primary bg-primary/5',
        )}
      >
        <span
          aria-hidden
          className={cn(
            'flex size-7 shrink-0 items-center justify-center rounded-md',
            EmptyIcon ? 'bg-muted text-muted-foreground' : 'border border-dashed',
          )}
        >
          {EmptyIcon && <EmptyIcon className="size-4" />}
        </span>
        {emptyOption.label}
      </button>

      {status === 'ready' ? (
        <>
          <p className="sr-only" role="status">
            {t('iconPicker.count', { count: results.length })}
          </p>
          {results.length === 0 ? (
            <p className="py-10 text-center text-sm text-muted-foreground">
              {t('iconPicker.noMatches', { query: deferredQuery.trim() })}
            </p>
          ) : (
            <IconGrid
              // A new search is a new list: start at its top rather than wherever the last one was.
              key={deferredQuery}
              catalog={catalog}
              names={results}
              selected={selected}
              onPick={onPick}
            />
          )}
        </>
      ) : status === 'failed' ? (
        <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
          <p>{t('iconPicker.loadFailed')}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void loadIconCatalog().catch(() => {})}
          >
            {t('common.retry')}
          </Button>
        </div>
      ) : (
        <div className="flex justify-center py-10">
          <Spinner />
        </div>
      )}
    </>
  );
}

function IconGrid({
  catalog,
  names,
  selected,
  onPick,
}: {
  catalog: IconCatalog;
  names: readonly string[];
  selected: string | null;
  onPick: (icon: string) => void;
}) {
  const { t } = useTranslation();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [scrollTop, setScrollTop] = useState(0);
  const selectedIndex = selected ? names.indexOf(selected) : -1;
  const [active, setActive] = useState(Math.max(0, selectedIndex));
  /** Set by a key press, so the cell it moved to takes focus once it has rendered. */
  const focusPending = useRef(false);

  const width = size.width || FALLBACK_WIDTH;
  const height = size.height || FALLBACK_HEIGHT;
  const columns = Math.max(1, Math.floor(width / CELL));
  const view = gridWindow({
    count: names.length,
    columns,
    rowHeight: CELL,
    scrollTop,
    viewportHeight: height,
    overscan: OVERSCAN,
  });

  useLayoutEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    const measure = () => setSize({ width: element.clientWidth, height: element.clientHeight });
    measure();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  /** Scroll just enough to show a cell's row. */
  const reveal = useCallback(
    (index: number) => {
      const element = scrollRef.current;
      if (!element) return;
      const top = Math.floor(index / columns) * CELL;
      if (top < element.scrollTop) element.scrollTop = top;
      else if (top + CELL > element.scrollTop + height) element.scrollTop = top + CELL - height;
    },
    [columns, height],
  );

  /* Open on the current icon rather than on `a-arrow-down`: the one question anyone opening this
     has first is "what is it now". Once, when the grid is first measured — not again on resize. */
  const revealedSelection = useRef(false);
  useLayoutEffect(() => {
    if (revealedSelection.current || !size.height || selectedIndex < 0) return;
    revealedSelection.current = true;
    const element = scrollRef.current;
    if (!element) return;
    const row = Math.floor(selectedIndex / columns);
    element.scrollTop = Math.max(0, row * CELL - (height - CELL) / 2);
  }, [size.height, selectedIndex, columns, height]);

  useLayoutEffect(() => {
    if (!focusPending.current) return;
    focusPending.current = false;
    scrollRef.current?.querySelector<HTMLButtonElement>(`[data-index="${active}"]`)?.focus();
  }, [active]);

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const next = moveInGrid(active, event.key, {
      count: names.length,
      columns,
      pageRows: Math.max(1, Math.floor(height / CELL) - 1),
      ctrl: event.ctrlKey || event.metaKey,
    });
    if (next === null) return;
    event.preventDefault();
    focusPending.current = true;
    reveal(next);
    setActive(next);
  };

  /* The rows in view, plus the active cell's row wherever it is — it holds the grid's one tab stop,
     and a tab stop that unmounts on scroll is a grid the keyboard can no longer enter. */
  const activeRow = Math.floor(Math.min(active, names.length - 1) / columns);
  const rows: number[] = [];
  for (let row = view.firstRow; row <= view.lastRow; row++) rows.push(row);
  if (activeRow < view.firstRow || activeRow > view.lastRow) rows.push(activeRow);

  return (
    <div
      ref={scrollRef}
      role="group"
      aria-label={t('iconPicker.grid')}
      className="relative h-72 overflow-y-auto overscroll-contain rounded-lg border"
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onKeyDown={onKeyDown}
    >
      <div style={{ height: view.height }} />
      {rows.map((row) => (
        <div
          key={row}
          className="absolute inset-x-0 flex"
          style={{ top: row * CELL, height: CELL }}
        >
          {names.slice(row * columns, row * columns + columns).map((name, column) => {
            const index = row * columns + column;
            const isSelected = name === selected;
            return (
              <button
                key={name}
                type="button"
                data-index={index}
                tabIndex={index === active ? 0 : -1}
                aria-label={iconLabel(name)}
                aria-pressed={isSelected}
                onClick={() => onPick(name)}
                onFocus={() => setActive(index)}
                className={cn(
                  'flex items-center justify-center rounded-md text-foreground/80 transition-colors outline-none',
                  'hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                  isSelected &&
                    'bg-primary text-primary-foreground hover:bg-primary/90 hover:text-primary-foreground',
                )}
                style={{ width: `${100 / columns}%`, height: CELL }}
              >
                {/* Drawn from the catalog directly: it is already loaded, and a `namedIcon` per
                      cell would be a store subscription per cell for an answer known here. */}
                <LucideRenderer
                  aria-hidden
                  className="size-5"
                  icon={{ name, node: iconNode(catalog, name) ?? [] }}
                />
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
