export type Theme = 'light' | 'dark' | 'auto';

const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');

const isDark = (theme: Theme) => theme === 'dark' || (theme === 'auto' && mediaQuery.matches);

export function getTheme(): Theme {
  const stored = localStorage.getItem('theme');
  return stored === 'light' || stored === 'dark' ? stored : 'auto';
}

export function applyTheme(theme: Theme) {
  localStorage.setItem('theme', theme);
  document.documentElement.classList.toggle('dark', isDark(theme));
}

// Follow OS changes while in auto mode.
mediaQuery.addEventListener('change', () => {
  if (getTheme() === 'auto') {
    document.documentElement.classList.toggle('dark', mediaQuery.matches);
  }
});
