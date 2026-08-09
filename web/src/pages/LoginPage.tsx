import { BookOpen } from 'lucide-react';
import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { FullScreenSpinner, Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { notifyError } from '@/lib/notify';
import { useSession } from '@/lib/authClient';
import { googleSignIn } from '@/lib/googleSignIn';
import { setLocalOnly } from '@/lib/localOnly';
import { setPreference, usePreferences } from '@/lib/preferences';

/* Lazy, unlike everything else this page imports. LoginPage is eager in the main bundle (it is the
   one route that has to render before anything is known about the session), and the tour drags in
   five step components, framer-motion's presence machinery and a fake diary — none of which the
   overwhelming majority of loads, which have already seen it, should pay for. */
const OnboardingFlow = lazy(() => import('@/components/onboarding/OnboardingFlow'));

export default function LoginPage() {
  const { data: session, isPending } = useSession();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);
  const { onboardingSeen } = usePreferences();

  if (isPending) return <FullScreenSpinner />;
  /* Above the onboarding gate below, and that order is load-bearing: someone with a session who
     lands here — a deep link, a stale tab — is on their way to the diary, and must not be shown a
     frame of a first-run tour on the way. It is also what makes this gate invisible to everyone
     upgrading to this build, since a signed-in user never renders past this line. */
  if (session?.user) return <Navigate to="/diary" replace />;

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await googleSignIn('/diary');
      // useSession refreshes after signIn and the <Navigate> above redirects (native); the web
      // flow has already navigated away by the time this resolves.
      setSigningIn(false);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : t('errors.unknown'));
      setSigningIn(false);
    }
  };

  const continueWithoutAccount = () => {
    setLocalOnly(true);
    void navigate('/diary');
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-8 px-6">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <BookOpen className="size-7" />
        </div>
        <h1 className="text-2xl font-semibold tracking-tight">{t('app.name')}</h1>
        <p className="max-w-xs text-sm text-balance text-muted-foreground">{t('app.tagline')}</p>
      </div>
      <div className="flex flex-col items-center gap-3">
        <Button size="lg" variant="outline" onClick={handleSignIn} disabled={signingIn}>
          {signingIn ? <Spinner className="size-4" /> : <GoogleIcon />}
          {t('auth.signInWithGoogle')}
        </Button>
        <button
          type="button"
          onClick={continueWithoutAccount}
          className="text-xs text-muted-foreground underline-offset-2 hover:underline"
        >
          {t('auth.continueWithoutAccount')}
        </button>
      </div>
      {/* Over this screen rather than in front of it, so finishing the tour reveals a sign-in
          decision made by someone who now knows what they are signing in to — including whether
          they want an account at all. `fallback={null}` because the chunk resolves in a frame or
          two and a spinner between the login screen and a modal would only flicker. */}
      {!onboardingSeen && (
        <Suspense fallback={null}>
          <OnboardingFlow onDone={() => setPreference('onboardingSeen', true)} />
        </Suspense>
      )}
    </div>
  );
}
