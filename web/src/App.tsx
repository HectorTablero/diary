import { App as CapApp } from '@capacitor/app';
import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import AppLayout from './components/layout/AppLayout';
import { todayKey } from './lib/dates';
import { isNative } from './lib/native';
import CalendarPage from './pages/CalendarPage';
import DiaryDayPage from './pages/DiaryDayPage';
import LoginPage from './pages/LoginPage';
import PeopleListPage from './pages/PeopleListPage';
import PersonProfilePage from './pages/PersonProfilePage';
import SearchPage from './pages/SearchPage';
import SettingsPage from './pages/SettingsPage';
import TagsPage from './pages/TagsPage';

const router = createBrowserRouter([
  { path: '/login', element: <LoginPage /> },
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/diary" replace /> },
      { path: 'diary', element: <Navigate to={`/diary/${todayKey()}`} replace /> },
      { path: 'diary/:date', element: <DiaryDayPage /> },
      { path: 'calendar', element: <CalendarPage /> },
      { path: 'people', element: <PeopleListPage /> },
      { path: 'people/:id', element: <PersonProfilePage /> },
      { path: 'search', element: <SearchPage /> },
      { path: 'tags', element: <TagsPage /> },
      { path: 'settings', element: <SettingsPage /> },
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
}

export default function App() {
  return <RouterProvider router={router} />;
}
