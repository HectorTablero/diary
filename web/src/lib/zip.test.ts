import { crc32, inflateRawSync } from 'node:zlib';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { zipTextFiles } from './zip';

/*
 * lib/zip writes the ZIP container by hand, so the only test worth having is one that reads it
 * back with something that shares no code with it. Everything below goes through Node's zlib and a
 * parser written the way a real unzipper works — seek to the end record, read the central
 * directory, follow each entry's offset — rather than re-deriving the byte layout from the source.
 *
 * That distinction matters: a test that trusted the local headers would pass on an archive whose
 * index was wrong, and a wrong index is exactly the failure that produces "the zip is corrupt" in
 * Windows Explorer while every other tool opens it fine.
 */

const END_RECORD_SIZE = 22;

interface ParsedEntry {
  name: string;
  content: string;
  method: number;
  flags: number;
  crc: number;
}

function parseZip(base64: string): ParsedEntry[] {
  const bytes = Buffer.from(base64, 'base64');

  // No archive comment is ever written, so the end record is the last 22 bytes exactly.
  const end = bytes.length - END_RECORD_SIZE;
  expect(bytes.readUInt32LE(end)).toBe(0x06054b50);
  const count = bytes.readUInt16LE(end + 10);
  const directorySize = bytes.readUInt32LE(end + 12);
  let at = bytes.readUInt32LE(end + 16);
  // The directory must end exactly where the end record begins, or something is misaligned.
  expect(at + directorySize).toBe(end);

  const entries: ParsedEntry[] = [];
  for (let i = 0; i < count; i++) {
    expect(bytes.readUInt32LE(at)).toBe(0x02014b50);
    const flags = bytes.readUInt16LE(at + 8);
    const method = bytes.readUInt16LE(at + 10);
    const crc = bytes.readUInt32LE(at + 16);
    const compressedSize = bytes.readUInt32LE(at + 20);
    const size = bytes.readUInt32LE(at + 24);
    const nameLength = bytes.readUInt16LE(at + 28);
    const extraLength = bytes.readUInt16LE(at + 30);
    const commentLength = bytes.readUInt16LE(at + 32);
    const localOffset = bytes.readUInt32LE(at + 42);
    const name = bytes.subarray(at + 46, at + 46 + nameLength).toString('utf8');

    // Follow the index to the file itself, which is the half a broken directory gets wrong.
    expect(bytes.readUInt32LE(localOffset)).toBe(0x04034b50);
    const localNameLength = bytes.readUInt16LE(localOffset + 26);
    const localExtraLength = bytes.readUInt16LE(localOffset + 28);
    const dataAt = localOffset + 30 + localNameLength + localExtraLength;
    const stored = bytes.subarray(dataAt, dataAt + compressedSize);

    const raw = method === 8 ? inflateRawSync(stored) : Buffer.from(stored);
    // The sizes and checksum in the directory have to describe what is actually there.
    expect(raw.length).toBe(size);
    expect(crc32(raw)).toBe(crc);

    entries.push({ name, content: raw.toString('utf8'), method, flags, crc });
    at += 46 + nameLength + extraLength + commentLength;
  }
  return entries;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('zipTextFiles', () => {
  it('round-trips file names and contents', async () => {
    const files = [
      { name: 'Ana.md', content: '# Ana\n\nTalking points go here.\n' },
      { name: 'Bob.md', content: '# Bob\n\n- one\n- two\n' },
    ];
    const entries = parseZip(await zipTextFiles(files));

    expect(entries.map((e) => ({ name: e.name, content: e.content }))).toEqual(files);
  });

  it('preserves non-ASCII names and contents', async () => {
    /* The reason the UTF-8 flag exists. A name written without bit 11 set is read as CP437, and
       these are the names this app actually produces — not edge cases. */
    const files = [
      { name: 'María José.md', content: '# María José\n\nCafé el jueves.\n' },
      { name: '田中さん.md', content: '# 田中さん\n\n打ち合わせ\n' },
    ];
    const entries = parseZip(await zipTextFiles(files));

    expect(entries.map((e) => e.name)).toEqual(['María José.md', '田中さん.md']);
    expect(entries.map((e) => e.content)).toEqual(files.map((f) => f.content));
    for (const entry of entries) expect(entry.flags & 0x800).toBe(0x800);
  });

  it('compresses content that benefits from it', async () => {
    // Repetitive enough that DEFLATE cannot fail to win, so this pins the compressed path.
    const content = '# Repetition\n\n' + 'the same line, over and over\n'.repeat(200);
    const entries = parseZip(await zipTextFiles([{ name: 'long.md', content }]));

    expect(entries[0].method).toBe(8);
    expect(entries[0].content).toBe(content);
  });

  it('stores content that DEFLATE would grow', async () => {
    // A briefing for someone with nothing recorded yet: too short for the Huffman tables to pay off.
    const entries = parseZip(await zipTextFiles([{ name: 'tiny.md', content: '# A\n' }]));

    expect(entries[0].method).toBe(0);
    expect(entries[0].content).toBe('# A\n');
  });

  it('still produces a valid archive without CompressionStream', async () => {
    // The degraded path: a bigger file beats losing the export.
    vi.stubGlobal('CompressionStream', undefined);
    const content = 'x'.repeat(5000);
    const entries = parseZip(await zipTextFiles([{ name: 'plain.md', content }]));

    expect(entries[0].method).toBe(0);
    expect(entries[0].content).toBe(content);
  });

  it('handles an archive large enough to need chunked base64', async () => {
    /* Past the 0x8000-byte slice in toBase64, and past it with content that will not compress
       away below it — the encoder is where a naive String.fromCharCode(...bytes) blows the stack. */
    const content = Array.from({ length: 40_000 }, (_, i) =>
      String.fromCharCode(97 + (i % 26)),
    ).join('');
    const files = Array.from({ length: 4 }, (_, i) => ({ name: `p${i}.md`, content: content + i }));
    const entries = parseZip(await zipTextFiles(files));

    expect(entries.map((e) => e.content)).toEqual(files.map((f) => f.content));
  });

  it('writes a readable archive with no files in it', async () => {
    expect(parseZip(await zipTextFiles([]))).toEqual([]);
  });
});
