import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanelPage } from "../src/panel/PanelPage";
import { RunLine, RunList } from "../src/panel/RunLine";
import { isPanelActionMessage, isPanelStateMessage, type PanelState, type ConnectionView } from "../src/panel/contract";

const render = (state: PanelState) => renderToStaticMarkup(createElement(PanelPage, { state, send: () => {} }));

const connection = (overrides: Partial<ConnectionView> = {}): ConnectionView => ({
  name: "workshop",
  kind: "server",
  address: "http://localhost:4710",
  route: { kind: "server", host: "localhost:4710", localHost: false },
  state: { kind: "connected" },
  runs: [{ id: "run-a", title: "Night bus round", state: "running", pendingActions: 0, updatedAt: Date.now() }],
  entries: [
    { id: "ragents.reference.board", title: "Collection board", description: "A board for ideas", kind: "skill", category: "Mini-apps" },
    { id: "ragents.reference.circle", title: "Discussion circle", description: "Four agents in a circle", kind: "script", category: "Run scripts" },
  ],
  canCreate: true,
  ...overrides,
});

const page = (overrides: Partial<PanelState> = {}): PanelState =>
  ({ theme: "dark", page: "start", connections: [connection()], profileSuggestions: [], ...overrides });

test("Start shows the servers as a block, the recent runs and all templates; the actions are only in the VS Code title bar", () => {
  const html = render(page({
    connections: [
      connection(),
      connection({ name: "core", kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "starting" }, runs: [], entries: [], canCreate: false }),
    ],
  }));
  assert.doesNotMatch(html, /<h1/, "Start has no header of its own, the title is already in the view title bar");
  assert.doesNotMatch(html, /aria-label="Runs"|aria-label="Set up server"|Back to Start/, "no icons the title bar already has");
  assert.match(html, /aria-label="Server"/);
  assert.match(html, />Server</);
  assert.match(html, />workshop</);
  assert.match(html, /title="connected"/);
  assert.match(html, /aria-label="Runs on workshop"[^>]*>/, "a connected server leads to its runs");
  assert.doesNotMatch(html, />Runs<\/span>/, "a connected server carries no action word");
  assert.match(html, /data-cell="route"[^>]*title="localhost:4710"[^>]*>localhost:4710</);
  assert.match(html, />core</);
  assert.match(html, /title="starting"/);
  assert.match(html, /aria-label="core is starting"[^>]*disabled=""/, "a starting server is not clickable");
  assert.match(html, />starting \.\.\.</);
  assert.match(html, /data-cell="route"[^>]*title="local \u00b7 core"[^>]*>local \u00b7 core</);
  assert.match(html, /aria-label="New chat on workshop"/);
  assert.doesNotMatch(html, /aria-label="New chat on core"/, "a server without the start right gets no plus");
  assert.match(html, />Continue</);
  assert.match(html, />Night bus round</);
  assert.match(html, /title="running"/);
  assert.match(html, />New</);
  assert.match(html, />Collection board</);
  assert.match(html, />Discussion circle</);
  assert.doesNotMatch(html, /Search templates/, "Start has no search over the templates");
  assert.doesNotMatch(html, /Disconnect|Stop|Question/);
});

test("New starts for each reachable server with the default template as the marked template, otherwise with New chat; the plus takes the same one", () => {
  const chat = render(page());
  assert.match(chat, />New<span[^>]*>3</, "the New chat template is counted");
  assert.match(chat, /<ul aria-label="Templates"[^>]*><li[^>]*><button[^>]*data-tile="New chat"/, "New chat is the first template");
  assert.match(chat, />No template</);
  assert.match(chat, />New chat</);
  assert.match(chat, />Empty run; the task takes shape in the chat\.</);
  assert.match(chat, /lucide-plus size-3\.5/, "New chat differs only by its icon");
  assert.match(chat, /aria-label="New chat on workshop"/);
  assert.doesNotMatch(chat, />Default</);
  const standard = render(page({ connections: [connection({ defaultEntry: "ragents.reference.circle" })] }));
  assert.match(standard, />New<span[^>]*>2</, "the default does not appear a second time");
  assert.match(standard, /<ul aria-label="Templates"[^>]*><li[^>]*><button[^>]*data-tile="Discussion circle"/, "the default template comes first");
  assert.match(standard, />Default</);
  assert.equal(standard.match(/>Discussion circle</g)?.length, 1);
  assert.doesNotMatch(standard, />New chat</);
  assert.match(standard, /aria-label="New run from Discussion circle on workshop"/);
  const two = render(page({ connections: [connection(), connection({ name: "second", address: "http://localhost:4727", runs: [] })] }));
  assert.match(two, /aria-label="Templates on workshop"[^>]*><li[^>]*><button[^>]*data-tile="New chat"/, "each server starts its group with New chat or the default template");
  assert.match(two, /aria-label="Templates on second"[^>]*><li[^>]*><button[^>]*data-tile="New chat"/);
  const none = render(page({ connections: [connection({ state: { kind: "stopped" }, runs: [] })] }));
  assert.doesNotMatch(none, />New</, "without a reachable server there is no New section");
});

test("on an error the state icon is a button of its own for the message, on the lock for the sign-in, otherwise none", () => {
  const failed = render(page({ connections: [connection({ state: { kind: "failed", message: "no checkout" }, runs: [] })] }));
  assert.match(failed, /aria-haspopup="dialog"[^>]*aria-label="Show error of workshop"/);
  assert.match(failed, /title="failed"/);
  assert.match(failed, /aria-label="Retry workshop"/, "the left part of the chip keeps its action");
  assert.doesNotMatch(failed, /no checkout/, "the message appears only in the opened popover");
  const forbidden = render(page({ connections: [connection({ state: { kind: "forbidden", message: "No access" }, runs: [] })] }));
  assert.match(forbidden, /aria-label="Show error of workshop"/);
  const login = render(page({ connections: [connection({ state: { kind: "login-required", mode: "password" }, runs: [] })] }));
  assert.match(login, /aria-label="Sign-in for workshop"/);
  assert.doesNotMatch(login, /aria-label="Show error of/);
  for (const state of [{ kind: "connected" as const }, { kind: "starting" as const }, { kind: "stopped" as const }]) {
    const html = render(page({ connections: [connection({ state, runs: [] })] }));
    assert.doesNotMatch(html, /aria-label="Show error of|aria-label="Sign-in for/, `${state.kind}: the icon has no action of its own`);
  }
});

test("with two or more servers every run line names its server and New groups the templates per server, with one neither", () => {
  const two = render(page({ connections: [connection(), connection({ name: "second", address: "http://localhost:4727", runs: [] })] }));
  assert.match(two, /Night bus round \(workshop\)/);
  assert.match(two, /<h3[^>]*>[\s\S]*?workshop<\/h3><div[^>]*><ul aria-label="Templates on workshop"/, "group heading per server");
  assert.match(two, /<h3[^>]*>[\s\S]*?second<\/h3><div[^>]*><ul aria-label="Templates on second"/);
  assert.equal(two.match(/data-tile="Collection board"/g)?.length, 2, "the template does not name the server itself");
  const one = render(page());
  assert.doesNotMatch(one, /Night bus round \(workshop\)|<h3/);
  assert.match(one, /<ul aria-label="Templates"/);
});

test("a run line names the cause of a locked run with a warning icon and opens nothing", () => {
  const html = render(page({ connections: [connection({ runs: [
    { id: "run-a", title: "Night bus round", state: "idle", pendingActions: 0, updatedAt: Date.now(), locked: "unsupported journal format 6" },
    { id: "run-b", title: "Balcony", state: "idle", pendingActions: 0, updatedAt: Date.now() },
  ] })] }));
  assert.match(html, /Night bus round<\/span><span class="[^"]*text-destructive[^"]*" title="Locked: unsupported journal format 6">/);
  assert.equal(html.match(/text-destructive[^"]*" title="Locked:/g)?.length, 1, "only the affected run carries the cause");
  assert.match(html, /<button aria-disabled="true"[^>]*title="Night bus round"/);
});

test("Start shows at most five runs and leads to the full list", () => {
  const runs = Array.from({ length: 7 }, (unused, index) => ({
    id: `run-${index}`, title: `Run ${index}`, state: "idle" as const, pendingActions: 0, updatedAt: Date.now() - index * 60_000,
  }));
  const html = render(page({ connections: [connection({ runs })] }));
  assert.match(html, />All 7 runs</);
  assert.match(html, />Run 4</);
  assert.doesNotMatch(html, />Run 5</, "after five lines the Continue block ends");
});

test("a template with a guide is called Set up as in the web app, otherwise Start", () => {
  const html = render(page({ connections: [connection({ entries: [
    { id: "ragents.reference.board", title: "Collection board", description: "A board for ideas", kind: "skill", category: "Mini-apps" },
    { id: "ragents.reference.circle", title: "Discussion circle", description: "Four agents in a circle", kind: "script", category: "Run scripts", guided: true },
  ] })] }));
  assert.match(html, /data-tile="Discussion circle"(?:(?!<\/button>).)*>Set up</s);
  assert.match(html, /data-tile="Collection board"(?:(?!<\/button>).)*>Start</s);
  assert.doesNotMatch(html, /data-tile="Discussion circle"(?:(?!<\/button>).)*>Start</s);
});

test("the left part of the chip carries its action word per state", () => {
  const login = render(page({ connections: [connection({ state: { kind: "login-required", mode: "password" }, runs: [] })] }));
  assert.match(login, /title="sign-in required"/);
  assert.match(login, /aria-label="Sign in to workshop"/);
  assert.match(login, />Sign in<\/span>/);
  const unreachable = render(page({ connections: [connection({ state: { kind: "unreachable", message: "fetch failed" }, runs: [] })] }));
  assert.match(unreachable, /title="unreachable"/);
  assert.match(unreachable, /aria-label="Retry workshop"/);
  assert.match(unreachable, />Retry<\/span>/);
  const stoppedServer = render(page({ connections: [connection({ state: { kind: "stopped" }, runs: [] })] }));
  assert.match(stoppedServer, /aria-label="Connect to workshop"/);
  assert.match(stoppedServer, />Connect<\/span>/);
  const stoppedProfile = render(page({ connections: [connection({ kind: "profile", route: { kind: "profile", profile: "core" }, state: { kind: "stopped" }, runs: [] })] }));
  assert.match(stoppedProfile, /aria-label="Start workshop"/);
  assert.match(stoppedProfile, />Start<\/span>/);
  const distributed = render(page({ connections: [connection({ route: { kind: "server", host: "workshop.example.com", localHost: true }, runs: [] })] }));
  assert.match(distributed, /title="workshop.example.com \u00b7 local"/);
});

test("without a server and with a broken setting Start leads to the servers", () => {
  const empty = render(page({ connections: [] }));
  assert.match(empty, />Add server</);
  const broken = render(page({ connections: [], problem: "ragents.connections must be a list" }));
  assert.match(broken, /role="alert"[^>]*>ragents.connections must be a list</);
});

test("the Runs page brings all runs together and offers search, hiding and selection", () => {
  const html = render(page({
    page: "runs",
    connections: [
      connection({ runs: [{ id: "run-a", title: "Night bus round", state: "waiting", pendingActions: 2, updatedAt: Date.now() }] }),
      connection({ name: "core", runs: [{ id: "run-b", title: "Word game", state: "ended", pendingActions: 0, updatedAt: Date.now() - 3 * 86_400_000 }] }),
    ],
  }));
  assert.match(html, /<h1[^>]*>Runs<\/h1>/);
  assert.match(html, /aria-label="Back to Start"/);
  assert.doesNotMatch(html, /aria-label="Server"/, "the header carries only the title and back");
  assert.match(html, /aria-label="Search runs"/);
  assert.match(html, />Hide ended</);
  assert.match(html, />Select</);
  assert.match(html, />Night bus round</);
  assert.match(html, />Word game</);
  assert.match(html, /title="waiting for input \(2\)"/);
  assert.match(html, />3d</);
  assert.doesNotMatch(html, /All servers/, "filter chips are off");
  assert.doesNotMatch(html, /aria-label="Only /, "without a chip click there is no server filter");
  assert.doesNotMatch(html, /selected</, "the selection bar appears only with the selection mode");
  assert.match(html, /<ul aria-label="Runs" class="[^"]*grid-cols-\[auto_minmax\(0,1fr\)_auto_auto\]/, "with two or more servers the list has a column for the server");
  assert.match(html, /data-cell="connection"[^>]*title="core"[^>]*>core</);
});

test("Runs and Server always lead back to Start with the arrow before their title, Start has no arrow", () => {
  for (const [name, title] of [["runs", "Runs"], ["connections", "Server"]] as const) {
    const html = render(page({ page: name }));
    assert.match(html, new RegExp(`aria-label="Back to Start"[\\s\\S]*?<h1[^>]*>${title}</h1>`), `${name}: the arrow comes first`);
    assert.equal(html.match(/aria-label="Back to Start"/g)?.length, 1);
  }
  assert.doesNotMatch(render(page()), /Back to Start/);
});

test("the chip on Start passes its server to the Runs page; the filter shows as a pressed toggle", () => {
  const html = render(page({
    page: "runs",
    runsConnection: "core",
    connections: [
      connection({ runs: [{ id: "run-a", title: "Night bus round", state: "waiting", pendingActions: 2, updatedAt: Date.now() }] }),
      connection({ name: "core", runs: [{ id: "run-b", title: "Word game", state: "ended", pendingActions: 0, updatedAt: Date.now() }] }),
    ],
  }));
  assert.match(html, /aria-pressed="true"[^>]*aria-label="Only core"/);
  assert.match(html, />Word game</);
  assert.doesNotMatch(html, />Night bus round</, "the runs of the other server stay out");
  const single = render(page({ page: "runs" }));
  assert.match(single, /<ul aria-label="Runs" class="[^"]*grid-cols-\[auto_minmax\(0,1fr\)_auto\]/, "with one server the column is missing");
  assert.doesNotMatch(single, /data-cell="connection"/);
});

test("the Server page lists the rows with their actions, without Start and Stop", () => {
  const html = render(page({
    page: "connections",
    connections: [
      connection({ savedLogin: true }),
      connection({ name: "core", kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "starting" }, runs: [], entries: [], canCreate: false }),
    ],
  }));
  assert.match(html, /<h1[^>]*>Server<\/h1>/);
  assert.match(html, /aria-label="Back to Start"/);
  assert.match(html, /aria-label="Open setting"[^>]*>.*settings\.json</);
  assert.match(html, /aria-label="Remove workshop"/);
  assert.match(html, /title="http:\/\/localhost:4710"/);
  assert.match(html, /title="\/x\/ragents\.config\.core\.ts"[^>]*>ragents\.config\.core\.ts</);
  assert.match(html, />Disconnect</);
  assert.match(html, />Sign out</);
  assert.match(html, />Edit</);
  assert.match(html, />New server</);
  assert.match(html, /title="starting"/);
  assert.doesNotMatch(html, />Start</, "the extension starts a local profile itself");
  assert.doesNotMatch(html, />Stop</);
  assert.doesNotMatch(html, /Really remove\?/, "removing asks for confirmation in the dialog");
  assert.doesNotMatch(html, /Server type/, "the dialog appears only after the click");
  const failed = render(page({ page: "connections", connections: [connection({ kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "failed", message: "set ragents.hostPath to it" }, runs: [], entries: [] })] }));
  assert.match(failed, /title="failed"/);
  assert.match(failed, /role="alert"[^>]*>set ragents.hostPath to it</);
  assert.match(failed, />Retry</);
  const empty = render(page({ page: "connections", connections: [] }));
  assert.match(empty, />No server yet.</);
});

test("the Server page lists names from ragents.hostEnvironment without a value and offers to set them", () => {
  assert.doesNotMatch(render(page({ page: "connections" })), /Missing values/, "without the field the page stays unchanged");
  assert.doesNotMatch(render(page({ page: "connections", missingSecrets: [] })), /Missing values/, "with nothing open, there is no empty box");
  const one = render(page({ page: "connections", missingSecrets: ["SERVICE_TOKEN"] }));
  assert.match(one, />Missing values</);
  assert.match(one, /ragents\.hostEnvironment/);
  assert.match(one, /no value in the SecretStorage/);
  assert.match(one, /locally started host does not get the environment variable/);
  assert.match(one, />SERVICE_TOKEN</);
  assert.match(one, /aria-label="Set value for SERVICE_TOKEN"/);
  const two = render(page({ page: "connections", missingSecrets: ["SERVICE_TOKEN", "SERVICE_URL"] }));
  assert.match(two, /aria-label="Set value for SERVICE_TOKEN"/);
  assert.match(two, /aria-label="Set value for SERVICE_URL"/);
  assert.equal(two.match(/>Set value</g)?.length, 2, "one row per missing name");
  assert.doesNotMatch(render(page({ missingSecrets: ["SERVICE_TOKEN"] })), /Missing values/, "Start stays as it was");
});

test("a server missing an environment variable explains the case and leads to the value and to a new attempt", () => {
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  const html = render(page({
    page: "connections",
    connections: [connection({ kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "failed", message: "run-provision.ts ended with code 1" }, runs: [], entries: [], missingEnvironment: missing })],
  }));
  assert.match(html, /role="alert"[^>]*>The environment variable SERVICE_TOKEN is not set; the configuration requires it for ragents\.example\.SERVICE_KEY\./);
  assert.match(html, /Store its value as a secret/);
  assert.doesNotMatch(html, /ended with code 1/, "instead of the line from the output channel, the understandable reason is shown");
  assert.match(html, /aria-label="Set value for SERVICE_TOKEN and restart workshop"/);
  assert.match(html, />Set value</);
  assert.match(html, />Retry</);
  const start = render(page({ connections: [connection({ state: { kind: "failed", message: "run-provision.ts ended with code 1" }, runs: [], missingEnvironment: missing })] }));
  assert.match(start, /aria-label="Show error of workshop"/, "the chip carries the reason on its state icon");
  const without = render(page({ page: "connections", connections: [connection({ state: { kind: "failed", message: "no checkout" }, runs: [], entries: [] })] }));
  assert.match(without, /role="alert"[^>]*>no checkout</);
  assert.doesNotMatch(without, />Set value</, "without a finding the previous reason stays");
});

test("a differing RAgents version shows on Start and at the server, as an error in red and as a warning in the warning color", () => {
  const warning = { level: "warning" as const, text: "RAgents version does not match: extension 0.1.9, server 0.1.8 - update the server to 0.1.9." };
  const error = { level: "error" as const, text: "RAgents version does not match: extension 0.1.8, server 0.1.9 - update the RAgents extension to 0.1.9. The workspace is therefore not registered: executor 7 instead of 8." };
  const start = render(page({ connections: [connection({ versionNotice: warning })] }));
  assert.match(start, /<p class="[^"]*text-warning[^"]*" data-notice="warning" role="status">RAgents version does not match: extension 0\.1\.9, server 0\.1\.8 - update the server to 0\.1\.9\.<\/p>/);
  const two = render(page({ connections: [connection({ versionNotice: error }), connection({ name: "second", address: "http://localhost:4727" })] }));
  assert.match(two, /<p class="[^"]*text-destructive[^"]*" data-notice="error" role="alert">workshop: RAgents version does not match/, "with two or more servers the notice names its server");
  assert.equal(two.match(/data-notice=/g)?.length, 1);
  const servers = render(page({ page: "connections", connections: [connection({ versionNotice: error })] }));
  assert.match(servers, /data-notice="error" role="alert">RAgents version does not match: extension 0\.1\.8, server 0\.1\.9/);
  assert.doesNotMatch(render(page()), /data-notice=/);
});

test("messages in both directions are checked before processing", () => {
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "start" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "runs" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "connections" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "run" }), false, "openRun leads to the run, not page");
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "whatever" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "runs", connection: "core" }), true, "the chip passes its server to Runs");
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "runs", connection: 3 }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "connect", name: "workshop" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "connect" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "retry", name: "workshop" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "addServer", name: "a", url: "http://x" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "addProfile", name: "a", profileFile: "/x/ragents.config.a.ts" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "updateServer", name: "a", newName: "b", url: "http://x" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "updateServer", name: "a", url: "http://x" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "updateProfile", name: "a", newName: "b", profileFile: "/x/ragents.config.b.ts" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "login", name: "workshop", user: "a", password: "b" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "login", name: "workshop", token: "t" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "login", name: "workshop" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "openRun", name: "workshop", runId: "run-a" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "workshop", runIds: ["run-a", "run-b"] }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "workshop", runIds: [] }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "workshop", runIds: "run-a" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "workshop" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "newRun", name: "workshop" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "newRun", name: "workshop", entryId: 3 }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret", name: "SERVICE_TOKEN" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret", name: "SERVICE_TOKEN", connection: "core" }), true, "a server's error carries its name along");
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret", name: "SERVICE_TOKEN", connection: 3 }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "showOutput" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "evil" }), false);
  assert.equal(isPanelStateMessage({ type: "ragents.panel.state", state: { theme: "dark", page: "start", connections: [], profileSuggestions: [] } }), true);
  assert.equal(isPanelStateMessage({ type: "ready" }), false);
});

test("template-only access keeps its templates without exposing free creation or deletion", () => {
  const restricted = connection({ canCreateFree: false, canDelete: false });
  const start = render(page({ connections: [restricted] }));
  assert.match(start, /data-tile="Collection board"/);
  assert.doesNotMatch(start, /data-tile="New chat"|aria-label="New chat on/);
  const runs = render(page({ page: "runs", connections: [restricted] }));
  assert.match(runs, /Night bus round/);
  assert.doesNotMatch(runs, />Select<|>Delete</);
});

test("owner and list lines stand below the title inside the clickable item, the owner first", () => {
  const html = render(page({ connections: [connection({ runs: [{
    id: "run", title: "Review", state: "idle", pendingActions: 0, updatedAt: 0, notice: "updated", owner: "Alice",
    details: [{ label: "Workspace", text: "/home/user/project", icon: "folder" }, { label: "Branch", text: "main", icon: "branch" }, { label: "Ticket", text: "ACME-7" }],
  }, { id: "plain", title: "Plain", state: "idle", pendingActions: 0, updatedAt: 0 }] })] }));
  assert.match(html, /title="[^"]*, new activity"/);
  assert.doesNotMatch(html, /aria-label="New activity"/);
  const item = /<button[^>]*title="Review"[^>]*>(.*?)<\/button>/s.exec(html)?.[1] ?? "";
  assert.match(item, /class="col-\[2\/-1\][^"]*"><span[^>]*title="Owner: Alice">Alice<\/span><span[^>]*title="Workspace: \/home\/user\/project">.*?lucide-folder.*?\/home\/user\/project<\/span><\/span><span[^>]*title="Branch: main">.*?lucide-git-branch.*?main<\/span><\/span><span[^>]*title="Ticket: ACME-7"><span[^>]*>ACME-7<\/span><\/span><\/span>/s,
    "owner, then the lines in their order; a line without an icon shows only its text");
  const plain = /<button[^>]*title="Plain"[^>]*>(.*?)<\/button>/s.exec(html)?.[1] ?? "";
  assert.doesNotMatch(plain, /col-\[2\/-1\]/, "without owner and lines there is no second line");
});

const sharedRuns: ConnectionView["runs"] = [
  { id: "own", title: "Own review", state: "idle", pendingActions: 0, updatedAt: 3, canShare: true, shared: true },
  { id: "plain", title: "Plain run", state: "idle", pendingActions: 0, updatedAt: 2, canShare: true },
  { id: "viewed", title: "Viewed run", state: "idle", pendingActions: 0, updatedAt: 1, owner: "Alice", sharedAccess: "read" },
  { id: "joined", title: "Joined run", state: "idle", pendingActions: 0, updatedAt: 0, owner: "Alice", sharedAccess: "write" },
];

test("shared runs carry an indicator, a sharee row says what the share permits, and only runs the user may share offer Share ...", () => {
  const html = render(page({ page: "runs", connections: [connection({ runs: sharedRuns })] }));
  const item = (title: string) => new RegExp(`<button[^>]*title="${title}"[^>]*>(.*?)</button>`, "s").exec(html)?.[1] ?? "";
  assert.match(html, /<ul aria-label="Runs" class="[^"]*grid-cols-\[auto_minmax\(0,1fr\)_auto_auto\]/, "one more column for the row action");
  assert.match(item("Own review"), /title="Shared"><svg[^>]*lucide-users[^>]*>.*?<span class="sr-only">Shared<\/span>/s);
  assert.doesNotMatch(item("Plain run"), /title="Shared/);
  assert.match(item("Viewed run"), /title="Shared with you - view only"><svg[^>]*lucide-eye/);
  assert.match(item("Joined run"), /title="Shared with you - can operate"><svg[^>]*lucide-users/);
  assert.match(html, /<button(?=[^>]*aria-label="Share Own review")(?=[^>]*title="Share \.\.\.")[^>]*>/);
  assert.match(html, /aria-label="Share Plain run"/);
  assert.doesNotMatch(html, /aria-label="Share Viewed run"|aria-label="Share Joined run"/, "a sharee never changes the sharing");
  assert.equal(html.match(/data-cell="share"/g)?.length, 4, "every row keeps its action cell, so the columns stay aligned");
  const without = render(page({ page: "runs" }));
  assert.match(without, /<ul aria-label="Runs" class="[^"]*grid-cols-\[auto_minmax\(0,1fr\)_auto\]/);
  assert.doesNotMatch(without, /data-cell="share"/, "without a shareable run there is no action column");
});

test("Start offers Share ... in its recent runs too and shows a short notice, such as for a share taken back", () => {
  const html = render(page({ notice: "This run is no longer available to you.", connections: [connection({ runs: sharedRuns })] }));
  assert.match(html, /role="status">This run is no longer available to you\.<\/p>/);
  assert.match(html, /<ul aria-label="Recent" class="[^"]*grid-cols-\[auto_minmax\(0,1fr\)_auto_auto\]/);
  assert.match(html, /aria-label="Share Own review"/);
  assert.doesNotMatch(render(page()), /no longer available/);
});

test("in selection mode a row that cannot be deleted keeps an empty checkbox cell and no checkbox", () => {
  const rows = sharedRuns.slice(0, 3).map((run) => createElement(RunLine, {
    key: run.id, connection: connection(), run, showConnection: false, selecting: true, selectable: run.sharedAccess === undefined, onOpen: () => {},
  }));
  const html = renderToStaticMarkup(createElement(RunList, { label: "Runs", showConnection: false, selecting: true, children: rows }));
  assert.match(html, /grid-cols-\[auto_auto_minmax\(0,1fr\)_auto\]/);
  assert.match(html, /aria-label="Select Own review"/);
  assert.doesNotMatch(html, /aria-label="Select Viewed run"/);
  assert.match(html, /<li[^>]*><span aria-hidden="true"><\/span><button[^>]*title="Viewed run"/);
});

test("share actions are checked before the host acts on them", () => {
  const share = (sharing: unknown) => isPanelActionMessage({ type: "ragents.panel", action: "share", name: "workshop", runId: "run-a", sharing });
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "openSharing", name: "workshop", runId: "run-a" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "openSharing", name: "workshop" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "closeSharing" }), true);
  assert.equal(share({ everyone: null, users: [] }), true);
  assert.equal(share({ everyone: "read", users: [{ userId: "bob", access: "write" }] }), true);
  assert.equal(share({ everyone: "all", users: [] }), false);
  assert.equal(share({ everyone: null, users: [{ userId: "bob", access: "admin" }] }), false);
  assert.equal(share({ everyone: null, users: [{ access: "read" }] }), false);
  assert.equal(share({ everyone: null }), false);
  assert.equal(share(undefined), false);
});
