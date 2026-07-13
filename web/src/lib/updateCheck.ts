import { App as CapApp } from '@capacitor/app';
import { Preferences } from '@capacitor/preferences';
import { isNative } from './native';

const REPO = 'HectorTablero/diary';
const DISMISSED_KEY = 'update.dismissedVersionCode';

export interface UpdateInfo {
  versionCode: number;
  versionName: string;
  releaseUrl: string;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  html_url: string;
  assets: GithubAsset[];
}

function readVersionCode(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value)) return Number(value);
  return null;
}

function getWebVersionCode(): number | null {
  const value = (import.meta as { env?: Record<string, string | undefined> }).env?.VITE_APP_VERSION_CODE;
  return value ? readVersionCode(value) : null;
}

async function getCurrentVersionCode(): Promise<number | null> {
  if (isNative) {
    const { build } = await CapApp.getInfo();
    return readVersionCode(build);
  }
  return getWebVersionCode();
}

/** Compares the running build against the CI-published "latest" GitHub release. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!releaseRes.ok) return null;
  const release = (await releaseRes.json()) as GithubRelease;

  const versionAsset = release.assets.find((a) => a.name === 'version.json');
  if (!versionAsset) return null;

  const versionRes = await fetch(versionAsset.browser_download_url);
  if (!versionRes.ok) return null;
  const versionData = (await versionRes.json()) as Partial<{
    versionCode: unknown;
    versionName: unknown;
  }>;
  const versionCode = readVersionCode(versionData.versionCode);
  const versionName = typeof versionData.versionName === 'string' ? versionData.versionName : null;
  if (versionCode === null || versionName === null) return null;

  const currentVersionCode = await getCurrentVersionCode();
  if (currentVersionCode === null || versionCode <= currentVersionCode) return null;

  const dismissed = (await Preferences.get({ key: DISMISSED_KEY })).value;
  if (dismissed === String(versionCode)) return null;

  return { versionCode, versionName, releaseUrl: release.html_url };
}

export async function refreshWebApp(): Promise<boolean> {
  if (isNative || typeof navigator.serviceWorker === 'undefined') return false;
  const registration = await navigator.serviceWorker.getRegistration();
  if (registration) await registration.update();
  window.location.reload();
  return true;
}

export async function dismissUpdate(versionCode: number): Promise<void> {
  await Preferences.set({ key: DISMISSED_KEY, value: String(versionCode) });
}
