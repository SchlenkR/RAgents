import "./host-resolution.js";
import { configuredAnonymousUser, configuredUsers, loadConfigFile, missingEnvironmentOf, reportMissingEnvironment } from "./config-file.js";

const startupFailure = (error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.constructor !== Error && missingEnvironmentOf(error) === undefined) console.error(error.stack ?? message);
  console.error(`\nRAgents startet nicht: ${message}`);
  reportMissingEnvironment(error, (line) => console.error(line));
  process.exit(1);
};

/** Startmodi: --stdio (JSON-RPC über stdin und stdout, ohne --port kein HTTP), --port 0 (privater Port mit Ansage auf stdout), --port N. */
const parseArguments = (argv: readonly string[]): { stdio: boolean; port: number | undefined } => {
  let stdio = false;
  let port: number | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--stdio") { stdio = true; continue; }
    if (argument === "--port") {
      const value = Number(argv[index + 1]);
      if (!Number.isInteger(value) || value < 0 || value > 65535) throw new Error(`--port braucht eine ganze Zahl von 0 bis 65535, nicht ${argv[index + 1]}`);
      port = value;
      index += 1;
      continue;
    }
    throw new Error(`Unbekanntes Argument: ${argument} (erlaubt: --stdio, --port <n>)`);
  }
  return { stdio, port };
};

try {
  if (!process.env.PRODUCT_PROFILE) {
    throw new Error(
      "PRODUCT_PROFILE ist nicht gesetzt. scripts/start.sh <profil> setzt das Profil; "
      + "für pnpm start vorher export PRODUCT_PROFILE=<profil>.",
    );
  }
  const arguments_ = parseArguments(process.argv.slice(2));
  if (arguments_.port !== undefined) process.env.PORT = String(arguments_.port);
  if (arguments_.stdio) process.env.RAGENTS_STDIO = "1";
  if (arguments_.stdio && arguments_.port === undefined) process.env.RAGENTS_NO_HTTP = "1";
  await loadConfigFile();
  const { assertServerPortAvailable, assertDataDirectoryIsolated } = await import("./startup.js");
  const { config } = await import("./config.js");
  if (config.port === 0) {
    process.env.RAGENTS_ANNOUNCE = "1";
    if (!process.env.ACCESS_TOKEN && !configuredUsers() && !configuredAnonymousUser()) process.env.ACCESS_TOKEN = globalThis.crypto.randomUUID().replaceAll("-", "");
  } else if (process.env.RAGENTS_NO_HTTP !== "1") {
    await assertServerPortAvailable(config.port);
  }
  await assertDataDirectoryIsolated(config.dataDir);
  await import("./server.js");
} catch (error) {
  startupFailure(error);
}
