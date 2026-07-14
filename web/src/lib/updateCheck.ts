import { Preferences } from '@capacitor/preferences';
import { compareVersions } from './version';

const REPO = 'HectorTablero/diary';
const DISMISSED_KEY = 'update.dismissedVersion';

/** CI publishes `bundle-<version>-<nativeFingerprint>.zip` beside the APK on every release. */
const BUNDLE_ASSET_PATTERN = /^bundle-(\d+\.\d+\.\d+)-([0-9a-f]+)\.zip$/;

export interface ReleaseInfo {
  /** Version from the release tag, e.g. "2.4.0" (tag `v2.4.0`). */
  version: string;
  releaseUrl: string;
  /** Direct download for the OTA bundle, or null when the release has no bundle asset. */
  bundleUrl: string | null;
  /** Native shell the published bundle was built against, or null when there is no bundle. */
  fingerprint: string | null;
}

interface GithubAsset {
  name: string;
  browser_download_url: string;
}

interface GithubRelease {
  html_url: string;
  tag_name: string;
  assets: GithubAsset[];
}

/* The bundle zip is downloaded by Capgo from *native* code (OkHttp), which is not bound by CORS
   and follows GitHub's asset redirect normally. Only this metadata call goes through fetch, and
   api.github.com sends permissive CORS headers — which is why the release JSON, not the asset,
   is what the webview reads. */
export async function fetchLatestRelease(): Promise<ReleaseInfo | null> {
  if (!navigator.onLine) return null;

  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`);
  if (!res.ok) return null;
  const release = (await res.json()) as GithubRelease;

  const version = /^v?(\d+\.\d+\.\d+)$/.exec(release.tag_name.trim())?.[1];
  if (!version) return null;

  const bundle = (release.assets ?? [])
    .map((asset) => ({ asset, match: BUNDLE_ASSET_PATTERN.exec(asset.name) }))
    .find(({ match }) => match?.[1] === version);

  return {
    version,
    releaseUrl: release.html_url,
    bundleUrl: bundle?.asset.browser_download_url ?? null,
    fingerprint: bundle?.match?.[2] ?? null,
  };
}

/** True when the published release is newer than the bundle currently executing. */
export function isNewerThanRunning(release: ReleaseInfo): boolean {
  return compareVersions(release.version, __APP_VERSION__) > 0;
}

export async function isDismissed(version: string): Promise<boolean> {
  const { value } = await Preferences.get({ key: DISMISSED_KEY });
  return value === version;
}

export async function dismissUpdate(version: string): Promise<void> {
  await Preferences.set({ key: DISMISSED_KEY, value: version });
}
