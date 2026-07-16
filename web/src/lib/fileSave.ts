import { Directory, Encoding, Filesystem } from '@capacitor/filesystem';
import { Share } from '@capacitor/share';
import { isNative } from './native';

/* Saving a file out of the app. A plain <a download> blob link doesn't reliably save from an
   Android Capacitor WebView, so native writes to the (transient) cache dir and hands it to the
   share sheet instead — that's the actual persistence step, letting the user pick Drive/Files/
   email/etc. Cache (not Documents) needs no runtime storage permission. */

export async function saveTextFile(filename: string, content: string, mimeType: string): Promise<void> {
  if (isNative) {
    const { uri } = await Filesystem.writeFile({
      path: filename,
      data: content,
      directory: Directory.Cache,
      encoding: Encoding.UTF8,
    });
    await Share.share({ url: uri, title: filename });
    return;
  }

  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
  } finally {
    URL.revokeObjectURL(url);
  }
}
