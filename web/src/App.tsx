import { App as CapApp } from '@capacitor/app';
import { LocalNotifications } from '@capacitor/local-notifications';
import { Suspense } from 'react';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import AppLayout from './components/layout/AppLayout';
import { FullScreenSpinner } from './components/common/Spinner';
import { todayKey } from './lib/dates';
import { isNative } from './lib/native';
import { refreshNotifications } from './lib/notifications';
import LoginPage from './pages/LoginPage';
import {
  CalendarPage,
  DiaryDayPage,
  PeopleListPage,
  PersonProfilePage,
  SearchPage,
  SettingsPage,
  TagsPage,
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
      { path: 'people/:id', element: withSuspense(<PersonProfilePage />) },
      { path: 'search', element: withSuspense(<SearchPage />) },
      { path: 'tags', element: withSuspense(<TagsPage />) },
      { path: 'settings', element: withSuspense(<SettingsPage />) },
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

  // Tapping a checkup/daily-reminder notification opens the relevant screen.
  void LocalNotifications.addListener('localNotificationActionPerformed', ({ notification }) => {
    const extra = notification.extra as { kind: 'checkup'; personId: string } | { kind: 'daily' };
    if (extra.kind === 'checkup') void router.navigate(`/people/${extra.personId}`);
    else void router.navigate('/diary');
  });

  // Resuming the app is the main way we notice a day has rolled over (there's
  // no true native background poll), so re-arm reminders on every foreground.
  void CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) refreshNotifications();
  });
}

export default function App() {
  return <RouterProvider router={router} />;
}
