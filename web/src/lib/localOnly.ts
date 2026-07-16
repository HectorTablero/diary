/* Whether this device has explicitly opted into using the app without an account. Deliberately a
   separate concept from sessionCache.ts's cached user: that cache means "a real account has
   session'd here before, maybe just offline right now" — conflating the two would make
   AppLayout's offline-bypass logic (and the sync engine's "has ever linked" gate) fire for
   someone who was never signed in at all. */

const KEY = 'diary.localOnly';

export function isLocalOnly(): boolean {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setLocalOnly(value: boolean): void {
  try {
    if (value) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // storage unavailable (private browsing, quota) — nothing sensible to do
  }
}
