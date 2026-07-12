import { Preferences } from '@capacitor/preferences';
import { isNative } from './native';

/* Bearer session token used when the API is cross-origin (the Capacitor app),
   captured from Better Auth's `set-auth-token` response header. Kept in memory
   so reads stay synchronous; persisted to Capacitor Preferences on native and
   localStorage on the web. */

const KEY = 'diary.authToken';

let token: string | null =
  typeof localStorage === 'undefined' ? null : localStorage.getItem(KEY);

/** On native the persisted token loads async — await this before first render. */
export async function initAuthToken(): Promise<void> {
  if (!isNative) return;
  token = (await Preferences.get({ key: KEY })).value;
}

export const getAuthToken = (): string | null => token;

export function setAuthToken(value: string | null): void {
  token = value;
  if (isNative) {
    void (value ? Preferences.set({ key: KEY, value }) : Preferences.remove({ key: KEY }));
    return;
  }
  if (value) localStorage.setItem(KEY, value);
  else localStorage.removeItem(KEY);
}
