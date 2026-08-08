import { Fingerprint, LockKeyhole } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  biometryAvailable,
  getLockState,
  promptBiometrics,
  unlock,
  verifyPasscode,
} from '@/lib/appLock';

/**
 * The screen in front of the diary when the lock is on.
 *
 * Rendered *instead of* the router rather than over it (see AppLockGate), so there is no route
 * mounted behind it: nothing fetches, nothing renders an entry into the DOM, and no stray
 * screenshot of the last screen sits under a translucent overlay.
 */
export function LockScreen() {
  const { t } = useTranslation();
  const [passcode, setPasscode] = useState('');
  const [error, setError] = useState(false);
  const [checking, setChecking] = useState(false);
  const [canUseBiometrics, setCanUseBiometrics] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const tryBiometrics = async () => {
    if (await promptBiometrics(t('security.biometricsReason'), 'lock_screen')) unlock();
  };

  useEffect(() => {
    const { config } = getLockState();
    if (!config?.biometrics) return;
    void biometryAvailable().then((available) => {
      setCanUseBiometrics(available);
      // Offered straight away, not behind a tap: on a locked phone the prompt *is* the screen,
      // and making the user ask for it first would spend the whole convenience of having it.
      if (available) void tryBiometrics();
    });
    // Runs once, on mount.
  }, []);

  const submit = async () => {
    if (!passcode || checking) return;
    setChecking(true);
    const ok = await verifyPasscode(passcode, 'lock_screen');
    setChecking(false);
    if (ok) {
      unlock();
      return;
    }
    setError(true);
    setPasscode('');
    inputRef.current?.focus();
  };

  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-6 px-6 pt-[var(--inset-top)] pb-[var(--inset-bottom)]">
      <div className="flex flex-col items-center gap-3 text-center">
        <div className="flex size-14 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-sm">
          <LockKeyhole className="size-7" />
        </div>
        <h1 className="text-xl font-semibold tracking-tight">{t('security.lockedTitle')}</h1>
        <p className="max-w-xs text-sm text-balance text-muted-foreground">
          {t('security.lockedDescription')}
        </p>
      </div>

      <div className="flex w-full max-w-64 flex-col gap-3">
        <Input
          ref={inputRef}
          type="password"
          inputMode="numeric"
          autoFocus
          autoComplete="off"
          aria-label={t('security.passcode')}
          aria-invalid={error}
          aria-describedby="lock-passcode-error"
          value={passcode}
          onChange={(e) => {
            setPasscode(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => e.key === 'Enter' && void submit()}
          placeholder={t('security.passcode')}
          className="text-center tracking-widest"
        />
        {/* Reserves its line whether or not it is filled, so a wrong passcode doesn't shift the
            button out from under the thumb that is about to press it again. */}
        <p
          id="lock-passcode-error"
          className="min-h-4 text-center text-xs text-destructive"
          role="alert"
        >
          {error ? t('security.wrongPasscode') : ''}
        </p>
        <Button onClick={() => void submit()} disabled={!passcode || checking}>
          {t('security.unlock')}
        </Button>
        {canUseBiometrics && (
          <Button variant="ghost" className="gap-1.5" onClick={() => void tryBiometrics()}>
            <Fingerprint className="size-4" />
            {t('security.useBiometrics')}
          </Button>
        )}
      </div>
    </div>
  );
}
