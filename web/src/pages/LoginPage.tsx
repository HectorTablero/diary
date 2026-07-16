import { BookOpen } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Navigate, useNavigate } from 'react-router';
import { toast } from 'sonner';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { FullScreenSpinner, Spinner } from '@/components/common/Spinner';
import { Button } from '@/components/ui/button';
import { useSession } from '@/lib/authClient';
import { googleSignIn } from '@/lib/googleSignIn';
import { setLocalOnly } from '@/lib/localOnly';

export default function LoginPage() {
  const { data: session, isPending } = useSession();
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [signingIn, setSigningIn] = useState(false);

  if (isPending) return <FullScreenSpinner />;
  if (session?.user) return <Navigate to="/diary" replace />;

  const handleSignIn = async () => {
    setSigningIn(true);
    try {
      await googleSignIn('/diary');
      // useSession refreshes after signIn and the <Navigate> above redirects (native); the web
      // flow has already navigated away by the time this resolves.
      setSigningIn(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : t('errors.unknown'));
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
    </div>
  );
}
