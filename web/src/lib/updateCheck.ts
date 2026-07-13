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

/** Compares the running build against the CI-published "latest" GitHub release. */
export async function checkForUpdate(): Promise<UpdateInfo | null> {
  if (!isNative) return null;

  const releaseRes = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!releaseRes.ok) return null;
  const release = (await releaseRes.json()) as GithubRelease;

  const versionAsset = release.assets.find((a) => a.name === 'version.json');
  if (!versionAsset) return null;

  const versionRes = await fetch(versionAsset.browser_download_url);
  if (!versionRes.ok) return null;
  const { versionCode, versionName } = (await versionRes.json()) as {
    versionCode: number;
    versionName: string;
  };

  const { build } = await CapApp.getInfo();
  const currentVersionCode = Number(build);
  if (!Number.isFinite(currentVersionCode) || versionCode <= currentVersionCode) return null;

  const dismissed = (await Preferences.get({ key: DISMISSED_KEY })).value;
  if (dismissed === String(versionCode)) return null;

  return { versionCode, versionName, releaseUrl: release.html_url };
}

export async function dismissUpdate(versionCode: number): Promise<void> {
  await Preferences.set({ key: DISMISSED_KEY, value: String(versionCode) });
}
