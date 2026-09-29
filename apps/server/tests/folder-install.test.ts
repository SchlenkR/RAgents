import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { filesBelow, installFolder, withLock } from "../src/folder-install.ts";

const scratch = (): string => mkdtempSync(path.join(tmpdir(), "ragents-folder-install-"));

const writeTree = (folder: string, files: Readonly<Record<string, string>>): string => {
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(folder, name)), { recursive: true });
    writeFileSync(path.join(folder, name), content);
  }
  return folder;
};

test("a finished folder moves into place file by file: the folder stays, unchanged files stay, leftovers go", async () => {
  const root = scratch();
  try {
    const target = writeTree(path.join(root, "dist"), {
      "index.html": "old\n",
      "assets/app-OLD.js": "old\n",
      "assets/logo.svg": "<svg/>\n",
      "help/index.html": "Help\n",
      "gone/x.txt": "gone\n",
    });
    const before = { folder: statSync(target).ino, logo: statSync(path.join(target, "assets/logo.svg")).ino };
    const staging = writeTree(path.join(root, ".dist-1"), {
      "index.html": "new\n",
      "assets/app-NEW.js": "new\n",
      "assets/logo.svg": "<svg/>\n",
      "help/index.html": "Help\n",
      "gone": "now a file\n",
    });
    await installFolder(staging, target, ["index.html"]);
    assert.equal(statSync(target).ino, before.folder, "the web of a running host never disappears, not even briefly");
    assert.equal(statSync(path.join(target, "assets/logo.svg")).ino, before.logo, "an unchanged file stays as it is");
    assert.deepEqual(filesBelow(target), ["assets/app-NEW.js", "assets/logo.svg", "gone", "help/index.html", "index.html"]);
    assert.equal(readFileSync(path.join(target, "index.html"), "utf8"), "new\n");
    assert.equal(existsSync(staging), false);
    const fresh = writeTree(path.join(root, ".dist-2"), { "index.html": "first\n" });
    await installFolder(fresh, path.join(root, "new"), ["index.html"]);
    assert.deepEqual(filesBelow(path.join(root, "new")), ["index.html"], "without a target the folder is renamed as a whole");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("the lock runs parallel builds one after another, also across processes, and takes over the lock of a dead process", async () => {
  const root = scratch();
  try {
    const lock = path.join(root, ".build.lock");
    const order: string[] = [];
    await Promise.all(["a", "b", "c"].map((name) => withLock(lock, async () => {
      order.push(`${name}+`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push(`${name}-`);
    })));
    assert.ok(order.every((entry, index) => index % 2 === 1 || order[index + 1] === entry.replace("+", "-")), `never two at once: ${order.join(" ")}`);
    assert.equal(existsSync(lock), false);

    const module = fileURLToPath(new URL("../src/folder-install.ts", import.meta.url));
    const holder = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      const { withLock } = await import(${JSON.stringify(module)});
      await withLock(${JSON.stringify(lock)}, async () => { console.log("locked"); await new Promise((resolve) => setTimeout(resolve, 400)); });
    `], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()));
    const waited = Date.now();
    await withLock(lock, async () => {});
    assert.ok(Date.now() - waited >= 200, "a second process waits until the first is done");

    writeFileSync(lock, "999999\n");
    const started = Date.now();
    await withLock(lock, async () => {});
    assert.ok(Date.now() - started < 1000, "the lock of a dead process holds no one up");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
