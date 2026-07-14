import { computeNativeFingerprint } from '../web/scripts/nativeFingerprint.mjs';
import { readVersion, versionCode } from './version.mjs';

/* Prints the release identity as `key=value` lines, ready to append to $GITHUB_OUTPUT.
   Everything downstream — the git tag, the APK versionName/versionCode and the OTA bundle
   filename — is derived from these, so CI and the app can never disagree. */

const version = readVersion();
const lines = [
  `version=${version.version}`,
  `code=${versionCode(version)}`,
  `fingerprint=${computeNativeFingerprint()}`,
];

console.log(lines.join('\n'));
