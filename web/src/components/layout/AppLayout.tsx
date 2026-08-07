import {
  BellRing,
  BookOpen,
  CalendarDays,
  CloudOff,
  GitBranch,
  MoreHorizontal,
  Search,
  ServerOff,
  Settings,
  Tag,
  Users,
  WifiOff,
} from 'lucide-react';
import { AnimatedLogo } from '@/components/icons/AnimatedLogo';
import type { LucideIcon } from 'lucide-react';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router';
import { usePeople } from '@/api/hooks';
import { FullScreenSpinner } from '@/components/common/Spinner';
import { EXPLORE_SEGMENTS, isExplorePath } from '@/components/layout/ExploreLayout';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { forceSyncNow, kick, type SyncBlocker } from '@/db/sync';
import { useSyncStatus } from '@/db/useSyncStatus';
import { useSession } from '@/lib/authClient';
import { isCheckupDue } from '@/lib/checkup';
import { cancelIdle, onIdle } from '@/lib/idle';
import { isLocalOnly, setLocalOnly } from '@/lib/localOnly';
import { isNative } from '@/lib/native';
import { preloadLoaders } from '@/lib/preloaders';
import { cacheUser, getCachedUser } from '@/lib/sessionCache';
import { getUpdateState, subscribeToUpdateState, type UpdateState } from '@/lib/liveUpdate';
import { dismissUpdate, isDismissed } from '@/lib/updateCheck';
import { cn } from '@/lib/utils';
import { pageLoaders } from '@/pages/lazyPages';

interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
}

/** Pending-checkups count for the People nav badge; reactive since `usePeople` is
    invalidated on every mutation and every applied sync. */
function usePendingCheckupsCount(): number {
  const { data: people } = usePeople();
  return useMemo(() => (people ?? []).filter(isCheckupDue).length, [people]);
}

const MAIN_NAV: NavItem[] = [
  { to: '/diary', icon: BookOpen, labelKey: 'nav.diary' },
  { to: '/calendar', icon: CalendarDays, labelKey: 'nav.calendar' },
  { to: '/people', icon: Users, labelKey: 'nav.people' },
  { to: '/search', icon: Search, labelKey: 'nav.search' },
];

const SECONDARY_NAV: NavItem[] = [
  { to: '/tags', icon: Tag, labelKey: 'nav.tags' },
  { to: '/threads', icon: GitBranch, labelKey: 'nav.threads' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

/* The phone bar is its own list, not MAIN_NAV + SECONDARY_NAV: seven labels across a 360px screen
   overlap each other. The sidebar has the height for all seven and keeps them flat — a click saved
   on a surface that was never crowded.

   Search, Tags and Threads share the fourth slot. It is a *menu* rather than a link, and it is
   called "More", because the two shapes that don't work here both failed on the same point —
   saying out loud that those three screens exist:

     - a slot labelled "Explore" that opens Search names a screen the app doesn't have, and
     - a slot that renames itself to whichever of the three you're on says "Search" everywhere
       else, so from the diary nothing hints that Tags or Threads are there at all.

   A menu costs one tap on three rarely-used screens and buys naming all of them, every time the
   bar is on screen. ExploreLayout's segmented switcher still handles moving between them once
   you're there, so the tap is only ever paid on the way in. */
const TAB_NAV: NavItem[] = [
  { to: '/diary', icon: BookOpen, labelKey: 'nav.diary' },
  { to: '/calendar', icon: CalendarDays, labelKey: 'nav.calendar' },
  { to: '/people', icon: Users, labelKey: 'nav.people' },
  { to: '/settings', icon: Settings, labelKey: 'nav.settings' },
];

function SidebarLink({ item, badge = 0 }: { item: NavItem; badge?: number }) {
  const { t } = useTranslation();
  return (
    <NavLink
      to={item.to}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors',
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/50 hover:text-foreground',
        )
      }
    >
      <item.icon className="size-4.5 shrink-0" />
      <span className="flex-1">{t(item.labelKey)}</span>
      {badge > 0 && (
        <span className="flex h-5 items-center gap-0.5 rounded-full bg-destructive px-1.5 text-[11px] font-semibold text-white">
          <span className="sr-only">{t('people.checkupsPending', { count: badge })}</span>
          <BellRing aria-hidden className="size-3" />
          <span aria-hidden>{badge}</span>
        </span>
      )}
    </NavLink>
  );
}

function Sidebar({ pendingCheckups }: { pendingCheckups: number }) {
  const { t } = useTranslation();
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5 md:flex">
      <NavLink to="/diary" className="mb-6 flex items-center gap-2.5 px-3">
        <AnimatedLogo className="size-5" strokeColor="var(--foreground)" />
        <span className="text-base font-semibold tracking-tight">{t('app.name')}</span>
      </NavLink>
      <nav className="flex flex-1 flex-col gap-1">
        {MAIN_NAV.map((item) => (
          <SidebarLink
            key={item.to}
            item={item}
            badge={item.to === '/people' ? pendingCheckups : 0}
          />
        ))}
        <div className="mt-auto flex flex-col gap-1">
          {SECONDARY_NAV.map((item) => (
            <SidebarLink key={item.to} item={item} />
          ))}
        </div>
      </nav>
    </aside>
  );
}

/** The inside of one tab-bar slot. Shared so the More menu's trigger is visually a tab, not a
    button that merely sits in the row with them. */
function TabSlotBody({
  icon: Icon,
  label,
  active,
  badge = 0,
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  badge?: number;
}) {
  const { t } = useTranslation();
  return (
    <>
      <span className="relative flex items-center justify-center rounded-full p-1 transition-colors">
        <Icon className={cn('size-5 transition-transform', active && 'scale-110')} />
        {badge > 0 && (
          <span
            className={cn(
              'absolute rounded-full bg-destructive text-white',
              badge <= 9
                ? '-top-0.75 right-0 flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[9px] leading-none font-bold'
                : 'top-0 right-0.5 size-2.5',
            )}
          >
            <span className="sr-only">{t('people.checkupsPending', { count: badge })}</span>
            {badge <= 9 && <span aria-hidden>{badge}</span>}
          </span>
        )}
      </span>
      <span className="truncate">{label}</span>
      {active && (
        <span className="absolute -top-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary" />
      )}
    </>
  );
}

const TAB_SLOT =
  'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors relative';

/** The fourth slot: opens upward over the bar and names Search, Tags and Threads outright. */
function MoreTabSlot() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const active = isExplorePath(pathname);

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        className={cn(TAB_SLOT, active ? 'text-primary' : 'text-muted-foreground')}
      >
        <TabSlotBody icon={MoreHorizontal} label={t('nav.more')} active={active} />
      </DropdownMenuTrigger>
      {/* side="top" so it opens over the app rather than off the bottom of the screen, and
          sideOffset clears the gesture-nav inset the bar grows by. */}
      <DropdownMenuContent side="top" align="center" sideOffset={8} className="min-w-40">
        {EXPLORE_SEGMENTS.map((segment) => (
          <DropdownMenuItem key={segment.to} onSelect={() => void navigate(segment.to)}>
            <segment.icon className="size-4" />
            {t(segment.labelKey)}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function TabBar({ pendingCheckups }: { pendingCheckups: number }) {
  const { t } = useTranslation();
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        // The app always uses the tab bar, even in landscape widths.
        !isNative && 'md:hidden',
      )}
    >
      <div className="flex items-stretch justify-around pb-[var(--inset-bottom)]">
        {TAB_NAV.map((item) => (
          <Fragment key={item.to}>
            {/* More sits between People and Settings, so it is emitted just before Settings
                rather than appended after the loop. */}
            {item.to === '/settings' && <MoreTabSlot />}
            <NavLink
              to={item.to}
              className={({ isActive }) =>
                cn(TAB_SLOT, isActive ? 'text-primary' : 'text-muted-foreground')
              }
            >
              {({ isActive }) => (
                <TabSlotBody
                  icon={item.icon}
                  label={t(item.labelKey)}
                  active={isActive}
                  badge={item.to === '/people' ? pendingCheckups : 0}
                />
              )}
            </NavLink>
          </Fragment>
        ))}
      </div>
    </nav>
  );
}

/* Ordinary updates are silent: the web PWA swaps itself via the service worker, and the Android
   app live-updates its bundle in the background (lib/liveUpdate.ts). This banner exists for the
   one case neither can handle — a release whose native shell differs from the installed APK, so
   only downloading a new APK can deliver it. */
function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateState>(getUpdateState);
  const [dismissed, setDismissed] = useState(true);
  const { t } = useTranslation();

  useEffect(() => subscribeToUpdateState(setUpdate), []);

  const version = update.kind === 'native-required' ? update.version : null;

  useEffect(() => {
    if (!version) return;
    void isDismissed(version).then(setDismissed);
  }, [version]);

  if (update.kind !== 'native-required' || dismissed) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-4 border-b border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-600 dark:text-blue-400">
      {t('update.needsInstall', { version: update.version })}
      <a
        href={update.releaseUrl}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-2 min-w-max"
      >
        {t('update.view')}
      </a>
      <button
        type="button"
        className="text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => {
          void dismissUpdate(update.version);
          setDismissed(true);
        }}
      >
        {t('update.dismiss')}
      </button>
    </div>
  );
}

/**
 * What each blocker looks like in the pill: its icon, and (below) its wording.
 *
 * `paused` is the reason this is a table rather than a boolean. It is not a failure — nothing is
 * broken, the app is holding writes back because it was told to — so calling it "Offline" would be
 * wrong in the other direction, and it is the only one of the three the user can act on from here.
 */
const BLOCKER_ICON: Record<NonNullable<SyncBlocker>, LucideIcon> = {
  offline: CloudOff,
  unreachable: ServerOff,
  paused: WifiOff,
};

/** Session-expired banner + a pill naming whatever is currently stopping sync. */
function SyncStatusOverlay() {
  const status = useSyncStatus();
  const { t } = useTranslation();

  // Nothing to report for a device that was never linked to an account — there's no server
  // relationship to be "offline" from or "reconnected" to. initSync()'s online/offline window
  // listeners flip SyncStatus.blocker directly, independent of the sync engine's own account
  // gate, so this needs its own explicit check rather than trusting SyncStatus to stay quiet.
  if (isLocalOnly()) return null;

  if (status.needsAuth) {
    return (
      // role="alert", not "status": this is the banner saying writes are no longer reaching the
      // server, which is worth interrupting for — the same treatment the passcode error gets.
      <div
        role="alert"
        className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400"
      >
        {t('sync.sessionExpired')}
        <Link to="/login" className="font-medium underline underline-offset-2">
          {t('auth.signInWithGoogle')}
        </Link>
      </div>
    );
  }
  const Icon = status.blocker ? BLOCKER_ICON[status.blocker] : null;
  /* Written out per branch rather than assembled from a template key, so checkI18n can see that
     every one of these strings is used — the same reason HourCycleSetting spells its labels out. */
  const label = !status.blocker
    ? null
    : status.blocker === 'paused'
      ? status.pending > 0
        ? t('sync.pausedPending', { count: status.pending })
        : t('sync.paused')
      : status.blocker === 'unreachable'
        ? status.pending > 0
          ? t('sync.unreachablePending', { count: status.pending })
          : t('sync.unreachable')
        : status.pending > 0
          ? t('sync.offlinePending', { count: status.pending })
          : t('sync.offline');

  /* The wrapper is always mounted and the *pill* is what comes and goes, so that going offline is a
     text change inside an existing live region rather than a whole region appearing at once — the
     first is announced reliably, the second only sometimes. Empty and pointer-events-none, it
     costs nothing while online.

     Polite, not assertive: losing the network shouldn't cut across whatever is being read, and
     nothing has been lost yet — the writes are queued, which is what the pill says. */
  return (
    <div
      role="status"
      className={cn(
        // Sit above the tab bar; the bar's height grows by the gesture-nav
        // safe-area inset, so that inset must be part of the offset.
        'pointer-events-none fixed left-1/2 z-50 max-w-[calc(100vw-2rem)] -translate-x-1/2 bottom-[calc(5.5rem+var(--inset-bottom))]',
        !isNative && 'md:bottom-4',
      )}
    >
      {Icon && (
        <span
          className={cn(
            'flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur',
            // Only the paused pill has anything to click, and the wrapper is click-through so the
            // others can't swallow a tap meant for whatever is underneath them.
            status.blocker === 'paused' && 'pointer-events-auto',
          )}
        >
          <Icon aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{label}</span>
          {/* Offered whatever the pending count is: the pull is being held back too, so this is
              also how you go and fetch what another device wrote. Nothing about the preference
              changes — this spends one sync's worth of cellular data, on purpose, once. */}
          {status.blocker === 'paused' && (
            <button
              type="button"
              disabled={status.syncing}
              onClick={() => void forceSyncNow()}
              className="-mr-1.5 shrink-0 rounded-full px-2 py-0.5 font-medium text-foreground underline-offset-2 hover:bg-accent hover:underline disabled:opacity-50"
            >
              {t('sync.syncAnyway')}
            </button>
          )}
        </span>
      )}
    </div>
  );
}

/** Invisible until focused, first in the tab order: the sidebar is seven links, and on the diary —
    the screen most often opened — the composer sits at the very bottom of the document, so without
    this every navigation costs a keyboard user seven stops before any content. */
function SkipToContentLink() {
  const { t } = useTranslation();
  return (
    <a
      href="#main"
      onClick={(e) => {
        /* The href is what makes this a link worth announcing, but the navigation is done by hand:
           letting the hash land in the URL means a second activation on the same page is a no-op
           (the URL doesn't change, so the browser doesn't re-target), and it would leave #main
           trailing behind router navigations. Focusing <main> directly scrolls it into view too. */
        e.preventDefault();
        document.getElementById('main')?.focus();
      }}
      className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-lg focus:border focus:bg-popover focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-popover-foreground focus:shadow-md focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {t('common.skipToContent')}
    </a>
  );
}

export default function AppLayout() {
  const { data: session, isPending, error } = useSession();
  const cached = getCachedUser();
  const pendingCheckups = usePendingCheckupsCount();

  useEffect(() => {
    if (session?.user) {
      cacheUser({
        name: session.user.name,
        email: session.user.email,
        image: session.user.image,
      });
      // A real session now exists — whether this is a brand-new sign-in or an account just
      // linked from Settings, local-only mode is over. The kick() below drains anything queued
      // in the outbox while local-only, exactly like an ordinary reconnect-and-sync.
      setLocalOnly(false);
      kick();
    }
  }, [session]);

  // Warm the route chunk cache once the shell is up and idle, so navigating
  // between tabs doesn't pay a network round-trip. Skipped on metered
  // connections (Save-Data) since it's a pure UX nicety, not a requirement.
  useEffect(() => {
    if (!session?.user) return;
    const saveData = (navigator as { connection?: { saveData?: boolean } }).connection?.saveData;
    if (saveData) return;
    const handle = onIdle(() => {
      for (const load of Object.values(pageLoaders)) void load();
      if (!isNative) {
        for (const load of Object.values(preloadLoaders)) void load();
      }
    });
    return () => cancelIdle(handle);
  }, [session]);

  if (!session?.user && !isLocalOnly()) {
    // With a cached user, stay usable while the session check is pending or the
    // network is down (local-first). A definitive "signed out" still redirects.
    const offlineUsable = !!cached && (isPending || !!error);
    if (!offlineUsable) {
      if (isPending) return <FullScreenSpinner />;
      return <Navigate to="/login" replace />;
    }
  }

  return (
    <div className="flex min-h-dvh">
      {/* Web only: the native build renders no sidebar, so there are no stops to bypass. Must come
          before the sidebar in the DOM to be the first thing Tab reaches, and `tabIndex={-1}` on
          the target is what makes the jump actually move focus rather than only scroll. */}
      {!isNative && <SkipToContentLink />}
      {!isNative && <Sidebar pendingCheckups={pendingCheckups} />}
      <main
        id="main"
        tabIndex={-1}
        className={cn('min-w-0 flex-1 pt-[var(--inset-top)] pb-[calc(5.5rem+var(--inset-bottom))]', !isNative && 'md:pb-0')}
      >
        <UpdateBanner />
        <SyncStatusOverlay />
        <Outlet />
      </main>
      <TabBar pendingCheckups={pendingCheckups} />
    </div>
  );
}