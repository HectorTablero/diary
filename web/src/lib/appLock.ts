import { BiometricAuth } from '@aparajita/capacitor-biometric-auth';
import { useSyncExternalStore } from 'react';
import { isNative } from './native';

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

/** How long the app may sit in the background before it locks again. */
export const GRACE_CHOICES = [0, 60, 300, 900] as const;
export type GraceSeconds = (typeof GRACE_CHOICES)[number];

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
      graceSeconds: parsed.graceSeconds ?? 0,
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
export const useLockState = (): LockState => useSyncExternalStore(subscribe, getLockState, getLockState);

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
    graceSeconds: state.config?.graceSeconds ?? 0,
  });
  setState({ locked: false });
}

export async function verifyPasscode(passcode: string): Promise<boolean> {
  const config = state.config;
  if (!config) return true;
  const salt = Uint8Array.from(atob(config.salt), (c) => c.charCodeAt(0));
  const hash = await derive(passcode, salt, config.iterations);
  // Both operands are hashes of the same fixed length, and an attacker able to time this already
  // has the device — so a constant-time compare would be theatre.
  return hash === config.hash;
}

/** Switching the lock off requires proving you can already pass it. */
export async function disableLock(passcode: string): Promise<boolean> {
  if (!(await verifyPasscode(passcode))) return false;
  write(null);
  setState({ locked: false });
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
export async function promptBiometrics(reason: string): Promise<boolean> {
  if (!isNative) return false;
  try {
    await BiometricAuth.authenticate({ reason, allowDeviceCredential: true });
    return true;
  } catch {
    return false;
  }
}

// --- When to re-lock --------------------------------------------------------------------------

/* Backgrounding starts a clock rather than locking outright: re-authenticating every time a
   notification is glanced at would make the lock the thing the user turns off. `graceSeconds: 0`
   is still offered for anyone who wants exactly that. */
let hiddenAt: number | null = null;

export function initAppLock() {
  const onHidden = () => {
    hiddenAt = Date.now();
  };
  const onVisible = () => {
    if (!state.config || state.locked || hiddenAt === null) return;
    const away = (Date.now() - hiddenAt) / 1000;
    hiddenAt = null;
    if (away >= state.config.graceSeconds) setState({ locked: true });
  };

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') onHidden();
    else onVisible();
  });
  // A desktop browser can lose focus without the tab being hidden (another window on top), which
  // is the same exposure as backgrounding the app.
  window.addEventListener('pagehide', onHidden);
}
