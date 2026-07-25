import type { PersonRefDto, TagDto, ThreadDto } from '@diary/shared';
import { GitBranch, X } from 'lucide-react';
import { cn } from '@/lib/utils';

function ChipShell({
  children,
  onRemove,
  onClick,
  className,
  style,
}: {
  children: React.ReactNode;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}) {
  const Tag = onClick ? 'button' : 'span';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      style={style}
      className={cn(
        'inline-flex max-w-40 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        onClick && 'cursor-pointer transition-opacity hover:opacity-80',
        className,
      )}
    >
      <span className="truncate">{children}</span>
      {onRemove && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="-mr-0.5 rounded-full p-0.5 hover:bg-black/10 dark:hover:bg-white/20"
          aria-label="Remove"
        >
          <X className="size-3" />
        </button>
      )}
    </Tag>
  );
}

/** Readable text color for a hex background. */
function contrastColor(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#1a1a1a' : '#ffffff';
}

export function TagChip({
  tag,
  onRemove,
  onClick,
  className,
}: {
  tag: TagDto;
  onRemove?: () => void;
  onClick?: () => void;
  /** Callers use this to de-emphasise a chip — e.g. tags that don't match an active filter. */
  className?: string;
}) {
  return (
    <ChipShell
      onRemove={onRemove}
      onClick={onClick}
      className={className}
      style={{ backgroundColor: tag.color, color: contrastColor(tag.color) }}
    >
      #{tag.name}
    </ChipShell>
  );
}

/**
 * Outlined and unfilled, where a TagChip is filled with its colour and a PersonChip is filled with
 * `secondary`. That's what tells the three apart, together with the leading icon — the theme is
 * greyscale (`--muted` and `--secondary` are literally the same value), so a different fill shade
 * couldn't do it.
 *
 * Text is `foreground`, not `muted-foreground`: the thread's name is identifying content, so it
 * takes the theme's highest-contrast pair in both light and dark. Only the border is dialled back,
 * and it's a `foreground` tint rather than `border` so the outline stays visible on a card.
 */
export function ThreadChip({
  thread,
  onRemove,
  onClick,
  className,
}: {
  thread: ThreadDto;
  onRemove?: () => void;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <ChipShell
      onRemove={onRemove}
      onClick={onClick}
      className={cn('gap-1 border border-foreground/25 bg-transparent text-foreground', className)}
    >
      <GitBranch className="mr-0.5 inline size-3 shrink-0 align-[-2px]" />
      {thread.name}
    </ChipShell>
  );
}

export function PersonChip({
  person,
  onRemove,
  onClick,
}: {
  person: PersonRefDto;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  return (
    <ChipShell
      onRemove={onRemove}
      onClick={onClick}
      className="bg-secondary text-secondary-foreground ring-1 ring-inset ring-border"
    >
      @{person.name}
    </ChipShell>
  );
}
