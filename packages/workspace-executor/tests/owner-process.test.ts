import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import { processAlive } from "../src/owner-lifetime.mjs";

test("stdin closure exits the owner and removes its child and grandchild", { timeout: 15_000 }, async (t) => {
  const lifetime = new URL("../src/owner-lifetime.mjs", import.meta.url).href;
  const childScript = `
    const { spawn } = require("node:child_process");
    const grandchild = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
    console.log(JSON.stringify({ child: process.pid, grandchild: grandchild.pid }));
    setInterval(() => {}, 1000);
  `;
  const script = `
    import { spawn } from "node:child_process";
    import { watchOwnerLifetime, exitWorkspaceProcess } from ${JSON.stringify(lifetime)};
    spawn(process.execPath, ["-e", ${JSON.stringify(childScript)}], { stdio: ["ignore", "inherit", "inherit"] });
    watchOwnerLifetime({ onStop: () => exitWorkspaceProcess(0) });
  `;
  const owner = spawn(process.execPath, ["--input-type=module", "-e", script], { stdio: ["pipe", "pipe", "pipe"] });
  let output = "";
  let errors = "";
  const children: number[] = [];
  owner.stdout.on("data", (data: Buffer) => { output += data.toString(); });
  owner.stderr.on("data", (data: Buffer) => { errors += data.toString(); });
  t.after(() => {
    owner.kill("SIGKILL");
    for (const pid of children) { try { process.kill(pid, "SIGKILL"); } catch {} }
  });
  for (let attempt = 0; !output.includes("\n") && attempt < 100; attempt += 1) await delay(20);
  assert.ok(output.includes("\n"), errors || "Child process did not start");
  const pids = JSON.parse(output.trim()) as { child: number; grandchild: number };
  children.push(pids.child, pids.grandchild);
  const exited = once(owner, "exit");
  owner.stdin.end();
  const [code] = await exited;
  assert.equal(code, 0, errors);
  for (let attempt = 0; children.some(processAlive) && attempt < 100; attempt += 1) await delay(20);
  assert.ok(children.every((pid) => !processAlive(pid)), "A workspace descendant survived its owner");
});
