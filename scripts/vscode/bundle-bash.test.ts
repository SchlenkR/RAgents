import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { BASH_PACKAGES, BASH_TARGETS, bashBundleFolder, dllClosure, isWindowsSystemDll } from "./bundle-bash.ts";
import { peImports, type PeImports } from "./pe-imports.ts";

const SECTION_RVA = 0x1000;
const SECTION_OFFSET = 0x200;
const IMAGE_BASE = 0x400000;

interface SyntheticPe {
  readonly wide: boolean;
  readonly imports: readonly string[];
  readonly delayImports: readonly string[];
  /** Alte Delay-Deskriptoren (Attribut 0) tragen virtuelle Adressen statt RVAs. */
  readonly delayAsVirtualAddress?: boolean;
}

/** Eine minimale PE-Datei mit einem Abschnitt, der Import- und Delay-Import-Verzeichnis samt Namen trägt. */
const syntheticPe = ({ wide, imports, delayImports, delayAsVirtualAddress = false }: SyntheticPe): Buffer => {
  const buffer = Buffer.alloc(SECTION_OFFSET + 0x400);
  const rvaAt = (offsetInSection: number) => SECTION_RVA + offsetInSection;
  buffer.write("MZ", 0, "latin1");
  buffer.writeUInt32LE(0x40, 0x3c);
  buffer.write("PE\0\0", 0x40, "latin1");
  const optionalSize = wide ? 240 : 224;
  buffer.writeUInt16LE(wide ? 0x8664 : 0x14c, 0x44);
  buffer.writeUInt16LE(1, 0x46);
  buffer.writeUInt16LE(optionalSize, 0x54);
  const optional = 0x58;
  buffer.writeUInt16LE(wide ? 0x20b : 0x10b, optional);
  if (wide) buffer.writeBigUInt64LE(BigInt(IMAGE_BASE), optional + 24);
  else buffer.writeUInt32LE(IMAGE_BASE, optional + 28);
  buffer.writeUInt32LE(16, optional + (wide ? 108 : 92));
  const directories = optional + (wide ? 112 : 96);
  buffer.writeUInt32LE(rvaAt(0), directories + 8);
  buffer.writeUInt32LE(rvaAt(0x100), directories + 13 * 8);
  const section = optional + optionalSize;
  buffer.write(".idata", section, "latin1");
  buffer.writeUInt32LE(0x1000, section + 8);
  buffer.writeUInt32LE(SECTION_RVA, section + 12);
  buffer.writeUInt32LE(0x400, section + 16);
  buffer.writeUInt32LE(SECTION_OFFSET, section + 20);
  const names = [...imports, ...delayImports];
  const nameOffset = (index: number) => 0x200 + index * 0x20;
  names.forEach((name, index) => buffer.write(`${name}\0`, SECTION_OFFSET + nameOffset(index), "latin1"));
  imports.forEach((_, index) => buffer.writeUInt32LE(rvaAt(nameOffset(index)), SECTION_OFFSET + index * 20 + 12));
  delayImports.forEach((_, index) => {
    const descriptor = SECTION_OFFSET + 0x100 + index * 32;
    const rva = rvaAt(nameOffset(imports.length + index));
    buffer.writeUInt32LE(delayAsVirtualAddress ? 0 : 1, descriptor);
    buffer.writeUInt32LE(delayAsVirtualAddress ? IMAGE_BASE + rva : rva, descriptor + 4);
  });
  return buffer;
};

test("der PE-Leser nennt Importe und Delay-Importe einer PE32+-Datei in ihrer Schreibweise", () => {
  const file = syntheticPe({ wide: true, imports: ["msys-2.0.dll", "KERNEL32.dll"], delayImports: ["msys-z.dll"] });
  assert.deepEqual(peImports(file, "bash.exe"), { imports: ["msys-2.0.dll", "KERNEL32.dll"], delayImports: ["msys-z.dll"] });
});

test("der PE-Leser liest PE32 und alte Delay-Deskriptoren mit virtuellen Adressen", () => {
  const file = syntheticPe({ wide: false, imports: ["msys-2.0.dll"], delayImports: ["msys-intl-8.dll", "USER32.dll"], delayAsVirtualAddress: true });
  assert.deepEqual(peImports(file, "alt.exe"), { imports: ["msys-2.0.dll"], delayImports: ["msys-intl-8.dll", "USER32.dll"] });
  assert.deepEqual(peImports(syntheticPe({ wide: true, imports: [], delayImports: [] }), "leer.dll"), { imports: [], delayImports: [] });
});

test("keine PE-Datei ist ein benannter Fehler", () => {
  assert.throws(() => peImports(Buffer.from("#!/bin/sh\nexec grep -E \"$@\"\n".padEnd(80, " ")), "egrep"), /egrep ist keine lesbare PE-Datei: die MZ-Kennung fehlt/);
  const broken = syntheticPe({ wide: true, imports: ["a.dll"], delayImports: [] });
  broken.write("XX", 0x40, "latin1");
  assert.throws(() => peImports(broken, "kaputt.exe"), /kaputt.exe ist keine lesbare PE-Datei: die PE-Kennung fehlt/);
});

test("die DLL-Hülle folgt den Importen transitiv, übergeht Windows-Systembibliotheken und bricht bei einer fremden ab", () => {
  const table: Readonly<Record<string, PeImports>> = {
    "grep.exe": { imports: ["msys-2.0.dll", "msys-PCRE-1.dll", "KERNEL32.dll"], delayImports: [] },
    "sed.exe": { imports: ["msys-2.0.dll", "msys-intl-8.dll"], delayImports: ["api-ms-win-core-synch-l1-2-0.dll"] },
    "msys-2.0.dll": { imports: ["KERNEL32.dll", "ntdll.dll"], delayImports: [] },
    "msys-pcre-1.dll": { imports: ["msys-2.0.dll"], delayImports: [] },
    "msys-intl-8.dll": { imports: ["msys-iconv-2.dll", "msys-2.0.dll"], delayImports: [] },
    "msys-iconv-2.dll": { imports: ["msys-2.0.dll"], delayImports: ["USER32.dll"] },
  };
  const importsOf = (file: string): PeImports => {
    const imports = table[file];
    if (!imports) throw new Error(`unbekannt: ${file}`);
    return imports;
  };
  const available = new Map(Object.keys(table).map((name) => [name.toLowerCase(), name] as const));
  assert.deepEqual(dllClosure(["grep.exe", "sed.exe"], importsOf, available), ["msys-2.0.dll", "msys-iconv-2.dll", "msys-intl-8.dll", "msys-pcre-1.dll"]);
  assert.throws(
    () => dllClosure(["tool.exe"], () => ({ imports: ["msys-perl5_42.dll"], delayImports: [] }), available),
    /tool.exe braucht msys-perl5_42.dll; die DLL liegt nicht in usr\/bin und ist keine bekannte Windows-Systembibliothek/,
  );
});

test("Windows-Systembibliotheken erkennt die Hülle an Namen und API-Sets", () => {
  for (const name of ["KERNEL32.dll", "ntdll.dll", "USER32.DLL", "advapi32.dll", "api-ms-win-crt-runtime-l1-1-0.dll", "ext-ms-win-ntuser-window-l1-1-0.dll"]) {
    assert.equal(isWindowsSystemDll(name), true, name);
  }
  for (const name of ["msys-2.0.dll", "libcurl-4.dll", "msys-perl5_42.dll"]) assert.equal(isWindowsSystemDll(name), false, name);
});

test("die Bash bringt die GNU-Werkzeuge mit, aber nie Git, Perl, Editoren, SSH oder Terminals", () => {
  const files = Object.values(BASH_PACKAGES).flat();
  for (const needed of ["bash.exe", "sh.exe", "grep.exe", "sed.exe", "gawk.exe", "find.exe", "xargs.exe", "diff.exe", "patch.exe", "tar.exe", "cygpath.exe", "dos2unix.exe", "file.exe", "which.exe"]) {
    assert.ok(files.includes(needed), needed);
  }
  for (const file of files) assert.doesNotMatch(file, /^(git|perl|vim|gpg|ssh|openssl|mintty|winpty|tig|nano)/i);
  assert.deepEqual(Object.keys(BASH_TARGETS).sort(), ["win32-arm64", "win32-x64"]);
  for (const source of Object.values(BASH_TARGETS)) assert.match(source.sha256, /^[0-9a-f]{64}$/);
  assert.equal(bashBundleFolder("win32-x64", "/ext"), path.join("/ext", "dist", "bash", "win32-x64"));
});
