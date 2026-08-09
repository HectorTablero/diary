/*
 * A ZIP writer for the Markdown export, in place of JSZip.
 *
 * JSZip was 96 kB (28 kB gzipped) — larger than the app's entry chunk — to serve one branch of one
 * dialog: "export several people as separate files". It was already behind a dynamic import, so it
 * never reached first paint, but a lazy chunk is not a free chunk: the service worker precaches
 * every .js in dist/, and `cap sync` copies all of dist/ into the APK. Every user carried it.
 *
 * Nearly all of that size is JSZip's DEFLATE implementation, plus reading formats we never read.
 * The browser already has DEFLATE (CompressionStream), and what remains — the container — is a
 * handful of little-endian records that this file writes directly. It supports exactly what the
 * export needs: a flat list of UTF-8 text files, built in memory, written once.
 *
 * Deliberately absent, and the reason each is safe to omit here: zip64 (an archive of Markdown
 * briefings will not reach 4 GB), data descriptors (sizes are known before the header is written,
 * because nothing is streamed), encryption, and any form of reading.
 *
 * Reference: PKWARE APPNOTE 6.3.10, sections 4.3.7 (local header), 4.3.12 (central directory)
 * and 4.3.16 (end of central directory).
 */

const LOCAL_FILE_HEADER = 0x04034b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY = 0x06054b50;

/** Version needed to extract, ×10: 2.0, which is what DEFLATE requires. */
const VERSION_2_0 = 20;

/* General-purpose bit 11. Without it a filename is read as CP437, and every person whose name has
   an accent in it — the common case in this app, not the exotic one — extracts as mojibake. */
const UTF8_FILENAME = 0x800;

const STORED = 0;
const DEFLATED = 8;

const LOCAL_HEADER_SIZE = 30;
const CENTRAL_HEADER_SIZE = 46;
const END_RECORD_SIZE = 22;

export interface ZipTextFile {
  /** Path inside the archive. Callers own uniqueness: ZIP happily stores the same name twice. */
  name: string;
  content: string;
}

/**
 * Builds a ZIP archive and returns it base64-encoded, which is the form `saveBinaryFile` takes
 * (Capacitor's Filesystem plugin writes base64 directly, and the web path decodes it into a Blob).
 */
export async function zipTextFiles(files: ZipTextFile[]): Promise<string> {
  const encoder = new TextEncoder();
  /* One timestamp for the whole archive rather than one per entry: they are all produced by the
     same click, and a DOS timestamp has two-second resolution anyway. */
  const stamp = dosTimestamp(new Date());

  const body: Uint8Array[] = [];
  const directory: Uint8Array[] = [];
  let offset = 0;

  for (const file of files) {
    const name = encoder.encode(file.name);
    const source = encoder.encode(file.content);
    // CRC and the "uncompressed size" field both describe the original bytes, not the stored ones.
    const crc = crc32(source);
    const compressed = await deflateRaw(source);
    const method = compressed ? DEFLATED : STORED;
    const payload = compressed ?? source;

    const local = new Uint8Array(LOCAL_HEADER_SIZE + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, LOCAL_FILE_HEADER, true);
    localView.setUint16(4, VERSION_2_0, true);
    localView.setUint16(6, UTF8_FILENAME, true);
    localView.setUint16(8, method, true);
    localView.setUint32(10, stamp, true);
    localView.setUint32(14, crc, true);
    localView.setUint32(18, payload.length, true);
    localView.setUint32(22, source.length, true);
    localView.setUint16(26, name.length, true);
    localView.setUint16(28, 0, true); // no extra field
    local.set(name, LOCAL_HEADER_SIZE);

    /* The central directory repeats each local header with the offset it was written at. That
       duplication is the point of the format: an unzipper seeks to the end and reads the index,
       rather than scanning the whole file. */
    const entry = new Uint8Array(CENTRAL_HEADER_SIZE + name.length);
    const entryView = new DataView(entry.buffer);
    entryView.setUint32(0, CENTRAL_FILE_HEADER, true);
    entryView.setUint16(4, VERSION_2_0, true); // version made by (host 0 = MS-DOS: no unix mode)
    entryView.setUint16(6, VERSION_2_0, true); // version needed to extract
    entryView.setUint16(8, UTF8_FILENAME, true);
    entryView.setUint16(10, method, true);
    entryView.setUint32(12, stamp, true);
    entryView.setUint32(16, crc, true);
    entryView.setUint32(20, payload.length, true);
    entryView.setUint32(24, source.length, true);
    entryView.setUint16(28, name.length, true);
    // Bytes 30-38 stay zero: no extra field, no comment, disk 0, no internal attributes.
    entryView.setUint32(38, 0, true); // external attributes: none, so the extractor picks defaults
    entryView.setUint32(42, offset, true);
    entry.set(name, CENTRAL_HEADER_SIZE);

    body.push(local, payload);
    directory.push(entry);
    offset += local.length + payload.length;
  }

  const directorySize = directory.reduce((total, entry) => total + entry.length, 0);
  const end = new Uint8Array(END_RECORD_SIZE);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, END_OF_CENTRAL_DIRECTORY, true);
  // Bytes 4-8 stay zero: single-disk archive, and its directory starts on that same disk.
  endView.setUint16(8, files.length, true);
  endView.setUint16(10, files.length, true);
  endView.setUint32(12, directorySize, true);
  endView.setUint32(16, offset, true); // the directory begins where the file data ended
  endView.setUint16(20, 0, true); // no archive comment

  return toBase64(concat([...body, ...directory, end]));
}

/**
 * Raw DEFLATE via the platform, or null when it isn't worth using — in which case the caller
 * stores the bytes verbatim, which is a valid ZIP either way.
 *
 * Null happens for two reasons. `CompressionStream` is missing (nothing in our support range, but
 * this is a file export: degrading to a larger archive beats throwing away the user's export), and
 * more routinely, DEFLATE grew the input. That is normal for very short files, where the Huffman
 * tables cost more than the redundancy they describe — a briefing for someone with no notes yet.
 */
async function deflateRaw(source: Uint8Array): Promise<Uint8Array | null> {
  if (typeof CompressionStream === 'undefined') return null;
  try {
    const stream = new Blob([source as BlobPart])
      .stream()
      .pipeThrough(new CompressionStream('deflate-raw'));
    const compressed = new Uint8Array(await new Response(stream).arrayBuffer());
    return compressed.length < source.length ? compressed : null;
  } catch {
    return null;
  }
}

/** Modification time and date packed into the one 32-bit field they occupy, MS-DOS style. */
function dosTimestamp(date: Date): number {
  // The epoch is 1980 and there is nowhere to put an earlier year; clamp rather than wrap.
  const year = Math.max(date.getFullYear(), 1980);
  const time = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const day = ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  return ((day << 16) | time) >>> 0;
}

/* Built on first use and kept: 1 kB that only an export pays for, and only once. */
let crcTable: Uint32Array | undefined;

function buildCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let value = i;
    for (let bit = 0; bit < 8; bit++) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[i] = value >>> 0;
  }
  return table;
}

function crc32(bytes: Uint8Array): number {
  crcTable ??= buildCrcTable();
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function concat(parts: Uint8Array[]): Uint8Array {
  const result = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let at = 0;
  for (const part of parts) {
    result.set(part, at);
    at += part.length;
  }
  return result;
}

function toBase64(bytes: Uint8Array): string {
  /* `btoa` wants a string, and `String.fromCharCode(...bytes)` spreads every byte into an argument
     list — which blows the call-stack limit somewhere in the low hundreds of thousands, i.e. at a
     realistic archive size rather than an absurd one. Slicing keeps each call small. */
  const SLICE = 0x8000;
  let binary = '';
  for (let at = 0; at < bytes.length; at += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(at, at + SLICE));
  }
  return btoa(binary);
}
