import assert from "node:assert/strict";
import test from "node:test";
import { hostEnvironmentSecretKey, isEnvironmentName, missingHostEnvironmentSecrets, parseHostEnvironment, provideMissingSecret, withHostEnvironmentSecrets, withRelaySession } from "../src/settings";

/** Der geführte Weg mit Protokoll: die Reihenfolge der Schritte ist das, worauf es ankommt. */
const guided = (configured: readonly string[], answer: (name: string) => string | undefined) => {
  const steps: string[] = [];
  const names = [...configured];
  const stored = new Map<string, string>();
  const provide = (name: string) => provideMissingSecret(name, {
    names: () => names,
    writeNames: (next) => { steps.push(`einstellung ${next.join(",")}`); names.splice(0, names.length, ...next); return Promise.resolve(); },
    askValue: () => { steps.push(`frage ${name}`); return Promise.resolve(answer(name)); },
    store: (value) => { steps.push(`wert ${name}`); stored.set(name, value); return Promise.resolve(); },
    retry: () => { steps.push("neuer versuch"); return Promise.resolve(); },
  });
  return { steps, names, stored, provide };
};

const secretsOf = (values: Record<string, string>) => ({ get: (key: string) => Promise.resolve(values[key]) });

test("ragents.hostEnvironment führt nur geprüfte Namen von Umgebungsvariablen, doppelte nur einmal", () => {
  assert.deepEqual(parseHostEnvironment(["SERVICE_URL", " SERVICE_TOKEN ", "SERVICE_URL", "_X9"]), ["SERVICE_URL", "SERVICE_TOKEN", "_X9"]);
  assert.deepEqual(parseHostEnvironment(undefined), []);
  assert.deepEqual(parseHostEnvironment([]), []);
  for (const bad of ["text", [""], ["1ABC"], ["A-B"], ["A B"], ["A=1"], [42], [null], [{ name: "A" }]]) {
    assert.throws(() => parseHostEnvironment(bad), /ragents\.hostEnvironment/);
  }
  assert.ok(isEnvironmentName("SERVICE_TOKEN"));
  assert.ok(!isEnvironmentName("2SERVICE"));
  assert.equal(hostEnvironmentSecretKey("SERVICE_TOKEN"), "ragents.host-env:SERVICE_TOKEN");
});

test("die Umgebung eines Hosts: die Werte aus der SecretStorage überlagern das Geerbte", async () => {
  const lines: string[] = [];
  const secrets = secretsOf({
    [hostEnvironmentSecretKey("SERVICE_URL")]: "https://beispiel.invalid",
    [hostEnvironmentSecretKey("SERVICE_TOKEN")]: "abc123",
  });
  const environment = await withHostEnvironmentSecrets({ PATH: "/usr/bin", SERVICE_URL: "geerbt" }, ["SERVICE_URL", "SERVICE_TOKEN"], secrets, (line) => lines.push(line));
  assert.deepEqual(environment, { PATH: "/usr/bin", SERVICE_URL: "https://beispiel.invalid", SERVICE_TOKEN: "abc123" });
  assert.equal(lines.length, 0);
  assert.deepEqual(await withHostEnvironmentSecrets({ PATH: "/usr/bin" }, [], secrets, (line) => lines.push(line)), { PATH: "/usr/bin" });
  assert.equal(lines.length, 0, "ohne konfigurierte Namen bleibt die geerbte Umgebung, wie sie ist");
});

test("ein fehlender Wert steht mit seinem Namen im Protokoll und lässt den Start zu", async () => {
  const lines: string[] = [];
  const secrets = secretsOf({ [hostEnvironmentSecretKey("SERVICE_URL")]: "https://beispiel.invalid" });
  const environment = await withHostEnvironmentSecrets({ PATH: "/usr/bin" }, ["SERVICE_URL", "SERVICE_TOKEN"], secrets, (line) => lines.push(line));
  assert.deepEqual(environment, { PATH: "/usr/bin", SERVICE_URL: "https://beispiel.invalid" });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /SERVICE_TOKEN/);
  assert.ok(!lines.join("\n").includes("beispiel.invalid"), "kein Wert steht im Protokoll");
});

test("eine SecretStorage, die nicht antwortet, verhindert den Start nicht", async () => {
  const lines: string[] = [];
  const environment = await withHostEnvironmentSecrets({ PATH: "/usr/bin" }, ["SERVICE_TOKEN"], { get: () => Promise.reject(new Error("Schlüsselbund verschlossen")) }, (line) => lines.push(line));
  assert.deepEqual(environment, { PATH: "/usr/bin" });
  assert.match(lines.join("\n"), /SERVICE_TOKEN/);
});

test("die Seite Umgebungen bekommt genau die Namen ohne Wert, in der Reihenfolge der Einstellung", async () => {
  const secrets = secretsOf({ [hostEnvironmentSecretKey("SERVICE_URL")]: "https://beispiel.invalid" });
  assert.deepEqual(await missingHostEnvironmentSecrets([], secrets), [], "ohne deklarierten Namen fehlt nichts");
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_URL"], secrets), [], "ein gespeicherter Wert fehlt nicht");
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_URL", "SERVICE_TOKEN"], secrets), ["SERVICE_TOKEN"]);
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_TOKEN", "SERVICE_URL", "OTHER_KEY"], secrets), ["SERVICE_TOKEN", "OTHER_KEY"]);
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_TOKEN"], { get: () => Promise.reject(new Error("Schlüsselbund verschlossen")) }), ["SERVICE_TOKEN"]);
});

test("Vorrang der Umgebung eines verteilten Profils: geerbt, darüber die Sitzung, darüber die SecretStorage", async () => {
  const quiet = () => {};
  const geerbt = { PATH: "/usr/bin", RAGENTS_RELAY_URL: "https://aus-der-shell.example.com" };
  const sitzung = withRelaySession(geerbt, "https://server.example.com", "sitzungstoken");
  assert.deepEqual(sitzung,
    { PATH: "/usr/bin", RAGENTS_RELAY_URL: "https://server.example.com", RAGENTS_RELAY_TOKEN: "sitzungstoken" },
    "eine geerbte Variable verliert gegen die Sitzung");
  assert.deepEqual(await withHostEnvironmentSecrets(sitzung, ["RAGENTS_RELAY_URL", "RAGENTS_RELAY_TOKEN"], secretsOf({}), quiet), sitzung,
    "ohne gespeicherten Wert bleibt es bei der Sitzung");
  assert.deepEqual(await withHostEnvironmentSecrets(sitzung, ["RAGENTS_RELAY_URL"],
    secretsOf({ [hostEnvironmentSecretKey("RAGENTS_RELAY_URL")]: "https://anderes-relay.example.com" }), quiet),
    { PATH: "/usr/bin", RAGENTS_RELAY_URL: "https://anderes-relay.example.com", RAGENTS_RELAY_TOKEN: "sitzungstoken" },
    "ein gespeicherter Wert gewinnt auch über die Sitzung");
});

test("ein fehlender Name kommt erst in die Einstellung, dann kommt der Wert, dann der neue Versuch", async () => {
  const flow = guided([], () => "geheim");
  assert.equal(await flow.provide("SERVICE_TOKEN"), true);
  assert.deepEqual(flow.steps, ["einstellung SERVICE_TOKEN", "frage SERVICE_TOKEN", "wert SERVICE_TOKEN", "neuer versuch"]);
  assert.deepEqual(flow.names, ["SERVICE_TOKEN"]);
  assert.equal(flow.stored.get("SERVICE_TOKEN"), "geheim");
});

test("steht der Name schon in ragents.hostEnvironment, bleibt die Einstellung, wie sie ist", async () => {
  const flow = guided(["SERVICE_URL", "SERVICE_TOKEN"], () => "geheim");
  assert.equal(await flow.provide("SERVICE_TOKEN"), true);
  assert.deepEqual(flow.steps, ["frage SERVICE_TOKEN", "wert SERVICE_TOKEN", "neuer versuch"]);
  assert.deepEqual(flow.names, ["SERVICE_URL", "SERVICE_TOKEN"], "kein Name doppelt und keiner verloren");
});

test("mehrere fehlende Namen nacheinander: jeder kommt hinzu, keiner überschreibt den anderen", async () => {
  const flow = guided(["SERVICE_URL"], (name) => `wert-${name}`);
  await flow.provide("SERVICE_URL");
  await flow.provide("SERVICE_TOKEN");
  await flow.provide("SERVICE_REGION");
  assert.deepEqual(flow.names, ["SERVICE_URL", "SERVICE_TOKEN", "SERVICE_REGION"]);
  assert.deepEqual([...flow.stored], [["SERVICE_URL", "wert-SERVICE_URL"], ["SERVICE_TOKEN", "wert-SERVICE_TOKEN"], ["SERVICE_REGION", "wert-SERVICE_REGION"]]);
  assert.equal(flow.steps.filter((step) => step === "neuer versuch").length, 3, "nach jedem Wert folgt ein Versuch");
});

test("bricht der Benutzer die Eingabe ab, bleibt der Name in der Einstellung und es folgt kein Versuch", async () => {
  const flow = guided([], () => undefined);
  assert.equal(await flow.provide("SERVICE_TOKEN"), false);
  assert.deepEqual(flow.steps, ["einstellung SERVICE_TOKEN", "frage SERVICE_TOKEN"]);
  assert.equal(flow.stored.size, 0);
});
