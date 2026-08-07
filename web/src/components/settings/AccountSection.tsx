import { LogOut } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { ConfirmDialog } from '@/components/common/ConfirmDialog';
import { Spinner } from '@/components/common/Spinner';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { Button } from '@/components/ui/button';
import { clearLocalData } from '@/db/db';
import { closeLiveChannel } from '@/db/sync';
import { useSyncStatus } from '@/db/useSyncStatus';
import { signOut, useSession } from '@/lib/authClient';
import { setAuthToken } from '@/lib/authToken';
import { googleSignIn } from '@/lib/googleSignIn';
import { setLocalOnly } from '@/lib/localOnly';
import { notifyError } from '@/lib/notify';
import { cacheUser } from '@/lib/sessionCache';
import { Section } from './Section';

/** Who this diary belongs to: the signed-in account, or the offer to attach one. Owns the whole
    sign-out sequence, including the confirmation, because nothing else on the page needs it. */
export function AccountSection() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { data: session } = useSession();
  const { pending: pendingOps } = useSyncStatus();
  const [linkingAccount, setLinkingAccount] = useState(false);
  const [signOutConfirmOpen, setSignOutConfirmOpen] = useState(false);

  const handleSignOut = async () => {
    await signOut();
    // Local data belongs to the signed-in account: wipe it all.
    closeLiveChannel();
    await clearLocalData();
    setAuthToken(null);
    cacheUser(null);
    setLocalOnly(false);
    navigate('/login');
  };

  /**
   * Sign-out ends in `clearLocalData()`, which takes the outbox with it — so anything still queued
   * is not "unsynced", it is gone. Writing offline and then signing out is exactly the sequence
   * that produces a non-empty queue, so the count is checked rather than assumed to be zero.
   *
   * A drained queue signs out with no ceremony, as before: the confirmation only exists to name a
   * loss that is about to happen.
   */
  const requestSignOut = () => {
    if (pendingOps > 0) setSignOutConfirmOpen(true);
    else void handleSignOut();
  };

  const handleLinkAccount = async () => {
    setLinkingAccount(true);
    try {
      await googleSignIn('/settings');
      // Native resolves in place and stays on this page; AppLayout's session effect clears
      // local-only mode and kicks the sync engine, which drains anything queued while offline.
      setLinkingAccount(false);
    } catch (err) {
      notifyError(err instanceof Error ? err.message : t('errors.unknown'));
      setLinkingAccount(false);
    }
  };

  return (
    <>
      <Section title={t('settings.account')}>
        {session?.user ? (
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              {session.user.image && (
                <img src={session.user.image} alt="" className="size-9 rounded-full" referrerPolicy="no-referrer" />
              )}
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{session.user.name}</p>
                <p className="truncate text-xs text-muted-foreground">{session.user.email}</p>
              </div>
            </div>
            <Button variant="outline" size="sm" className="gap-1.5 h-8" onClick={requestSignOut}>
              <LogOut className="size-3.5" />
              {t('auth.signOut')}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-sm text-muted-foreground">{t('settings.accountLocalOnlyDescription')}</p>
            <Button
              size="sm"
              className="gap-1.5 h-8"
              disabled={linkingAccount}
              onClick={() => void handleLinkAccount()}
            >
              {linkingAccount ? <Spinner className="size-3.5" /> : <GoogleIcon />}
              {t('auth.signInWithGoogle')}
            </Button>
          </div>
        )}
      </Section>

      <ConfirmDialog
        open={signOutConfirmOpen}
        onOpenChange={setSignOutConfirmOpen}
        title={t('settings.signOutPendingTitle', { count: pendingOps })}
        description={t('settings.signOutPendingDescription')}
        confirmLabel={t('settings.signOutDiscard')}
        onConfirm={() => void handleSignOut()}
      />
    </>
  );
}
