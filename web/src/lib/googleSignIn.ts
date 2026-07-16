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
  if (!('idToken' in result) || !result.idToken) throw new Error('Google sign-in returned no idToken');
  const { error } = await authClient.signIn.social({
    provider: 'google',
    idToken: { token: result.idToken, accessToken: result.accessToken?.token },
  });
  if (error) throw new Error(error.message ?? 'sign-in failed');
  // Better Auth only auto-refreshes useSession for a fixed list of paths that
  // doesn't include /sign-in/social (the web flow reloads the page instead, so
  // it never notices). Nudge the session store manually.
  authClient.$store.notify('$sessionSignal');
  kick();
}

/** Google sign-in for both native and web, parametrized by post-sign-in destination. Web is
    always a full-page OAuth redirect regardless of trigger point, so `callbackURL` is the only
    lever there; native resolves in place with no navigation, so the caller stays on whatever
    page it was already on. */
export async function googleSignIn(callbackURL: string): Promise<void> {
  if (isNative) await nativeGoogleSignIn();
  else await signIn.social({ provider: 'google', callbackURL });
}
