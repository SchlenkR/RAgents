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
] as const;

export const safeProcessEnvironment = (source: NodeJS.ProcessEnv): NodeJS.ProcessEnv => {
  const environment: NodeJS.ProcessEnv = {};
  for (const name of SAFE_ENVIRONMENT_NAMES) {
    if (source[name] !== undefined) environment[name] = source[name];
  }
  return environment;
};
