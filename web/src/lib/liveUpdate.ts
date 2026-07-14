import { App as CapApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { CapacitorUpdater, type BundleInfo } from '@capgo/capacitor-updater';
import { captureError } from './telemetry';
import { isNative } from './native';
import { fetchLatestRelease, isNewerThanRunning, type ReleaseInfo } from './updateCheck';

/* Over-the-air updates for the Android app.

   A live update can only replace the web layer (JS/CSS/HTML). Anything native — a new Capacitor
   plugin, a manifest change — still needs a new APK. `NATIVE_FINGERPRINT_KEY` is how we tell the
   two apart at runtime:

   The fingerprint baked into a bundle says which native shell that bundle needs. The fingerprint
   of the *installed APK* can't be read from a bundle's own constant (after an update the running
   JS is not the JS that shipped with the APK), so we record it on any boot where Capgo reports
   the builtin bundle is live — that JS is, by definition, the one compiled into the APK. It then
   survives live updates in native storage, and Capgo's `resetWhenUpdate` default reverts to
   builtin whenever a new APK is installed, which refreshes it.

   Everything here is best-effort: with no network the app keeps running the bundle it has. */

const NATIVE_FINGERPRINT_KEY = 'native.fingerprint';
const BUILTIN_BUNDLE_ID = 'builtin';

export type UpdateState =
  /** Nothing to do, or the update is downloading silently. */
  | { kind: 'idle' }
  /** A newer release exists but needs a native shell this APK doesn't have: only a new APK can deliver it. */
  | { kind: 'native-required'; version: string; releaseUrl: string };

let state: UpdateState = { kind: 'idle' };
const listeners = new Set<(state: UpdateState) => void>();

/** A bundle that finished downloading and is waiting for the app to go to the background. */
let pending: BundleInfo | null = null;
let checking = false;

export function getUpdateState(): UpdateState {
  return state;
}

export function subscribeToUpdateState(listener: (state: UpdateState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setState(next: UpdateState): void {
  state = next;
  for (const listener of listeners) listener(next);
}

/** The fingerprint of the APK itself, recorded the last time the builtin bundle booted. */
async function getApkFingerprint(): Promise<string | null> {
  const { value } = await Preferences.get({ key: NATIVE_FINGERPRINT_KEY });
  return value;
}

async function recordApkFingerprintIfBuiltin(): Promise<void> {
  const { bundle } = await CapacitorUpdater.current();
  if (bundle.id !== BUILTIN_BUNDLE_ID) return;
  // This JS shipped inside the APK, so its build-time fingerprint is the APK's.
  await Preferences.set({ key: NATIVE_FINGERPRINT_KEY, value: __NATIVE_FINGERPRINT__ });
}

/** Can the APK we are running inside actually execute this bundle? */
async function isCompatible(release: ReleaseInfo): Promise<boolean> {
  if (!release.bundleUrl || !release.fingerprint) return false;
  const apkFingerprint = await getApkFingerprint();
  // Unknown APK fingerprint (first boot after installing an OTA-capable APK never happened, or
  // storage was cleared): refuse rather than risk a bundle the shell cannot run.
  if (!apkFingerprint) return false;
  return release.fingerprint === apkFingerprint;
}

/** Reuses a bundle downloaded in an earlier session that we never got to apply. */
async function findDownloadedBundle(version: string): Promise<BundleInfo | null> {
  const { bundles } = await CapacitorUpdater.list();
  return bundles.find((b) => b.version === version && b.status === 'success') ?? null;
}

async function checkAndDownload(): Promise<void> {
  if (checking || pending || !navigator.onLine) return;
  checking = true;

  try {
    const release = await fetchLatestRelease();
    if (!release || !isNewerThanRunning(release)) return;

    if (!(await isCompatible(release))) {
      // The web layer alone can't carry this one — surface it so the user can install the APK.
      setState({ kind: 'native-required', version: release.version, releaseUrl: release.releaseUrl });
      return;
    }

    pending =
      (await findDownloadedBundle(release.version)) ??
      (await CapacitorUpdater.download({ url: release.bundleUrl!, version: release.version }));
  } catch (err) {
    // Offline, rate-limited, or a failed download: keep running what we have.
    captureError(err, { scope: 'liveUpdate.checkAndDownload' });
  } finally {
    checking = false;
  }
}

/** Swaps in the downloaded bundle while the app is off-screen, so the reload is never seen. */
async function applyPending(): Promise<void> {
  if (!pending) return;
  const bundle = pending;
  pending = null;

  try {
    await CapacitorUpdater.set({ id: bundle.id });
  } catch (err) {
    captureError(err, { scope: 'liveUpdate.applyPending', bundle: bundle.version });
  }
}

/** Call *after* the app has rendered — see notifyAppReady below. */
export async function initLiveUpdate(): Promise<void> {
  if (!isNative) return;

  try {
    // Tells Capgo this bundle boots successfully. A bundle that never reaches this call within
    // `appReadyTimeout` (capacitor.config.ts) is rolled back to the last working one. This is the
    // safety net that makes shipping JS over the air survivable.
    await CapacitorUpdater.notifyAppReady();
    await recordApkFingerprintIfBuiltin();
  } catch (err) {
    captureError(err, { scope: 'liveUpdate.init' });
  }

  CapApp.addListener('appStateChange', ({ isActive }) => {
    if (isActive) void checkAndDownload();
    else void applyPending();
  });

  void checkAndDownload();
}
