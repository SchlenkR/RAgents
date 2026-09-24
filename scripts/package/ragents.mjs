#!/usr/bin/env node
import { spawn } from "node:child_process";
import { realpathSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ensureHostLinks } from "./host-links.mjs";

const AGENT_CLI = "scripts/agent/agent-cli.ts";

export const commands = {
  connect: "scripts/remote/connect.ts",
  start: "scripts/remote/start.ts",
  provision: "scripts/provision/run-provision.ts",
  "workspace-client": "scripts/workspace-client/run-workspace-client.ts",
  plugin: "scripts/plugin/plugin-cli.ts",
  run: AGENT_CLI,
  send: AGENT_CLI,
  journal: AGENT_CLI,
  stop: AGENT_CLI,
};

const usage = `Verwendung: ragents <befehl> [argumente]

  run <ordner> "<auftrag>"         Host ohne Oberfläche starten, Run anlegen und auf das Ende warten
  send <run> "<text>"              Folgeauftrag im selben Run
  journal <run> [--tools]          Verlauf eines Runs lesen
  stop <run> | stop --host         laufenden Turn abbrechen oder den gemerkten Host beenden
  connect <server-url>             Client-Profil samt Bundles holen und den lokalen Server damit starten
  start <profil|pfad>              ein Profil des Pakets, eine eigene Profildatei oder einen
                                   geholten Stand starten; die Oberfläche kommt fertig mit
  provision [<profil>|--workspace] Werkzeuge der Plugins holen
  workspace-client <server-url>    diesen Rechner als Arbeitsplatz anmelden
  plugin build <ordner...>         Plugin-Quellordner zu Bundles bauen (--out, --watch)
  --help, help                     diese Verwendung

run, send, journal und stop nehmen mit --profile <profil|pfad> ein anderes Profil: einen Namen
neben dem Host oder den Pfad zu einer eigenen ragents.config.<profil>.ts. RAGENTS_PROFILE setzt
dasselbe für alle Befehle einer Shell; verlangt das Profil eine Anmeldung, gehört der
persönliche Token des Benutzers in RAGENTS_TOKEN.
`;

const main = () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const [command, ...rest] = process.argv.slice(2);
  if (command === "--help" || command === "help") {
    console.log(usage);
    process.exit(0);
  }
  const script = command ? commands[command] : undefined;
  if (!script) {
    console.error(command ? `Unbekannter Befehl: ${command}\n\n${usage}` : usage);
    process.exit(1);
  }
  ensureHostLinks(root);
  const passed = script === AGENT_CLI ? [command, ...rest] : rest;
  const child = spawn(process.execPath, ["--import", "tsx", path.join(root, script), ...passed], {
    cwd: path.join(root, "apps/server"),
    env: { ...process.env, RAGENTS_CWD: process.cwd() },
    stdio: "inherit",
  });
  const forward = (signal) => () => child.kill(signal);
  process.on("SIGINT", forward("SIGINT"));
  process.on("SIGTERM", forward("SIGTERM"));
  child.once("error", (error) => {
    console.error(`ragents ${command} konnte nicht gestartet werden: ${error.message}`);
    process.exit(1);
  });
  child.once("exit", (code, signal) => process.exit(code ?? (signal ? 1 : 0)));
};

// npm legt den Befehl als Verknüpfung ab; der Vergleich braucht deshalb den echten Pfad.
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) main();
