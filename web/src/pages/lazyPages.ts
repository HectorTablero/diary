import { lazy } from 'react';

// Shared between the router (for on-demand loading) and the idle-time
// preloader (for warming the cache ahead of navigation). Kept in one place
// so both sides reference the same import() specifiers.
export const pageLoaders = {
  diary: () => import('./DiaryDayPage'),
  calendar: () => import('./CalendarPage'),
  people: () => import('./PeopleListPage'),
  personProfile: () => import('./PersonProfilePage'),
  search: () => import('./SearchPage'),
  settings: () => import('./SettingsPage'),
  tags: () => import('./TagsPage'),
} as const;

export const DiaryDayPage = lazy(pageLoaders.diary);
export const CalendarPage = lazy(pageLoaders.calendar);
export const PeopleListPage = lazy(pageLoaders.people);
export const PersonProfilePage = lazy(pageLoaders.personProfile);
export const SearchPage = lazy(pageLoaders.search);
export const SettingsPage = lazy(pageLoaders.settings);
export const TagsPage = lazy(pageLoaders.tags);
