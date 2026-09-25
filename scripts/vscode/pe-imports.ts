/** Die DLLs, die eine PE-Datei (exe oder dll) beim Laden und verzögert beim ersten Aufruf braucht. */
export interface PeImports {
  readonly imports: readonly string[];
  readonly delayImports: readonly string[];
}

interface Section {
  readonly virtualAddress: number;
  readonly virtualSize: number;
  readonly rawSize: number;
  readonly rawOffset: number;
}

const IMPORT_DIRECTORY = 1;
const DELAY_IMPORT_DIRECTORY = 13;
const IMPORT_DESCRIPTOR_SIZE = 20;
const DELAY_DESCRIPTOR_SIZE = 32;
const SECTION_HEADER_SIZE = 40;

const fail = (name: string, reason: string): never => {
  throw new Error(`${name} ist keine lesbare PE-Datei: ${reason}`);
};

const offsetOf = (sections: readonly Section[], rva: number, name: string): number => {
  const section = sections.find((entry) => rva >= entry.virtualAddress && rva < entry.virtualAddress + Math.max(entry.virtualSize, entry.rawSize));
  return section ? rva - section.virtualAddress + section.rawOffset : fail(name, `die Adresse 0x${rva.toString(16)} liegt in keinem Abschnitt`);
};

const zeroTerminated = (buffer: Buffer, offset: number, name: string): string => {
  const end = buffer.indexOf(0, offset);
  if (end < 0) fail(name, "ein DLL-Name endet nicht");
  return buffer.toString("latin1", offset, end);
};

/** Liest Import- und Delay-Import-Verzeichnis einer PE32- oder PE32+-Datei; die Namen stehen, wie die Datei sie schreibt. */
export const peImports = (buffer: Buffer, name: string): PeImports => {
  if (buffer.length < 0x40 || buffer.toString("latin1", 0, 2) !== "MZ") fail(name, "die MZ-Kennung fehlt");
  const pe = buffer.readUInt32LE(0x3c);
  if (pe + 24 > buffer.length || buffer.toString("latin1", pe, pe + 4) !== "PE\0\0") fail(name, "die PE-Kennung fehlt");
  const sectionCount = buffer.readUInt16LE(pe + 6);
  const optionalSize = buffer.readUInt16LE(pe + 20);
  const optional = pe + 24;
  const magic = buffer.readUInt16LE(optional);
  const wide = magic === 0x20b;
  if (!wide && magic !== 0x10b) fail(name, `unbekannter Optional-Header 0x${magic.toString(16)}`);
  const imageBase = wide ? Number(buffer.readBigUInt64LE(optional + 24)) : buffer.readUInt32LE(optional + 28);
  const directoryCount = buffer.readUInt32LE(optional + (wide ? 108 : 92));
  const directories = optional + (wide ? 112 : 96);
  const sectionTable = optional + optionalSize;
  const sections: readonly Section[] = Array.from({ length: sectionCount }, (_, index) => {
    const header = sectionTable + index * SECTION_HEADER_SIZE;
    return {
      virtualSize: buffer.readUInt32LE(header + 8),
      virtualAddress: buffer.readUInt32LE(header + 12),
      rawSize: buffer.readUInt32LE(header + 16),
      rawOffset: buffer.readUInt32LE(header + 20),
    };
  });
  const directoryRva = (index: number): number => index < directoryCount ? buffer.readUInt32LE(directories + index * 8) : 0;

  const descriptorNames = (rva: number, size: number, nameAt: (offset: number) => number): string[] => {
    if (rva === 0) return [];
    const start = offsetOf(sections, rva, name);
    const names: string[] = [];
    for (let offset = start; offset + size <= buffer.length; offset += size) {
      if (buffer.subarray(offset, offset + size).every((byte) => byte === 0)) return names;
      names.push(zeroTerminated(buffer, offsetOf(sections, nameAt(offset), name), name));
    }
    return fail(name, "ein Importverzeichnis endet nicht");
  };

  const imports = descriptorNames(directoryRva(IMPORT_DIRECTORY), IMPORT_DESCRIPTOR_SIZE, (offset) => buffer.readUInt32LE(offset + 12));
  const delayImports = descriptorNames(directoryRva(DELAY_IMPORT_DIRECTORY), DELAY_DESCRIPTOR_SIZE, (offset) => {
    const nameField = buffer.readUInt32LE(offset + 4);
    return (buffer.readUInt32LE(offset) & 1) === 1 ? nameField : nameField - imageBase;
  });
  return { imports, delayImports };
};
