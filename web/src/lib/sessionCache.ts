/* Last-known signed-in user, so the app stays usable offline (the local data
   is already on the device; only the session check needs the network). */

export interface CachedUser {
  name: string;
  email: string;
  image?: string | null;
}

const KEY = 'diary.user';

export function getCachedUser(): CachedUser | null {
  try {
    const raw = localStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as CachedUser) : null;
  } catch {
    return null;
  }
}

export function cacheUser(user: CachedUser | null): void {
  if (user) localStorage.setItem(KEY, JSON.stringify(user));
  else localStorage.removeItem(KEY);
}
