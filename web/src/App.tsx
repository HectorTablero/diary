import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { lazy, Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import AppLayout from './components/layout/AppLayout';
import ExploreLayout from './components/layout/ExploreLayout';
import { FullScreenSpinner } from './components/common/Spinner';
import { LockScreen } from './components/security/LockScreen';
import { useLockState } from './lib/appLock';
import { todayKey } from './lib/dates';
import { routeForUrl } from './lib/deepLinks';
import { isNative } from './lib/native';
import { refreshNotifications } from './lib/notifications';
import { refreshPlugins } from './plugins/lifecycle';
import LoginPage from './pages/LoginPage';
import {
  CalendarPage,
  DiaryDayPage,
  ImportBackupPage,
  ImportContactsPage,
  PeopleListPage,
  PersonProfilePage,
  SearchPage,
  SettingsPage,
  TagsPage,
  ThreadsPage,
} from './pages/lazyPages';

/* Its own lazy import rather than an entry in lazyPages, because AppLayout warms every entry of
   that map on idle — a plugin page registered there would download for everyone, enabled or not. */
const PluginPage = lazy(() => import('./plugins/PluginPage'));

function withSuspense(element: React.ReactNode) {
  return <Suspense fallback={<FullScreenSpinner />}>{element}</Suspense>;
}

export const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/diary" replace /> },
      { path: 'diary', element: <Navigate to={`/diary/${todayKey()}`} replace /> },
      { path: 'diary/:date', element: withSuspense(<DiaryDayPage />) },
      { path: 'calendar', element: withSuspense(<CalendarPage />) },
      { path: 'people', element: withSuspense(<PeopleListPage />) },
      // Ahead of `people/:id` so the literal segment always wins the match.
      { path: 'people/import', element: withSuspense(<ImportContactsPage />) },
      { path: 'people/:id', element: withSuspense(<PersonProfilePage />) },
      // Pathless layout route: the three "find entries by …" screens keep their own URLs (chips
      // all over the app link straight to /tags and /threads) but share one segmented switcher.
      {
        element: <ExploreLayout />,
        children: [
          { path: 'search', element: withSuspense(<SearchPage />) },
          { path: 'tags', element: withSuspense(<TagsPage />) },
          { path: 'threads', element: withSuspense(<ThreadsPage />) },
        ],
      },
      { path: 'settings', element: withSuspense(<SettingsPage />) },
      { path: 'settings/import-backup', element: withSuspense(<ImportBackupPage />) },
      /* One parameterised route for every plugin, not one each: the router walks this table on
         every navigation. PluginPage resolves the id against the registry and redirects an unknown
         or disabled one to the diary. Deliberately not in pages/lazyPages — see the note there. */
      { path: 'plugins/:pluginId', element: withSuspense(<PluginPage />) },
      { path: '*', element: <Navigate to="/diary" replace /> },
    ],
  },
]);

// Hardware back button: close any open Radix layer first (they listen for
// Escape), then walk the history, and only exit the app from the root screen.
if (isNative) {
  void CapApp.addListener('backButton', ({ canGoBack }) => {
    const openLayer = document.querySelector('[role="dialog"], [data-state="open"][role="menu"]');
    if (openLayer) {
      document.dispatchEvent(
        new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }),
      );
      return;
    }
    if (canGoBack) window.history.back();
    else void CapApp.exitApp();
  });

  // Tapping a checkup/birthday/daily-reminder notification opens the relevant screen.
  void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const extra = notification.extra as
      | { kind: 'checkup' | 'birthday'; personId: string }
      | { kind: 'checkupDigest' }
      | { kind: 'daily' };
    if (extra.kind === 'checkup' || extra.kind === 'birthday') {
      void router.navigate(`/people/${extra.personId}`);
      // The digest stands for several people at once; the list already hoists overdue ones to the top.
    } else if (extra.kind === 'checkupDigest') void router.navigate('/people');
    else void router.navigate('/diary');
  });

  // Resuming the app is the main way we notice a day has rolled over (there's
  // no true native background poll), so re-arm reminders on every foreground.
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) refreshNotifications();
    /* Both edges, and they do different jobs. On resume this banks whatever was pressed on the home
       screen while the app was closed — the widget's presses live in SharedPreferences until
       something reads them into Dexie, and this is the first moment anything can. On the way out it
       restates today, so the widget is correct for the whole time the app is *not* running, which
       is most of a widget's life.

       `refreshPlugins` rather than the widget alone, because a background sync can apply while the
       app is suspended: a plugin switched on from the laptop should be on when the phone comes
       back, not one sync later. */
    void refreshPlugins();
  });

  /* App Links: a diary.tablerus.es URL opens here rather than in the browser.
     Both halves are needed, and they cover different launches — `appUrlOpen` fires when the app is
     already running, while a cold start from a link has already happened by the time any listener
     could be attached, and only `getLaunchUrl` still knows about it. */
  const openDeepLink = (url: string) => {
    const route = routeForUrl(url);
    // Ignored rather than redirected when unrecognised: see routeForUrl. Nothing is lost — the
    // app simply opens where it would have anyway.
    if (route) void router.navigate(route);
  };

  void CapApp.addListener('appUrlOpen', ({ url }) => openDeepLink(url));
  void CapApp.getLaunchUrl().then((launch) => {
    if (launch?.url) openDeepLink(launch.url);
  });
}

/**
 * The app lock, ahead of the router.
 *
 * `LockScreen` replaces the router rather than covering it, so while locked there is no route
 * mounted at all — nothing queries the diary, nothing paints an entry into the DOM behind a
 * translucent panel, and the Android recents thumbnail is of the lock screen itself.
 */
function AppLockGate() {
  const { locked } = useLockState();
  if (locked) return <LockScreen />;
  return <RouterProvider router={router} />;
}

export default function App() {
  return <AppLockGate />;
}
