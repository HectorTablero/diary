import { GitBranch, Search, Tag } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { NavLink, Outlet } from 'react-router';
import { PageContainer } from '@/components/layout/PageHeader';
import { isNative } from '@/lib/native';
import { cn } from '@/lib/utils';

/* Search, Tags and Threads are three ways of asking the same question — "which entries relate to
   this?" — so under the bottom tab bar they share one screen with a segmented switcher instead of
   three tab-bar slots. The phone bar could not fit seven items legibly; this is what it gave back.

   Under the sidebar none of that pressure exists: all three are already one click away in the nav,
   so they stay plain separate pages with their own headings, exactly as before. The switcher and
   the page heading are strict alternatives — whichever navigation is on screen owns naming the
   page, and showing both would just say the same word twice.

   These stay three real routes rather than local state: /tags and /threads are linked to directly
   from the tag and thread chips all over the app, and the browser (and Android's back button)
   should treat switching segments as ordinary navigation. */

/** Paths this group owns — the tab bar highlights its Explore item on any of them. */
export const EXPLORE_PATHS = ['/search', '/tags', '/threads'] as const;

/* Which navigation is on screen. The Android app uses the bottom bar at every width (it has no
   sidebar at all), so `isNative` short-circuits the breakpoint rather than combining with it —
   these must stay exact complements of AppLayout's own `!isNative && 'md:hidden'` on the TabBar.
   `max-md:hidden` rather than `hidden md:flex` so it works whatever the element's display type. */
export const SIDEBAR_ONLY = isNative ? 'hidden' : 'max-md:hidden';
export const BOTTOM_NAV_ONLY = isNative ? '' : 'md:hidden';
/** SIDEBAR_ONLY for text that must still name the page under the bottom tab bar: `sr-only` keeps
    it in the accessibility tree, and its absolute positioning keeps it out of the layout. */
export const SIDEBAR_ONLY_SR = isNative ? 'sr-only' : 'max-md:sr-only';

export interface Segment {
  to: string;
  icon: LucideIcon;
  labelKey: string;
}

/* No count badges here. A third of a phone's width is the whole budget for a segment, and an
   icon + a translated label already spends it — "Etiquetas" or "スレッド" plus a badge starts
   truncating the label, and a cut-off label is worse than no count at all.

   Exported because the tab bar reads it too: see `exploreSegment` below. Search is first because
   it is both the most used of the three and the segment the tab bar falls back to. */
export const EXPLORE_SEGMENTS: Segment[] = [
  { to: '/search', icon: Search, labelKey: 'nav.search' },
  { to: '/tags', icon: Tag, labelKey: 'nav.tags' },
  { to: '/threads', icon: GitBranch, labelKey: 'nav.threads' },
];

/**
 * Which segment a path belongs to, defaulting to Search.
 *
 * The tab bar uses this to *become* the section you're in rather than fronting it under a
 * different name. A slot labelled "Explore" that opens Search was wrong in both directions: it
 * named something no screen is called, and it never changed while you moved between the three
 * screens behind it — so nothing on a phone ever said you were on Tags. Now the slot shows
 * Search / Tags / Threads by its own icon and label, and the switcher below moves between them.
 *
 * This costs no extra tap and no new string, which is why it beats the other way out of the same
 * problem (renaming the slot "More" and hanging a menu off it).
 */
export const exploreSegment = (pathname: string): Segment =>
  EXPLORE_SEGMENTS.find(
    (segment) => pathname === segment.to || pathname.startsWith(`${segment.to}/`),
  ) ?? EXPLORE_SEGMENTS[0];

export default function ExploreLayout() {
  const { t } = useTranslation();

  return (
    <PageContainer>
      <nav
        className={cn('mb-6 grid grid-cols-3 gap-1 rounded-xl bg-muted p-1', BOTTOM_NAV_ONLY)}
        aria-label={t('nav.explore')}
      >
        {EXPLORE_SEGMENTS.map((segment) => (
          <NavLink
            key={segment.to}
            to={segment.to}
            className={({ isActive }) =>
              cn(
                'flex min-w-0 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-sm font-medium transition-colors',
                isActive
                  ? 'bg-background text-foreground shadow-xs'
                  : 'text-muted-foreground hover:text-foreground',
              )
            }
          >
            <segment.icon className="size-4 shrink-0" />
            <span className="truncate">{t(segment.labelKey)}</span>
          </NavLink>
        ))}
      </nav>
      <Outlet />
    </PageContainer>
  );
}
