import { ANDROID_PACKAGE_NAME } from '@diary/shared';

/**
 * The Digital Asset Links statement Android fetches to verify this site's App Links.
 *
 * At install time — and periodically after — Android requests
 * `https://<host>/.well-known/assetlinks.json` for every `android:autoVerify` host in the manifest,
 * and checks that it names this package and the certificate the installed APK was signed with. If
 * it does, tapping a link to that host opens the app directly. If it does not, the link still
 * works; Android just shows a chooser, or goes to the browser.
 *
 * So this failing is not an outage, which is exactly what makes it easy to miss: the app keeps
 * working and links quietly stop preferring it. `handleAndroidAppLinksVerification` in Play Console
 * and `adb shell pm get-app-links es.tablerus.diary` are the two places the real answer shows up.
 */

/** SHA-256 fingerprints of every signing certificate whose builds should open these links. */
export function certFingerprints(): string[] {
  return (process.env.ANDROID_CERT_FINGERPRINTS ?? '')
    .split(/[\s,]+/)
    .map((value) => value.trim().toUpperCase())
    .filter(Boolean);
}

/**
 * A fingerprint as `keytool` prints it: 32 hex byte pairs joined by colons.
 *
 * Validated rather than passed through, because every way of getting this value wrong produces the
 * same silent result. Pasting the SHA-1 line instead of the SHA-256 one is the easy mistake — they
 * sit next to each other in `keytool -list -v` output and differ only in length.
 */
const FINGERPRINT = /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/;

export interface AssetLinksResult {
  statements: unknown[];
  /** Fingerprints that were configured but not in `keytool` form; none means all were fine. */
  malformed: string[];
}

export function buildAssetLinks(): AssetLinksResult {
  const configured = certFingerprints();
  const malformed = configured.filter((value) => !FINGERPRINT.test(value));
  const valid = configured.filter((value) => FINGERPRINT.test(value));

  if (!valid.length) return { statements: [], malformed };

  return {
    malformed,
    statements: [
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: {
          namespace: 'android_app',
          package_name: ANDROID_PACKAGE_NAME,
          sha256_cert_fingerprints: valid,
        },
      },
    ],
  };
}
