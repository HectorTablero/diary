import { Preferences } from '@capacitor/preferences';
import { isNative } from './native';

/* Bearer session token used when the API is cross-origin (the Capacitor app), captured from
   Better Auth's `set-auth-token` response header. Kept in memory so reads stay synchronous, and
   persisted to Capacitor Preferences.

   Native only, deliberately. The web is same-origin — the Vite proxy in dev, the server's own SPA
   in prod — so the session cookie is both sufficient and authoritative there, and sending a bearer
   token alongside it is not harmless belt-and-braces: Better Auth's bearer plugin *replaces* the
   session cookie on the incoming request with whatever the token says (setRequestCookie, in
   better-auth/cookies/cookie-utils). A token left in localStorage whose session has since gone —
   a sign-out elsewhere, a wiped sessions collection — therefore shadows every cookie that arrives
   after it, and it is still correctly HMAC-signed, so the plugin trusts it and does the swap.
   Signing in then succeeds the whole way through — user, account and session rows written, cookie
   returned — and the app still shows the login screen, permanently, because every get-session is
   answered for the dead token instead of the live cookie. */

const KEY = 'diary.authToken';

let token: string | null = null;

/** On native the persisted token loads async — await this before first render. */
export async function initAuthToken(): Promise<void> {
  if (!isNative) {
    // Clears tokens written by earlier builds, which is what unsticks a browser already caught
    // by the shadowing described above.
    try {
      localStorage.removeItem(KEY);
    } catch {
      // Storage can be unavailable (private mode); there is nothing to recover from here.
    }
    return;
  }
  token = (await Preferences.get({ key: KEY })).value;
}

export const getAuthToken = (): string | null => token;

export function setAuthToken(value: string | null): void {
  if (!isNative) return;
  token = value;
  void (value ? Preferences.set({ key: KEY, value }) : Preferences.remove({ key: KEY }));
}
