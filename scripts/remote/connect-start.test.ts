import assert from "node:assert/strict";
import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hostWebDirectory, hostWebProblem } from "../../apps/server/src/host-web.ts";
import { buildPlugins } from "../../apps/server/src/plugin-build/build.ts";
import { announcement, assertGreetingServed, GREETING_PLUGIN, isolatedDirectory, profileSource, stopChild, writeFiles } from "../../apps/server/tests/foreign-plugin-fixture.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("ein Server verteilt ein Profil mit einem fremden Bundle; connect holt es in einen leeren Ordner und startet es mit dem Web seines Hosts", { timeout: 180_000 }, async () => {
  const problem = hostWebProblem(hostWebDirectory(root), root, true);
  assert.equal(problem, undefined, `${problem}; vorher pnpm build:web`);
  const directory = isolatedDirectory("ragents-connect-start-");
  const children: ChildProcess[] = [];
  try {
    const source = writeFiles(path.join(directory, "sources", "acme.greeting"), GREETING_PLUGIN);
    const profiles = path.join(directory, "werkstatt");
    const [outcome] = await buildPlugins([source], { out: path.join(profiles, "dist", "plugins"), typecheck: false });
    assert.equal(outcome?.kind, "built", outcome?.kind === "failed" ? outcome.problems.join("\n") : "");
    const builtIns = ["ragents.orchestration", "ragents.workspace", "ragents.product"];
    writeFileSync(path.join(profiles, "ragents.config.werkstatt-client.ts"), profileSource("werkstatt-client", [...builtIns, "./dist/plugins/acme.greeting"]));
    const serverProfile = path.join(profiles, "ragents.config.werkstatt.ts");
    writeFileSync(serverProfile, profileSource("werkstatt", [...builtIns, "ragents.profile-distribution"],
      `"ragents.profile-distribution": { CLIENT_PROFILE_FILE: "./ragents.config.werkstatt-client.ts" },`));

    const environment = { ...process.env, ACME_MODEL_KEY: "kein-echter-schluessel", RAGENTS_DEV: "" };
    const server = spawn(process.execPath, ["--import", "tsx", "src/main.ts", "--port", "0"], {
      cwd: path.join(root, "apps/server"),
      env: { ...environment, PRODUCT_PROFILE: "werkstatt", PRODUCT_PROFILE_FILE: serverProfile, DATA_DIR: path.join(directory, "server-data") },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(server);
    const distributing = await announcement(server, []);

    const home = path.join(directory, "home");
    mkdirSync(home);
    const connectOutput: string[] = [];
    const connect = spawn(process.execPath, ["--import", "tsx", "../../scripts/remote/connect.ts", distributing.url, "--port", "0"], {
      cwd: path.join(root, "apps/server"),
      env: { ...environment, HOME: home, RAGENTS_TOKEN: distributing.token },
      stdio: ["ignore", "pipe", "pipe"],
    });
    children.push(connect);
    const client = await announcement(connect, connectOutput);
    assert.ok(connectOutput.some((line) => line.includes("== Profil werkstatt-client vom Server") && line.includes("(geholt)")), connectOutput.join("\n"));

    const cache = path.join(home, ".local/share/ragents/remote", `127.0.0.1-${new URL(distributing.url).port}`, "werkstatt-client", "profiles");
    const [stand] = readdirSync(cache);
    assert.ok(stand, "connect legt den Stand im leeren Datenordner ab");
    assert.equal(existsSync(path.join(cache, stand, "ragents.config.werkstatt-client.ts")), true);
    assert.equal(existsSync(path.join(cache, stand, "dist/plugins/acme.greeting/ragents-bundle.json")), true, "das fremde Bundle kommt fertig im Archiv");
    assert.equal(existsSync(path.join(cache, stand, "web")), false, "das Archiv trägt kein Web");
    await assertGreetingServed(client, hostWebDirectory(root));
  } finally {
    for (const child of children.reverse()) await stopChild(child);
    rmSync(directory, { recursive: true, force: true });
  }
});
