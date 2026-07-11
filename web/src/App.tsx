import { createBrowserRouter, Navigate, RouterProvider } from 'react-router';
import AppLayout from './components/layout/AppLayout';
import { todayKey } from './lib/dates';
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

export default function App() {
  return <RouterProvider router={router} />;
}
