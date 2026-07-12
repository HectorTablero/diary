import { BookOpen, CalendarDays, CloudOff, Search, Settings, Tag, Users } from 'lucide-react';
import { AnimatedLogo } from '@/components/icons/AnimatedLogo';
import type { LucideIcon } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Link, Navigate, NavLink, Outlet } from 'react-router';
import { FullScreenSpinner } from '@/components/common/Spinner';
import { kick } from '@/db/sync';
import { useSyncStatus } from '@/db/useSyncStatus';
import { useSession } from '@/lib/authClient';
import { isNative } from '@/lib/native';
import { cacheUser, getCachedUser } from '@/lib/sessionCache';
import { cn } from '@/lib/utils';

interface NavItem {
  to: string;
  icon: LucideIcon;
  labelKey: string;
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

function SidebarLink({ item }: { item: NavItem }) {
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
      {t(item.labelKey)}
    </NavLink>
  );
}

function Sidebar() {
  const { t } = useTranslation();
  return (
    <aside className="sticky top-0 hidden h-dvh w-56 shrink-0 flex-col border-r bg-sidebar px-3 py-5 md:flex">
      <NavLink to="/diary" className="mb-6 flex items-center gap-2.5 px-3">
        <AnimatedLogo className="size-5" strokeColor="var(--foreground)" />
        <span className="text-base font-semibold tracking-tight">{t('app.name')}</span>
      </NavLink>
      <nav className="flex flex-1 flex-col gap-1">
        {MAIN_NAV.map((item) => (
          <SidebarLink key={item.to} item={item} />
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

function TabBar() {
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
        {items.map((item) => (
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
                  className={cn(
                    'flex items-center justify-center rounded-full p-1 transition-colors'
                  )}
                >
                  <item.icon className={cn('size-5 transition-transform', isActive && 'scale-110')} />
                </span>
                <span className="truncate">{t(item.labelKey)}</span>
                {isActive && (
                  <span className="absolute -top-0.5 left-1/2 h-0.5 w-5 -translate-x-1/2 rounded-full bg-primary" />
                )}
              </>
            )}
          </NavLink>
        ))}
      </div>
    </nav>
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
      {!isNative && <Sidebar />}
      <main className={cn('min-w-0 flex-1 pt-[var(--inset-top)] pb-20', !isNative && 'md:pb-0')}>
        <SyncStatusOverlay />
        <Outlet />
      </main>
      <TabBar />
    </div>
  );
}