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

test("ein fertiger Ordner kommt Datei für Datei an seinen Platz: der Ordner bleibt, Unverändertes bleibt, Reste gehen", async () => {
  const root = scratch();
  try {
    const target = writeTree(path.join(root, "dist"), {
      "index.html": "alt\n",
      "assets/app-OLD.js": "alt\n",
      "assets/logo.svg": "<svg/>\n",
      "help/index.html": "Hilfe\n",
      "gone/x.txt": "weg\n",
    });
    const before = { folder: statSync(target).ino, logo: statSync(path.join(target, "assets/logo.svg")).ino };
    const staging = writeTree(path.join(root, ".dist-1"), {
      "index.html": "neu\n",
      "assets/app-NEW.js": "neu\n",
      "assets/logo.svg": "<svg/>\n",
      "help/index.html": "Hilfe\n",
      "gone": "jetzt eine Datei\n",
    });
    await installFolder(staging, target, ["index.html"]);
    assert.equal(statSync(target).ino, before.folder, "das Web eines laufenden Hosts verschwindet nie, auch nicht kurz");
    assert.equal(statSync(path.join(target, "assets/logo.svg")).ino, before.logo, "eine unveränderte Datei bleibt, wie sie ist");
    assert.deepEqual(filesBelow(target), ["assets/app-NEW.js", "assets/logo.svg", "gone", "help/index.html", "index.html"]);
    assert.equal(readFileSync(path.join(target, "index.html"), "utf8"), "neu\n");
    assert.equal(existsSync(staging), false);
    const fresh = writeTree(path.join(root, ".dist-2"), { "index.html": "erst\n" });
    await installFolder(fresh, path.join(root, "neu"), ["index.html"]);
    assert.deepEqual(filesBelow(path.join(root, "neu")), ["index.html"], "ohne Ziel wird der Ordner als Ganzes umbenannt");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("die Sperre lässt parallele Bauläufe nacheinander laufen, auch über Prozesse, und übernimmt die Sperre eines toten Prozesses", async () => {
  const root = scratch();
  try {
    const lock = path.join(root, ".build.lock");
    const order: string[] = [];
    await Promise.all(["a", "b", "c"].map((name) => withLock(lock, async () => {
      order.push(`${name}+`);
      await new Promise((resolve) => setTimeout(resolve, 30));
      order.push(`${name}-`);
    })));
    assert.ok(order.every((entry, index) => index % 2 === 1 || order[index + 1] === entry.replace("+", "-")), `nie zwei zugleich: ${order.join(" ")}`);
    assert.equal(existsSync(lock), false);

    const module = fileURLToPath(new URL("../src/folder-install.ts", import.meta.url));
    const holder = spawn(process.execPath, ["--import", "tsx", "--input-type=module", "-e", `
      const { withLock } = await import(${JSON.stringify(module)});
      await withLock(${JSON.stringify(lock)}, async () => { console.log("gesperrt"); await new Promise((resolve) => setTimeout(resolve, 400)); });
    `], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise<void>((resolve) => holder.stdout!.once("data", () => resolve()));
    const waited = Date.now();
    await withLock(lock, async () => {});
    assert.ok(Date.now() - waited >= 200, "ein zweiter Prozess wartet, bis der erste fertig ist");

    writeFileSync(lock, "999999\n");
    const started = Date.now();
    await withLock(lock, async () => {});
    assert.ok(Date.now() - started < 1000, "die Sperre eines toten Prozesses hält niemanden auf");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
