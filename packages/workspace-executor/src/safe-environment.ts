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

/** The variables of the surrounding editor; a child process that inherits them attaches itself to VS Code or Electron. */
const isEditorVariable = (name: string): boolean => name.startsWith("VSCODE_") || name.startsWith("ELECTRON_");

/** What a non-interactive bash reads in by itself; through it a startup file of the user would get into every command. */
const BASH_STARTUP_VARIABLES: ReadonlySet<string> = new Set(["BASH_ENV", "ENV"]);

/** The whole environment of a process without the variables of the surrounding editor. */
export const editorFreeEnvironment = (source: NodeJS.ProcessEnv): Record<string, string> => Object.fromEntries(Object.entries(source)
  .filter((entry): entry is [string, string] => typeof entry[1] === "string" && !isEditorVariable(entry[0])));

/** The inherited environment for processes on the user's own machine: everything except editor variables and the startup files of the bash. */
export const inheritedProcessEnvironment = (source: NodeJS.ProcessEnv): Record<string, string> => Object.fromEntries(
  Object.entries(editorFreeEnvironment(source)).filter(([name]) => !BASH_STARTUP_VARIABLES.has(name)));
