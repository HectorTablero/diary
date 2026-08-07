import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import AppLayout from './components/layout/AppLayout';
import ExploreLayout from './components/layout/ExploreLayout';
import { FullScreenSpinner } from './components/common/Spinner';
import { LockScreen } from './components/security/LockScreen';
import { useLockState } from './lib/appLock';
import { todayKey } from './lib/dates';
import { isNative } from './lib/native';
import { refreshNotifications } from './lib/notifications';
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
