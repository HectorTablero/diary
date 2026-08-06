/**
 * What kind of connection this device is on, for the "sync on wi-fi only" preference.
 *
 * Read through the Network Information API, which is non-standard but present in every Chromium —
 * and the Android build *is* a Chromium WebView, which is the only place this setting can be
 * turned on from a mobile data plan in the first place. AppLayout already leans on the same object
 * for Save-Data-aware route prefetching.
 *
 * Everything here answers "is this definitely metered", never "is this definitely wi-fi". Where
 * the browser won't say, the answer is no: silently withholding sync because we could not identify
 * the connection would mean a diary that quietly stops backing itself up, which is far worse than
 * a few kilobytes of text over cellular.
 */

interface NetworkInformation {
  /** 'wifi' | 'cellular' | 'ethernet' | 'none' | 'unknown' … — Chromium-only. */
  type?: string;
  /** The user asked the OS to economise on data. */
  saveData?: boolean;
}

const connection = (): NetworkInformation | undefined =>
  (navigator as { connection?: NetworkInformation }).connection;

export function isMeteredConnection(): boolean {
  const info = connection();
  if (!info) return false;
  if (info.saveData) return true;
  return info.type === 'cellular';
}
