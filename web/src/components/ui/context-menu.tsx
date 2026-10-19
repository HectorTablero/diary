import * as React from 'react';
import { createPortal } from 'react-dom';
import { Slot } from 'radix-ui';

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

/* Right-click menu built on the *dropdown* menu rather than Radix's ContextMenu, so the very same
   `DropdownMenuItem` children a row already hands its ⋯ menu can be passed here unchanged — one
   list of actions, two ways in. The dropdown anchors to an invisible point portalled to <body> at
   the cursor (portalled because a dragged/animated ancestor's transform would otherwise become
   the containing block for `position: fixed`).

   The native menu still wins over links, form fields and selected text: those are exactly where
   "Open in new tab", spellcheck and "Copy" are what the user is after. That also keeps an Android
   long-press — which selects a word first — doing what it always did. A row that *is* a link (a
   stretched anchor covering the whole row) marks it `data-row-link`, so the row still gets its menu. */
function ContextMenu({
  menu,
  disabled = false,
  children,
}: {
  /** `DropdownMenuItem`s etc., usually the same nodes as the row's ⋯ menu. */
  menu: React.ReactNode;
  /** Leaves the browser's own menu in place, e.g. for a read-only row with nothing to offer. */
  disabled?: boolean;
  children: React.ReactElement;
}) {
  const [open, setOpen] = React.useState(false);
  // Kept after closing so the exit animation plays where the menu actually was.
  const [point, setPoint] = React.useState({ x: 0, y: 0 });

  const onContextMenu = (e: React.MouseEvent<HTMLElement>) => {
    // A menu nested inside another (a row in a card) has already claimed the click.
    if (disabled || e.defaultPrevented) return;
    const target = e.target as HTMLElement;
    const native = target.closest('a[href], input, textarea, select, [contenteditable="true"]');
    if (native && !native.hasAttribute('data-row-link')) return;
    if (!(window.getSelection()?.isCollapsed ?? true)) return;
    e.preventDefault();
    // The menu key / Shift+F10 report (0, 0): open beside the focused element instead.
    if (e.clientX === 0 && e.clientY === 0) {
      const rect = e.currentTarget.getBoundingClientRect();
      setPoint({ x: rect.left, y: rect.bottom });
    } else {
      setPoint({ x: e.clientX, y: e.clientY });
    }
    setOpen(true);
  };

  return (
    <>
      <Slot.Root onContextMenu={onContextMenu}>{children}</Slot.Root>
      {/* Non-modal: a modal menu blanks body pointer-events, so right-clicking another row while
          this one is open would land on nothing and fall through to the browser's menu. */}
      <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
        {createPortal(
          <DropdownMenuTrigger asChild>
            <span
              aria-hidden
              tabIndex={-1}
              className="pointer-events-none fixed size-0"
              style={{ left: point.x, top: point.y }}
            />
          </DropdownMenuTrigger>,
          document.body,
        )}
        <DropdownMenuContent align="start" sideOffset={0} className="w-auto">
          {menu}
        </DropdownMenuContent>
      </DropdownMenu>
    </>
  );
}

export { ContextMenu };
