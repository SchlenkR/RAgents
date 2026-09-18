import "./host-resolution.js";
import { loadConfigFile } from "./config-file.js";

const startupFailure = (error: unknown): never => {
  const message = error instanceof Error ? error.message : String(error);
  if (error instanceof Error && error.constructor !== Error) console.error(error.stack ?? message);
  console.error(`\nRAgents startet nicht: ${message}`);
  process.exit(1);
};

try {
  if (!process.env.PRODUCT_PROFILE) {
    throw new Error(
      "PRODUCT_PROFILE ist nicht gesetzt. scripts/start.sh <profil> setzt das Profil; "
      + "für pnpm start vorher export PRODUCT_PROFILE=<profil>.",
    );
  }
  await loadConfigFile();
  const { assertServerPortAvailable, assertDataDirectoryIsolated } = await import("./startup.js");
  const { config } = await import("./config.js");
  await assertServerPortAvailable(config.port);
  await assertDataDirectoryIsolated(config.dataDir);
  await import("./server.js");
} catch (error) {
  startupFailure(error);
}
