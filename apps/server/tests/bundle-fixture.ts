import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { HOST_API_VERSION } from "../src/host-api.ts";
import { BUNDLE_FORMAT, BUNDLE_MANIFEST_FILE, bundleStand, type BundleManifest } from "../src/profile/bundle-manifest.ts";

export const PLUGIN_ENTRY_SOURCE = "export const plugin = { create: () => ({ manifest: { id: \"x\" }, register: () => {} }) };\n";

export interface BundleFixture {
  readonly server?: string;
  readonly manifest?: Readonly<Record<string, unknown>>;
  readonly files?: Readonly<Record<string, string>>;
}

/** Writes a small bundle as the build tool would, without building it; the folder name is the id, the stand covers its files. */
export const writeBundle = (folder: string, fixture: BundleFixture = {}): string => {
  mkdirSync(path.join(folder, "server"), { recursive: true });
  writeFileSync(path.join(folder, "server", "index.js"), fixture.server ?? PLUGIN_ENTRY_SOURCE);
  for (const [name, content] of Object.entries(fixture.files ?? {})) {
    mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    writeFileSync(path.join(folder, name), content);
  }
  const manifest: BundleManifest = {
    format: BUNDLE_FORMAT,
    id: path.basename(folder),
    api: HOST_API_VERSION,
    hostNames: { server: {}, web: {} },
    stand: bundleStand(folder),
    sourceStand: "0".repeat(64),
    server: "server/index.js",
    exports: { server: {}, web: {} },
    uses: [],
    assets: [],
  };
  writeFileSync(path.join(folder, BUNDLE_MANIFEST_FILE), `${JSON.stringify({ ...manifest, ...fixture.manifest }, null, 2)}\n`);
  return folder;
};
