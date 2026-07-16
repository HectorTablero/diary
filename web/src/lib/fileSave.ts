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

  downloadBlob(new Blob([content], { type: mimeType }), filename);
}

/** Same as saveTextFile, for binary content (e.g. a zip) already base64-encoded — Capacitor's
    Filesystem plugin takes base64 directly when no `encoding` is given, and the web path just
    decodes it into a Blob. */
export async function saveBinaryFile(filename: string, base64Data: string, mimeType: string): Promise<void> {
  if (isNative) {
    const { uri } = await Filesystem.writeFile({ path: filename, data: base64Data, directory: Directory.Cache });
    await Share.share({ url: uri, title: filename });
    return;
  }

  const bytes = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
  downloadBlob(new Blob([bytes], { type: mimeType }), filename);
}

function downloadBlob(blob: Blob, filename: string): void {
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
