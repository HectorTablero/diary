import { App as CapApp } from '@capacitor/app';
import { CapacitorUpdater } from '@capgo/capacitor-updater';
import { isNative } from './native';

/* The running bundle's identity.

   On Android the web layer can be replaced over the air, so there are two different versions in
   play and they are both worth knowing:

     - the *bundle* version: what this JS was built as. It is baked in at build time, so the
       running code always reports itself correctly, OTA or not. This is the version that matters
       for "am I up to date".
     - the *APK* version: the native shell the bundle is running inside. Read from the native
       layer, so it is unaffected by a live update. Only interesting for diagnostics and for
       knowing when a new APK is genuinely needed. */

export interface VersionInfo {
  /** Version of the JS bundle that is actually executing. */
  version: string;
  buildTime: string;
  /** Native shell this bundle was compiled against. */
  fingerprint: string;
  platform: 'web' | 'native';
  /** Capgo bundle id — 'builtin' means the JS shipped inside the APK. */
  bundleId?: string;
  /** versionName of the installed APK. */
  apkVersion?: string;
  /** versionCode of the installed APK. */
  apkVersionCode?: number;
}

/** Compares two Major.Minor.Patch strings. Returns >0 when `a` is newer than `b`. */
export function compareVersions(a: string, b: string): number {
  const parse = (v: string) => v.trim().split('.').map((part) => Number.parseInt(part, 10) || 0);
  const [aMajor, aMinor, aPatch] = parse(a);
  const [bMajor, bMinor, bPatch] = parse(b);
  return aMajor - bMajor || aMinor - bMinor || aPatch - bPatch;
}

export async function getVersionInfo(): Promise<VersionInfo> {
  const info: VersionInfo = {
    version: __APP_VERSION__,
    buildTime: __BUILD_TIME__,
    fingerprint: __NATIVE_FINGERPRINT__,
    platform: isNative ? 'native' : 'web',
  };

  if (!isNative) return info;

  // Diagnostics only — never let a plugin hiccup break the page that logs the version.
  try {
    const [{ bundle }, app] = await Promise.all([CapacitorUpdater.current(), CapApp.getInfo()]);
    info.bundleId = bundle.id;
    info.apkVersion = app.version;
    info.apkVersionCode = Number(app.build) || undefined;
  } catch {
    /* ignore */
  }

  return info;
}

let logged = false;

/** One line in the console identifying exactly what is running. Called from the home page. */
export async function logVersion(): Promise<void> {
  if (logged) return;
  logged = true;

  const info = await getVersionInfo();
  const parts = [`Diary v${info.version}`, info.platform];
  if (info.bundleId) parts.push(`bundle ${info.bundleId}`);
  if (info.apkVersion) parts.push(`apk v${info.apkVersion} (${info.apkVersionCode ?? '?'})`);
  parts.push(`native ${info.fingerprint}`, `built ${info.buildTime}`);

  console.info(`[version] ${parts.join(' · ')}`);
}
