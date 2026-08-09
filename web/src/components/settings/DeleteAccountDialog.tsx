import { AlertTriangle, Check, Download, Fingerprint } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Spinner } from '@/components/common/Spinner';
import { GoogleIcon } from '@/components/icons/GoogleIcon';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useSyncStatus } from '@/db/useSyncStatus';
import { ApiError, apiDelete } from '@/lib/apiClient';
import { biometryAvailable, getLockState, promptBiometrics, verifyPasscode } from '@/lib/appLock';
import { buildBackupEnvelope } from '@/lib/backup/export';
import {
  forgetAccountDeletionResume,
  markAccountDeletionResume,
  resumingAccountDeletion,
} from '@/lib/deleteAccountResume';
import { endSession } from '@/lib/endSession';
import { saveTextFile } from '@/lib/fileSave';
import { googleReauth } from '@/lib/googleSignIn';
import { notifyError } from '@/lib/notify';

/**
 * Deleting the account and everything in it.
 *
 * The only irreversible action in the app, so the dialog is built to be slow in the places that
 * matter and honest in the rest:
 *
 * - **A way out that isn't cancelling.** The export button is inside the dialog rather than only
 *   back on the settings page, because the moment someone is about to delete their diary is exactly
 *   when they might want a copy of it, and sending them away to find it loses the thought.
 * - **Typing, not tapping.** A word has to be typed before the button enables. A destructive button
 *   behind one confirmation is still one mis-tap from the same place; a text field cannot be hit by
 *   accident, and filling it in means the sentence above it was read.
 * - **The device lock, if there is one.** With a passcode set, this asks for it (or biometry) before
 *   anything is sent. Someone holding an unlocked phone is the threat the lock exists for, and
 *   erasing the diary is a worse outcome than reading it.
 * - **The Google account behind it all.** The two guards above are this dialog's, which means the
 *   server cannot see them and anything holding a session token can skip straight past. So the
 *   server keeps one of its own — the session has to be minutes old — and this dialog answers a
 *   refusal by sending the user back through Google. See `signInAgain` and lib/googleSignIn.ts.
 * - **No promises it can't keep.** The copy says other devices keep what they've already downloaded
 *   until they sign out, because they do — after this there is no account for them to sync against
 *   and nothing that can reach them.
 *
 * The order the four are in is not arbitrary. The two free, instant, local guards come first, so
 * the expensive one — a whole sign-in round trip, on the web a redirect out of the app — is only
 * ever spent by someone who has already typed the word and passed the lock.
 */

/** The server's answer to a session too old to be trusted with this. Not a 401: the session is
    perfectly valid and must not be torn down, it just is not recent enough. */
const REAUTH_REQUIRED = 'errors.reauth_required';

/**
 * `confirm` collects the typed word; `lock` asks the device passcode or biometry; `signin` sends
 * the user back through Google after the server has refused a stale session; `resumed` is where the
 * web lands on its way back from that redirect. Deleting spans all four, so the dialog can't be
 * dismissed while a request is in flight.
 */
type Stage = 'confirm' | 'lock' | 'signin' | 'resumed';

export function DeleteAccountDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [exporting, setExporting] = useState(false);
  const [exported, setExported] = useState(false);
  const [phrase, setPhrase] = useState('');
  /* Read at the first render rather than in an effect: it is a fact about the page load, decided
     before this component existed, and the dialog has to open already showing the right stage. */
  const [stage, setStage] = useState<Stage>(() =>
    resumingAccountDeletion() ? 'resumed' : 'confirm',
  );
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState(false);
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const passcodeRef = useRef<HTMLInputElement>(null);
  /* One trip through Google per attempt. Arriving on a resume counts as having taken it, which is
     what stops a server that keeps refusing from bouncing the user out to Google and back forever —
     a loop that would survive page loads, since each one would look like a first attempt. */
  const reauthAttempted = useRef(resumingAccountDeletion());

  const confirmWord = t('settings.data.deleteAccount.confirmWord');
  const phraseMatches = phrase.trim().toLowerCase() === confirmWord.toLowerCase();
  /* Checked here as well as on the button that opens this, because the interesting case is the
     connection dropping *while* the dialog is open — someone typing the word, losing signal, and
     pressing a button that can only fail. Reaching the device-lock prompt and being refused after
     it would be the worst version of that. */
  const { blocker } = useSyncStatus();
  const serverUnreachable = blocker === 'offline' || blocker === 'unreachable';

  // A fresh dialog every time it opens: a half-typed word, a reached stage, or a spent trip through
  // Google left over from a cancelled attempt would mean the next one starts further along than the
  // user expects — and, in the last case, further along than it is allowed to.
  useEffect(() => {
    if (open) return;
    setPhrase('');
    setPasscode('');
    setPasscodeError(false);
    setStage('confirm');
    setExported(false);
    reauthAttempted.current = false;
    forgetAccountDeletionResume();
  }, [open]);

  const handleExport = async () => {
    setExporting(true);
    try {
      const envelope = await buildBackupEnvelope();
      await saveTextFile(
        `diary-backup-${envelope.exportedAt.slice(0, 10)}.json`,
        JSON.stringify(envelope, null, 2),
        'application/json',
      );
      setExported(true);
    } catch {
      notifyError(t('errors.unknown'));
    } finally {
      setExporting(false);
    }
  };

  /** Wipe the server, then leave the device as a sign-out would. */
  const runDeletion = async () => {
    setDeleting(true);
    try {
      await apiDelete('/account');
    } catch (err) {
      // Nothing has been deleted, so the dialog stays exactly where it is and can be retried.
      setDeleting(false);
      const sessionTooOld = err instanceof ApiError && err.code === REAUTH_REQUIRED;
      /* The server is the only thing that knows how old a session may be, so the age is never
         checked here — this waits to be told, and then offers the one thing that fixes it. */
      if (sessionTooOld && !reauthAttempted.current) {
        setStage('signin');
        return;
      }
      notifyError(t(sessionTooOld ? REAUTH_REQUIRED : 'settings.data.deleteAccount.failed'));
      return;
    }
    /* Past this point the account is gone and there is nothing to roll back, so the teardown is not
       allowed to leave the user on a settings page for a diary that no longer exists — any failure
       in here still ends at the login screen. */
    await endSession({ serverSessionGone: true }).catch(() => {});
    onOpenChange(false);
    navigate('/login', { replace: true });
  };

  /**
   * Prove the Google account is still ours, then finish what was started.
   *
   * The marker goes down *before* the call, because on the web there is no line of code after the
   * redirect starts that is guaranteed to run. Native never leaves, so it picks the marker straight
   * back up and carries on in place — the platform difference lives entirely in the outcome
   * googleReauth reports, and this function reads the same on both.
   */
  const signInAgain = async () => {
    reauthAttempted.current = true;
    setDeleting(true);
    markAccountDeletionResume();
    let outcome: Awaited<ReturnType<typeof googleReauth>>;
    try {
      outcome = await googleReauth('/settings');
    } catch {
      /* Cleared, and the attempt handed back: a sign-in that failed is not a sign-in that was
         used up, and leaving this armed would strand the user on a stage whose only button no
         longer does anything. */
      forgetAccountDeletionResume();
      reauthAttempted.current = false;
      setDeleting(false);
      notifyError(t('settings.data.deleteAccount.signInFailed'));
      return;
    }
    // The page is on its way to Google. The marker is what brings this dialog back afterwards, and
    // nothing after this line is reliably reached.
    if (outcome === 'redirecting') return;
    forgetAccountDeletionResume();
    await runDeletion();
  };

  const tryBiometrics = async () => {
    if (
      await promptBiometrics(t('settings.data.deleteAccount.biometricsReason'), 'delete_account')
    ) {
      await runDeletion();
    }
  };

  /** The typed word is in — or, on a resume, the word and the lock were passed before the redirect
      and the Google account has since been re-presented. Either way: hand over to the device lock,
      or delete. The lock is asked again after a resume on purpose. It guards this device rather
      than the account, the round trip through Google says nothing about who is holding the phone,
      and it is the cheap half of the pair. */
  const handleConfirm = () => {
    if (!getLockState().config) {
      void runDeletion();
      return;
    }
    setStage('lock');
  };

  // Entering the lock stage offers biometry immediately when it's on, the same as the lock screen
  // does — making the user tap a button to be shown a prompt spends the whole convenience of it.
  useEffect(() => {
    if (stage !== 'lock') return;
    const { config } = getLockState();
    if (!config?.biometrics) return;
    void biometryAvailable().then((available) => {
      setCanUseBiometrics(available);
      if (available) void tryBiometrics();
    });
    // Runs on entering the stage.
  }, [stage]);

  const submitPasscode = async () => {
    if (!passcode || deleting) return;
    if (!(await verifyPasscode(passcode, 'delete_account'))) {
      setPasscodeError(true);
      setPasscode('');
      passcodeRef.current?.focus();
      return;
    }
    await runDeletion();
  };

  const description = {
    confirm: t('settings.data.deleteAccount.description'),
    lock: t('settings.data.deleteAccount.lockDescription'),
    signin: t('settings.data.deleteAccount.signInDescription'),
    resumed: t('settings.data.deleteAccount.resumedDescription'),
  }[stage];

  /* On the last press as much as the first. A resume rebuilds this dialog from nothing in a page
     the user did not navigate to themselves, so the consequences have to be back on screen before
     the button that causes them is. */
  const consequences = (
    <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
      <li>{t('settings.data.deleteAccount.bulletContent')}</li>
      <li>{t('settings.data.deleteAccount.bulletAccount')}</li>
      <li>{t('settings.data.deleteAccount.bulletDevices')}</li>
    </ul>
  );

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {t('settings.data.deleteAccount.title')}
          </DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        {stage === 'confirm' && (
          <div className="flex flex-col gap-4">
            {consequences}

            <div className="flex flex-col gap-1.5 rounded-lg border bg-muted/40 p-3">
              <Button
                variant="outline"
                size="sm"
                className="w-full gap-1.5 h-8"
                disabled={exporting}
                onClick={() => void handleExport()}
              >
                {exporting ? (
                  <Spinner className="size-3.5" />
                ) : exported ? (
                  <Check className="size-3.5" />
                ) : (
                  <Download className="size-3.5" />
                )}
                {exported
                  ? t('settings.data.deleteAccount.exportedAgain')
                  : t('settings.data.deleteAccount.exportFirst')}
              </Button>
              <p className="text-xs text-muted-foreground">
                {t('settings.data.deleteAccount.exportFirstDescription')}
              </p>
            </div>

            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-confirm-phrase">
                {t('settings.data.deleteAccount.typeToConfirm', { word: confirmWord })}
              </Label>
              <Input
                id="delete-confirm-phrase"
                autoComplete="off"
                autoCapitalize="characters"
                spellCheck={false}
                value={phrase}
                onChange={(e) => setPhrase(e.target.value)}
                onKeyDown={(e) =>
                  e.key === 'Enter' && phraseMatches && !serverUnreachable && handleConfirm()
                }
                placeholder={confirmWord}
              />
              {serverUnreachable && (
                <p className="text-xs text-muted-foreground" role="status">
                  {t('settings.data.deleteAccount.needsConnection')}
                </p>
              )}
            </div>
          </div>
        )}

        {stage === 'lock' && (
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="delete-passcode">{t('security.passcode')}</Label>
              <Input
                ref={passcodeRef}
                id="delete-passcode"
                type="password"
                inputMode="numeric"
                autoFocus
                autoComplete="off"
                aria-invalid={passcodeError}
                aria-describedby="delete-passcode-error"
                value={passcode}
                onChange={(e) => {
                  setPasscode(e.target.value);
                  setPasscodeError(false);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void submitPasscode()}
                className="text-center tracking-widest"
              />
              {/* Holds its line either way, so a wrong passcode doesn't move the button that is
                  about to be pressed again. */}
              <p
                id="delete-passcode-error"
                className="min-h-4 text-xs text-destructive"
                role="alert"
              >
                {passcodeError ? t('security.wrongPasscode') : ''}
              </p>
            </div>
            {canUseBiometrics && (
              <Button
                variant="ghost"
                size="sm"
                className="w-fit gap-1.5"
                disabled={deleting}
                onClick={() => void tryBiometrics()}
              >
                <Fingerprint className="size-4" />
                {t('security.useBiometrics')}
              </Button>
            )}
          </div>
        )}

        {/* Nothing but the reassurance. The description above says what is about to happen and that
            nothing has been deleted yet; a stage that also repeated the consequences would bury the
            one sentence the user needs here, which is that they have not lost anything by getting
            this far. */}
        {stage === 'signin' && (
          <p className="text-sm text-muted-foreground">
            {t('settings.data.deleteAccount.signInWhy')}
          </p>
        )}

        {stage === 'resumed' && consequences}

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {stage === 'signin' ? (
            <Button className="gap-1.5" disabled={deleting} onClick={() => void signInAgain()}>
              {deleting ? <Spinner className="size-3.5" /> : <GoogleIcon />}
              {t('auth.signInWithGoogle')}
            </Button>
          ) : stage === 'lock' ? (
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={!passcode || deleting || serverUnreachable}
              onClick={() => void submitPasscode()}
            >
              {deleting && <Spinner className="size-3.5" />}
              {t('settings.data.deleteAccount.confirm')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="gap-1.5"
              /* The typed word only gates the stage that collects it. On a resume it was typed
                 before the redirect and the field it was typed into no longer exists. */
              disabled={(stage === 'confirm' && !phraseMatches) || deleting || serverUnreachable}
              onClick={handleConfirm}
            >
              {deleting && <Spinner className="size-3.5" />}
              {t('settings.data.deleteAccount.confirm')}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
