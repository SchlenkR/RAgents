import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import ts from "typescript";
import { canonicalTypeScriptBuildContract as canonical } from "./build-contract.ts";
export { canonicalTypeScriptBuildContract, typeScriptBuildContractHash } from "./build-contract.ts";

const VIRTUAL_ROOT = "/";
const OUTPUT_ROOT = "/__ragents__/out";
const nodeTypeRoot = () => path.dirname(path.dirname(createRequire(import.meta.url).resolve("@types/node/package.json")));

export interface VirtualTypeScriptFile {
    readonly fileName: string;
    readonly text: string;
}

export interface VirtualTypeScriptLibrary {
    readonly fileName: string;
    readonly path: string;
}

export type VirtualTypeScriptEmit = "none" | "browser" | "node";

export interface CompileVirtualTypeScriptRequest {
    readonly sources: readonly VirtualTypeScriptFile[];
    readonly declarations?: readonly VirtualTypeScriptFile[];
    readonly libraries?: readonly VirtualTypeScriptLibrary[];
    readonly contract?: string;
    readonly emit?: VirtualTypeScriptEmit;
    readonly rootDirectory?: string;
}

export type VirtualTypeScriptDiagnosticCategory = "warning" | "error" | "suggestion" | "message";

export interface VirtualTypeScriptPosition {
    readonly line: number;
    readonly column: number;
}

export interface VirtualTypeScriptDiagnostic {
    readonly code: number;
    readonly category: VirtualTypeScriptDiagnosticCategory;
    readonly message: string;
    readonly fileName?: string;
    readonly start?: VirtualTypeScriptPosition;
    readonly end?: VirtualTypeScriptPosition;
}

export interface VirtualTypeScriptCompilation {
    readonly valid: boolean;
    readonly compilationHash: string;
    readonly diagnostics: readonly VirtualTypeScriptDiagnostic[];
    readonly emittedFiles: readonly VirtualTypeScriptFile[];
}

type VirtualFileKind = "source" | "declaration";

interface NormalizedFile extends VirtualTypeScriptFile {
    readonly kind: VirtualFileKind;
}

interface LoadedLibrary extends NormalizedFile {
    readonly hash: string;
}

const compareText = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;

const MAX_CACHED_SOURCE_FILES = 256;
const parsedFiles = new Map<string, ts.SourceFile>();
const fileHashes = new WeakMap<ts.SourceFile, string>();
let previousProgram: ts.Program | undefined;

const textHash = (text: string): string => createHash("sha256").update(text).digest("hex");

const cachedSourceFile = (key: string, parse: () => ts.SourceFile): ts.SourceFile => {
    const cached = parsedFiles.get(key);
    if (cached) {
        parsedFiles.delete(key);
        parsedFiles.set(key, cached);
        return cached;
    }
    const file = parse();
    parsedFiles.set(key, file);
    while (parsedFiles.size > MAX_CACHED_SOURCE_FILES) parsedFiles.delete(parsedFiles.keys().next().value!);
    return file;
};

const hashOf = (file: ts.SourceFile): string => {
    const known = fileHashes.get(file);
    if (known) return known;
    const hash = textHash(file.text);
    fileHashes.set(file, hash);
    return hash;
};

const requestLibraryCache = new Map<string, { readonly text: string; readonly hash: string }>();

const libraryContent = (source: string): { readonly text: string; readonly hash: string } => {
    const cached = requestLibraryCache.get(source);
    if (cached) return cached;
    const text = readFileSync(source, "utf8");
    const content = { text, hash: textHash(text) };
    requestLibraryCache.set(source, content);
    return content;
};

const normalizeFileName = (fileName: string, kind: VirtualFileKind): string => {
    if (!fileName.trim() || fileName.includes("\0") || fileName.includes("\\")) {
        throw new TypeError(`Ungültiger virtueller TypeScript-Pfad: ${fileName}`);
    }

    const normalized = path.posix.normalize(`/${fileName}`).replace(/^\/+(?=.)/, "/");
    if (normalized === VIRTUAL_ROOT || normalized.startsWith("/__ragents__/")) {
        throw new TypeError(`Reservierter virtueller TypeScript-Pfad: ${fileName}`);
    }

    if (kind === "source" && ((!normalized.endsWith(".ts") && !normalized.endsWith(".tsx")) || normalized.endsWith(".d.ts"))) {
        throw new TypeError(`Virtuelle TypeScript-Quelle muss auf .ts oder .tsx enden: ${fileName}`);
    }
    if (kind === "declaration" && !normalized.endsWith(".d.ts")) {
        throw new TypeError(`Virtuelle TypeScript-Deklaration muss auf .d.ts enden: ${fileName}`);
    }

    return normalized;
};

const normalizedFiles = (
    files: readonly VirtualTypeScriptFile[],
    kind: VirtualFileKind,
): NormalizedFile[] => files.map((file) => ({
    fileName: normalizeFileName(file.fileName, kind),
    text: file.text,
    kind,
})).sort((left, right) => compareText(left.fileName, right.fileName));

const assertUniqueFiles = (files: readonly NormalizedFile[]): void => {
    const names = new Set<string>();
    for (const file of files) {
        if (names.has(file.fileName)) throw new TypeError(`Virtuelle Datei doppelt deklariert: ${file.fileName}`);
        names.add(file.fileName);
    }
};

const compilerOptions = (emit: VirtualTypeScriptEmit): ts.CompilerOptions => ({
    allowJs: false,
    alwaysStrict: true,
    exactOptionalPropertyTypes: false,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.Bundler,
    newLine: ts.NewLineKind.LineFeed,
    noEmit: emit === "none",
    noEmitOnError: true,
    noImplicitAny: true,
    noImplicitReturns: false,
    noUncheckedIndexedAccess: true,
    outDir: OUTPUT_ROOT,
    removeComments: false,
    rootDir: VIRTUAL_ROOT,
    skipLibCheck: true,
    sourceMap: false,
    strict: true,
    strictNullChecks: true,
    target: ts.ScriptTarget.ES2022,
    useDefineForClassFields: true,
    ...(emit === "browser" ? { jsx: ts.JsxEmit.React, types: [] } : { types: ["node"], typeRoots: [nodeTypeRoot()] }),
});

const compilationHashOf = (
    sources: readonly NormalizedFile[],
    declarations: readonly NormalizedFile[],
    libraries: readonly LoadedLibrary[],
    options: ts.CompilerOptions,
    contract: string | undefined,
): string => createHash("sha256").update(canonical({
    apiVersion: 1,
    compilerOptions: options,
    contract: contract ?? null,
    declarations: declarations
        .map(({ fileName, text }) => ({ fileName, text }))
        .sort((left, right) => compareText(left.fileName, right.fileName)),
    ...(libraries.length > 0 ? {
        libraries: libraries
            .map(({ fileName, hash }) => ({ fileName, hash }))
            .sort((left, right) => compareText(left.fileName, right.fileName)),
    } : {}),
    sources: sources
        .map(({ fileName, text }) => ({ fileName, text }))
        .sort((left, right) => compareText(left.fileName, right.fileName)),
    typescriptVersion: ts.version,
})).digest("hex");

const categoryOf = (category: ts.DiagnosticCategory): VirtualTypeScriptDiagnosticCategory => {
    switch (category) {
        case ts.DiagnosticCategory.Warning: return "warning";
        case ts.DiagnosticCategory.Error: return "error";
        case ts.DiagnosticCategory.Suggestion: return "suggestion";
        case ts.DiagnosticCategory.Message: return "message";
    }
};

const positionOf = (file: ts.SourceFile, offset: number): VirtualTypeScriptPosition => {
    const position = file.getLineAndCharacterOfPosition(offset);
    return { line: position.line + 1, column: position.character + 1 };
};

const structuredDiagnostic = (diagnostic: ts.Diagnostic): VirtualTypeScriptDiagnostic => {
    const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, "\n");
    if (!diagnostic.file || diagnostic.start === undefined) {
        return { code: diagnostic.code, category: categoryOf(diagnostic.category), message };
    }

    const start = positionOf(diagnostic.file, diagnostic.start);
    const end = positionOf(diagnostic.file, diagnostic.start + (diagnostic.length ?? 0));
    return {
        code: diagnostic.code,
        category: categoryOf(diagnostic.category),
        message,
        fileName: diagnostic.file.fileName,
        start,
        end,
    };
};

const diagnosticsOf = (diagnostics: readonly ts.Diagnostic[]): VirtualTypeScriptDiagnostic[] => {
    const unique = new Map<string, VirtualTypeScriptDiagnostic>();
    for (const diagnostic of diagnostics.map(structuredDiagnostic)) {
        const key = canonical(diagnostic);
        if (!unique.has(key)) unique.set(key, diagnostic);
    }
    return [...unique.values()].sort((left, right) =>
        compareText(left.fileName ?? "", right.fileName ?? "")
        || (left.start?.line ?? 0) - (right.start?.line ?? 0)
        || (left.start?.column ?? 0) - (right.start?.column ?? 0)
        || left.code - right.code
        || compareText(left.message, right.message));
};

export const compileVirtualTypeScript = (
    request: CompileVirtualTypeScriptRequest,
): VirtualTypeScriptCompilation => {
    if (request.sources.length === 0) throw new TypeError("Mindestens eine TypeScript-Quelle ist erforderlich.");
    const emit = request.emit ?? "none";
    if (!["none", "browser", "node"].includes(emit)) throw new TypeError(`Unbekannter TypeScript-Emitmodus: ${String(emit)}`);
    const sources = normalizedFiles(request.sources, "source");
    const declarations = normalizedFiles(request.declarations ?? [], "declaration");
    const libraries: LoadedLibrary[] = (request.libraries ?? []).map((library) => ({
        fileName: normalizeFileName(library.fileName, "declaration"),
        kind: "declaration" as const,
        ...libraryContent(library.path),
    })).sort((left, right) => compareText(left.fileName, right.fileName));
    assertUniqueFiles([...sources, ...declarations, ...libraries]);
    const root = path.resolve(request.rootDirectory ?? path.join(process.cwd(), ".ragents-typescript"));
    const output = path.join(root, ".compiled");
    const options = { ...compilerOptions(emit), rootDir: root, outDir: output };
    const absolute = (name: string) => path.join(root, name.slice(1));
    const files = new Map([...sources, ...declarations, ...libraries].map((file) => [absolute(file.fileName), file]));
    const emitted = new Map<string, string>();
    const host = ts.createCompilerHost(options, true);
    const read = host.readFile.bind(host);
    const exists = host.fileExists.bind(host);
    const directoryExists = host.directoryExists?.bind(host);
    const directories = host.getDirectories?.bind(host);
    host.readFile = (name) => files.get(path.resolve(name))?.text ?? read(name);
    host.fileExists = (name) => files.has(path.resolve(name)) || exists(name);
    host.directoryExists = (name) => [...files.keys()].some((file) => file.startsWith(`${path.resolve(name)}/`)) || directoryExists?.(name) === true;
    host.getDirectories = (name) => [...new Set([
        ...directories?.(name) ?? [],
        ...[...files.keys()].flatMap((file) => {
            const relative = path.relative(name, file);
            return relative.includes(path.sep) && !relative.startsWith("..") ? [relative.split(path.sep)[0]!] : [];
        }),
    ])];
    host.getCurrentDirectory = () => root;
    host.getSourceFile = (name, languageVersion) => {
        const virtual = files.get(path.resolve(name));
        if (virtual?.kind === "source") return ts.createSourceFile(name, virtual.text, languageVersion, true);
        const text = virtual?.text ?? read(name);
        if (text === undefined) return undefined;
        const key = virtual ? `${name}\0${"hash" in virtual ? virtual.hash : textHash(text)}` : `${name}\0${languageVersion}`;
        return cachedSourceFile(key, () => ts.createSourceFile(name, text, languageVersion, true));
    };
    host.writeFile = (name, text) => emitted.set(path.relative(output, name).split(path.sep).join("/"), text);
    const program = ts.createProgram({ rootNames: [...files.keys()], options, host, ...(previousProgram ? { oldProgram: previousProgram } : {}) });
    previousProgram = program;
    const rawDiagnostics = [...ts.getPreEmitDiagnostics(program)];
    if (emit !== "none") rawDiagnostics.push(...program.emit().diagnostics);
    const diagnostics = diagnosticsOf(rawDiagnostics).map((diagnostic) => diagnostic.fileName && files.has(diagnostic.fileName)
        ? { ...diagnostic, fileName: files.get(diagnostic.fileName)!.fileName }
        : diagnostic);
    const valid = !diagnostics.some((diagnostic) => diagnostic.category === "error");
    const dependencies = program.getSourceFiles().filter((file) => !files.has(file.fileName)).map((file) => ({
        fileName: file.fileName,
        kind: "declaration" as const,
        text: file.text,
        hash: hashOf(file),
    }));
    return {
        valid,
        compilationHash: compilationHashOf(sources, declarations, [...libraries, ...dependencies], options, request.contract),
        diagnostics,
        emittedFiles: valid ? [...emitted].map(([fileName, text]) => ({ fileName, text })).sort((left, right) => compareText(left.fileName, right.fileName)) : [],
    };
};
