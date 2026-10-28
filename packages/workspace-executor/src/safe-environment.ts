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

const privateNames = new Set<string>();
const privateValues = new Set<string>();

export const excludeProcessEnvironment = (source: NodeJS.ProcessEnv): void => {
  for (const [name, value] of Object.entries(source)) {
    privateNames.add(name);
    if (value) privateValues.add(value);
  }
};

export const withoutPrivateEnvironment = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(source).filter(([name, value]) => !privateNames.has(name) && (value === undefined || !privateValues.has(value))));

export const safeProcessEnvironment = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return withoutPrivateEnvironment(environment);
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

const SECRET_NAME_PARTS = new Set([
  "KEY", "KEYS", "TOKEN", "TOKENS", "SECRET", "SECRETS", "PASSWORD", "PASSWD", "PASS", "PAT",
  "CREDENTIAL", "CREDENTIALS", "AUTH", "SESSION", "COOKIE", "PRIVATE",
]);

export const secretFreeProcessEnvironment = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(source).filter(([name, value]) => name.toUpperCase() !== "GPG_AGENT_INFO"
    && !name.toUpperCase().split("_").some((part) => SECRET_NAME_PARTS.has(part))
    && (value === undefined || !/[a-z][a-z0-9+.-]*:\/\/[^\s/@:]*:[^\s/@]*@/i.test(value))));

const ISOLATED_WORKSTATION_NAMES: ReadonlySet<string> = new Set([
  ...SAFE_ENVIRONMENT_NAMES, "SHELL", "USER", "LOGNAME", "LANGUAGE", "TERM_PROGRAM", "CLICOLOR", "EDITOR", "VISUAL", "PAGER",
  "CI", "NODE_ENV", "COMMAND_MODE", "__CF_USER_TEXT_ENCODING", "REQUESTS_CA_BUNDLE", "CURL_CA_BUNDLE",
  "HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "NO_PROXY", "JAVA_HOME", "ANDROID_HOME", "ANDROID_SDK_ROOT", "ANDROID_NDK_HOME",
  "GOROOT", "GOPATH", "GOBIN", "GOFLAGS", "GOPROXY", "GOPRIVATE", "CARGO_HOME", "RUSTUP_HOME", "RUSTUP_TOOLCHAIN",
  "PYENV_ROOT", "VIRTUAL_ENV", "CONDA_PREFIX", "NVM_DIR", "VOLTA_HOME", "BUN_INSTALL", "DENO_DIR", "MANPATH", "INFOPATH",
  "PROGRAMW6432", "COMMONPROGRAMFILES", "COMMONPROGRAMFILES(X86)", "COMPUTERNAME", "OS",
].map((name) => name.toUpperCase()));

const ISOLATED_WORKSTATION_PREFIXES = ["LC_", "DOTNET_", "FNM_", "HOMEBREW_", "COREPACK_", "XDG_"];

/** Isolated workstation commands inherit only toolchain, locale and terminal variables, never secrets with arbitrary names. */
export const isolatedWorkstationEnvironment = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => secretFreeProcessEnvironment(Object.fromEntries(
  Object.entries(source).filter(([name]) => ISOLATED_WORKSTATION_NAMES.has(name.toUpperCase())
    || ISOLATED_WORKSTATION_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)))));

const startupHookNames = new Set([
  "NODE_OPTIONS", "NODE_PATH", "NODE_REPL_EXTERNAL_MODULE", "NODE_V8_COVERAGE", "NODE_REDIRECT_WARNINGS",
  "NODE_COMPILE_CACHE", "NODE_CHANNEL_FD", "NODE_UNIQUE_ID", "GCONV_PATH", "LOCPATH", "NLSPATH",
  "OPENSSL_CONF", "OPENSSL_MODULES", "OPENSSL_ENGINES", "GLIBC_TUNABLES", "JAVA_TOOL_OPTIONS", "JDK_JAVA_OPTIONS", "_JAVA_OPTIONS",
  "BASH_ENV", "ENV", "SHELLOPTS", "BASHOPTS", "BASH_XTRACEFD", "PS4",
]);

export const withoutProcessStartupHooks = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => Object.fromEntries(
  Object.entries(source).filter(([name]) => !startupHookNames.has(name.toUpperCase()) && !/^(?:LD_|DYLD_|BASH_FUNC_)/i.test(name)));
