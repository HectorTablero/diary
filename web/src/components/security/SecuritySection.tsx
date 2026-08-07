import { Fingerprint, LockKeyhole } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import {
  biometryAvailable,
  disableLock,
  GRACE_CHOICES,
  setPasscode,
  updateLockOptions,
  useLockState,
  verifyPasscode,
  type GraceSeconds,
} from '@/lib/appLock';
import { notifyError, notifySuccess } from '@/lib/notify';

const MIN_PASSCODE_LENGTH = 4;

/**
 * Set, change, or turn off the passcode.
 *
 * One dialog for all three because they are the same two questions in different combinations:
 * prove you know the current passcode (unless there isn't one yet), then type the new one twice
 * (unless you are removing it).
 */
function PasscodeDialog({
  mode,
  open,
  onOpenChange,
}: {
  mode: 'set' | 'change' | 'disable';
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const needsCurrent = mode !== 'set';
  const needsNew = mode !== 'disable';

  useEffect(() => {
    if (!open) return;
    setCurrent('');
    setNext('');
    setConfirm('');
    setError(null);
  }, [open]);

  const submit = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (needsCurrent && !(await verifyPasscode(current))) {
        setError(t('security.wrongPasscode'));
        return;
      }
      if (needsNew) {
        if (next.length < MIN_PASSCODE_LENGTH) {
          setError(t('security.tooShort', { count: MIN_PASSCODE_LENGTH }));
          return;
        }
        if (next !== confirm) {
          setError(t('security.mismatch'));
          return;
        }
        await setPasscode(next);
        notifySuccess(t('security.passcodeSaved'), { important: true });
      } else {
        await disableLock(current);
        notifySuccess(t('security.lockDisabled'), { important: true });
      }
      onOpenChange(false);
    } catch {
      notifyError(t('errors.unknown'));
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'set'
      ? t('security.setPasscode')
      : mode === 'change'
        ? t('security.changePasscode')
        : t('security.disableLock');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {needsCurrent && (
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="current-passcode">{t('security.currentPasscode')}</Label>
              <Input
                id="current-passcode"
                type="password"
                inputMode="numeric"
                autoFocus
                autoComplete="off"
                value={current}
                onChange={(e) => {
                  setCurrent(e.target.value);
                  setError(null);
                }}
                onKeyDown={(e) => e.key === 'Enter' && void submit()}
              />
            </div>
          )}
          {needsNew && (
            <>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="new-passcode">{t('security.newPasscode')}</Label>
                <Input
                  id="new-passcode"
                  type="password"
                  inputMode="numeric"
                  autoFocus={!needsCurrent}
                  autoComplete="off"
                  value={next}
                  aria-describedby="new-passcode-hint"
                  onChange={(e) => {
                    setNext(e.target.value);
                    setError(null);
                  }}
                />
                <p id="new-passcode-hint" className="text-xs text-muted-foreground">
                  {t('security.passcodeHint', { count: MIN_PASSCODE_LENGTH })}
                </p>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="confirm-passcode">{t('security.confirmPasscode')}</Label>
                <Input
                  id="confirm-passcode"
                  type="password"
                  inputMode="numeric"
                  autoComplete="off"
                  value={confirm}
                  onChange={(e) => {
                    setConfirm(e.target.value);
                    setError(null);
                  }}
                  onKeyDown={(e) => e.key === 'Enter' && void submit()}
                />
              </div>
            </>
          )}
          {error && (
            <p className="text-xs text-destructive" role="alert">
              {error}
            </p>
          )}
          {/* Named plainly: forgetting the passcode is unrecoverable by design, and the moment to
              say so is while one is being chosen. */}
          {needsNew && (
            <p className="text-xs text-muted-foreground">{t('security.noRecoveryWarning')}</p>
          )}
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)}>
              {t('common.cancel')}
            </Button>
            <Button
              variant={mode === 'disable' ? 'destructive' : 'default'}
              disabled={busy}
              onClick={() => void submit()}
            >
              {mode === 'disable' ? t('security.disableLock') : t('common.save')}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The Security block of the Settings page.
 *
 * Sits under Account because it is the same kind of question — who is allowed in — but it is
 * pointedly *not* part of the account: the lock is device-local (see lib/appLock.ts), so it stays
 * on through a sign-out and works with no account at all.
 */
export function SecuritySection({
  Section,
}: {
  /** The Settings page's own section shell, passed in so this block looks like every other one. */
  Section: React.ComponentType<{
    title: string;
    description?: string;
    children: React.ReactNode;
  }>;
}) {
  const { t } = useTranslation();
  const { config } = useLockState();
  const [dialog, setDialog] = useState<'set' | 'change' | 'disable' | null>(null);
  const [biometryReady, setBiometryReady] = useState(false);

  useEffect(() => {
    void biometryAvailable().then(setBiometryReady);
  }, []);

  const graceLabel = (seconds: GraceSeconds) =>
    seconds === 0
      ? t('security.lockImmediately')
      : seconds < 3600
        ? t('security.lockAfterMinutes', { count: seconds / 60 })
        : t('security.lockAfterMinutes', { count: 60 });

  return (
    <Section title={t('security.title')} description={t('security.description')}>
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-0.5">
            <Label htmlFor="app-lock">{t('security.requirePasscode')}</Label>
            <p className="text-xs text-muted-foreground">{t('security.requirePasscodeDescription')}</p>
          </div>
          <Switch
            id="app-lock"
            checked={config !== null}
            onCheckedChange={(checked) => setDialog(checked ? 'set' : 'disable')}
          />
        </div>

        {config && (
          <>
            <div className="flex flex-col gap-1.5">
              <Label>{t('security.lockAfter')}</Label>
              <Select
                value={String(config.graceSeconds)}
                onValueChange={(value) =>
                  updateLockOptions({ graceSeconds: Number(value) as GraceSeconds })
                }
              >
                <SelectTrigger className="w-56">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GRACE_CHOICES.map((seconds) => (
                    <SelectItem key={seconds} value={String(seconds)}>
                      {graceLabel(seconds)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Only where there is biometry to offer: a switch that cannot do anything is worse
                than an absent one, the same rule the Reminders block follows. */}
            {biometryReady && (
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <Label htmlFor="app-lock-biometrics">{t('security.biometrics')}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t('security.biometricsDescription')}
                  </p>
                </div>
                <Switch
                  id="app-lock-biometrics"
                  checked={config.biometrics}
                  onCheckedChange={(checked) => updateLockOptions({ biometrics: checked })}
                />
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={() => setDialog('change')}>
                <LockKeyhole className="size-3.5" />
                {t('security.changePasscode')}
              </Button>
              {biometryReady && !config.biometrics && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-8 gap-1.5 text-muted-foreground"
                  onClick={() => updateLockOptions({ biometrics: true })}
                >
                  <Fingerprint className="size-3.5" />
                  {t('security.useBiometrics')}
                </Button>
              )}
            </div>
          </>
        )}
      </div>

      <PasscodeDialog
        mode={dialog ?? 'set'}
        open={dialog !== null}
        onOpenChange={(open) => !open && setDialog(null)}
      />
    </Section>
  );
}
