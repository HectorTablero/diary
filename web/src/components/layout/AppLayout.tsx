import { BellRing, BookOpen, CalendarDays, CloudOff, Search, Settings, Tag, Users } from 'lucide-react';
import { AnimatedLogo } from '@/components/icons/AnimatedLogo';
import type { LucideIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet } from 'react-router';
import { usePeople } from '@/api/hooks';
import { FullScreenSpinner } from '@/components/common/Spinner';
import { kick } from '@/db/sync';
import { useSyncStatus } from '@/db/useSyncStatus';
import { useSession } from '@/lib/authClient';
import { isCheckupDue } from '@/lib/checkup';
import { cancelIdle, onIdle } from '@/lib/idle';
import { isNative } from '@/lib/native';
import { cacheUser, getCachedUser } from '@/lib/sessionCache';
import { checkForUpdate, dismissUpdate, type UpdateInfo } from '@/lib/updateCheck';
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

function TabBar({ pendingCheckups }: { pendingCheckups: number }) {
  const { t } = useTranslation();
  const items = [...MAIN_NAV, ...SECONDARY_NAV];
  return (
    <nav
      className={cn(
        'fixed inset-x-0 bottom-0 z-40 border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/80',
        // The app always uses the tab bar, even in landscape widths.
        !isNative && 'md:hidden',
      )}
    >
      <div className="flex items-stretch justify-around pb-[var(--inset-bottom)]">
        {items.map((item) => {
          const badge = item.to === '/people' ? pendingCheckups : 0;
          return (
            <NavLink
              key={item.to}
              to={item.to}
              className={({ isActive }) =>
                cn(
                  'flex min-w-0 flex-1 flex-col items-center gap-0.5 py-2 text-[11px] font-medium transition-colors relative',
                  isActive ? 'text-primary' : 'text-muted-foreground',
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn('relative flex items-center justify-center rounded-full p-1 transition-colors')}
                  >
                    <item.icon className={cn('size-5 transition-transform', isActive && 'scale-110')} />
                    {badge > 0 && (
                      <span
                        className={cn(
                          'absolute rounded-full bg-destructive text-white',
                          // '-top-0.75 right-0 flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[9px] leading-none font-bold'
                          badge <= 9
                            ? '-top-0.75 right-0 flex h-3.5 min-w-3.5 items-center justify-center px-0.5 text-[9px] leading-none font-bold'
                            : 'top-0 right-0.5 size-2.5',
                        )}
                      >
                        <span className="sr-only">{t('people.checkupsPending', { count: badge })}</span>
                        {/* <span aria-hidden className="px-0.5">{badge}</span> */}
                        {badge <= 9 && <span aria-hidden>{badge}</span>}
                      </span>
                    )}
                  </span>
                  <span className="truncate">{t(item.labelKey)}</span>
                  {isActive && (
                    <span className="absolute -top-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary" />
                  )}
                </>
              )}
            </NavLink>
          );
        })}
      </div>
    </nav>
  );
}

/** Notifies once a newer build than the running one is published on GitHub. */
function UpdateBanner() {
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (!isNative) return;
    void checkForUpdate().then(setUpdate);
  }, []);

  if (!update) return null;

  return (
    <div className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-blue-500/30 bg-blue-500/10 px-4 py-2 text-sm text-blue-600 dark:text-blue-400">
      {t('update.available', { version: update.versionName })}
      <a
        href={update.releaseUrl}
        target="_blank"
        rel="noreferrer"
        className="font-medium underline underline-offset-2"
      >
        {t('update.view')}
      </a>
      <button
        type="button"
        className="text-muted-foreground underline-offset-2 hover:underline"
        onClick={() => {
          void dismissUpdate(update.versionCode);
          setUpdate(null);
        }}
      >
        {t('update.dismiss')}
      </button>
    </div>
  );
}

/** Session-expired banner + offline/pending pill fed by the sync engine. */
function SyncStatusOverlay() {
  const status = useSyncStatus();
  const { t } = useTranslation();

  if (status.needsAuth) {
    return (
      <div className="sticky top-0 z-50 flex items-center justify-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-4 py-2 text-sm text-amber-600 dark:text-amber-400">
        {t('sync.sessionExpired')}
        <Link to="/login" className="font-medium underline underline-offset-2">
          {t('auth.signInWithGoogle')}
        </Link>
      </div>
    );
  }
  if (status.offline) {
    return (
      <div
        className={cn(
          // Sit above the tab bar; the bar's height grows by the gesture-nav
          // safe-area inset, so that inset must be part of the offset.
          'pointer-events-none fixed left-1/2 z-50 -translate-x-1/2 bottom-[calc(5.5rem+var(--inset-bottom))]',
          !isNative && 'md:bottom-4',
        )}
      >
        <span className="flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur">
          <CloudOff className="size-3.5" />
          {status.pending > 0
            ? t('sync.offlinePending', { count: status.pending })
            : t('sync.offline')}
        </span>
      </div>
    );
  }
  return null;
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
    });
    return () => cancelIdle(handle);
  }, [session]);

  if (!session) {
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
      {!isNative && <Sidebar pendingCheckups={pendingCheckups} />}
      <main className={cn('min-w-0 flex-1 pt-[var(--inset-top)] pb-[calc(5.5rem+var(--inset-bottom))]', !isNative && 'md:pb-0')}>
        <UpdateBanner />
        <SyncStatusOverlay />
        <Outlet />
      </main>
      <TabBar pendingCheckups={pendingCheckups} />
    </div>
  );
}