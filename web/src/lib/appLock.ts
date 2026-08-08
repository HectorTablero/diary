import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { useSyncExternalStore } from 'react';
import { isNative } from './native';
import { trackEvent } from './telemetry';

/**
 * The lock in front of the diary.
 *
 * A diary is the one kind of app where "someone else is holding my unlocked phone" is the main
 * threat, and until now anyone who was could read every entry. This adds a passcode in front of
 * the app, with the device's own biometry as the fast path.
 *
 * Everything here is device-local and lives in localStorage, deliberately:
 *
 * - it must survive sign-out, which runs `clearLocalData()` and wipes IndexedDB. A lock that
 *   switches itself off when the account settings reset is not a lock.
 * - it must work in local-only mode, where there is no account to sync a setting to, and
 * - it describes *this device*. Locking a shared laptop says nothing about whether the phone in
 *   your pocket needs a passcode.
 *
 * The passcode is stored only as a PBKDF2-SHA-256 hash with a per-device random salt. That does
 * not make the diary itself secret — the entries are plain rows in IndexedDB, and anything with
 * developer tools or filesystem access can still read them. It makes the *app* refuse to open,
 * which is exactly the threat above and no more. Encrypting the store at rest is a separate,
 * larger job; this does not pretend to be it.
 */

const STORAGE_KEY = 'appLock';
const PBKDF2_ITERATIONS = 210_000;

/**
 * Which gate an unlock attempt was made at.
 *
 * Passed in rather than inferred, because the three are the same two functions used for genuinely
 * different things and the numbers only mean something apart. `lock_screen` is the whole app
 * refusing to open — a failure there is someone locked out of their own diary. `delete_account` is
 * a re-authentication in front of an irreversible action, where a *high* failure rate is the system
 * working. `settings` is someone changing the lock they already know.
 */
export type LockContext = 'lock_screen' | 'settings' | 'delete_account';

/* What the lock reports.
 *
 * Outcomes only, and never the passcode, the hash, the salt or the iteration count — the whole
 * point of this module is that those do not leave the device, and a telemetry pipeline is exactly
 * the kind of place they would leak to without anyone noticing.
 *
 * Volume is negligible: this fires when a person unlocks their diary, a handful of times a day at
 * most, which is why none of it is sampled. */
function reportUnlock(
  method: 'passcode' | 'biometric',
  context: LockContext,
  ok: boolean,
  reason?: string,
): void {
  trackEvent('app_lock_unlock', { method, context, ok, reason });
}

/**
 * The plugin's own name for why biometry didn't happen.
 *
 * Read off the thrown value rather than imported as a type: `BiometryError.code` is a string enum
 * (`userCancel`, `biometryLockout`, `biometryNotEnrolled`, `authenticationFailed`, …) and the
 * distinctions are the entire value of this event — "the user pressed cancel" and "the sensor has
 * locked itself out after five bad fingers" are the same `false` today, and only one of them means
 * the fast path is broken. Defensive because a plugin upgrade must not be able to break unlocking.
 */
function biometryFailureReason(err: unknown): string {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === 'string' ? code : 'unknown';
}

/** How long the app may sit in the background before it locks again. */
export const GRACE_CHOICES = [0, 60, 300, 900] as const;
export type GraceSeconds = (typeof GRACE_CHOICES)[number];

/**
 * What a lock starts out as, and what a config missing the field falls back to.
 *
 * A minute rather than zero: switching apps to check the address you are writing about, or
 * answering a notification, is a normal part of using a diary, and a lock that demands a passcode
 * for every one of those gets turned off — which protects nothing at all. Zero is still one of the
 * choices for anyone who wants it.
 */
export const DEFAULT_GRACE_SECONDS: GraceSeconds = 60;

export interface LockConfig {
  /** Base64 PBKDF2 hash of the passcode. */
  hash: string;
  /** Base64 random salt, generated once per passcode. */
  salt: string;
  iterations: number;
  /** Offer the device's biometry before the passcode field. Native only. */
  biometrics: boolean;
  graceSeconds: GraceSeconds;
}

const encoder = new TextEncoder();

const toBase64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));

/**
 * PBKDF2-SHA-256, the same parameters used to verify. Deliberately slow: a passcode is short
 * enough that the only thing standing between it and a brute force is how long each guess costs.
 */
async function derive(passcode: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey('raw', encoder.encode(passcode), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations, hash: 'SHA-256' },
    key,
    256,
  );
  return toBase64(new Uint8Array(bits));
}

function read(): LockConfig | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<LockConfig>;
    // A half-written or hand-edited blob must fail closed *as unlocked* rather than lock the user
    // out of their own diary with a hash nothing can match.
    if (!parsed.hash || !parsed.salt || !parsed.iterations) return null;
    return {
      hash: parsed.hash,
      salt: parsed.salt,
      iterations: parsed.iterations,
      biometrics: parsed.biometrics ?? false,
      graceSeconds: parsed.graceSeconds ?? DEFAULT_GRACE_SECONDS,
    };
  } catch {
    return null;
  }
}

/* Config and locked-ness are one store, so a component re-renders on either. */
interface LockState {
  config: LockConfig | null;
  locked: boolean;
}

let state: LockState = { config: read(), locked: read() !== null };
const listeners = new Set<() => void>();

const emit = () => {
  for (const listener of listeners) listener();
};

const setState = (next: Partial<LockState>) => {
  state = { ...state, ...next };
  emit();
};

const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

export const getLockState = (): LockState => state;
export const useLockState = (): LockState =>
  useSyncExternalStore(subscribe, getLockState, getLockState);

export const isLockEnabled = () => state.config !== null;

function write(config: LockConfig | null) {
  try {
    if (config) localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private-mode storage failures shouldn't lose the in-memory change.
  }
  setState({ config });
}

/** Turn the lock on, or replace the passcode. Always mints a fresh salt. */
export async function setPasscode(passcode: string): Promise<void> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(passcode, salt, PBKDF2_ITERATIONS);
  write({
    hash,
    salt: toBase64(salt),
    iterations: PBKDF2_ITERATIONS,
    biometrics: state.config?.biometrics ?? false,
    graceSeconds: state.config?.graceSeconds ?? DEFAULT_GRACE_SECONDS,
  });
  setState({ locked: false });
}

export async function verifyPasscode(passcode: string, context: LockContext): Promise<boolean> {
  const config = state.config;
  // No lock set: a vacuous pass, not an unlock. Reporting it would put a permanent `ok: true`
  // baseline under the success rate of every device that has never turned the lock on.
  if (!config) return true;
  const salt = Uint8Array.from(atob(config.salt), (c) => c.charCodeAt(0));
  const hash = await derive(passcode, salt, config.iterations);
  // Both operands are hashes of the same fixed length, and an attacker able to time this already
  // has the device — so a constant-time compare would be theatre.
  const ok = hash === config.hash;
  reportUnlock('passcode', context, ok);
  return ok;
}

/** Switching the lock off requires proving you can already pass it. */
export async function disableLock(passcode: string): Promise<boolean> {
  if (!(await verifyPasscode(passcode, 'settings'))) return false;
  write(null);
  setState({ locked: false });
  trackEvent('app_lock_disabled');
  return true;
}

export function updateLockOptions(patch: Partial<Pick<LockConfig, 'biometrics' | 'graceSeconds'>>) {
  if (!state.config) return;
  write({ ...state.config, ...patch });
}

export const unlock = () => setState({ locked: false });
export const lockNow = () => {
  if (state.config) setState({ locked: true });
};

// --- Biometry ---------------------------------------------------------------------------------

/** Whether this device can offer biometry at all. False on the web, where there is no plugin. */
export async function biometryAvailable(): Promise<boolean> {
  if (!isNative) return false;
  try {
    return (await BiometricAuth.checkBiometry()).isAvailable;
  } catch {
    return false;
  }
}

/** Prompt for biometry. Resolves false on any refusal or failure — the passcode is always behind it. */
export async function promptBiometrics(reason: string, context: LockContext): Promise<boolean> {
  // Not an attempt: there is no plugin on the web, so the caller falls straight through to the
  // passcode field. Counting these would make biometry look broken on every browser.
  if (!isNative) return false;
  try {
    await BiometricAuth.authenticate({ reason, allowDeviceCredential: true });
    reportUnlock('biometric', context, true);
    return true;
  } catch (err) {
    reportUnlock('biometric', context, false, biometryFailureReason(err));
    return false;
  }
}

// --- When to re-lock --------------------------------------------------------------------------

/* Backgrounding starts a clock rather than locking outright: re-authenticating every time a
   notification is glanced at would make the lock the thing the user turns off — which is why the
   clock starts at DEFAULT_GRACE_SECONDS rather than zero. `graceSeconds: 0` is still offered for
   anyone who wants exactly that. */
let hiddenAt: number | null = null;

export function initAppLock() {
  const onHidden = () => {
    hiddenAt = Date.now();
  };
  const onVisible = () => {
    if (!state.config || state.locked || hiddenAt === null) return;
    const away = (Date.now() - hiddenAt) / 1000;
    const grace = state.config.graceSeconds;
    hiddenAt = null;
    if (away < grace) return;
    setState({ locked: true });
    /* The grace period is a guess — DEFAULT_GRACE_SECONDS is 60 because the comment above argues a
       lock that demands a passcode for every glance at a notification is a lock people switch off.
       This is the only way to find out whether that guess is right: `away_s` clustered just above
       `grace_s` means the app is re-locking on exactly the quick app-switches the default was
       chosen to tolerate, and the default is too short. */
    trackEvent('app_lock_engaged', { away_s: Math.round(away), grace_s: grace });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
    else onVisible();
  });
  // A desktop browser can lose focus without the tab being hidden (another window on top), which
  // is the same exposure as backgrounding the app.
  window.addEventListener('pagehide', onHidden);
}
