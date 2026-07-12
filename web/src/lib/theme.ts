import { StatusBar, Style } from '@capacitor/status-bar';
import { isNative } from './native';

export type Theme = 'light' | 'dark' | 'auto';

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

const isDark = (theme: Theme) => theme === 'dark' || (theme === 'auto' && mediaQuery.matches);

/** Keep the Android status-bar icons readable against the current theme. */
function syncStatusBar() {
  if (!isNative) return;
  const dark = document.documentElement.classList.contains('dark');
  void StatusBar.setStyle({ style: dark ? Style.Dark : Style.Light });
}

export function getTheme(): Theme {
  const stored = localStorage.getItem('theme');
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export function applyTheme(theme: Theme) {
  localStorage.setItem('theme', theme);
  document.documentElement.classList.toggle('dark', isDark(theme));
  syncStatusBar();
}

// Follow OS changes while in auto mode.
mediaQuery.addEventListener('change', () => {
  if (getTheme() === 'auto') {
    document.documentElement.classList.toggle('dark', mediaQuery.matches);
    syncStatusBar();
  }
});

// The pre-paint <script> in index.html set the class before React loaded.
syncStatusBar();
