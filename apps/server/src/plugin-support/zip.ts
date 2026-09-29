import { inflateRawSync } from "node:zlib";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_FILE_HEADER = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const MAX_COMMENT = 0xffff;

export interface ZipEntry {
  readonly name: string;
  readonly content: Buffer;
}

const endOffset = (archive: Buffer): number => {
  const first = Math.max(0, archive.byteLength - MAX_COMMENT - 22);
  for (let offset = archive.byteLength - 22; offset >= first; offset -= 1) {
    if (archive.readUInt32LE(offset) === END_OF_CENTRAL_DIRECTORY) return offset;
  }
  throw new Error("The archive has no end of central directory; it is not a ZIP file");
};

const contentOf = (archive: Buffer, localOffset: number, compression: number, compressedSize: number): Buffer => {
  if (archive.readUInt32LE(localOffset) !== LOCAL_FILE_HEADER) throw new Error(`The local entry at ${localOffset} is missing from the archive`);
  const start = localOffset + 30 + archive.readUInt16LE(localOffset + 26) + archive.readUInt16LE(localOffset + 28);
  const raw = archive.subarray(start, start + compressedSize);
  if (compression === 0) return Buffer.from(raw);
  if (compression === 8) return inflateRawSync(raw);
  throw new Error(`The archive uses the unknown compression ${compression}`);
};

interface DirectoryEntry {
  readonly name: string;
  readonly compression: number;
  readonly compressedSize: number;
  readonly localOffset: number;
}

/** Reads the central directory; Zip64 and encryption are hard errors. */
const readDirectory = (archive: Buffer): readonly DirectoryEntry[] => {
  const end = endOffset(archive);
  const count = archive.readUInt16LE(end + 10);
  const directory = archive.readUInt32LE(end + 16);
  if (count === 0xffff || directory === 0xffffffff) throw new Error("The archive is Zip64; this form is not read");
  const entries: DirectoryEntry[] = [];
  let offset = directory;
  for (let index = 0; index < count; index += 1) {
    if (archive.readUInt32LE(offset) !== CENTRAL_FILE_HEADER) throw new Error(`The directory entry ${index} is missing from the archive`);
    const flags = archive.readUInt16LE(offset + 8);
    const nameLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 46, offset + 46 + nameLength).toString("utf8");
    if ((flags & 0x1) !== 0) throw new Error(`The archive entry ${name} is encrypted`);
    if (!name.endsWith("/")) {
      entries.push({
        name,
        compression: archive.readUInt16LE(offset + 10),
        compressedSize: archive.readUInt32LE(offset + 20),
        localOffset: archive.readUInt32LE(offset + 42),
      });
    }
    offset += 46 + nameLength + archive.readUInt16LE(offset + 30) + archive.readUInt16LE(offset + 32);
  }
  return entries;
};

export const readZipNames = (archive: Buffer): readonly string[] => readDirectory(archive).map((entry) => entry.name);

export const readZipEntries = (archive: Buffer, keep: (name: string) => boolean): readonly ZipEntry[] =>
  readDirectory(archive)
    .filter((entry) => keep(entry.name))
    .map((entry) => ({ name: entry.name, content: contentOf(archive, entry.localOffset, entry.compression, entry.compressedSize) }));
