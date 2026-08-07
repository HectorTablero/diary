import { useEffect, useState } from 'react';
import { getVersionInfo, type VersionInfo } from '@/lib/version';

/** Build identity, quietly, at the very bottom — the thing to ask for first in a bug report.
    On Android the JS bundle can be newer than the APK it runs inside, so show both when
    they've drifted apart. */
export function VersionFooter() {
  const [info, setInfo] = useState<VersionInfo | null>(null);

  useEffect(() => {
    void getVersionInfo().then(setInfo);
  }, []);

  if (!info) return null;
  const parts = [`v${info.version}`];
  if (info.apkVersion && info.apkVersion !== info.version) parts.push(`APK v${info.apkVersion}`);

  return (
    <p className="mt-6 text-center text-xs text-muted-foreground">Diary {parts.join(' · ')}</p>
  );
}
