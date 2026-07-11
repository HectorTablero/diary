import type { PersonRefDto, TagDto } from '@diary/shared';
import { X } from 'lucide-react';
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
}: {
  tag: TagDto;
  onRemove?: () => void;
  onClick?: () => void;
}) {
  return (
    <ChipShell
      onRemove={onRemove}
      onClick={onClick}
      style={{ backgroundColor: tag.color, color: contrastColor(tag.color) }}
    >
      #{tag.name}
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
