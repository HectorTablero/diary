import { useSyncExternalStore } from 'react';

/* `.dark` on <html> is the one place the app records which theme is showing — set before first paint
   by index.html and toggled by lib/theme.ts — and nothing announces a change to it. So the class is
   watched directly, which also catches the OS flipping while the theme is on "auto". */

const subscribe = (onChange: () => void) => {
  const observer = new MutationObserver(onChange);
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
  return () => observer.disconnect();
};

const isDark = () => document.documentElement.classList.contains('dark');

/** Whether the page is showing its dark theme right now, re-rendering when that changes. */
export function useDarkMode(): boolean {
  return useSyncExternalStore(subscribe, isDark, () => false);
}
