import { SocialLogin } from '@capgo/capacitor-social-login';
import { kick } from '@/db/sync';
import { authClient, signIn } from './authClient';
import { isNative } from './native';

let socialLoginReady = false;

/**
 * Native sign-in: Google blocks its OAuth pages inside webviews, so the app
 * uses the platform's native Google Sign-In and hands the resulting idToken
 * to Better Auth, which creates the session (returned as a bearer token).
 */
async function nativeGoogleSignIn(): Promise<void> {
  if (!socialLoginReady) {
    await SocialLogin.initialize({
      google: { webClientId: import.meta.env.VITE_GOOGLE_CLIENT_ID as string },
    });
    socialLoginReady = true;
  }
  // No `scopes`: identity (email/name/picture) already comes in the idToken, and
  // requesting scopes would require the plugin's MainActivity modification.
  const { result } = await SocialLogin.login({
    provider: 'google',
    options: {},
  });
  if (!('idToken' in result) || !result.idToken)
    throw new Error('Google sign-in returned no idToken');
  const { error } = await authClient.signIn.social({
    provider: 'google',
    idToken: { token: result.idToken, accessToken: result.accessToken?.token },
  });
  if (error) throw new Error(error.message ?? 'sign-in failed');
  // Better Auth only auto-refreshes useSession for a fixed list of paths that
  // doesn't include /sign-in/social (the web flow reloads the page instead, so
  // it never notices). Nudge the session store manually.
  authClient.$store.notify('$sessionSignal');
}

/** Google sign-in for both native and web, parametrized by post-sign-in destination. Web is
    always a full-page OAuth redirect regardless of trigger point, so `callbackURL` is the only
    lever there; native resolves in place with no navigation, so the caller stays on whatever
    page it was already on. */
export async function googleSignIn(callbackURL: string): Promise<void> {
  if (isNative) {
    await nativeGoogleSignIn();
    // Only for a sign-in that opens the diary. googleReauth below deliberately does not sync:
    // it runs moments before the account is erased, and a pull landing after the local store has
    // been cleared would put a deleted diary back on the device.
    kick('signin');
  } else await signIn.social({ provider: 'google', callbackURL });
}

/**
 * Re-present the Google credential behind the account that is already signed in.
 *
 * There is exactly one reason to want this: DELETE /account refuses a session that is more than a
 * few minutes old (server routes/account.ts), so erasing the diary means proving again that the
 * person asking is the account holder. Google OAuth is the only credential this app has, so the
 * proof is another sign-in — and what makes that work as a proof rather than a formality is that
 * every sign-in inserts a *new* session, which is precisely what the server is measuring.
 *
 * The return value exists because the two platforms differ in the one way the caller cannot paper
 * over: whether this function comes back at all.
 *
 * - **Native** signs in through the platform's Google client and resolves in place, with a new
 *   bearer token already stored. The caller simply carries on where it left off.
 * - **Web** hands the whole page to Google. `signIn.social` resolves once the redirect is under
 *   way, not once the user is back, so `'redirecting'` means *stop* — anything after it races a
 *   navigation. Whatever needs to happen on the other side has to have been written down
 *   somewhere that survives the round trip (lib/deleteAccountResume.ts).
 *
 * Worth being plain about what this proves: if the browser or the device still holds a live Google
 * session, Google may wave the user through without asking anything. That is the same guarantee
 * the original sign-in gave, and it is the ceiling for any app whose only credential is somebody
 * else's. What it does rule out is the case that matters — a session token on its own, without the
 * Google account behind it, can no longer erase the diary.
 */
export async function googleReauth(returnTo: string): Promise<'signed-in' | 'redirecting'> {
  if (isNative) {
    await nativeGoogleSignIn();
    return 'signed-in';
  }
  /* Checked, unlike the sign-in path above, because there is a decision resting on it: a caller
     told `'redirecting'` will stand down and wait for a page load that is never coming. */
  const { error } = await signIn.social({ provider: 'google', callbackURL: returnTo });
  if (error) throw new Error(error.message ?? 'sign-in failed');
  return 'redirecting';
}
