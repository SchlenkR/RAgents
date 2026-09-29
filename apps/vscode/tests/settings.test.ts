import assert from "node:assert/strict";
import test from "node:test";
import { hostEnvironmentSecretKey, isEnvironmentName, missingHostEnvironmentSecrets, parseHostEnvironment, provideMissingSecret, withHostEnvironmentSecrets, withRelaySession } from "../src/settings";

/** The guided way with a log: the order of the steps is what matters. */
const guided = (configured: readonly string[], answer: (name: string) => string | undefined) => {
  const steps: string[] = [];
  const names = [...configured];
  const stored = new Map<string, string>();
  const provide = (name: string) => provideMissingSecret(name, {
    names: () => names,
    writeNames: (next) => { steps.push(`setting ${next.join(",")}`); names.splice(0, names.length, ...next); return Promise.resolve(); },
    askValue: () => { steps.push(`ask ${name}`); return Promise.resolve(answer(name)); },
    store: (value) => { steps.push(`value ${name}`); stored.set(name, value); return Promise.resolve(); },
    retry: () => { steps.push("retry"); return Promise.resolve(); },
  });
  return { steps, names, stored, provide };
};

const secretsOf = (values: Record<string, string>) => ({ get: (key: string) => Promise.resolve(values[key]) });

test("ragents.hostEnvironment holds only validated names of environment variables, duplicates only once", () => {
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

test("the environment of a host: the values from the SecretStorage override the inherited ones", async () => {
  const lines: string[] = [];
  const secrets = secretsOf({
    [hostEnvironmentSecretKey("SERVICE_URL")]: "https://example.invalid",
    [hostEnvironmentSecretKey("SERVICE_TOKEN")]: "abc123",
  });
  const environment = await withHostEnvironmentSecrets({ PATH: "/usr/bin", SERVICE_URL: "inherited" }, ["SERVICE_URL", "SERVICE_TOKEN"], secrets, (line) => lines.push(line));
  assert.deepEqual(environment, { PATH: "/usr/bin", SERVICE_URL: "https://example.invalid", SERVICE_TOKEN: "abc123" });
  assert.equal(lines.length, 0);
  assert.deepEqual(await withHostEnvironmentSecrets({ PATH: "/usr/bin" }, [], secrets, (line) => lines.push(line)), { PATH: "/usr/bin" });
  assert.equal(lines.length, 0, "without configured names, the inherited environment stays as it is");
});

test("a missing value appears with its name in the log and allows the start", async () => {
  const lines: string[] = [];
  const secrets = secretsOf({ [hostEnvironmentSecretKey("SERVICE_URL")]: "https://example.invalid" });
  const environment = await withHostEnvironmentSecrets({ PATH: "/usr/bin" }, ["SERVICE_URL", "SERVICE_TOKEN"], secrets, (line) => lines.push(line));
  assert.deepEqual(environment, { PATH: "/usr/bin", SERVICE_URL: "https://example.invalid" });
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /SERVICE_TOKEN/);
  assert.ok(!lines.join("\n").includes("example.invalid"), "no value appears in the log");
});

test("a SecretStorage that does not answer does not prevent the start", async () => {
  const lines: string[] = [];
  const environment = await withHostEnvironmentSecrets({ PATH: "/usr/bin" }, ["SERVICE_TOKEN"], { get: () => Promise.reject(new Error("keychain locked")) }, (line) => lines.push(line));
  assert.deepEqual(environment, { PATH: "/usr/bin" });
  assert.match(lines.join("\n"), /SERVICE_TOKEN/);
});

test("the server page gets exactly the names without a value, in the order of the setting", async () => {
  const secrets = secretsOf({ [hostEnvironmentSecretKey("SERVICE_URL")]: "https://example.invalid" });
  assert.deepEqual(await missingHostEnvironmentSecrets([], secrets), [], "without declared names, nothing is missing");
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_URL"], secrets), [], "a stored value is not missing");
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_URL", "SERVICE_TOKEN"], secrets), ["SERVICE_TOKEN"]);
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_TOKEN", "SERVICE_URL", "OTHER_KEY"], secrets), ["SERVICE_TOKEN", "OTHER_KEY"]);
  assert.deepEqual(await missingHostEnvironmentSecrets(["SERVICE_TOKEN"], { get: () => Promise.reject(new Error("keychain locked")) }), ["SERVICE_TOKEN"]);
});

test("precedence of the environment of a distributed profile: inherited, above it the session, above that the SecretStorage", async () => {
  const quiet = () => {};
  const inherited = { PATH: "/usr/bin", RAGENTS_RELAY_URL: "https://from-the-shell.example.com" };
  const session = withRelaySession(inherited, "https://server.example.com", "session-token");
  assert.deepEqual(session,
    { PATH: "/usr/bin", RAGENTS_RELAY_URL: "https://server.example.com", RAGENTS_RELAY_TOKEN: "session-token" },
    "an inherited variable loses against the session");
  assert.deepEqual(await withHostEnvironmentSecrets(session, ["RAGENTS_RELAY_URL", "RAGENTS_RELAY_TOKEN"], secretsOf({}), quiet), session,
    "without a stored value, the session stays");
  assert.deepEqual(await withHostEnvironmentSecrets(session, ["RAGENTS_RELAY_URL"],
    secretsOf({ [hostEnvironmentSecretKey("RAGENTS_RELAY_URL")]: "https://other-relay.example.com" }), quiet),
    { PATH: "/usr/bin", RAGENTS_RELAY_URL: "https://other-relay.example.com", RAGENTS_RELAY_TOKEN: "session-token" },
    "a stored value also wins over the session");
});

test("a missing name goes into the setting first, then comes the value, then the retry", async () => {
  const flow = guided([], () => "secret");
  assert.equal(await flow.provide("SERVICE_TOKEN"), true);
  assert.deepEqual(flow.steps, ["setting SERVICE_TOKEN", "ask SERVICE_TOKEN", "value SERVICE_TOKEN", "retry"]);
  assert.deepEqual(flow.names, ["SERVICE_TOKEN"]);
  assert.equal(flow.stored.get("SERVICE_TOKEN"), "secret");
});

test("if the name is already in ragents.hostEnvironment, the setting stays as it is", async () => {
  const flow = guided(["SERVICE_URL", "SERVICE_TOKEN"], () => "secret");
  assert.equal(await flow.provide("SERVICE_TOKEN"), true);
  assert.deepEqual(flow.steps, ["ask SERVICE_TOKEN", "value SERVICE_TOKEN", "retry"]);
  assert.deepEqual(flow.names, ["SERVICE_URL", "SERVICE_TOKEN"], "no name duplicated and none lost");
});

test("several missing names one after the other: each is added, none overwrites another", async () => {
  const flow = guided(["SERVICE_URL"], (name) => `value-${name}`);
  await flow.provide("SERVICE_URL");
  await flow.provide("SERVICE_TOKEN");
  await flow.provide("SERVICE_REGION");
  assert.deepEqual(flow.names, ["SERVICE_URL", "SERVICE_TOKEN", "SERVICE_REGION"]);
  assert.deepEqual([...flow.stored], [["SERVICE_URL", "value-SERVICE_URL"], ["SERVICE_TOKEN", "value-SERVICE_TOKEN"], ["SERVICE_REGION", "value-SERVICE_REGION"]]);
  assert.equal(flow.steps.filter((step) => step === "retry").length, 3, "each value is followed by an attempt");
});

test("if the user cancels the input, the name stays in the setting and no attempt follows", async () => {
  const flow = guided([], () => undefined);
  assert.equal(await flow.provide("SERVICE_TOKEN"), false);
  assert.deepEqual(flow.steps, ["setting SERVICE_TOKEN", "ask SERVICE_TOKEN"]);
  assert.equal(flow.stored.size, 0);
});

test("zoom accepts percentages between 50 and 200 and rejects invalid settings", async () => {
  const { parseZoomSetting, ZOOM_MAX, ZOOM_MIN } = await import("../src/settings");
  const { readFileSync } = await import("node:fs");
  const schema = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).contributes.configuration.properties["ragents.zoom"];
  assert.deepEqual([schema.minimum, schema.maximum], [ZOOM_MIN, ZOOM_MAX]);
  for (const zoom of [50, 90, 100, 112.5, 125, 200]) assert.equal(parseZoomSetting(zoom), zoom);
  for (const zoom of [undefined, null, "100", false, 49, 201, NaN, Infinity]) assert.throws(() => parseZoomSetting(zoom), /ragents\.zoom/);
});
