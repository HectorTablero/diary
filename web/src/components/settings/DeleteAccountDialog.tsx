import { AlertTriangle, Check, Download, Fingerprint } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Spinner } from '@/components/common/Spinner';
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
import { apiDelete } from '@/lib/apiClient';
import { biometryAvailable, getLockState, promptBiometrics, verifyPasscode } from '@/lib/appLock';
import { buildBackupEnvelope } from '@/lib/backup/export';
import { endSession } from '@/lib/endSession';
import { saveTextFile } from '@/lib/fileSave';
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
 * - **No promises it can't keep.** The copy says other devices keep what they've already downloaded
 *   until they sign out, because they do — after this there is no account for them to sync against
 *   and nothing that can reach them.
 */
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
  /* 'confirm' collects the typed word; 'reauth' asks the device lock. Deleting spans both, so the
     dialog can't be dismissed while a request is in flight. */
  const [stage, setStage] = useState<'confirm' | 'reauth'>('confirm');
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState(false);
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const passcodeRef = useRef<HTMLInputElement>(null);

  const confirmWord = t('settings.data.deleteAccount.confirmWord');
  const phraseMatches = phrase.trim().toLowerCase() === confirmWord.toLowerCase();
  /* Checked here as well as on the button that opens this, because the interesting case is the
     connection dropping *while* the dialog is open — someone typing the word, losing signal, and
     pressing a button that can only fail. Reaching the device-lock prompt and being refused after
     it would be the worst version of that. */
  const { blocker } = useSyncStatus();
  const serverUnreachable = blocker === 'offline' || blocker === 'unreachable';

  // A fresh dialog every time it opens: a half-typed word or a reached reauth stage left over from
  // a cancelled attempt would mean the next one starts further along than the user expects.
  useEffect(() => {
    if (open) return;
    setPhrase('');
    setPasscode('');
    setPasscodeError(false);
    setStage('confirm');
    setExported(false);
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
    } catch {
      // Nothing has been deleted, so the dialog stays exactly where it is and can be retried.
      setDeleting(false);
      notifyError(t('settings.data.deleteAccount.failed'));
      return;
    }
    /* Past this point the account is gone and there is nothing to roll back, so the teardown is not
       allowed to leave the user on a settings page for a diary that no longer exists — any failure
       in here still ends at the login screen. */
    await endSession({ serverSessionGone: true }).catch(() => {});
    onOpenChange(false);
    navigate('/login', { replace: true });
  };

  const tryBiometrics = async () => {
    if (await promptBiometrics(t('settings.data.deleteAccount.biometricsReason'))) {
      await runDeletion();
    }
  };

  /** The typed word is in: either hand over to the device lock, or delete. */
  const handleConfirm = () => {
    if (!getLockState().config) {
      void runDeletion();
      return;
    }
    setStage('reauth');
  };

  // Entering the reauth stage offers biometry immediately when it's on, the same as the lock screen
  // does — making the user tap a button to be shown a prompt spends the whole convenience of it.
  useEffect(() => {
    if (stage !== 'reauth') return;
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
    if (!(await verifyPasscode(passcode))) {
      setPasscodeError(true);
      setPasscode('');
      passcodeRef.current?.focus();
      return;
    }
    await runDeletion();
  };

  return (
    <Dialog open={open} onOpenChange={(next) => !deleting && onOpenChange(next)}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-destructive">
            <AlertTriangle className="size-4 shrink-0" />
            {t('settings.data.deleteAccount.title')}
          </DialogTitle>
          <DialogDescription>
            {stage === 'confirm'
              ? t('settings.data.deleteAccount.description')
              : t('settings.data.deleteAccount.reauthDescription')}
          </DialogDescription>
        </DialogHeader>

        {stage === 'confirm' ? (
          <div className="flex flex-col gap-4">
            <ul className="flex list-disc flex-col gap-1 pl-5 text-sm text-muted-foreground">
              <li>{t('settings.data.deleteAccount.bulletContent')}</li>
              <li>{t('settings.data.deleteAccount.bulletAccount')}</li>
              <li>{t('settings.data.deleteAccount.bulletDevices')}</li>
            </ul>

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
        ) : (
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

        <DialogFooter className="gap-2">
          <Button variant="outline" disabled={deleting} onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          {stage === 'confirm' ? (
            <Button
              variant="destructive"
              disabled={!phraseMatches || serverUnreachable}
              onClick={handleConfirm}
            >
              {t('settings.data.deleteAccount.confirm')}
            </Button>
          ) : (
            <Button
              variant="destructive"
              className="gap-1.5"
              disabled={!passcode || deleting || serverUnreachable}
              onClick={() => void submitPasscode()}
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
