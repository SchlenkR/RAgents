import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { safeProcessEnvironment } from "@ragents/workspace-executor";

test("profile references, materialized values and provider keys cannot enter a model process through allowed names or additions", async (t) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-private-environment-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const secret = "example-private-environment-value";
  const providerKey = "example-private-provider-key";
  await writeFile(path.join(directory, "ragents.config.private-environment.ts"), `
    const env = name => ({ kind: "environment", name });
    export const config = {
      host: { MODEL_PROVIDERS: [{ id: "example", apiKey: env("LC_CTYPE"), models: [] }] },
      "acme.reader": { LANG: env("COLORTERM"), TERM: { authorization: env("COLORTERM") } },
    };
    export const users = [{ id: "alice", password: env("TZ"), rights: ["*"] }];
  `);
  const script = `
    import { loadConfigFile } from "./src/config-file.ts";
    import { safeProcessEnvironment, workspaceProcessContext, prepareExecutorContribution } from "@ragents/workspace-executor";
    await loadConfigFile(${JSON.stringify(directory)});
    const context = workspaceProcessContext({
      runId: "alice", cwd: ${JSON.stringify(directory)}, root: ${JSON.stringify(directory)},
      home: { home: ${JSON.stringify(directory)} }, logDirectory: ${JSON.stringify(directory)}, hostRoot: undefined,
      additions: { LC_CTYPE: ${JSON.stringify(providerKey)}, COLORTERM: ${JSON.stringify(secret)} },
    });
    let contributionEnvironment;
    prepareExecutorContribution({ plugin: "acme.reader", revision: "example", contribution: machine => {
      contributionEnvironment = machine.processEnvironment("alice");
      return {};
    } }, ${JSON.stringify(directory)});
    console.log(JSON.stringify({ safe: safeProcessEnvironment(process.env), context: context.env, contribution: contributionEnvironment }));
  `;
  const child = spawnSync(process.execPath, ["--import", "tsx", "--input-type=module", "-e", script], {
    cwd: path.resolve(import.meta.dirname, ".."), encoding: "utf8", timeout: 15_000,
    env: { ...safeProcessEnvironment(process.env), PRODUCT_PROFILE: "private-environment", PRODUCT_PROFILE_FILE: "",
      COLORTERM: secret, LC_CTYPE: providerKey, TZ: "example-private-password" },
  });
  assert.equal(child.status, 0, child.stderr);
  const environments = JSON.parse(child.stdout.trim().split("\n").at(-1)!) as Record<string, NodeJS.ProcessEnv>;
  for (const environment of Object.values(environments)) {
    for (const name of ["LANG", "TERM", "COLORTERM", "LC_CTYPE", "TZ", "MODEL_PROVIDERS"]) assert.equal(environment[name], undefined, name);
    assert.ok(environment.PATH);
    assert.doesNotMatch(JSON.stringify(environment), /example-private-/);
  }
  assert.equal(environments.context!.HOME, directory);
  assert.equal(environments.contribution!.RAGENTS_RUN_ID, "alice");
});
