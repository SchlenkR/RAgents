const SAFE_ENVIRONMENT_NAMES = [
  "PATH",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TZ",
  "TERM",
  "COLORTERM",
  "NO_COLOR",
  "FORCE_COLOR",
  "TMPDIR",
  "TMP",
  "TEMP",
  "DOTNET_ROOT",
  "DOTNET_CLI_HOME",
  "DOTNET_CLI_TELEMETRY_OPTOUT",
  "DOTNET_NOLOGO",
  "NUGET_XMLDOC_MODE",
  "PNPM_HOME",
  "SSL_CERT_FILE",
  "SSL_CERT_DIR",
  "NODE_EXTRA_CA_CERTS",
  "SystemRoot",
  "SystemDrive",
  "windir",
  "ComSpec",
  "PATHEXT",
  "PROCESSOR_ARCHITECTURE",
  "NUMBER_OF_PROCESSORS",
  "ProgramFiles",
  "ProgramFiles(x86)",
  "ProgramData",
  "APPDATA",
  "LOCALAPPDATA",
  "USERPROFILE",
  "USERNAME",
  "HOMEDRIVE",
  "HOMEPATH",
] as const;

export const safeProcessEnvironment = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
};

/** Die Variablen des umgebenden Editors; ein Kindprozess, der sie erbt, hängt sich an VS Code oder Electron. */
const isEditorVariable = (name: string): boolean => name.startsWith("VSCODE_") || name.startsWith("ELECTRON_");

/** Was eine nicht interaktive Bash von sich aus einliest; über sie käme eine Startdatei des Benutzers in jeden Befehl. */
const BASH_STARTUP_VARIABLES: ReadonlySet<string> = new Set(["BASH_ENV", "ENV"]);

/** Die ganze Umgebung eines Prozesses ohne die Variablen des umgebenden Editors. */
export const editorFreeEnvironment = (source: NodeJS.ProcessEnv): Record<string, string> => Object.fromEntries(Object.entries(source)
  .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !isEditorVariable(entry[0])));

/** Die geerbte Umgebung für Prozesse auf dem eigenen Rechner des Benutzers: alles außer Editor-Variablen und den Startdateien der Bash. */
export const inheritedProcessEnvironment = (source: NodeJS.ProcessEnv): Record<string, string> => Object.fromEntries(
  Object.entries(editorFreeEnvironment(source)).filter(([name]) => !BASH_STARTUP_VARIABLES.has(name)));
