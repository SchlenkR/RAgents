import {
  Braces,
  File,
  FileArchive,
  FileCode2,
  FileCog,
  FileImage,
  FileTerminal,
  FileText,
  Folder,
  FolderOpen,
  Palette,
  type LucideIcon,
} from "lucide-react";

type FileTone = "blue" | "yellow" | "green" | "teal" | "orange" | "pink" | "violet" | "red" | "muted";

interface FileIconChoice {
  Icon: LucideIcon;
  tone: FileTone;
}

export const fileToneClass: Readonly<Record<FileTone, string>> = {
  blue: "text-info",
  yellow: "text-warning",
  green: "text-success",
  teal: "text-teal",
  orange: "text-[color-mix(in_srgb,var(--warning)_75%,var(--destructive))]",
  pink: "text-[color-mix(in_srgb,var(--destructive)_65%,var(--accent))]",
  violet: "text-primary",
  red: "text-destructive",
  muted: "text-muted-foreground",
};

const byExtension: Readonly<Record<string, FileIconChoice>> = {
  ts: { Icon: FileCode2, tone: "blue" },
  tsx: { Icon: FileCode2, tone: "blue" },
  mts: { Icon: FileCode2, tone: "blue" },
  cts: { Icon: FileCode2, tone: "blue" },
  js: { Icon: FileCode2, tone: "yellow" },
  jsx: { Icon: FileCode2, tone: "yellow" },
  mjs: { Icon: FileCode2, tone: "yellow" },
  cjs: { Icon: FileCode2, tone: "yellow" },
  cs: { Icon: FileCode2, tone: "green" },
  fs: { Icon: FileCode2, tone: "teal" },
  fsx: { Icon: FileCode2, tone: "teal" },
  py: { Icon: FileCode2, tone: "green" },
  json: { Icon: Braces, tone: "yellow" },
  md: { Icon: FileText, tone: "violet" },
  txt: { Icon: FileText, tone: "muted" },
  pdf: { Icon: FileText, tone: "red" },
  html: { Icon: FileCode2, tone: "orange" },
  htm: { Icon: FileCode2, tone: "orange" },
  hbs: { Icon: FileCode2, tone: "orange" },
  css: { Icon: Palette, tone: "pink" },
  png: { Icon: FileImage, tone: "violet" },
  jpg: { Icon: FileImage, tone: "violet" },
  jpeg: { Icon: FileImage, tone: "violet" },
  gif: { Icon: FileImage, tone: "violet" },
  webp: { Icon: FileImage, tone: "violet" },
  svg: { Icon: FileImage, tone: "violet" },
  ico: { Icon: FileImage, tone: "violet" },
  sh: { Icon: FileTerminal, tone: "green" },
  zsh: { Icon: FileTerminal, tone: "green" },
  bash: { Icon: FileTerminal, tone: "green" },
  yml: { Icon: FileCog, tone: "muted" },
  yaml: { Icon: FileCog, tone: "muted" },
  toml: { Icon: FileCog, tone: "muted" },
  ini: { Icon: FileCog, tone: "muted" },
  csproj: { Icon: FileCog, tone: "blue" },
  fsproj: { Icon: FileCog, tone: "teal" },
  sln: { Icon: FileCog, tone: "blue" },
  slnx: { Icon: FileCog, tone: "blue" },
  zip: { Icon: FileArchive, tone: "orange" },
  gz: { Icon: FileArchive, tone: "orange" },
  tar: { Icon: FileArchive, tone: "orange" },
  lock: { Icon: FileCog, tone: "muted" },
};

const byName: Readonly<Record<string, FileIconChoice>> = {
  "package.json": { Icon: Braces, tone: "green" },
  "pnpm-lock.yaml": { Icon: FileCog, tone: "muted" },
  "tsconfig.json": { Icon: Braces, tone: "blue" },
  ".gitignore": { Icon: FileCog, tone: "muted" },
  dockerfile: { Icon: FileCog, tone: "teal" },
};

export const fileIconFor = (name: string, kind: "directory" | "file", open: boolean): FileIconChoice => {
  if (kind === "directory") return { Icon: open ? FolderOpen : Folder, tone: "muted" };
  const named = byName[name.toLowerCase()];
  if (named) return named;
  const extension = name.includes(".") ? name.toLowerCase().split(".").at(-1) ?? "" : "";
  return byExtension[extension] ?? { Icon: File, tone: "muted" };
};
