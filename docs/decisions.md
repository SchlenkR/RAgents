# Decisions

## 2026-10-04: A workstation names its background commands at sign-in; a restarted server observes their ends again

Chapters: `spec/plugins.md` (Workspace, sandbox tools, and processes: workstation sign-in, background
commands; Open limits); usage: `usage.md` (Open and stop services and background processes).

**Why.** A background command of `bash` on a workstation outlives a restart of the server, and
`task_output` and `task_stop` still reached it by ID through the executor of the binding, but the
observation of its end lived only in the server's memory: after a restart nothing observed it, and
the actor that started a dev server never learned that it had exited.

**Decision.**

- When the server starts a background command, it passes the calling actor in the input of `bash` as
  `startedBy`; the executor keeps it with the command without reading it, and a background start
  without it fails with `background-task-starter-missing` (400). The binding of actor and command
  lives in the executor's own record, not in the journal: command and record live and end together on
  one machine, and only the workstation knows which commands still run, so a journal entry would
  outlive the command and still need the workstation's word.
- The executor counts an end as reported once an observation `tasks.wait` has returned it; an aborted
  one, such as one the server's restart cuts off, does not count.
  `WorkspaceOperationExecutor.unreportedBackgroundTasks()` lists the commands of all runs without a
  reported end, except those `task_stop` ended, with run, ID, and starter.
- The workstation names them at every sign-in under `backgroundTasks` of
  `ragents.workspace.clients.register` (required, at most 1024). `clientMethods` hands the sign-in to
  the plugin, and `RunWorkspaceRuntime.resumeBackgroundTasks` opens the observation again for each
  command whose run the server binds to this workstation of this owner, for the named actor
  (`WorkspaceSandboxHost.observeBackgroundTask`). A command the server already observes keeps its
  observation, so a sign-in after a lost connection or with changed folders brings no second notice.
  An end while the server was down arrives right after the sign-in. A command of a run not bound
  there, such as one deleted while the workstation was away and the server restarted since, keeps
  running, and the server names it in its log.
- `WORKSPACE_EXECUTOR_VERSION` is 12, because the sign-in and the input of `bash` have a new field.

Rejected: a separate method after the sign-in to name the commands (a second round trip and a second
check that the caller holds the sign-in); stopping a command of a run the server does not bind to the
workstation (destructive on the user's machine, for example after the server changed its data folder;
the lost registered stop that would have ended it is an existing open limit); counting an end as
reported only after the server confirmed it (the messaging layer acknowledges no response; the gap is
one answer that a breaking connection loses, named in the open limits).

Verified with `packages/workspace-executor/tests/background.test.ts` (the listing with starter after an
aborted and a returned observation, `task_stop`, and the run stop; the refusal without starter),
`scripts/workspace-client/run-workspace-client.test.ts` (the headless workstation across a real stop
and start of the server on the same port: both commands named with their actor, an end during the
downtime and one after it each reach the actor once, a sign-in during an observation adds none, a
reported end is not named again, `task_output` on the new server), `apps/server/tests/run-workspace.test.ts`
(only runs bound to this workstation and owner are observed again, the others are logged), and
`workspace-clients.test.ts` (the sign-in hands the named commands to the plugin). A live run with a
real model is still open (`TODO.md`).

## 2026-10-04: The remote-workspace check reads before it writes; the host-modules browser test expects versioned web addresses

Chapters: none of the spec; `scripts/remote-workspace/README.md` (Checks: server roots).

**Why.** Two Roots checks of `pnpm check:remote-workspace` failed independently of what they check:
the scripted actor program replaced the template's `package.json` with `write` without a `read`, which
the seen-file rule refuses since 2026-10-02, and the prompt check expected the sentence "only that bash
has `$RAGENTS_ACTORS_DIR`", which the root description no longer contains in that order since
`@documents` names `$RAGENTS_DOCUMENTS_DIR` first. `apps/web/tests/host-modules.browser.test.ts` waited
for the probe's stylesheet without the `?v=<revision>` that web halves carry since 2026-10-02 and
compared loaded addresses without their query.

**Decision.** The script reads `package.json` before it writes it. The prompt check asserts the
meaning: `RAGENTS_ACTORS_DIR` appears once, in the sentence about the bash that runs on the server, as
`$RAGENTS_ACTORS_DIR` for `@actors`. The browser test takes the probe's stylesheet address from
`ragents.plugins.bootstrap`, checks that it carries the revision, waits for exactly that link in the
page and in the run panel's frame, and compares loaded addresses with their query. The product links
what it should and stays unchanged.

Verified: `pnpm check:remote-workspace` with 64 ok, 0 FAILED, 0 skipped, and the browser test with
`RAGENTS_BROWSER_TESTS=1` against the built web.

## 2026-10-04: No document address carries the access token; the web sends only its origin as referrer

Chapters: `spec/plugins.md` (Ownership per facet: grants and resolution; Web as plugin host:
`resolveRunUrl`, access token and referrer policy; Open limits), `spec/profiles.md` (sign-in for
clients without a cookie); usage: `usage.md` (VS Code sign-in).

**Why.** Follow-up of the entry below on grants: in VS Code, Markdown images, image documents, and
downloads still carried the long-lived access token as `?access=`, so it landed in the access logs of
the server and of every proxy before it and in the address of every copied image or download, and the
panel's own address carried it as well, so every request of the panel sent it as referrer.

**Decision.**

- The shared web entry `apps/web/index.html`, and with it `run-panel.html`, declares
  `<meta name="referrer" content="strict-origin">` before its first request. Not `no-referrer`: with
  it the browser sends `Origin: null` with the page's own POST requests (Fetch standard), which
  `isSameOriginRequest` refuses, so a page with sign-in could change nothing any more. Not
  `same-origin`: it sends the whole address, token included, to the own server, which is the leak.
  `strict-origin` sends only the origin, keeps the `Origin` header, and sends nothing after a
  downgrade to http.
- Where the page has a token, every address of the content route takes the grant of the root its
  first segment names instead of `raw/`: Markdown in the Documents view and in the chat, image
  documents, and downloads. One store per page (`DocumentGrantStore`, `web/grants.ts`) holds one grant
  per run and root, asks once, renews after half the lifetime while a view watches, hands none out in
  its last minute, forgets one nobody watches, and asks for a failed one again after 30 seconds. The
  lifetime moved into the plugin's contract (`DOCUMENT_GRANT_LIFETIME_MS`) for both halves.
  `withToken` is gone; `withAccessToken` stays in the host API for mini-app frames.
- quassel 0.4.5 resolves an address only when its Markdown mounts: Streamdown's memo compares the
  content and a few options, not `urlTransform`, so a changed `resolveUrl` never reaches a rendered
  message (measured in Chrome: the image keeps its empty address). The Documents view therefore keys
  its Markdown on the revision of the grants, the documents `SessionProvider` shows a run with a token
  only once the grants of its root and of `@documents` have settled, once per run, and the chat's
  `resolveRunUrl` reads the current grants when it resolves. An HTML frame keeps the grant it opened
  with until its file changes, so that a renewal does not reload it.
- A result of `artifact_publish` lies on the host's artifact route, which a grant of the plugin cannot
  reach without the core naming the plugin; with a token its image or download loads with the bearer,
  like a text document, and shows under a `blob:` address.
- The panel's own address keeps `?access=`: removing it needs a handshake over the webview's message
  channel and a page that the `ACCESS_TOKEN` gate serves without a token; an Open limit.

Rejected: a resolver that announces changes and that `RunUrls` reads again, because quassel would not
render a mounted message again anyway; mounting the whole run again on every change of the grants
(drafts, scroll position, dock state); extending one grant while a view watches, because a leaked
address would then live as long as the view; loading every image and download as `blob:`, because
grants keep one way for every address the browser loads by itself and a download address also works
outside the page; an empty address for a failed grant, because a broken image says more than a
missing one.

Also: `start-page.browser.test.ts` "one shared header retains the coordinator and run actions
(browser)" still expected the "Chat" and "Reset layout" buttons at 520 px, which the header moved into
the "All windows" menu on 2026-10-02 (entry "A run header too narrow for the window buttons shows one
'All windows' menu"); the header is right, the test now opens that menu, finds "Reset layout" in it,
and shows Chat through it.

Verified with `apps/web/tests/document-grants.test.ts` (store: one request per run and root,
renewal, last minute, retry, forgetting; addresses per root with query and anchor; the referrer
policy before the first request), `document-links.test.ts`, `document-grant-browser.test.ts` (real
Chrome, token: one grant per root for documents and chat, every image of an HTML and a Markdown
document, an image document, and the chat through the grant of its root, a download to its grant
address, a result once with the bearer under `blob:`, no address with the token, no referrer beyond
the origin, the grant requests with their `Origin`; cookie: plain route, no grant),
`apps/server/tests/document-content.test.ts`, and `document-grant-host.test.ts`.
## 2026-10-04: ACP tool starts retain streamed input and server failures retain their cause

Chapters: `spec/plugins.md` (External ACP actors, Server process sandbox); operations:
`operations.md` (Configure external ACP agents).

**Why.** Claude announces tools before their arguments finish streaming, so recording that
announcement loses the command. Its fixed temporary path is blocked by the server sandbox,
and ACP request errors can put the actual cause in `data`.

**Decision.** Pending calls collect refinements until execution, permission, or turn end; the
journal start and live event share that input. A successful turn closes unfinished calls with
a failure result. Permission details use the same bounds and redaction as updates. Diagnostics
retain ACP error data. Every server sandbox sets `CLAUDE_CODE_TMPDIR` to the run's writable temp
folder. Operations document non-interactive environment credentials, including subscription
tokens for Claude and API-key method selection for Codex; workstation sign-in stays local.

## 2026-10-03: Complete external agents run through a generic actor runtime

Chapters: `spec/overview.md` (actors and layers), `spec/core.md` (External runtimes, journal),
`spec/plugins.md` (runtime contribution, executor, External ACP actors); usage: `usage.md`
(Run external ACP actors); operations: `operations.md` (Configure external ACP agents).
The implemented concept `concepts/acp-agent-drivers.md` is deleted.

**Why.** Complete coding agents need to keep their own tools and conversation while sharing
RAgents delivery, workspace, turns, and history. A named external runtime keeps protocol and
vendor behavior in a plugin, and the existing executor keeps processes beside the run's files
on both server and workstation.

**Decision.** The engine adds `external` execution with a runtime name and an `actorRuntimes`
contribution supplying its driver. Observable text and reasoning use a separate decision without
inventing model context. Journal format 13 keeps formats 7 to 12 readable; host API 12 and executor
version 13 identify the changed driver, module-operation, and confined-path contracts.
`ragents.acp` registers the configured adapters through one stable ACP client implementation,
with one sandboxed process and session per actor. Messages queue; permission questions block
within their turn and retain opaque option IDs in the executor. Actor-scoped state keeps the
session and cumulative usage behind a private access projection, including inspection access,
journal queries, and subscriptions; persisted journals and archives retain the state. ACP actors
use the shared run workspace and reject explicit workspace isolation. Restoration requires
advertised `session/load`, with replay updates suppressed; a missing capability or failed load
blocks the actor instead of replacing its history. MCP definitions stay private and only supported transports are forwarded, with
explicit exclusions and rejection of unrepresentable working directories. RAgents functions
are not yet supplied to external agents.

## 2026-10-03: Editors use ordinary runs through an ACP stdio adapter

Chapters: `spec/profiles.md` (ACP editor agent), `spec/plugins.md` (MCP client);
usage: `usage.md` (Connect an editor over ACP).

**Why.** Editors need a standard chat protocol while runs, ownership, workspace tools, and history
continue to belong to the host. Reusing the host-finding and messaging code avoids a second
startup path or conversation store.

**Decision.** `ragents acp` translates stable ACP v1 over stdio to the existing run API and
primary-actor chat channel. It binds a local folder on the server, or registers that folder as
a workstation when the server is remote. The first prompt creates the run; load replays its
history and list uses its folder binding. Model selection uses the changeable start option.
Editor-supplied MCP servers pass through a guarded non-tool method into the plugin's private
store; an idle load can replace them without exposing their secrets to the journal. Tool
updates, plans, and questions use the stable protocol. stdout is reserved for ACP, including
when the shared helper starts a host.
Skill commands retain their existing template identifiers and use the web's prepared input
for their prompt and skill; a 20-skill cap keeps the editor's command list small until larger
catalogs have their own discovery.
Remote connection cleanup closes MCP before unregistering the workstation, keeping its executor
reachable during cleanup and its private definitions available for a later load.

## 2026-10-03: MCP tools connect on the run's workspace machine

Chapters: `spec/plugins.md` (MCP client), `spec/profiles.md` (structured plugin configuration);
usage: `usage.md` (MCP server status); operations: `operations.md` (Connect MCP servers).

**Why.** External tools need the same workspace, process sandbox, and meaning of `localhost`
as the run. Profile configuration must accept existing MCP server entries, including nested
environment references, without special host parsing for this integration.

**Decision.** `ragents.mcp` owns one executor state per run for stdio, Streamable HTTP, and
legacy HTTP+SSE. It exposes dynamic native run functions through the normal journaled tool
path. Cached tools survive disconnects so fixed actor selections remain valid; failed calls,
a per-run prompt chapter, and a small status tab report the cause. A typed service stores
additional run-scoped server definitions separately from the journal, providing the boundary
for an editor integration. Generic structured configuration resolves `env(...)` recursively;
the plugin validates its own server map. Remote authentication uses static headers.
The executor's machine contract provides `startManagedService` for protocol child processes;
the raised executor version prevents an older workstation from accepting a contribution that needs it.
Tool calls use cancellable executor observations so MCP progress can reset the SDK timeout
without a fixed outer transport timeout. Image hooks receive the tool-call ID to bind each
result during parallel execution.

## 2026-10-03: A tunnel never shadows a local service

Chapters: `spec/plugins.md` (Workspace, sandbox tools, and processes: opening a service; Open
limits); usage: `usage.md` (Open and stop services and background processes).

**Why.** A live check opened a tunnel from the extension's code to a service on a workstation that
ran on the same machine without being this window's workstation, as another window's workstation or
a headless workstation can. The service listened on the IPv6 wildcard, the extension's listener on
`127.0.0.1` with the same port number still bound (macOS lets a specific address coexist with a
wildcard under `SO_REUSEADDR`), and the dial-back, which tries `127.0.0.1` first for a wildcard,
reached the tunnel itself and opened stream after stream.

**Decision.** Before the extension keeps the service's port number, it connects once to
`127.0.0.1` and `[::1]` on that port; if anything answers, the tunnel takes a free port. The probe
closes gracefully, so the service sees no reset. Rejected: probing by binding, because the same
`SO_REUSEADDR` rule lets the probe bind as well; always a free port, because absolute addresses of a
service fit only while the local port keeps its number. Verified with
`apps/vscode/tests/service-tunnels.test.ts` (a service on the IPv6 wildcard keeps its port, and a
request through the tunnel reaches it) and live: HTTP, a WebSocket echo, and server-sent events of a
dev server on a workstation through a real server and the dial-back.

## 2026-10-03: `bash` runs commands in the background; `task_output` and `task_stop` read and end them by ID

Chapters: `spec/plugins.md` (Workspace, sandbox tools, and processes: the tools, the executor's
modules, background commands, the process display; Open limits), `spec/core.md` (Pausing a run;
Origin of an input); usage: `usage.md` (Open and stop services and background processes);
operations: `operations.md` (Time limit of `bash`); concept: `concepts/sandbox-services.md`.

**Why.** A `bash` call ended with its process group, and `run_in_background: true` was rejected.
Agents that had to keep a dev server running for browser checks improvised in two live runs: one
spawned `node -e "child_process.spawn(..., {detached: true})"`, another submitted a launchd job with
`launchctl submit` on the developer's workstation, which is invasive and easily left behind. The
process rail shows services and VS Code opens them through a tunnel, so starting one is ordinary
work and needs the standard's tool, not a workaround.

**Decision.** In the shape of the standard, checked against `sdk-tools.d.ts` of
`@anthropic-ai/claude-agent-sdk` 0.3.288 and the background result of Claude Code itself:

- `bash` with `run_in_background: true` starts the command detached in its own process group, with
  the run marker, in the same lock, folder, environment, account, and process sandbox as every call,
  and returns at once with one line: "Command running in background with ID: b3f9a1. task_output
  reads its new output, task_stop ends it." The ID is `b` and six hexadecimal digits. stdout and
  stderr go through pipes into `background/<id>.log` below the run's log folder on the executing
  machine (`logDirectory`); the path never reaches the model. When the command exits, the rest of its
  process group ends with it, as after every call.
- `task_stop {task_id}` follows `TaskStop` (formerly `KillShell {shell_id}`): SIGTERM to the group,
  two seconds, then SIGKILL; on Windows `taskkill /T /F` and the MSYS processes of the command.
- `task_output {task_id}` follows `TaskOutput`, which replaced `BashOutput {bash_id}`. Claude Code
  has since removed it and points the model at the output file with `Read`; here the file lies on
  the command's machine, possibly a workstation, outside every root, and models copy no paths, so the
  tool stays and takes the ID. It returns only output new since the last read, at most 20 KB from its
  end starting at a line, the last 2000 lines, lines over 1000 characters shortened, and names what
  it left out; then "Status: running", "exited with code N", "ended by signal S", or "stopped with
  task_stop". `block` and `timeout` of `TaskOutput` are not taken: no tool waits.
- The end reaches the actor that started the command: the server opens the observation `tasks.wait`
  at the executor that started it (`untilAborted`, like `files.watch`), and its result becomes an
  ActorInput in the owner's name with `presentation: "background"`: "Background command b3f9a1
  exited with code 1. task_output reads what it wrote last." No input for an end through
  `task_stop`; an end through the rail brings one. The run stop aborts the observations before it
  stops the executors. After a lost connection to a workstation the server opens the observation
  again every 15 seconds; the executor keeps the status of an ended command until the run stops.
- The server remembers per run which executor started which ID and sends `task_output` and
  `task_stop` there; an unknown ID goes to the binding's executor.
- Ending: `task_stop`, the end button of the rail, the stop and deletion of the run, and the
  `shutdown` of the executor, which also removes the output files. `bash` starts a background
  command only for an actor that has `task_output` and `task_stop` (`background-tools-missing`,
  400), so the global coordinator, whose fixed selection has `bash` without them, cannot start one
  it could neither read nor end; its selection stays unchanged, because changing it would force every
  existing global conversation to reset.
- The process display counts the group of a background command as background although the executor
  is its parent (`WorkspaceExecutorModule.backgroundGroups`). With an account per run, the cleanup
  after a call keeps the background commands and everything below them (`stopUidProcesses` with
  `keep`).
- The workspace rules and the skill `browser-testing` tell agents to start services this way and to
  stop them; `usage.md` no longer describes a detached `child_process.spawn` as the way.
- `WORKSPACE_EXECUTOR_VERSION` is 11, because an older workstation knows neither the operations nor
  the start.

One deviation from the standard: `timeout` does not apply to a background command. Claude Code stops
one after 30 minutes by default and two hours at most; here a dev server for a long browser check
must not die halfway, and the run stop ends what nobody stops. The server's process sandbox keeps
its rules: a service of a server run still cannot be opened there (`concepts/sandbox-services.md`).

Rejected: reading the output with `read` by path (the file is on another machine and models copy no
paths); starting the command through a wrapper process so that it is no direct child of the
executor (the end and the output would need a second channel); polling the status from the server;
a sequential ID per run (two executors of one run would collide).

Verified with `packages/workspace-executor/tests/background.test.ts` (survives the call,
incremental output, limits, exit code, stop, run stop, files, process display),
`packages/agent/tests/bash.test.ts` and `background-tasks.test.ts` (schemas, results),
`apps/server/tests/bash-background.test.ts` (notice to the actor, no notice for `task_stop` and the
run stop, missing tools), `workspace-foreign-machine.test.ts` (on a workstation through its
connection, with `@actors` on the server, run stop there), `profile-composition.test.ts`, and
`overseer-workspace.test.ts`.

## 2026-10-03: Document addresses through quassel's `resolveUrl`, in the run chat too; grants for HTML documents; the store without the run's root

Chapters: `spec/plugins.md` (Ownership per facet: resolution, account switch, content route, grants;
Rights in server and web contributions: `accessFromAddress`; Web as plugin host: `resolveRunUrl`;
Workspace, sandbox tools, and processes: server roots without the run's root; Browser checks; Open
limits), `spec/profiles.md` (sign-in for clients without a cookie); usage: `usage.md` (Run chat and
inspection, document store); operations: `operations.md` (data folder); handbook: `development.md`
(web slots, quassel version).

**Why.** Five follow-ups of the entry below. The viewer rewrote the Markdown source with a parser of
its own, because quassel had no address hook; quassel 0.4.5 has `QuasselProvider.resolveUrl`. The
run chat resolved nothing, so a model that put `![shot](@documents/browser/x.png)` or a path relative
to the run's root into its answer showed a broken image. An HTML document resolved its addresses
through a `<base href>` without a token, so its images failed in VS Code, where the panel signs in with
a token instead of a cookie. With an account switch (`hostSandbox.ident`), `syncWorkspaceOwnership`
rejected `@documents` under a `DOCUMENTS_DIR` outside the run storage, so every server context of such
a run failed with an unclear error. And reading `@documents` went through a context that needed the
run's root, so a run whose bound folder was gone could not deliver its store.

**Decision.**

- quassel is `^0.4.5`. The Documents view puts a `QuasselProvider` with `resolveUrl` around its
  `Markdown`; the resolution keeps its semantics (relative to the document's folder, an alias to its
  root, schemes, `/` addresses, and anchors unchanged, the token in VS Code). The rewrite and
  `mdast-util-from-markdown`, `mdast-util-gfm`, and `micromark-extension-gfm` are gone.
- The web host gets the slot `resolveRunUrl` (`RunUrlResolver`, at most one active plugin).
  `PluginChat` wraps the run in `RunUrls` (`chat/QuasselHost.tsx`), which hands it to quassel;
  `ragents.documents` contributes the resolution against the run's root, so the host names no
  plugin. A result document without a base keeps its addresses through its own identity resolver,
  because an inner provider replaces the outer one. A new type, no new host API name.
- An HTML document in a page with an access token asks `ragents.documents.grant` for a grant of its
  root and puts `.../runs/<runId>/grant/<grant>/<folder>/` into its base. A grant is 32 random bytes,
  ten minutes long, in memory only, `GET` only, and bound to run, caller's access, and root; the long-
  lived token never lands in a path, a log line, or a referrer, and the frame gets
  `<meta name="referrer" content="no-referrer">` because the panel's own address carries the token. The
  host learns the access of such an address through the new optional `HttpRouteContribution`
  field `accessFromAddress`, asks it before the access token and the sign-in, and then checks run
  and rights against it as for a signed-in request. The web host API gains the name
  `accessTokenInstalled` (no new `HOST_API_VERSION`, names only grow).
- An account switch refuses a registered root outside the run storage when the workspace resolves
  (`workspace-root-outside-storage`, 409, naming the alias), before any tool runs; the sandbox host
  checks the same before every ownership sync. The root is not left out of the sync instead, because
  the run's account could then not write in it, and a chown outside the storage would change rights
  in a folder the operator placed elsewhere on purpose.
- An operation that addresses only roots of the server runs, while a run on the server has lost its
  root, at a second executor of the server in the context of the run's server folder, the same
  context a run on a workstation uses; every other operation still names why the root is missing,
  and nothing creates it again. The content route, `copy`, file tools, and `bash` with an alias as
  `cwd` take this path without code of their own.
- `scripts/remote-workspace/run-remote-workspace-check.ts` imports `BROWSER_EXECUTABLE_VARIABLE` from
  the browser plugin's executor contract, where it lives since the browser became a contribution.

One finding on the way: the content route decided the root by the first segment of the decoded
reference, so `@documents%2F..%2Fproject%2Fx` reached a file of the run's root with `runs.read` alone,
past `runs.inspect` and the owner-only check. A decoded segment with a `/` or a `..` component now
names no file and counts as the run's root.

Rejected for now: grants for Markdown addresses, image documents, and downloads as well (they keep
the token; `TODO.md`); rejected: a grant as a query parameter (relative addresses drop it); routing every
operation of a server run on a server root through the second executor (language servers on `@actors`
and the diagnostics of the run would split); a fallback root inside `#contextFor` (the cached sandbox
of a run keeps its working directory); chowning `DOCUMENTS_DIR/<runId>` with `DOCUMENTS_DIR` as its own
boundary.

Verified with `apps/web/tests/document-links.test.ts` (resolution, Markdown through quassel, code
blocks, base with grant and referrer, chat resolver, result without base),
`apps/web/tests/document-grant-browser.test.ts` (real Chrome: images of an HTML document through the
grant with a token, without referrer and token, and through `raw/` with a cookie),
`apps/server/tests/document-content.test.ts` (grants per root, run, expiry, rights; crafted
references; the store without the run's root), `document-grant-host.test.ts` (the real host lets a
grant pass its access token gate only on the content route and only for `GET`),
`run-workspace.test.ts` (server roots without the bound folder, the account switch refused at the
start), `workspace-ownership.test.ts` (refusal before the sync), and the homepage extension examples.

## 2026-10-03: A service of a run streams as raw TCP through WebSocket legs that the run's machine dials back

Chapters: `spec/plugins.md` (PluginHost registrations; Rights in server and web contributions:
upgrade routes; Message layer; Workspace, sandbox tools, and processes: process module, opening a
service; Open limits); usage: `usage.md` (Open and stop services and background processes);
operations: `operations.md` (Run a CLI workstation); handbook: `development.md` (extension points);
concept: `concepts/browser-service-tunnel.md`.

**Why.** The forwarding of the entry below carried one buffered HTTP exchange per call: a WebSocket
upgrade got 501, so the live reload of a dev server and many real apps did not connect, server-sent
events ended at the 60-second limit, and bodies stopped at 16 MiB. The owner needs WebSockets. The
transport sets the frame: viewers and workstations talk only to the server, a workstation opened its
own connection (requests from the server over SSE, answers by POST, 32 MiB per message), the server
cannot connect to a workstation, and it often sits behind a reverse proxy or Cloudflare tunnel that
passes HTTP and WebSocket upgrades on one HTTPS host.

**Decision.** The extension's local listener is a TCP listener, and every accepted connection is one
byte stream piped unchanged in both directions, so no header handling remains. `ragents.processes.tunnel`
(`runId`, `port`, `connect`; same rights as before plus workspace access) checks the port or opens a
stream: the plugin's broker creates two one-time secrets and asks the run's executor with the new
operation `processes.dial` to dial back; the executor checks the port against the run's processes,
connects on loopback as before, and opens its leg as a WebSocket to
`/api/plugins/ragents.processes/tunnel?secret=...`; the method then returns the path of the caller's
leg, which connects to the same endpoint within 15 seconds. The broker pairs the legs and relays
their frames with backpressure. For a run on the server the server's executor dials the server's own
address, for a workstation its executor dials the address of its own connection, which
`workspaceExecutorModules` now receives as `serverAddress`. Both ends share `pipeTunnel`: binary
frames for bytes, the text frame `end` for the end of one direction, so half-closed connections keep
working, close code 1000 when both directions ended, 1011 with the cause on an error. Legs ping every
30 seconds; the server cuts a leg it has not heard from for 75 seconds while it reads it. Run stop and
deletion close the streams on the server, the executor closes its legs in `stopRun` and `shutdown`, so
a workstation that signs out ends them; the extension's port check and end conditions stay, and its
output gets one line per stream open and close instead of one per request.

The host gets upgrades as an additive part of the HTTP registration: `HttpRouteContribution.upgrade`
with `HttpUpgradeContext` (`request`, `socket`, `head`, `url`), dispatched by
`HttpContributionRegistry.dispatchUpgrade`. Of the host's gates only the external-access switch
applies, because an upgrade route authenticates itself; the legs carry only their secret in the
address, so every WebSocket client, a browser later too, can be one. New names only, so
`HOST_API_VERSION` stays 11; the plugin reads `TUNNEL_PING_INTERVAL_MS` from the executor as a new
listed name. `ws` is the WebSocket implementation on all three ends: the server needs one anyway
(Node has no WebSocket server), and on the clients it gives pause and resume plus send callbacks,
while the global WebSocket of Node 22 has no flow control on receiving and only a polled
`bufferedAmount` for sending, and the extension host's globals vary with the VS Code version.
`ragents.processes` bundles its own copy, the executor package depends on it, and the extension
bundles it through the executor. The HTTP forwarding, its operation, buffering, header code, the 501
answer, and their tests are removed without a shim, since none of it was released;
`WORKSPACE_EXECUTOR_VERSION` stays 10, because the released 0.1.30 carries 9.

Two details came out of the tests. A leg opens paused, because ws emits frames that arrive with the
handshake before a caller who awaited the opening could listen, and a service that speaks first lost
its greeting. And the server judges a leg by anything it hears, its own pings included, instead of by
pongs, because a leg that stops reading for backpressure, such as a paused download, cannot answer
a ping but keeps sending its own.

Rejected: chunking the bytes as Base64 through the existing JSON-RPC channels, because every chunk
would be a server request to the workstation over SSE plus a POST back, with no backpressure, a third
more bytes, and a round trip per chunk; a WebSocket for the whole message layer, because it would
replace a transport that works for everything else; the global WebSocket on the clients (above);
relaying in the server by TCP without WebSockets, because a proxy in front of the server passes only
HTTP and upgrades on its HTTPS host; a session cookie or token on the legs, because the global
WebSocket of browsers sends no headers and the one-time secret already binds a leg to one checked
call; closing a stream when one direction ends, because it cuts the answer of a client that
half-closes after its request; the server cutting legs without a pong, because of the paused leg
above. A tunnel for viewers with only a browser stays open as `concepts/browser-service-tunnel.md`.
Verified with `packages/workspace-executor/tests/tunnel.test.ts` (own port only, foreign port
refused, bytes both ways, half-close, 20 MiB each way, reset and close propagation, refused leg,
unreachable port, wildcard and IPv6, stop and shutdown), `apps/server/tests/tunnel-streams.test.ts`
(pairing with early frames, single-use and foreign secrets, 426, expiry, failed dial-back, run stop,
silent leg), `run-processes.test.ts` (rights and signal of the method), `workspace-owner-access.test.ts`,
`access-rights.test.ts` (upgrade dispatch), `workspace-foreign-machine.test.ts` (a stream to a
service on the workstation through its dial-back, and to the same service as a run on the server
through the server's own executor),
`scripts/workspace-client/run-workspace-client.test.ts` (the headless workstation dials back to the
address of its connection, and unregistering ends its legs), `apps/web/tests/run-panel-host.test.ts`,
and `apps/vscode/tests/service-tunnels.test.ts` (against the stub server with the real broker and a
real executor: TCP listener, HTTP, a WebSocket echo, server-sent events, a service that speaks
first, 20 MiB each way, refusals, end by check, connection, and deactivation).


## 2026-10-03: The document store is the server root `@documents`; `copy` and one content route by reference replace `document_write`

Chapters: `spec/plugins.md` (Ownership per facet; Workspace, sandbox tools, and processes; Browser
checks; Open limits), `spec/profiles.md` (Run ownership, wording); usage: `usage.md` (Run chat and
inspection); operations: `operations.md` (data folder).

**Why.** A run bound to a workstation wrote a Markdown report with browser screenshots, and every
image in Documents was broken. The viewer rendered Markdown without a base, so relative image
addresses resolved against the app's own address, in every binding; the server read project files
only as text up to 256 KB; nothing led from the store into the project folder, and `document_write
{file_path}` copied only text and only into the store; and `browser_take_screenshot` returned
`name`, `path` (a UUID path in the store), `url`, `markdown`, and `capturedAt`, so the model copied
the UUID path into its report, against the rules that models copy no paths and tool results stay
lean.

**Decision.** The server holds journal and store, the machine of the binding holds project folder,
processes, and browser, viewers talk only to the server, and the alias, not an absolute path,
decides the machine; the four bindings collapse into "run root on the server" and "run root on a
workstation".

- `ragents.documents` registers its store as the writable server root `@documents`
  (`RAGENTS_DOCUMENTS_DIR` for a bash on the server), like `@actors`. `documentStoreToken`,
  `directoryFor`, and `DOCUMENTS_DIR` stay unchanged. File tools, `bash` with `cwd`, and
  `show_document` reach it in every binding, and the workspace description names it from
  `serverRoots()`.
- `document_write` is gone: writing text is `write` with `@documents/...`, copying is `copy`.
  `show_document` keeps `file_path | content` and drops `storePath`. A breaking change without a
  shim; old fields are rejected as unknown, as on 2026-10-02.
- The executor gets `bytes.read` and `bytes.write` in the module of the sandbox tools: a file, or
  with `recursive` a folder, as Base64, at most 16 MiB and 1000 files per call, which fits the
  32 MiB message limit of a workstation's connection; the errors name the limit. Writing runs in
  the lock of `write`. `WORKSPACE_EXECUTOR_VERSION` is 10.
- `copy {source, destination}` belongs to `ragents.workspace` and counts as a writing workspace
  tool: it reads at the source's machine and writes at the destination's, files and folders,
  writable roots only, and answers "Copied N files.".
- One content route by reference, `GET .../runs/<runId>/raw/<reference>`, replaces
  `files/content?path=` and `workspace/content?path=`, with the rights per root as before; being a
  path, relative addresses inside a document follow plain URL semantics.
- The viewer resolves the addresses of a document against its reference: Markdown destinations are
  replaced at the positions `mdast-util-from-markdown` (with GFM) reports, HTML gets a `<base href>`,
  image documents load from the route. A `resolveUrl` hook in quassel would replace the rewrite
  (`TODO.md`).
- `browser_take_screenshot` takes `filename` like the Playwright MCP tool (the 2026-10-02 entry had
  left it out because nobody needed it), by default `@documents/browser/<id>.png`; the result names
  only the reference it generated. Capture list entries carry `id` and `reference`; entries of the
  former shape `{ name, path }` are read as `@documents/browser/<id>.png`.
- Old journals load unchanged: a replay executes no tool, an old `document_write` call stays an
  ordinary tool line, and an old `show_document` call with `storePath` opens no document card, as
  for `path` on 2026-10-02; displays of `content` still do.

Two further details: the frame of an HTML document keeps its sandbox without scripts but gets
`allow-same-origin`, because Chrome sends no `SameSite=Lax` sign-in cookie with the image requests
of a sandboxed `srcdoc` frame with an opaque origin (measured with Chromium 1228); and the content
route answers with `Content-Security-Policy: sandbox` and `nosniff`, because it now serves project
files of every type on the app's origin.

Rejected: a regular expression over raw Markdown; writing a screenshot at the browser's machine
directly, which would be a second path beside `bytes.write`; reading the store in the route
directly on the server, a local branch beside the executor; a separate route per root, because
relative addresses need one path space.

Verified with `packages/workspace-executor/tests/bytes.test.ts` (roots, folders, links, limits,
lock), `apps/server/tests/document-content.test.ts` (route rights per root, binary, errors, limit,
`copy`), `show-document-tool.test.ts`, `browser-tools.test.ts` (`filename`, lean result, former
capture list), `browser-live.test.ts` (real Chrome), `workspace-foreign-machine.test.ts` (`copy`
across machines, a screenshot stored on the workstation, `show_document`, the root description),
`profile-composition.test.ts` (no tool, prompt, or skill names the removed forms), and
`apps/web/tests/document-links.test.ts` and `documents-presenter.test.ts`.

## 2026-10-03: A service of a run opens on the machine it runs on; VS Code forwards it

Chapters: `spec/plugins.md` (Ownership per facet: `placementOf`; Web as plugin host: the VS Code
host bridge; Workspace, sandbox tools, and processes: process module, opening a service; Open
limits); usage: `usage.md` (Open and stop services and background processes).

**Why.** The port link of the process rail was `http://<host name of the page>:<port>/`. It always
pointed to the server's machine, also for a process on a workstation, and behind a reverse proxy or
tunnel it reached nothing, because only the server's own HTTPS host is reachable there. It worked
only when server, workstation, and viewer were one machine. The agent side was right and stays: the
run's browser runs on the bound machine. Viewers talk only to the server, and the server reaches a
workstation only through the executor connection the workstation opened; no DNS or proxy change may
be required.

**Decision.** The server forwards over the executor connection. `ragents.processes.forward`
(`runId`, `port`, `request` with method, path, header pairs, and a Base64 body, or `null` for a mere
check) requires `runs.read`, `runs.inspect`, and `ragents.processes.read` plus workspace access,
because it reaches into the machine like the Files tab, and goes to the run's executor as the new
operation `processes.forward`. The process module forwards only to a port that a process of the run
listens on, from the rail's scan, which answers for two seconds so that the files of a page share
it; it calls the listening address on loopback (a wildcard on `127.0.0.1`, then `::1`), follows no
redirect, drops hop-by-hop headers, sets `Host` to `localhost:<port>`, buffers at most 16 MiB per
body, and stops after 60 seconds; every error names its cause. `WORKSPACE_EXECUTOR_VERSION` is 10,
because an older workstation does not know the operation. VS Code is the forwarding client, as with
VS Code Remote: the run panel hands the service to its host with the new bridge message
`openService`, and the extension opens a service on its own machine directly, otherwise through a
local listener on `127.0.0.1` with the same port number if it is free, which forwards every request
through the run's server connection, logs it, and ends when the server says the port, the run, or
the access is gone (also asked every five seconds), when the connection ends, and when the
extension deactivates. The browser keeps the direct link for a run on the server and shows a port on
a workstation without a link, with the machine in its tooltip. For that the snapshot names the
machine, and `WorkspacePlacement` carries the workstation's ID and current label.

Two details follow from the boundaries. The extension names no plugin (`apps/server/tests/core-boundary.test.ts`),
so it cannot import the contract of `ragents.processes`: `openService` carries the forwarding
method's ID, which the process plugin supplies, and the host contract defines the request and
response shape (`ServiceForwardInput`, `ServiceForwardResult`) that the method fulfills. And "on its
own machine" also covers a run on the server when the server is the extension's own local host;
a tunnel there would only occupy a second port for the same machine.

Rejected: a subdomain per port, because it needs wildcard DNS and certificates; a path prefix per
port on the server, because apps with absolute URLs break under it; following redirects in the
executor, because the browser has to see a redirect to change its address; reading the binding from
the workspace plugin's run metadata in the web, because the process plugin would depend on another
plugin's shape; the extension observing the process channel, because it would have to know the
plugin's messages. WebSocket forwarding and a tunnel for viewers with only a browser stay open
(`TODO.md`). Verified with `packages/workspace-executor/tests/forward.test.ts` (own port, foreign
port refused, headers, binary bodies, size limits, redirect not followed, wildcard and IPv6,
unreachable and silent services, scan reuse), `apps/server/tests/run-processes.test.ts` (rights and
workspace access of the method), `workspace-owner-access.test.ts`, `workspace-foreign-machine.test.ts`
(a service on a workstation through its connection), `run-workspace.test.ts` (placement with the
current label), `apps/web/tests/run-processes.test.ts` (link rules; the browser fixture with a port
on a workstation), `run-panel-host.test.ts` (bridge message), and
`apps/vscode/tests/service-tunnels.test.ts` (against the stub server: same or free port, reuse,
headers and binary bodies, refusals with their status, end by check, connection, and deactivation,
413 and 501).

## 2026-10-03: The `developer` profile loads the C# solution at run start and brings the browser

Chapters: `spec/profiles.md` (Profiles); handbook: `development.md` (The profiles).

**Why.** The programming profile is the one a developer starts locally from VS Code (a connection
with `profileFile`) without a central server. It lacked browser checks and watchers, and C#
diagnostics only started once the coordinator called `roslyn_open`, so a project-specific copy
was the only way to get a working default.

**Decision.** `ragents.config.developer.ts` adds `ragents.browser` and `ragents.watch` and sets
`ROSLYN_SOLUTION_ON_START` to `on`: one solution loads directly, several are offered as a question,
none starts nothing. TypeScript and F# stay on demand. Without `BROWSER_EXECUTABLE_PATH` the
browser is the provisioned Chromium, so the file names no machine path.


## 2026-10-02: Rooms delimit parts of a run; every run script start opens one

Chapters: `spec/core.md` (Rooms; IDs, handles, and creating actors again; Actor roster and
workspace in the system prompt; File format, write boundaries, and replay; Open limits),
`spec/typescript-platform.md` (Execution and context; Run scripts as prepared actor programs),
`spec/actor-programs.md` (Packages and actor binding; functions as tools), `spec/plugins.md`
(shared actor packages; reference templates; browser checks), `spec/overview.md` (terms);
usage: `usage.md`; concept: `concepts/rooms.md` (the interface).

**Why.** A repeated start of the same run script reused the script's actor, so two reviews of two
changesets in one run shared one setup actor, its state, and its participants. The owner wanted a
delimited part of a run with its own actors, state, apps, and conversation, but the same run,
journal, workspace, and folder, flat beside the main room, with addresses that a model takes from
tool results instead of building them.

**Decision.** The journal gets `room.opened` (`name`, `origin`) and `room` on `agent.spawned` and
`script.created`; file format 12, readable 7 to 12, because an older version would reject the new
event. Without the field an actor stands in the main room, so older journals load unchanged.
`RunState.rooms`, `Actor.room`, and `RunView.rooms` are projections. An address is `room.name`,
the bare handle in the main room; one resolver (`actorByReference`) reads a reference from the
caller's room: ID, then an exact dotted handle of an older journal, then `room.handle`, then a bare
name in the caller's room and in the main room. Bare handles are unique within a room and between
the main room and every room, so a name never means two actors from one room; new handles of
agents and TypeScript actors contain no dot. Tool results, the roster, delivered event headers,
and creator notices show addresses from the reader's room (`addressFrom`); surfaces for people
show `addressOf`. Agents join their creator's room. A run script start, new run or embedded,
chooses a free room named after the script and opens it in the command that creates the setup
actor, so a failed start leaves no empty room; bundled programs become the room's packages
(`@actors/<room>.<name>`), shared packages stay in the main room, and the reuse of an earlier
start's setup actor is removed. Package names in the program functions are relative to the
caller's room like addresses, a published tool without targets reaches its package's room, and
a program's `context.actor.handle` is the address as its acting principal's room writes it.

Rejected: nested rooms, because a flat set with an origin keeps addresses to at most one dot;
a room ID beside the name, because the name is unique, never reused, and already the address;
opening the room in its own command before the start, because a failed start would leave an
empty room and consume its name; allowing a room to shadow a main room name, because a bare name
would then mean different actors in different rooms with no way to write the hidden one; a model
function that opens a room, because no current case needs it. Verified with
`packages/ragents/tests/rooms.test.ts` (resolution, free names, dot rule, opening with the first
actor, spawning into the creator's room, caller-relative tool output and roster, namespace rule,
replay and isolation, an older journal with a dotted handle),
`apps/server/tests/run-script-in-run.test.ts` (a room per start with its own actors, bundled
programs per room, origin of a room opened from a room, results and program functions relative to
the caller's room, shared packages in the main room), `reference-run-scripts.test.ts`, and
`apps/web/tests/addressee-tree.test.ts` (groups per room).

## 2026-10-02: A workspace tab can be a header window instead of a rail tool

Chapters: `spec/plugins.md` (Web extension points; docking workspace; sidebar tabs; Open limits);
usage: `usage.md` (Run panel and VS Code extension).

**Why.** A plugin view that is used like a mini-app, large and beside the chat, was reachable only
through the narrow rail and the sidebar flyout; dragging it into the dock every time was the only
way to give it room. The owner asked for a way to show such a tab like a mini-app.

**Decision.** `WorkspaceTabContribution` gets `placement?: "sidebar" | "window"`, default
`"sidebar"`, which keeps the rail unchanged. With `"window"` the browser treats the same
contribution as a view: its panel ID is `tab:<id>` instead of `tool:<id>`, so it lives in the
tree, `known`, `closed`, and the header `order` and never in `bar`, without a second set of tree
operations. It joins the layout like a new app (also after Reset layout), and the catalog lists
window tabs after Chat and before apps so that later apps still join at the end. Its `Badge` and
pending activity become a dot on its header button, menu entry, and the "All windows" button; its
`Header` renders in the area header. `selectDockPanel` now ignores IDs outside `known`, so
`openTab` cannot write an invalid layout. VS Code keeps such tabs in its rail: its editor tabs
exist only for mini-apps, and an editor layout for workspace tabs would need a new contract
between panel, frame, and extension.

## 2026-10-02: A workstation is shown with its current label

Chapter: `spec/plugins.md` (Workspace binding).

**Why.** The binding freezes the workstation's label in the run's start option, so a workstation
renamed after the run started kept its old name in the location line, the run list, and the run
header for good. The client ID is the identity; the label is presentation. The views now take the
label from the registry while the workstation is signed in and fall back to the stored one only
while it is not.

## 2026-10-02: The agent graph grows with its content and pans; the addressee chip gets a way back

Chapters: `spec/plugins.md` (Web as plugin host: run panel, addressee graph);
usage: `usage.md` (Run panel and VS Code extension).

**Why.** The addressee pop-out and the "Agents" view had fixed sizes (560 and 680 pixels high), so
a small graph sat in a mostly empty panel and a large one scrolled with scrollbars in a box much
smaller than the window. The owner asked for the panel to use the available space, for panning by
dragging when even that is not enough, for the pop-out without its "Addressee" title, and for a
one-click way from another actor back to the coordinator.

**Decision.** `ActorPopout` is sized by its content up to Base UI's `--available-width` and
`--available-height` and passes that room, less its fixed-height header, to its body as
`--popout-body-width` and `--popout-body-height`. `ActorGraph` measures the room on a hidden probe
and takes the column count from it, so the layout no longer depends on the size it produces.
`graphViewport` makes the view as large as the layout up to the room per axis; an axis that does
not fit pans over the cards plus 40 pixels. Panning reuses native scrolling with hidden scrollbars,
so wheel, trackpad, touch, and focus scrolling keep working and the browser keeps the limits; a
left-button drag of 5 pixels or more scrolls by the pointer delta divided by the page zoom, as
`DockWorkspace` corrects its deltas, and swallows the click that ends it. The chosen actor stays
centered until the first press, wheel, or key, because the room settles only after Base UI has
positioned the pop-out. After a group click the group card keeps its screen position as far as the
limits allow; a one-time `ResizeObserver` applies it again once the pop-out has moved, because
Base UI repositions in its own resize notification. The pop-out drops its header: the label only
names the dialog, the close button sits in the top right corner, and Escape and a click outside
still close it. The chip shows an x "Back to @<handle>" while the addressee is not the actor
`selectedRunPanelActor` picks without a stored choice. `graphColumns` no longer reserves 16 pixels
for a scrollbar.

Rejected: panning with a CSS transform and own wheel, touch, and focus handling, because native
scrolling already provides all of them; measuring the pop-out's header in JavaScript instead of a
fixed header height in a CSS variable; keeping the group card's place relative to the view instead
of the screen, because the two pop-outs grow towards different sides. In the pop-out above the
input a group card cannot keep its screen position when the pop-out grows upward past it; it then
stays in view. Verified with `apps/web/tests/actor-graph.test.ts` (columns, viewport, pan limits,
pan target), `apps/web/tests/addressee-control.test.ts` (the x only for another actor), and
`apps/web/tests/actor-graph-browser.test.ts` (compact small graph, pop-out grown to the window,
drags from the background and from cards clamped 40 pixels beyond the cards, a short press picks,
wheel, Tab into view, group card kept on screen in the Agents view, the x returns to the
coordinator, drag under a 125 percent page zoom).

## Actor workspaces relink libraries of an earlier host version (2026-10-02)

Chapter: `docs/spec/actor-programs.md`. After a host update, a run created under the earlier version
failed to start run scripts with "The prepared library ... has a different origin", because the links
in its actor workspace still pointed to the previous host's libraries. `prepareAppDependencies` now
replaces such a link with one to the current host's library; a real folder in its place stays an error.

## 2026-10-02: A run header too narrow for the window buttons shows one "All windows" menu

Chapters: `spec/plugins.md` (Web as plugin host: docking workspace);
usage: `usage.md` (Use chat and mini-apps, Run panel and VS Code extension).

**Why.** In a very narrow run header "Empty space" simply disappeared, the remaining buttons
shrank to identical app icons, and with more than five windows only the windows moved into a
menu while "Empty space" and "Reset layout" stayed outside. The owner asked for one place for the
whole group when it does not fit.

**Decision.** `DockWindowActions` shows either all direct entries (views, `extra`, "Reset layout")
or one "All windows" `DropdownMenu` with all of them: the views in header order as checkbox items
checked while visible, then "Empty space" and "Reset layout" after a separator, with the same
actions as the buttons. The switch is a container query on `@container/run-header`, as for the
labels of "Run script", "Share", and "Agents", with one named size per number of direct entries
(`@md` for one up to `@4xl` for six): below it the buttons would lose even the first letter of
their labels beside the other header actions, measured in the docking fixture with the real
`RunPanelHeader`. Both variants are rendered and CSS hides one, so nothing is measured at runtime,
nothing flickers, and dragging and reordering stay on the visible buttons. The rule of more than
five windows stays, now for the whole group: a longer row no longer reads at a glance, and seven
entries would need a run header wider than 56rem before every label fits. The menu button shows
the icon and name of the focused area's active tab (`focusedDockWindow` in `dock-state.ts`, which
`useDockActiveApp` now shares) and is named "All windows, <title>". VS Code has no run header
container, so only the five-window rule applies there; the host API keeps its names and
`HOST_API_VERSION`, `active` is a new optional prop.

Rejected: measuring the free width with a `ResizeObserver`, because the actions slot takes its
width from its content and would oscillate between the two variants; one fixed breakpoint,
because the room the group needs grows with every window; keeping "Reset layout" beside the menu,
because the narrow header then still carries two controls for one group; showing the first
visible window in the menu button when a tool or an empty pane is in front, because the button
should name what the focused area shows. Verified with `apps/web/tests/dock-state.test.ts`
(focused window) and `apps/web/tests/dock-windows-browser.test.ts` (real run header: buttons when
wide, reorder by drag, menu when narrow with order, checks, Empty space, Reset layout, keyboard,
no overlap with the other header actions, more than five windows), plus the updated overflow
check in `apps/web/tests/docking-browser.test.ts`.

## Web halves load under their bundle revision (2026-10-02)

Chapter: `docs/spec/plugins.md` (Web as plugin host). After a deploy, a browser behind a proxy that
overrode the cache headers kept an old web half under the unchanged address `/plugins/<id>/web/index.js`
and the profile failed to load ("requires the guide ..., which no active plugin provides").
`ragents.plugins.bootstrap` now names `web.entry` and `web.css` with `?v=<bundle revision>`, like the
versioned stylesheet; the file route ignores the query. Cross-plugin exports under
`/plugins/<id>/web/exports/` keep their fixed addresses.

## 2026-10-02: "Empty space" adds empty panes that hold a place in the browser dock

Chapters: `spec/plugins.md` (Web as plugin host: docking workspace);
usage: `usage.md` (Use chat and mini-apps, Run panel and VS Code extension).

**Why.** The owner wanted to reserve room in the layout before deciding what goes there: an
always-present header entry that adds an empty pane, several if needed, which behaves like any
window and takes the window that is dropped onto it.

**Decision.** An empty pane is a regular dock panel with the ID `empty:<uuid>`, so moving,
splitting, merging, maximizing, closing, grips, and persistence come from the existing tree
operations unchanged. It exists only in the tree and in `known`: closing removes it instead of
listing it in `closed`, reconciliation keeps it although no catalog names it, and "Reset layout"
drops it. `addDockEmptyPane` adds one through `revealDockPanel` (click) or `moveDockPanels` (drop on
a guide) and changes nothing when the pane would not land. A center drop on an area whose active
tab is an empty pane replaces that pane in place; the whole content of such an area is a center
target, and the compass center reads "Replace empty pane". The header entry is the new optional
`extra` of `DockWindowActions`: always direct after the views, also beside the "All windows" menu,
outside the header order and the menu count, so five windows still fit before the menu appears.
A run header narrower than 18rem hides it, as it hides the Share and Agents labels, because the
actions there have room for Chat and "Reset layout" only.
Dividing the space is meant, like splitting beside any pane; nothing about permissions or sharing
a run changes.

Rejected: reusing the existing empty area (a group without tabs), because it cannot be a tab, be
dragged as a window, or exist several times in one area; making "Empty space" part of the header
order, because it is an action that creates panes, not a window with a state; replacing an empty
pane that waits as a background tab, because the user cannot see what the drop would replace.
Verified with `apps/web/tests/dock-state.test.ts` (adding, several panes, closing, reconciliation,
reset, replacement, hit testing, validation) and `apps/web/tests/dock-windows-browser.test.ts`
(click and drag from the header, hint, drops from the header and from a tab, moving, closing,
reload, reset).

## 2026-10-02: Header window buttons get grips, reorder by drag, and dock onto the workspace guides

Chapters: `spec/plugins.md` (Web as plugin host: zoom, docking workspace);
usage: `usage.md` (Use chat and mini-apps, Run panel and VS Code extension).

**Why.** The run header lists Chat and every mini-app as buttons, but they could only be clicked.
The owner asked for a visible drag affordance, for reordering the buttons, and for dropping a
button onto the docking guides exactly like a tab, while a plain click keeps opening the window.

**Decision.** In the browser, `DockWindowActions` receives optional drag props from `DockWorkspace`:
each direct button shows a small `GripVerticalIcon` inside its existing left padding, so the
header needs no extra width, transparent until hover,
focus, or drag and always shown under `pointer: coarse`, and the whole button starts the dock's
existing pointer gesture. Below 6 px of movement it stays a click (`revealDockPanel`); inside the
"Layout actions" group the drop inserts the view before the button whose center lies right of the
pointer, elsewhere the drag reuses `dockHitTest`, the guides, previews, and `moveDockPanels`.
Alt+ArrowLeft and Alt+ArrowRight reorder from the keyboard. The order is the optional `order` field
of the stored dock state (`dockWindowOrder`, `moveDockWindow` in `dock-state.ts`), so it shares
the per-origin and per-run storage, its validation, catalog reconciliation, and "Reset layout";
moving a button changes neither the tree nor the automatic layout. The header slot compares client
coordinates with client rectangles, so the page zoom needs no correction there. VS Code passes no
drag props and keeps its editor tabs; the host API keeps its names and `HOST_API_VERSION`.

Rejected: a separate storage key for the order, because reset, validation, and reconciliation would
need a second copy; dragging only from the grip, because the requested threshold already separates
click and drag on the whole button; dragging entries of the "All windows" menu, because a popover
list makes a poor drag source and the menu follows the same order anyway. Verified with
`apps/web/tests/dock-state.test.ts` (order, moves, reconciliation, reset, validation) and
`apps/web/tests/dock-windows-browser.test.ts` (grips on hover, focus, and touch, header reorder with
marker, no-op and Escape, click below the threshold, tap, compass split and merge from the header,
keyboard reorder, reload, page zoom, narrow buttons).

## 2026-10-02: The agents of a run as a top-down graph, in the addressee pop-out and in the run header

Chapters: `spec/plugins.md` (Web as plugin host, Run panel, Open limits), `spec/core.md` (Ownership);
usage: `usage.md` (Run chat and inspection, Run panel and VS Code extension).

**Why.** The addressee pop-out was an indented list: in a run with a coordinator, an implementer,
and 37 rule reviewers you could read who belongs to whom, but not what is going on, and it showed
neither how long an agent has been working nor where the working ones sit. The owner asked for a
top-down graph like the agent view of a coding assistant, without the search, and for a button in
the run header that opens the same view.

**Decision.** `ActorGraph` (`plugins/ragents.orchestration/web/run-panel/ActorGraph.tsx`) replaces
`AddresseeTree` and is the only renderer for the pop-out and for "Agents" in the header. The model
stays `addresseeTree`; `actorGraphLayout` (`actor-graph.ts`) places it as a deterministic tidy tree
with fixed card sizes and HTML cards over `SvgEdge` lines, without a layout library: the mini-app
renderer `FlowDiagram` (@xyflow/react with elkjs) is not in the host API and would add a large
library and an asynchronous layout to a pop-out that changes with every run event. Rows hold at
most as many children as fit the canvas width; further rows hang on a gutter line so no edge
crosses a card, and an open group frames its members with one edge into the frame instead of 37.
A card shows handle, state, task, waiting inputs, and a time: the running turn counts from
`startedAt` of the actor's lifecycle, otherwise the last finished turn from `RunView.turns`, both
already in the view. The search and `addresseeMatches` are gone: the graph shows every actor, groups
keep it short, and the addressee opens scrolled into view. The header button is a regular
`sessionHeaders` contribution with the new optional `placement: "bar"`, rendered by
`RunPanelHeader` next to "Share" instead of in the run details, so the host names no plugin;
`SvgEdge` is new in the web host API without a new `HOST_API_VERSION`, because nothing is removed.
The header view stores the addressee through the same run panel state as the chip; the run panel
now keeps every chosen actor's chat mounted, whichever way it was chosen.

Rejected: wrapping rows by width, because a big open group would then push its siblings into rows
far below; individual edges into every group member, because 37 lines with a bus per row read as a
grid; a separate header slot type, because `sessionHeaders` with a placement follows
`overviewPanels` and `startOptions`. Verified with `apps/web/tests/actor-graph.test.ts` (levels,
wrapping and gutter, group frame, columns, paths, durations, timings, group state),
`apps/web/tests/actor-graph-browser.test.ts` (pop-out and header view with 42 actors: hierarchy,
edges, ticking time, group open and closed, selection, scrolling into view, Escape),
`apps/web/tests/restricted-interface.test.ts` (bar placement), and
`apps/web/tests/run-panel-actors.test.ts` (shared addressee choice).

## 2026-10-02: A clicked template or run script shows that it is starting

Chapters: `spec/plugins.md` (Web as plugin host); usage: `usage.md` (Create your first run, Run
panel and VS Code extension).

**Why.** A click on a template in the start selection, on Start in VS Code, or on a run script in
the run header only dimmed all tiles until the run or the script appeared, so it was unclear
whether anything was happening. The browser's Start page already switched to "Starting run" at
once; the start selection after a guide or a Help sample, the run script list, and Start in VS
Code until the run panel took over did not.

**Decision.** `StartTile` gets `starting`: the tile stays at full opacity with `aria-busy`, and a
`Spinner` with "Starting ..." replaces "Start" or "Set up"; `StartTiles` takes the running start as
`starting` (an `entryId`, none for New chat) and locks every tile meanwhile. `StartSelection` and
`RunScriptMenu` keep the started entry instead of a flag. Start in VS Code keeps the sent `newRun`
together with the `PanelState` it was sent from and shows it as starting only while that state is
current, so the next state ends it without a protocol change; the extension therefore renders the
page after every `newRun`, also after a cancelled folder choice or a failed start.

## 2026-10-02: Zoom setting in the browser

Chapters: `spec/plugins.md` (Web as plugin host, Open limits); usage: `usage.md` (Settings).

**Why.** VS Code scales the interface with `ragents.zoom`, the browser had only its own page zoom.
Settings, Appearance, Zoom now offers 80 to 150 percent per browser and server address, stored like
the appearance under `ragents.zoom` and only in the host `browser`.

- CSS `zoom` on the root element instead of a second iframe shell as in VS Code: the browser page
  has no shell, and CSS `zoom` scales text, controls, spacing, and mini-app frames together.
- With CSS `zoom`, client coordinates and element rectangles are already zoomed, and a pixel
  position a script writes from them is zoomed once more. Base UI (Floating UI) corrects this only
  when the offset parent of a popup is an element whose rendered and layout widths differ; `body`
  is therefore `position: relative`.
  Without it, popovers and menus landed far off their anchor at 130 percent, in Chrome and WebKit.
- The dock computed hit tests and divider ratios from client coordinates against its unzoomed
  geometry, so areas resized faster than the pointer and drops missed their guide. It now divides
  pointer movements by its container's ratio of rendered to layout width, which needs no newer
  browser interface such as `currentCSSZoom`.
- No settings right: the zoom changes only the own display, like the browser's page zoom that no
  right can prevent either.

## 2026-10-02: Pages link the stylesheet under its content hash

Chapters: `spec/plugins.md` (Web as plugin host).

**Why.** The server delivered `/ragents.css` with `Cache-Control: no-cache` and ETag, but behind a
CDN it arrived with `max-age=14400`. After a release Safari kept the old stylesheet for hours while
the scripts with hashed names were new, and the layout broke because new classes were missing.

**Decision.** The server writes the content hash of the compiled stylesheet into the link of
`index.html` and `run-panel.html` on every delivery (`/ragents.css?v=<hash>`) and delivers the pages
with `Cache-Control: no-cache`. Every compilation gives a new hash. Only the current versioned
address is answered with `public, max-age=31536000, immutable`; the plain address keeps working
with `no-cache` for callers that name it, and an outdated version gets the current stylesheet with
`no-cache`, so a page open during a recompile does not lose its styles. The VS Code shell and the
mini-app frames need nothing of their own: the shell loads `run-panel.html` from the server, and
the frames inline their styles.

## 2026-10-02: The share dialog is a list of users instead of dropdowns

Chapters: usage: `usage.md` (Share runs).

**Why.** The dialog hid the profile's users behind an "Add user" dropdown and chose each access
in a dropdown, so whom a run is shared with was not visible at a glance. Now every user is a row
with the switch "Off", "Can view", or "Can operate"; "Off" replaces the remove button.

## 2026-10-02: Stop in the chat pauses the whole run until a human continues it

Chapters: `spec/core.md` (Interrupting a turn, stopping an actor, stopping a run; Pausing a run;
Origin of an input; File format, write boundaries, and replay; Open limits), `spec/plugins.md`
(rights of run methods, chat composer); usage: `usage.md` (Run chat, Run panel and VS Code
extension, Control RAgents as an agent); homepage (Drive RAgents from outside).

**Why.** The chat's stop button called `ragents.runs.interruptTurn` and ended only the
coordinator's turn. A sub-agent the coordinator had started kept changing files, its next output
reached the coordinator through its subscription, and the coordinator started a new turn on its
own 42 seconds after the stop. To the operator, Stop had not worked. Between ending one turn and
stopping the run for good (`ragents.chat.stop`) there was no way to halt and continue later.

**Decision.** Stop in the chat (web, VS Code, actor chats, global coordinator) and `ragents stop
<run>` call the new `ragents.runs.pause`; `ragents.runs.resume` and `ragents resume <run>`
continue without a message, and every human input continues as well. The state comes only from
the journal: `run.paused` (`reason`, `userId`) and `run.resumed` (`trigger` input or resume,
`userId`), written by the owner, projected as `RunState.pause`, so it survives replay and restart.
The journal writes format 11 and reads 7 to 11. `ragents.runs.interruptTurn` stays for ending a
single turn (`ragents stop <run> --turn`), `ragents.chat.stop` stays the emergency stop (`--run`).

- Order: `run.paused` is written before the running turns of all actors are interrupted, not after.
  Written afterwards, a turn could start in the gap between two interruptions, for example from
  the subscription delivery of an interrupted sub-agent, which is exactly the observed failure,
  and a crash during the interruptions would leave the run unpaused. The decision of
  `turn.started` and the journal check reject a turn in a paused run.
- Nothing is lost: inputs are written as before and only not delivered. The interruption of a
  sub-agent produces the usual automatic notice to its creator, so the coordinator learns on
  resume what was interrupted.
- Order on resume: a human input writes `run.resumed` and its `actor.input.enqueued` in one
  command. The input model already bundles: the primary actor's turn claims its oldest waiting
  input, and steering feeds all further waiting inputs into the same turn before the first model
  request, in journal order. The human input is the newest and therefore the last message, the
  current instruction. No new delivery path was needed.
- Sub-agents do not continue by themselves: the pause marks every active executable actor as
  `held`; `run.resumed` releases only the primary actor, every other actor is released when a
  human or another actor addresses it directly after the pause, or by a restart. Automatic inputs
  (subscriptions, notices, plugin inputs under the owner) leave it held and wait.
- Actor programs and run scripts: a running turn of a TypeScript actor ends like an agent turn and
  its claimed input is consumed; afterwards it is held like a sub-agent unless it is the primary
  actor. Program processes keep running, and functions and app actions a person calls from a view
  are no turns and keep working; inputs they enqueue wait. A run script that was interrupted
  during setup does not repeat its start input. Background processes keep running.
- `ragents.runs.enqueueInput` now sets `origin: "human"`: a user calls it with their access, and
  as a human input it must resume a paused run. As a consequence it also closes the open questions
  of its addressee in `ragents.ask`, as a chat message does.
- The run chat marks every turn of the primary actor that no human input started with its trigger
  ("New turn, triggered by turn.finished of @implementer"), so an automatic turn is never mistaken
  for a failed stop. Run list, status icons, and VS Code know the state "paused".
- The abort of a running model request reaches the provider's HTTP connection; a test with a local
  streaming endpoint checks this for OpenRouter and OpenAI-compatible providers.

## 2026-10-02: Runs are shared from the run list and the run header, in the browser and in VS Code

Chapters: `spec/plugins.md` (Web as plugin host: rights in the browser, run panel header, Start
and Runs), `spec/profiles.md` (Run ownership); usage: `usage.md` (Switch runs, Run panel and VS
Code extension, Share runs); homepage (Current status and limits).

**Why.** Runs could be shared only through the API and the command line. The owner wants sharing
where runs are chosen and worked on: in the run overview and inside the run, in both hosts.

**Decision.** One `ShareDialog` (`panel/ShareDialog.tsx`) serves every place. It takes the loaded
sharing, a save function, and the close from its host and edits the whole sharing as a local draft
(`run-sharing.ts`; `sameSharing` decides whether Save is enabled). The run list shows "Shared" or
what a share permits next to the title and, only when a listed row may be shared, "Share ..." in an
extra last column; `ConnectionRun` takes `canShare`, `shared`, and `sharedAccess` from the run
list, not `operable`, which no row needs. Start and Runs send `openSharing`, `share`, and
`closeSharing`, and the host keeps the dialog in `PanelState.sharing`: the browser's run panel
against its own server, the extension through the connection's client, both with the same
`openSharing` and `saveSharing`, so the panel pages stay identical. The run header offers "Share"
with `canShare`, also for a fresh run identifier before its first message, and a badge for
sharees. Read-only reuses the restricted interface: `RunAccessScope` drops `runs.write` from the
access context below a run with `operable: false`, so host and plugin controls that check
`runs.write` turn read-only without code of their own; the composer names the reason, and "Stop
run" disappears only for a read share, because others may still stop an `ownerOnly` run. A run
that leaves the list after it was seen as shared leads back to Start with a notice; VS Code gets it
as `showStart` with `notice` and shows it as `PanelState.notice`.

**Rejected.** A dialog per host: the VS Code panel page has no server connection, so the page stays
state-driven and only the transport differs. An action column on every list: it would take room in
profiles without sign-in. Hiding controls per plugin for read shares: the access scope covers every
`runs.write` check at once.

Verified with `apps/web/tests/run-sharing.test.ts`, `panel-page.test.ts`,
`restricted-interface.test.ts`, `run-overview.test.ts`, `run-panel-host.test.ts`, the browser test
in `panel-pages.browser.test.ts`, and `apps/vscode/tests/overview-model.test.ts` and
`extension-bundle.test.ts`.

## 2026-10-02: `agent_spawn`, `actor_input`, `todo_write`, and the document tools take the shapes of the common agent harnesses

Chapters: `spec/core.md` (Actors, inputs, events, and subscriptions; Automatic notices and rejected
calls; Delivery of subscriptions; Artifacts, attachments, and ownership; Equipping subagents),
`spec/plugins.md` (Ownership per facet; Workspace, sandbox tools, and processes),
`spec/actor-programs.md` (Connect workflow definition, instructions, and presentation); usage:
`usage.md` (Run chat and inspection).

**Why.** Models call these functions in the shape Claude Code and OpenCode taught them. There the
subagent tool takes `prompt` as the task and `description` as a short label; our `agent_spawn` took
`prompt` as the system prompt and the task only with a second call, so a model that put its task
into `prompt` got an idle agent with the task as its role. `actor_input {actor, content}` differed
from `SendMessage {to, message}`. `todo_replace` with `id`, `text`, and `open`/`active` needed a
synonym table and differed from `TodoWrite`. `show_document` named a file of the file store in
`path`, while `read` names workspace files, so models retyped workspace files into `content`, and
`document_write` even told them to.

**Decision.** A breaking change; old fields are rejected as unknown. Verified against the Claude
Code tools reference, `sdk-tools.d.ts` of `@anthropic-ai/claude-agent-sdk` 0.3.287, the schema of
`SendMessage`, and OpenCode's `task.ts` and `todo.ts`.

- `agent_spawn`: `description` (required, the standard's label of a few words, also the participants
  overview), `prompt` (the first task, enqueued as `actor.input.enqueued` in the same command as
  `agent.spawned`, which therefore also needs `actor.input`), `name` (the standard's addressable
  name, formerly `handle`), `instructions` (the system prompt, formerly `prompt`; the journal keeps
  it as `agent.spawned.prompt`), everything else unchanged; `model` already had the standard name.
  `subagent_type` is not taken: a role from `model_list` supplies only driver, model, reasoning, and
  limits, neither prompt nor tools, so it is no agent type and stays `profile`. `prompt` stays
  optional, unlike the standard, because setups create idle participants and subscribe before the
  first task: a task given at the spawn starts at once, and a later subscription can miss its first
  answer. The descriptions say how answers come back (a subscription; automatic notices for
  failures) and which function creates what: `agent_spawn` one agent in this run, `actor_input` a
  message to an existing actor, `run_script_start` a prepared setup. No function of a run creates
  another run; there are no sub-runs.
- `actor_input {to, message, artifactIds?}`; the name stays the core term. The operation
  `actor_input` of `ragents.orchestration` takes the same schema; `ragents.runs.enqueueInput` is no
  model contract and keeps `actorId` and `content`.
- `todo_write {todos: [{content, status: pending | in_progress | completed, activeForm}]}` replaces
  `todo_replace`: closed items, every call replaces the whole list, native by default, sequential.
  The plugin state has the same shape, and the actor card shows `activeForm` for the item in
  progress. A to-do state of the old shape is neither migrated nor read: the card shows no list
  until the next `todo_write` replaces it. The run stays usable, because the core never reads plugin
  state; locking a run for an old to-do list would be out of proportion.
- `show_document {title, file_path | storePath | content, format?}`: `file_path` names a file
  exactly as `read` does (same field, same roots including the read-only `@skills`, the same alias
  routing, workstations included). The call checks it through the new executor operation
  `files.text` (the whole text up to 256 KB, not binary; `WORKSPACE_EXECUTOR_VERSION` 9 covers it),
  and the display reads the current content through a route that needs `runs.inspect` and workspace
  access, like the Files view. The storage case stays as `storePath`, because the file store is no
  root `read` reaches and a report written with `document_write` must be shown without retyping.
  The result is only "Shown to the user.". `document_write {storePath, content | file_path}` had
  the same mismatch: `file_path` now copies an existing file unchanged.
- Old journals load unchanged: the events keep their payloads, and a replay executes no tool. Old
  `agent_spawn` and `actor_input` calls show their old arguments in the chat; an old `show_document`
  call with `path` opens no document card anymore, while displays of `content` still do.

## 2026-10-02: `read`, `write`, `edit`, and `bash` take the shapes of the common agent harnesses

Chapters: `spec/plugins.md` (Workspace, sandbox tools, and processes; Open limits), `spec/core.md`
(Model context and agent runtime: file editing); operations: `operations.md` (Time limit of
`bash`).

**Why.** Models are trained on the file and shell tools of Claude Code and OpenCode and call
look-alikes in that shape. Our tools came from a forked coding agent: `read` and `write` took
`path`, `edit` took a list `edits` of `oldText` and `newText` with the anchors `occurrence` and
`nearLine`, and `bash` took `timeout` in seconds up to 3600 with an open schema that silently
dropped fields such as `run_in_background` and `description`. `read` returned the bare text without
line numbers. Every look-alike call cost a failed validation or, worse, ran differently than the
model expected.

**Decision.** A breaking change without accepting the old schemas; names stay lower case, fields
follow Claude Code exactly, and all four schemas are closed. `read {file_path, offset?, limit?}`
numbers the lines in cat -n style (`N<tab>line`), reads up to 2000 lines and 50 KB, cuts lines
over 2000 characters, and warns about an empty file or an offset behind the end. `write
{file_path, content}` says whether it created or updated. `edit {file_path, old_string,
new_string, replace_all?}` makes one replacement per call with the standard's errors; an ambiguous
match names its lines, an empty `old_string` creates a file, and deleting a text that ends a line
takes its line break along. The stale-file protection follows Claude Code too: editing or writing
an existing file needs a read; a changed file makes `write` fail ("File has been modified since
read ..."), while an `edit` still applies when `old_string` selects its target and then says that
the file contains changes the model has not seen, keeping the old seen state, so a later `write`
needs a new read. `bash {command, timeout?, description?, run_in_background?, cwd?}` takes
milliseconds, default 120000, at most 3600000. The upper limit deliberately exceeds Claude Code's
600000: cold builds of real projects take longer, there is no background mode to fall back on, and
models trained on the standard simply stay below it. `description` labels the call in the chat line.
`run_in_background: true` is rejected with the alternative, because a call ends with its process
group and nothing could read a background command's output later; the Processes view only
observes and stops what a run leaves behind. `cwd` stays although the standard has none: every call
starts anew, and an alias such as `@actors/<name>` names a root on the server, so the folder must
pick the machine before the command runs. `RAGENTS_BASH_TIMEOUT_SECONDS` keeps its unit for the
operator and stays at most 3600. `WORKSPACE_EXECUTOR_VERSION` is 9, because a workstation with the
old executor would read the old fields. Old journals keep their arguments; a replay executes no
tool, the chat still shows their `path`, and a continued old conversation sees the old calls only as
history.

## 2026-10-02: Browser tools take the names and fields of the Playwright MCP server

Chapters: `spec/plugins.md` (Browser checks); `docs/development.md` (Testing a workspace on another
machine); the skill `browser-testing` and the prompt chapter of `ragents.browser`.

**Why.** Models call tools in the shape the leading agent harnesses taught them. For browser
control the de-facto standard is Microsoft's Playwright MCP server. Our names (`browser_open`,
`browser_fill`, `browser_select` ...) and fields (`value`, a single `label`) differed from it, so a
model had to learn a second vocabulary for the same actions.

**Decision.** The browser tools carry the upstream names and input fields, verified on 2026-10-02
against the README of `microsoft/playwright-mcp` and the tool sources in `microsoft/playwright`
(`packages/playwright-core/src/tools/backend`): `browser_open` is now `browser_navigate`,
`browser_fill` `browser_type` (`value` became `text`, plus upstream's optional `submit` and
`slowly`), `browser_select` `browser_select_option` (`label` became `values`, each matched against
an option's value or visible label), `browser_press` `browser_press_key` (`target` optional; without
it the key goes to the focused element, as upstream), `browser_viewport` `browser_resize`, and
`browser_screenshot` `browser_take_screenshot`. `browser_snapshot`, `browser_click`, and
`browser_close` already matched. The old names are not kept as aliases. Executor operations and
server methods follow the same names (`browser.navigate`, `browser.type`, `browser.selectOption`,
`browser.pressKey`, `browser.resize`, `browser.takeScreenshot`; `BrowserRuntime.navigate`).
`target` keeps its name, because upstream's locator field is also `target`, but stays an object of
role/name, label, text, test ID, or CSS instead of a snapshot reference: models do not copy IDs.
`browser_check`, `browser_view_screenshot`, and `actor_view_snapshot` have no counterpart in the
MCP server and keep their names; results, evidence, and time limits are unchanged. Under the new
native default the plugin drops its explicit `nativeTool: true`, so every browser tool is native,
now including `browser_resize`; every browser tool keeps `executionMode: "sequential"` explicitly.

Old journals keep the old names. Replay and the chat display take tool names as recorded and need
no tool of that name. An agent whose fixed tool selection names an old browser tool runs on without
it; a newly created or restarted one is stopped with the unresolved names, as for any missing tool.
Nothing is migrated.

**Rejected.** Splitting `browser_check` into upstream's `browser_verify_*` tools, which the MCP
server offers only with `--caps=testing`: one call proves target, text, address, count, and errors
together and records the evidence. Upstream's `element` permission field, the click options
`doubleClick`, `button`, and `modifiers`, the screenshot `filename`, and the snapshot options: no
caller needs them yet. Playwright's CLI skills also define a `browser_check` that ticks a checkbox;
the MCP server does not expose it, so the name stays with the assertion.

Verified with `apps/server/tests/browser-tools.test.ts`, `browser-executor.test.ts`,
`browser-view-snapshot.test.ts`, `workspace-foreign-machine.test.ts`, `profile-composition.test.ts`,
and the real-browser test `browser-live.test.ts`.

## 2026-10-02: Every function is a native tool unless it opts out

Chapters: `spec/plugins.md` (Provide functions, plugin contract list), `spec/typescript-platform.md`
(One-off snippets), `spec/core.md` (equipped LLMs); `docs/development.md` (What is built in).

**Why.** In a real run with a small local model, four of ten failed calls were functions such as
`actor_list`, `model_list`, `run_script_list`, and `agent_spawn` called directly although they
were snippet-only; every such detour costs a model step and a compiler run, and the previous rule
("native only for what the model reads by itself") had to be decided anew for every function.
The requirement was to turn it around: native by default, snippet-only by explicit opt-out.

**Decision.** `isNativeTool` treats a function as native unless it sets `nativeTool: false`; the
toolset, the plugin host, the descriptor check, the engine descriptors, and the generated catalog
use it. This includes actor-program functions that are activated during a run: the system prompt
already changed with them before. The engine's four journal event functions opt out, because
their raw results belong in code and `watch_*` covers waiting for models. The orientation in the
system prompt no longer repeats native tools, whose descriptions already arrive with the tool
definitions; it explains the snippet path and lists only snippet-only functions. Prompts that
routed single calls through `typescript_eval` (orchestration, actor programs, global coordinator,
core contract) now name the direct call. Explicit `nativeTool: true` is redundant and is removed.
Functions only programs may call stay limited by availability. A native function without
`executionMode` now runs sequentially instead of in parallel (before, only names starting with
`agent_`), because most newly native functions have side effects that were ordered by snippet code
before; every previously native function already declared its mode. Open: how small local models
handle the larger tool list (`TODO.md`).

## 2026-10-02: Runs can be shared with all users or with individual users, each for reading or writing

Chapters: `spec/profiles.md` (Run ownership, Sharing in detail, Ownership in detail, Open limits),
`spec/core.md` (File format, write boundaries, and replay: format 10), `spec/plugins.md` (method
rights of the message layer); usage: `usage.md` (Control RAgents as an agent, Drive runs from
external clients); `docs/development.md` (journal example), `skills-for-agents/ragents/SKILL.md`.

**Why.** A run belonged to its creator alone; colleagues could only watch it with `runs.read.all`,
which opens every run of the profile. The owner wants to let selected people or the whole profile
watch or join a single run.

**Decision.** A run is shared with `everyone` (all users of the profile) and with individual users,
each with `read` or `write`; a user gets the higher of both. `read` sees the run (list, chat, apps,
journal as far as the user's own rights go, the workspace unless only its owner reaches it) and
operates nothing: every operating path answers `run-read-only` (403) instead of disguising the run.
`write` sees and operates like `runs.read.all` for this run, within the user's own rights; a run
that only its owner operates stays the owner's. Only the owner and `runs.read.all` change the
sharing (`ragents.runs.sharing`, `ragents.runs.share`, full replacement), only with sign-in; a
coordinator and a run without an owner are not shareable. Deleting stays with the owner and
`runs.read.all`; a sharee never deletes (`run-delete-denied`). Ownership is never rewritten.

The journal event `run.sharing-changed` (`everyone`, `users`, `changedBy`) replaces the whole
sharing, authored by the run's human owner actor, and projects into `RunState.sharing`, which the
run view for clients leaves out like the owner. Before the start, the server keeps a choice per
user under the free identifier, like the start options, and only the creating user's choice joins
the creation record; an unchanged sharing writes nothing. Because an older version would reject
the new event, the journal writes file format 10 and still reads 7 to 9, as for format 6 with
`turn.input-steered`; nothing is migrated. `RunAccessPolicy` carries the sharing; `rights.ts`
separates visibility (`runVisible`: own or shared), workspace access (the `ownerOnly` rule alone),
and operating (`ownerOnly` and read shares), and the run rights `stop`, the message layer for
`runs.write`, `ragents.overseer.stopRun`, and writing requests on delivery routes refuse read
shares. `ragents.runs.list` adds `operable`, `canShare`, `shared`, and `sharedAccess` per caller.
A sharing change notifies the run list listeners, and the dispatcher ends every channel with
`runId` whose caller no longer sees the run (`watchRunAccess`), so revocation does not wait for a
reload. `ragents.overseer.createRun` takes `sharing`, `ragents run` takes `--share` and
`--share-all`, and `ragents share` prints or replaces a sharing.

**Rejected.** Changing the owner or a list of owners: ownership stays the one fact the journal
records at creation. Hiding a read-only run's operating paths only in the interface: the server
must refuse them itself. A pending sharing per free identifier instead of per user: whoever creates
the run under a guessed identifier would inherit someone else's choice. Ending channels by checking
access on every message: the check reads the run state and would run for every streamed chat event.
Verified with `packages/ragents/tests/run-sharing.test.ts` (validation, projection, replay,
creation record), `apps/server/tests/run-sharing.test.ts` (rights, message layer, provider with
users, list fields, channels, overseer), and `scripts/agent/agent-cli.test.ts` (flags and `share`).

## 2026-10-02: `ask_user` takes the question shape of the common agent harnesses

Chapters: `spec/plugins.md` (Web as plugin host: questions of `ragents.ask`; language server
plugins: start question of `ragents.lsp-roslyn`), `spec/core.md` (journal: persisted plugin
contracts; wake-up guarantee); usage: `usage.md` (Run chat; Control RAgents as an agent);
`skills-for-agents/ragents/SKILL.md`, `selftest/GUIDE.md`.

**Why.** Models know the question tools of common agent harnesses and called `ask_user` in that
shape: a list `questions` with header chips and options that carry a description. Our tool took a
single `question` with `options` as texts and failed validation, so the model had to retry. One
question per call also forced related decisions into several turns.

**Decision.** A breaking change without accepting the old schema. `ask_user` takes `questions`
(1 to 4), each with `question`, `header` (at most 12 characters), `options` (2 to 4 entries of
`label` and `description`), and a required `multiSelect`; free text stays possible for every
question, so there is no "Other" option. One call is one action with the payload
`{ questions, recipient? }`; the shared rules in `ask-payload.ts` (non-empty texts, distinct
questions and labels, at least two options) are checked for every caller and name every path. The
user answers all questions of a call at once; `ragents.ask.answer` takes `answers` with one
`{ selected }` or `{ text }` per question, or `dismiss: true`, and the journal keeps `{ answers }`.
The answers reach the asker as one input with one line per question (`"<question>" = "<label>"`,
several labels comma-separated, a free answer marked `free answer`), quoted as JSON strings so
that no text can break a line. `AskService.ask` takes the same questions and resolves to
`{ kind: "answered", answers }` or `{ kind: "dismissed" }`; the start question of
`ragents.lsp-roslyn` and the confirmations of `ragents.actor-programs` use it, and
`answerMessageOf` gives a caller that forwards an answer the same text. The four-option limit is
the tool's, so the start question still lists every solution. Record texts read "Dismissed by the
user without an answer." and "Withdrawn without an answer." for one or several questions. The web
card shows all questions with chip, option descriptions, and a free answer field each, and one
submit; a single question with one choice still answers on click. The CLI prints one `? [<header>]`
line per question and keeps answering through `send`. Journals are not migrated: the host's
persisted-contract check next to the removed host layout rejects an action of `ragents.ask`
with the former `question` text instead of a `questions` list, answered or open, so such a run is locked with the cause and its files
stay as they are; the plugin, web, and CLI then never meet the old shape, and an answered record
could not be shown without keeping it. The declared exports of `ragents.ask` change (`AskRequest`,
`AskService.ask`, `answerQuestions`, `QuestionCard` props); they are not part of the host API,
whose names do not change, so `HOST_API_VERSION` stays 11.

## 2026-10-02: One run row for browser and VS Code; read markers per user on the server

Chapters: `spec/plugins.md` (run metadata, web slots, message layer, Start and run list, run
overview read state, state vocabulary time, open limits); `usage.md` (Switch runs, VS Code
extension, states).

**Why.** Browser and VS Code render the same `RunLine`, but fed it different data. The browser
knew only running or idle, no pending actions, and kept read markers per browser in
localStorage, which the VS Code Start page cannot see; it added owner and plugin metadata through
a render prop. The extension loaded the full run view of every run to compute waiting, ended, and
pending actions, and showed neither owner, metadata, nor read notices. Only the top line of a row
highlighted and opened the run.

**Decision.** `ragents.runs.list` now delivers per run `state` (running, waiting, idle, ended) and
`pendingActions`, computed on the server from the journal state with the former semantics of the
extension (`run-list-state.ts`), the caller's `seenRevision`, and `listDetails`. A server metadata
contribution declares `listDetail(value)` for its list line (label, text, icon folder or branch);
`ragents.workspace` reproduces its former list rendering there. The new method
`ragents.runs.markViewed` stores the highest viewed revision per user and run in
`run-read-markers.json` under the profile's data directory, written atomically and coalesced, and
removed with the run; a change reaches only the same user's `ragents.runs` subscriptions, the first
at once and further ones at most once per second, because the run panel reports every revision of
a viewed running run. The browser's localStorage read state is gone. One mapping
(`connectionRunOf`) turns a listed run into `ConnectionRun` for both hosts; `RunLine` renders owner
and lines itself inside the clickable item, and the `runDetails` render prop, the list placement of
the web `sessionMetadata` slot, `ConnectionRun.problem`, and the extension's run views for the list
(`run-model.ts`) are removed. The extension keeps its five-second poll and the run channel of the
selected run, which now only refreshes the list. Compact times drop the space (`5min`, `3h`, `1d`).
The host API names do not change, so `HOST_API_VERSION` stays 11; a plugin with a list component in
its web `sessionMetadata` must move that line to `listDetail` on the server, because the run list no
longer renders web components.

## 2026-10-02: Clipboard replies reach nested frames through their window; host API 11

Chapters: `spec/plugins.md` (VS Code host: hosted mini-app frames, clipboard relay);
`apps/server/src/host-api.ts`.

**Why.** The nested-input browser test lost editor focus after a paste in about two of three runs.
The shell and the run panel move focus while reading the clipboard; Chromium forwards these
changes to the mini-app process through the browser process, while the reply travelled over the
frame's MessagePort, which can overtake them. The requesting frame restored its input, and the late
focus update then cleared it (active element `BODY`, document without focus).

**Decision.** Each relay posts the `clipboardContent` reply into the requesting frame's window;
requests and keyboard events still use the token-checked port. Window messages arrive after the
sender's earlier focus changes, so the restored focus stays. `createClipboardReader` takes the
request transport, and the frame bridge reuses it. The regression test also requires
`document.hasFocus()`. Because `relayFrameInput` keeps its name but its `reply` must now post into
the child's window, `HOST_API_VERSION` rises to 11; plugin bundles are rebuilt against it.

## 2026-10-02: Docking guides win over a hover flyout; narrow headers; browser tests follow the spec

Chapters: `spec/plugins.md` (sidebar rail drop targets; run list notice).

**Why.** While a hover flyout is visible during a drag it covers part of the workspace: always the
right edge guide, and with the 630-pixel default also the compass of the area. `dockHitTest`
checked the rail and sidebar zone first, so dropping on a visible guide returned the tool to the
rail. Several browser tests had not followed earlier spec changes and failed on every run.

**Decision.** Guides now take precedence; the rest of the flyout and the rail remain the return
target. The shared header's coordinator field may shrink to 40 instead of 120 pixels, so a
220-pixel header no longer scrolls horizontally; from about 288 pixels on it is unchanged. The run
list notice sentence describes the dot inside the state ring and its tooltip. Stale browser tests
now derive sidebar widths from the default, measure the run script pop-out after its entrance
animation, expect the automatic split from 1000 pixels, find the notice in the state title, use
`data-tile` for Start tiles, expect chat detail levels that start `grouped` and stay separate per
display, and use a fit-width frame narrower than the graph's 80-percent width.

## 2026-10-02: The host ends the asker's turn after `ask_user`

Chapters: `spec/core.md` (Scheduler and turns, Turns of an agent), `spec/plugins.md` (Provide
functions, `ragents.ask`, Open limits), usage: `usage.md` (Control RAgents as an agent);
`skills-for-agents/ragents/SKILL.md`.

**Why.** Since `ask_user` stopped blocking, the turn ended only because the prompt told the model
to stop: every question cost one more model request, and weak models wrote redundant text in it.

**Decision.** A run function can end the caller's turn with its result (`RunFunction.endsTurn(output)`);
the toolset reports it as `ToolInvocation.endsTurn`, and `AgentTurn` passes it to the agent loop
as `terminate`. The turn ends only when every call of the model step sets it, and an error result
never does, also not when a hook turns the result into an error. An input waiting at that point
still joins as steering, as after a final answer; a later one starts the next turn. `ask_user`
ends the turn only when it posed a question, not with `SUPERSEDED_ANSWER`; a call through
`typescript_eval` does not end it. The host API is unchanged, because an optional field adds no
value name. Withdrawn questions (asker or run stopped, run deleted, wait cancelled) now carry
`{ withdrawn: true }` and read "The question was withdrawn." `ragents run` and `ragents send`
print a posed question with its options and how to answer it, `ragents journal` prints a
`QUESTION` line.

## 2026-10-02: Every input field described; `actor_restart` specified; subscription versus watch

Chapters: `spec/core.md` (Interrupting a turn, stopping an actor, stopping a run), `spec/plugins.md`
(Watchers with a wake condition).

**Why.** Many functions that models read through `typescript_api` had input fields without a
description; misleading or bare parameters made models misuse tools. `actor_restart` described
itself with an implementation remark, `event_subscribe` and `watch_create` gave no hint when to use
which, and since `ask_user` no longer holds the turn it was open whether a watch loses wakes for a
target with an open question.

**Decision.** Every input field of the engine and plugin functions now has a description, checked
by composing the engine and the showcase profile; result fields stay as they are. `actor_restart`
stays (operator button, actor program plugin, and run scripts use the same restart) and is
specified next to `actor_stop`: it makes a stopped actor of the caller's branch idle with history
and state unchanged. Subscription and watch stay separate: a subscription delivers every matching
event as its own input, a watch wakes once a derived state meets a condition; both descriptions
say so. A watch holds back wakes while its target has a pending question it asked, like during a
running turn; the held-back check is no evaluation, so the target is woken with the accumulated
changes once it is free. New tests cover the tool and the watch service. `browser_check` rejects
`count` together with `text` instead of ignoring `text`.

## Open installation layout (02.10.2026)

Chapter: `spec/overview.md`. The installation area uses underlined tabs and open command rows.
Removing the outer card and terminal frames reduces visual nesting; spacing and fine separators
keep the method, command, and copy action distinct. Installation choices and commands are unchanged.

## 2026-10-01: `ask_user` no longer holds the asker's turn

Chapters: `spec/plugins.md` (Web as plugin host: questions of `ragents.ask`; Open limits),
`spec/core.md` (Interrupting a turn, stopping an actor, stopping a run; Actors, inputs, events, and
subscriptions: wake-up guarantee; Origin of an input); usage: `usage.md` (Run chat and inspection);
`selftest/CATALOG.md` (T04), `concepts/acp-agent-drivers.md`. For questions of agents this
supersedes the entry "A message from the human ends a blocking question" (28.09.2026).

**Why.** A turn ends as soon as the actor calls no more tools; there are no waiting tools.
`ask_user` was the exception: its call stayed open until someone answered, so the asker's turn kept
running, steering waited behind the call, and a run with an unanswered question looked busy.

**Decision.** `ask_user` calls the new `AskService.pose`, which only proposes the action, and
returns at once `QUESTION_POSED`; tool description and prompt chapter tell the model to end its
turn. The question stays open after the turn, and an actor can have several open questions. The
answer or a dismissal by the user reaches the asker through the existing path as a new ActorInput,
as steering while its turn still runs. A human's message (`origin: "human"`) to an actor closes
every open question it asked without `recipient` as `dismissed` with `{ supersededBy }` and without
an answer input; the plugin reads these questions from the journal state, so the rule also holds
after a restart of the host. A message that already waits when the tool asks still means that no
question is created (`SUPERSEDED_ANSWER`). Stopping the asker (`actor.stopped`) and stopping or
deleting the run (lifecycle `stopSession` and `afterStopSession`) withdraw these questions without
an input. `AskService.ask` keeps its waiting form only for questions the owner asks outside a turn
(start question of `ragents.lsp-roslyn`, confirmations of the actor programs); its type admits only
`turnId: null`, and the turn-bound waiter (`blockedActorId`) is removed. Questions of the owner
stay open on a human message, as decided on 28.09.2026.

## 2026-10-01: Remove `action_propose` and the transcript plugin; actions always have an owner

Chapters: `spec/core.md` (pending actions), `spec/plugins.md` (transcript section removed),
`spec/profiles.md`, `spec/overview.md`. `action_propose` was the core's generic approval case for
an action without an owner; no plugin used it, no journal on any machine contains such an action,
and the web has no view for an action without an owner. The tool, the ownerless branch of the
decision and of the event semantics, and the helpers only it used are gone; `owner` is a required
string in `action.proposed`. The capability name `action.propose` stays in the vocabulary,
because every run grants all capability names to its owner and removing one would lock all
existing journals. `ragents.transcript` with `actor_transcript` is removed from the repository and
from the `core` and `showcase` profiles: it had no caller and no test of its own. Profiles that
still list it must drop the line. `actor_restart` stays: the operator button, the actor program
plugin, and external run scripts call the restart path. `show_document` no longer carries the
availability text of `ask_user` ("the question always goes to the user").

## Compact homepage installation (01.10.2026)

Chapter: `spec/overview.md`. Installation tabs already identify each method, so repeated badges,
headings, and marketing descriptions are removed. Each panel keeps the action or commands and
prerequisites. The closing section offers the getting-started guide and project feedback without
a second installation button or repeated explanatory paragraphs.

## 2026-10-01: Wider hover flyout, notice dot inside the run ring, no tooltip on Start tiles

Chapters: `spec/plugins.md` (sidebar width), usage: `usage.md` (inspection rail). The sidebar
default width is 630 instead of 420 pixels, 50 percent wider; layouts already saved keep their
stored width until the layout is reset or resized, no migration. A run's "new activity" or "not
viewed" dot now sits inside its state ring and replaces the inner glyph while it shows, because the
corner dot overlapped the ring and read as a rendering error; the tone still carries the state, the
tooltip names both. Start tiles lose their native `title` tooltip, which repeated the visible
heading; tests find tiles through `data-tile`.

## 2026-10-01: Remove `quick_answer` and its toast from the global coordinator

Chapters: `spec/core.md` (global coordinator), `spec/plugins.md` (global coordinator in the
header); usage: `usage.md`. Added on 09.09.2026 as a short answer shown below the header while
the history is closed; removed completely: the run function, the prompt instruction, the
`QUICK_ANSWER_MAX_LENGTH` and `QuickAnswerState` contract entries, the web state machine, the toast,
and their tests. The path depended on a second model step after every answer that adds nothing to
the result, and weak models misused it: a message without a question got an invented question, a
summary of the model's own behavior, and a repeated summary in the chat despite the prohibition.
The toast showed what the chat shows next. Old `plugin.state-replaced` events of kind
`quick-answer` stay in existing journals and are ignored. The stored tool selection of an existing
coordinator still names `quick_answer`, so its conversation answers `global-tools-changed` until
it is reset once; no migration.

## 2026-10-01: One type scale and one page rhythm for Start, Runs, and Server; Runs keeps its back arrow

Chapter: `spec/plugins.md` (UI library and theme tokens, run panel header, VS Code zoom and pages);
usage: `usage.md`. Owner's findings: the section headings on Start were cramped, Runs had no way
back in the browser, Runs began higher than Start, and headings, labels, body, and meta text used
different sizes, weights, and letter spacing from page to page. The commit "One UI for web and VS
Code" changed none of this: it wrapped the shared pages in the browser in an extra `p-3`, so Start
and Runs both began 22 pixels below the header there. The regressions came from the uncommitted
work of the same day, which dropped that wrapper, gave only Start `pt-[22px]` (Runs began at 11
pixels in both hosts), and hid the Runs and Server back arrow in the browser
(`PanelPageProps.hideBack`). The cramped headings were never different: `gap-1.5` below the label
and `gap-4` between sections since 24.09.2026. Now `PanelPage` gives every page `pt-6`, sections
are `gap-8` apart with `gap-3` under their heading, and `hideBack` is gone: the logo stays the way
back from a run, while Runs and Server show the arrow in both hosts. Six text roles replace about
forty ad-hoc combinations (`text-[0.52rem]` to `text-[1.1rem]`, three letter spacings, four
weights): `type-title`, `type-label`, `type-item`, `type-body`, `type-meta`, and `type-caption` in
`theme.css`, in `rem` so `ragents.zoom` scales them with everything else. Named `text-*` tokens
were tried first and rejected: `cn` (tailwind-merge rules) takes `text-item` for a color and drops
it next to `text-destructive`. `SectionHeading` replaces `StartSection` and shares the label style
with `SectionLabel`, whose letter spacing and size move from 0.07em/0.62rem to the common
0.06em/0.66rem. A browser test now proves that panel text follows only `ragents.zoom`, not VS
Code's injected font settings, and that Runs starts at the height of Start.

## 2026-10-01: Standalone installers take an explicit scope; `ragents --version`

Chapter: `spec/overview.md` (Development tools, homepage); operations: `operations.md` (Install a
standalone release, Install from npm, Work without a checkout); usage: `usage.md` (Control
RAgents as an agent); `README.md`, the npm README, and the homepage install section. Owner's
requirement: say whether RAgents is installed for the current user or globally instead of always
landing in `~/.local/bin`. `install.sh` and `install.ps1` now take `--local`/`-Local` (default,
never elevated) or `--global`/`-Global` (all users: `/usr/local` with sudo only when that folder is
not writable; `%ProgramFiles%\RAgents` and the machine `PATH`, refused outside an elevated
PowerShell instead of falling back to the user). Scope and `--prefix` are orthogonal: the scope
decides about elevation and the Windows `PATH`, the prefix only about the folder, so a server can
use `--global --prefix /opt/ragents` and tests can exercise the global path in a temporary folder;
mutually exclusive flags would have needed a hidden test override. A per-project folder was not
chosen because the archive is a machine-wide tool with per-user data, and `--prefix` already covers
a folder of one's own. `--uninstall`/`-Uninstall` removes the command, every version, and on Windows
the `PATH` entry; data stays. The installers refuse to replace a `ragents` command they did not
create (an npm link in `/usr/local/bin` was the realistic collision) and only warn about a
shadowing command or an installation in the other scope, with the exact command to remove it.
A root-owned installation failed for other users on the first command, because the launcher
creates `app/node_modules/@ragents/*` links on first use (`EACCES` in an Ubuntu container); both
installers therefore run `ensureHostLinks` with the bundled Node after moving the version into
place and before switching the command, for both scopes, so a host never writes into its
installation. A run of `check-standalone.mjs` as an unprivileged user against a root-owned
0.1.20 installation passed without any file in it changing. The shell installer prints the `PATH`
line for zsh, bash (macOS `~/.bash_profile`, Linux `~/.bashrc`), fish, or other shells and never
edits startup files; `~/.local/bin` is not on the default macOS `PATH`. The PowerShell installer
now edits `PATH` through the registry with `REG_EXPAND_SZ`, because `[Environment]::SetEnvironmentVariable`
expands and flattens entries such as `%SystemRoot%`, which matters for the machine `PATH`. All
documents use the script block form for PowerShell, because `irm ... | iex` cannot pass `-Global`
or `-Version`. The launcher answers `--version` and `-v` with its package version, which
`check-standalone.mjs` now compares with the archive's manifest. Open: whether `core` should keep
the .NET language servers (`TODO.md`); the new flags reach users only with the next release.

## 2026-10-01: The global coordinator opens from a header button into a dimmed dropdown

Chapter: `spec/plugins.md` (header, global coordinator, `PopoverContent`); usage: `usage.md`.
Owner's requirements: the header no longer holds a text box, and the open conversation dims the
rest of the application like the other dimming pop-outs. The header contribution is now a
`PopoverTrigger` button that looks like the former field and keeps the status marker and the
working pulse; the dropdown uses `dim` and ends in the same card composer as the run chat, which
took over attachments, send and stop, model, reasoning, reset, and the error line. The focus
juggling between header input and history is gone: the composer gets the focus on opening,
the button gets it back on closing, and leaving button and dropdown by Tab now closes it as well.
The header sits in its own stacking context below the global backdrop, so the dropdown is
portaled into the contribution's own element (new `container` on `PopoverContent`) and the button
is lifted above the backdrop there instead of adding overlay code. Typing on the closed button
does not open the dropdown, because the composer only offers to replace its draft.

## 2026-10-01: Every view keeps its header button; header actions without a menu

Chapters: `spec/plugins.md` (docking workspace, sidebar rail, run panel header),
`spec/typescript-platform.md` (Run scripts); usage: `usage.md`. Owner's requirements: the view
buttons at the top right list Chat and every app at all times. `revealDockPanel` opens a closed
view as before, brings a background tab to the front, and leaves a visible view untouched; the
button is pressed while its view is visible. The old strip measured its content with a hidden
copy and a `ResizeObserver` and kept a stale width, which opened a large gap before "Reset
layout"; it now only shrinks its labels, and more than five views move into one "All windows"
menu. Maximize/restore and the close button of an area header swapped places, so X is outermost.
The burger menu is gone: Settings, Help, sign-out, and in VS Code "Open in browser" are icon
buttons, and "Run script" is a labeled button next to the views whose pop-out reuses the Start
page items (`StartTile`). Rail badges were unreadable circles over the icons; the rail now shows
one blue dot for a badge or pending activity. The hover flyout uses the `shadow-pop` token instead
of `shadow-md`, the pinned sidebar `shadow-none`; whether `--pop-shadow` is strong enough in the
dark theme is a theme-wide question, not a per-element value. The run script pop-out spans the
header width up to 800 pixels, right-aligned, in two columns when wide, available scripts first.

## The logo leads back to Start; no coordinator chat on Start (01.10.2026)

Chapter: `spec/plugins.md`; usage: `usage.md`. Owner's requirement: the logo replaces the back
arrow, and the bottom coordinator chat on Start is redundant. The logo at the top left of the
shared header is now the button "Back to Start" in browser and VS Code run panel; the run header
and the browser's Runs page drop their back arrows (`PanelPageProps.hideBack`). The VS Code
pages Runs and Server have no logo and keep theirs. The header dropdown already shows the full
coordinator conversation and takes follow-ups, so the overseer's full-size chat and the `idle`
overview placement, which only it used, are removed. This reverses the entry of 29.09.2026.

## Homepage annotations follow scroll position (01.10.2026)

Chapter: `spec/overview.md`. Annotation delays, CSS fades, focus smoothing, and separate rendering
loops made identical scroll positions show different text and arrows. Scene geometry, lighting,
annotation fades, and arrowhead growth now use the same scene position and render frame on desktop
and mobile. Manual scrolling pauses playback until it is explicitly resumed, removing the timed
restart that moved the page while the reader was inspecting a scene.

## Run focus and responsive window defaults (01.10.2026)

Chapter: `spec/plugins.md`; usage: `usage.md`. Opening or starting a run requests the selected
chat input once in both browser and VS Code, after connection and addressee resolution.
Wide browser workspaces start with Chat beside mini-apps; narrow ones use tabs. Manual
arrangements remain authoritative. Hidden windows have direct buttons with existing icons
and an overflow menu instead of a generic add-window button. Tab close controls replace the
duplicate area close control, and maximize appears only when another area exists. Reset uses
the standard header button size and restores the responsive default.

## Directory synchronization on Windows (01.10.2026)

Chapter: `spec/core.md`. Journal locks and host recovery synchronize directory entries only on
Linux and macOS. Windows rejects directory `fsync`, which prevented even a fresh host from
starting. File contents still use `fsync` on every platform, and file errors remain hard errors.
The spec states the Windows power-loss durability limit for directory entries explicitly.

## Public web access by default in the process sandbox (01.10.2026)

Chapter: `spec/plugins.md`; operation: `operations.md`; usage: `usage.md`.
Public documentation, APIs and package downloads should work without maintaining a domain list.
The default network setting is now `["*"]`, translated into automatic proxy permission for public
web domains on ports 80 and 443. Explicit lists still restrict access; local and internal services
need explicit targets. The runtime checks DNS results and retains file isolation. The workspace
prompt no longer prohibits network access from Bash. This does not classify HTTP actions or
prevent uploads of readable files. User questions already exist through `ragents.ask`, but an
enforced host approval before file deletion remains open in `TODO.md`.

## Native Windows plugin paths (01.10.2026)

Chapter: `spec/plugins.md`. Plugin discovery recognizes native absolute paths, including Windows
drive and UNC paths, and backslashes in relative and home paths. A profile resolves external
bundles to absolute paths before provisioning; treating a Windows path as a built-in plugin ID
prevented the standalone host from starting with an external plugin. The extracted-bundle
startup check covers this on both Windows architectures.

## 2026-10-01: A model checks a mini-app through a view function, not through the browser

Chapters: `spec/actor-programs.md`, `spec/plugins.md` (Browser checks).
A small model finished a text-analysis mini-app in 30 seconds and then needed 106 tool calls to look at it: it
wanted to verify the interface, so it guessed the host port, signed in to a different server, guessed the
element ID of the app layout, and read the repository for the address. The app had been open as a tab all
along. Giving the model the host address and sign-in would have meant letting it talk to its own host over
HTTP, which is questionable on its own; the requirement to check interfaces in the browser is dropped.

`actor_view_snapshot` (plugin `ragents.browser`, soft dependency on the actor programs service) resolves the
view, address and frame in code and returns the accessible structure. `ActorProgramsService.resolveView` is
the new host-side lookup; `actor_program_list` shows each view's `ref`. The actor programs summary now says that a
visible view is already open and that hiding keeps state, which is proven by comparing a function result.
`typescript_api` answers a query without match with a hint (a query is one phrase, not words) and the bash
tool says that `rg -r` means replace. Not solved: a server with sign-in; the snapshot reports the page it finds.

## One installation section and one release for every channel (01.10.2026)

Chapter: `spec/overview.md`; setup: `operations.md`; publishing: `development.md`.
The homepage's Get RAgents links lead to four installation tabs: VS Code, npm, npx, and Standalone.
Commands can be copied; standalone users choose their OS or download an archive. This keeps the
hero concise while showing every supported installation path in one place.

A release always includes the host and platform npm packages, every VSIX, and all six native
archives with one version. All publish aliases run locally with the existing npm and Marketplace
tokens and GitHub CLI login. GitHub Actions only builds and checks all native platforms; it has
no publishing credentials. The local command waits for that build and downloads its artifacts,
then reserves them in a draft GitHub Release. It publishes npm and Marketplace before making
that release public. Retrying uses the saved version and files without rebuilding. Providers
cannot share a transaction, so failures can temporarily leave some channels ahead. Source
manifests stay unchanged locally; release metadata is set only in the build checkout.

## 2026-10-01: Bound chat content and keep hover previews transient

Use one 900-pixel host token with quassel 0.4.3's existing centered content and composer
layout. This keeps the scrollbar at the panel edge and aligns pending actions with the input.
Standalone actor controls use the same limit; preparation keeps matching side padding.

Hover previews were written to storage and cleared only on mount. Keep live snapshots in
memory and persist previews as hidden; the reload regression also moves the pointer off the
rail to avoid opening a fresh preview. The header had hidden launching titles while no run ID
was selected. Restore them in the Run title bar region and use accessible test locators.

Updated chapter: `spec/plugins.md`; usage and generated guides describe the chat column.

## One hover color for all neutral buttons (01.10.2026)

Chapters: none (visual). The ghost and outline variants of `Button`, `Badge` and `Toggle` hovered with
the weak `muted` token (half strength in the dark theme) while the run title button used `accent`.
All of them now use `hover:bg-accent`, as the run title already did, so that the back arrow, icon
buttons and text buttons look the same on hover. No special cases per place.

## The header shows the logo instead of a grid icon and the product name (01.10.2026)

Chapters: `docs/usage.md` (header). The one-row header of the browser app shows the product logo
(`docs/logo/skull-line-bold.svg`, inline in `apps/web/src/ui/brand-logo.tsx`, takes the text color,
the product title as its accessible name and tooltip) where the grid icon and the title text were.
The global coordinator's input row has no background of its own anymore.

## Standalone archives and shell installation through GitHub Releases (01.10.2026)

Chapter: `spec/overview.md`; installation: `operations.md`; release workflow: `development.md`.
Distribute the existing host package with a pinned Node.js runtime and installed dependencies so
users need no Node.js or npm setup. Build one dependency lock and the existing platform tool
packages, then assemble and check archives on all six native OS/architecture combinations.
GitHub Releases holds the archives and checksum-checked Unix/PowerShell installers. Versioned
user-local installations preserve the previous command on failed updates and leave run data in
its existing location. Desktop installers and a separate desktop runtime are unnecessary.

## 2026-10-01: One header row and hover previews without sticky overlays

Brand, coordinator input, and menu share the browser header; run layout actions move into
the title row. Start gains 10 pixels above Server. Removing negative run-list margins keeps
rows inside the established 1280-pixel column and aligned with the template grid.

The sidebar now has only hidden, hover-preview, and docked states. Rail clicks dock or toggle
the active view off, and unpin hides it. Pointer capture protects flyout grips only during
the gesture; interacting no longer creates sticky overlays. Returning a tool docks the sidebar
beside the layout, so it cannot cover another tool tab and intercept the next drag. Hover
previews do not survive reload. Browser regressions cover compass drops, width bounds,
sidebar transitions, grip presses, and screenshots for visual review.

Updated chapter: `spec/plugins.md`; usage and generated guides follow the same behavior.

## quassel 0.4.3: transcript mode switch in every chat, latest reply for the global coordinator (01.10.2026)

Chapters: `docs/usage.md` (chat controls). quassel 0.4.3 adds `transcriptMode` ("all" or "latest") and
the `TranscriptModeSwitch` button. Every chat input now shows the switch next to the detail and
timestamp switches (`chat-view-settings.tsx`); the mode is kept per run and actor in local storage
and invalid stored values are a hard error. Ordinary chats start with all replies, the global
coordinator with the latest reply between inputs. `TranscriptModeSwitch` is a new name in the host
API (`pnpm update:host-api`, additive, version unchanged).

## 2026-10-01: Constrain every panel page in the shared host

Start-only width limits left Runs and Server unconstrained. `PanelPage` now owns the centered
1280-pixel column and side padding for both hosts. Template tracks use a fixed 240-pixel
minimum with a container query for narrower panels, avoiding percentage-dependent auto-fill
tracks. Cards remain capped at 320 pixels, and Start server chips at 720 pixels. Browser
regressions measure the rendered browser shell and extension panel, including column counts,
search and row widths, centering, and horizontal overflow at narrow and ultrawide sizes.

Updated chapter: `spec/plugins.md`; usage and generated guides describe the shared column.

## 2026-10-01: Frame docking areas as cards with dotted resize grips

Dock areas, empty areas, the view rail, and side views now share thin rounded card frames,
separated by uniform gaps on the app background. Three-dot grips expose the draggable gaps
without divider lines; wider transparent hit areas preserve reachability. Focus and drag use
existing theme accents. Only floating views retain a shadow. Card interiors and previews use
the same inset geometry, preserving mounted frame identity and the existing side-view modes.

Updated chapter: `spec/plugins.md`; usage and browser geometry checks follow the new frames.

## 2026-10-01: Bound Start and make inspection state explicit

The shared Start page now measures its panel, caps content and card widths, and keeps server
chips beside their actions on wide displays. Inspection uses two toolbar rows; its actor selector
is a window-header contribution, leaving more space for the conversation.

Independent pin and sticky flags allowed contradictory sidebar behavior. Four explicit modes
now determine visibility, pin appearance, layout space and persistence. Interacting with a hover
preview makes it sticky; pointer capture and guarded leave timers keep both grips usable. Floating
views regain the shared popover frame while pinned views stay flat. Browser regressions cover
wide/narrow Start, grip presses and resizing, pin transitions, closing and reload.

Updated chapter: `spec/plugins.md`; usage follows the same behavior.

## 2026-10-01: Name dock panels through their controls and test local editing focus

Dock panels use `aria-labelledby` to reference their tab or sidebar button, keeping the inner
Chat region's label unique. The nested clipboard test checks `document.activeElement` rather
than `document.hasFocus()`, which additionally requires system focus on the browser window.
Clipboard focus restoration is unchanged; undo, redo, and subsequent typing remain covered.

Updated chapter: `spec/plugins.md`.

## 2026-10-01: User-controlled browser docking with stable mounted windows

The browser restores classic area docking for Chat, apps, and inspection tools, including a
resizable flyout or pinned sidebar. The initial layout remains one tab group. Layout belongs
to the user and is stored per server origin and run; coordinator layout functions, placements,
chat placement modes, and fullscreen overlays remain removed. VS Code keeps its editor tabs.

A small in-house split tree and geometry layer is sufficient, so no docking library is added.
Panels are positioned as stable siblings instead of being reparented into tree nodes; this
preserves iframe identity and drafts across moves, splits, close/reopen, and maximize/restore.
The existing app catalog and plugin run panel remain the sources of content.

Updated chapter: `spec/plugins.md`; usage, development, and generated homepage guides describe
the browser interactions and the content-lifetime boundary.

## 2026-09-30: Align the balcony setup test with automatic app discovery

The balcony reference test now expects activation followed directly by run configuration,
and four calls after repeated setup. Its obsolete placement assertion prevented native package
activation even though the program already followed the shared app catalog model. All reference
packages were checked for equivalent stale expectations. Runtime behavior and the app catalog
contract in `spec/actor-programs.md` remain unchanged.

## 2026-09-30: Finish the shared web entry and removal audit

Browser and VS Code runs now use one HTML source and one bootstrap. The host build emits an
identical `run-panel.html` alias for the iframe contract, and rejects divergent entry pages.
The extension packages only the thin navigation adapter and its assets; it supplies its HTML shell.
This keeps offline server navigation available without maintaining a second run interface.

The removal audit also updates mini-app prompts, reference walkthroughs, terminology, and generated
help. Outdated homepage screenshots are removed; new screenshots remain in TODO. Live layout
registrations and callers are gone. The explicit journal rejection boundary and its regression
tests retain historical names to lock affected old runs without blocking other runs or server startup.
Start-page cards and layout inside mini-apps remain independent features.

Updated chapters: `spec/plugins.md`, `spec/actor-programs.md`, `spec/overview.md`, `spec/core.md`,
and `spec/typescript-platform.md`; usage follows the same interface, and
entry-point and verification instructions are in `development.md`.

## 2026-09-30: Remove program-controlled host layouts

The shared app catalog makes layout functions and canvas placement metadata redundant. Both
layout functions, the placement service, their prompts and template callers are removed together.
Embedded starts retain their delivery semantics and expose visible apps through actor ownership.
The journal preflight rejects old layouts, placements and function references per run before
restoring state or repairing files; other runs and server startup remain available. No migration
or callable compatibility tool is provided.

Updated chapters: `spec/plugins.md`, `spec/actor-programs.md`, `spec/typescript-platform.md`, and
`spec/core.md`; usage, sample instructions, and generated references follow the same behavior.

## Keep startup geometry stable in the shared panel (30.09.2026)

Chapter: `docs/spec/plugins.md`. The pending panel reserves the same status bar as the
opened run, so the loading notice does not jump when the chat connects. Browser regression
fixtures now use stable sidebar component identities, select New chat within Templates,
and explicitly exercise the click guard of an aria-disabled locked run.

## Use one run panel in the browser and VS Code (30.09.2026)

Chapters: `docs/spec/plugins.md`, `docs/spec/actor-programs.md`, `docs/spec/overview.md`.
The browser now enters the shared panel and uses the extension's Start and Runs pages.
Chat and app tabs keep visited views mounted; unavailable apps return to Chat without
new apps taking focus. Global coordination, journal, permissions, preparation, settings,
help, and actor inspection remain reachable. Tile layouts, docking, surface shortcuts,
fullscreen clients, and workspace width/visibility persistence are deleted. Host API 10
requires one `surface.RunPanel` contribution. Server layout contracts and callers remain
for the next compatibility-boundary step; entry packaging follows afterwards.

## Preserve clipboard images through the VS Code shell (30.09.2026)

Chapter: `docs/spec/plugins.md` (VS Code input). The clipboard bridge intercepted paste but
returned only text, discarding images before the chat could process them. The shell now captures
files from the paste event and carries them through each frame to the composer's normal attachment
handling. Text editing keeps its undo behavior. The preparation chat also forwards attachment
changes to its model-capability query; its draft tracking had overwritten that callback.

## Keep nested focus polling independent of transpiler helpers (30.09.2026)

Chapter: `docs/spec/plugins.md` (VS Code input). The nested clipboard browser test now
uses Playwright's frame-local polling with its timeout. A named callback inside the previous
serialized function acquired a `tsx` helper unavailable in the browser. The assertion still
requires both the active editor and document focus before typing without refocusing.

## Restore each nested frame before delivering clipboard text (30.09.2026)

Chapter: `docs/spec/plugins.md` (VS Code input). Restoring the shell iframe and asking
the editor window to focus does not restore the complete nested focus chain. Each clipboard
relay now refocuses its captured child iframe before delivering the reply, including empty
text. Removed frames and disposed transports do not receive focus. The browser regression
continues to require document focus and undo without refocusing the editor.

## Restore the requesting document's focus after nested paste (30.09.2026)

Chapter: `docs/spec/plugins.md` (VS Code input). Focusing the outer iframe alone leaves
a nested document unfocused even when its input is still the active element. The clipboard
bridge now focuses the requesting window before the input, including empty clipboard replies.
The browser regression sends undo and redo without refocusing the input. The zoom regression
waits for the nested button's response after its coordinate click, retaining the hit-test check.

## Restore frame focus after clipboard reads and stabilize browser assertions (30.09.2026)

Chapter: `docs/spec/plugins.md` (VS Code input). The clipboard reader temporarily focuses
a field in the webview shell; it now restores the run panel frame before replying so nested
inputs can retain focus. Browser checks address a running actor's input by its accessible
name instead of its changing placeholder, and wait for visible chat layout and queued scroll
events before testing keyboard scrolling after a tab switch.

## Keep the run panel on chat and open apps through navigation (30.09.2026)

Chapter: `docs/spec/plugins.md` (run panel and VS Code). Chat placement modes, the floating
chat sheet, its settings, and host placement messages are removed. VS Code app entries open
or focus one editor tab per server, run, and app; browser panel tabs retain visited views.
The addressee tree no longer depends on tile visibility, and visited chats retain separate drafts.
Host API 9 removes the placement hook; bundles must be rebuilt.
The navigation state uses a new key without migrating layout preferences. The browser workspace
and layout APIs remain for subsequent refactoring steps.

## Share the mini-app catalog and renderer before changing layouts (30.09.2026)

Chapter: `docs/spec/plugins.md` (mini-app hosting). Browser tiles, the run panel, and
standalone app views now resolve contributions and render apps through one host module.
A host navigation contract separates opening an app from the existing VS Code message.
Host API 8 marks the renamed navigation method so older bundles must be rebuilt.
This removes duplicated selection logic while preserving current layouts and app behavior.

## The title request is one user message with the task inside tags (30.09.2026)

Chapter: `docs/spec/plugins.md` (title compaction). With the instruction in the system prompt and
the bare task as the user message, a model without reasoning answered questions instead of
titling them and invented file names. The instruction now precedes the task in a single user
message, the task is wrapped in `<task>` tags, and there is no system prompt.

## The model request timeout counts idle time (30.09.2026)

Chapter: `docs/spec/core.md` (Retries and compaction). The five-minute limit of a model request ran
from the start of the request, so a reasoning model that streamed its thinking for longer was cut
off although it was active. The openai-completions stream now restarts a timer on every received
chunk and aborts only after `timeoutMs` of silence (default raised to ten minutes, for a long
prefill before the first token). The AI SDK's own `chunkMs` was not used: it resets only on
text, reasoning, and tool deltas that its provider parses, and `reasoning_content` from
OpenAI-compatible servers arrives only as a raw chunk.

## Preserve access-token gates during shared sign-in renewal (30.09.2026)

Chapter: `docs/spec/plugins.md` (workstation sign-in). Require the server's `login-required`
refusal before automatic password login, restoring the token-only guard for both launchers.
Log silent sign-in attempts without credentials in extension output and CLI stderr. Give the
remote check container 25 seconds to stop, beyond the worker's 15-second shutdown deadline
and launcher's 20-second enforcement, so Docker does not preempt cleanup.

## One workstation implementation for VS Code and CLI (30.09.2026)

Chapter: `docs/spec/plugins.md` (workstations, bundled tools, lifecycle).

Both launchers must offer the same tools and execution behavior. Resolve the existing VSIX tool
layout through one executor helper and reuse its pinned binary builders for six optional npm
packages. Exact versions and npm `os`/`cpu` constraints keep installation small; Bash ships only
on Windows. Publish every missing platform package before the main host, so interrupted releases
can resume without republishing immutable versions. Dry runs use the intended version in every
built manifest while leaving source versions unchanged.

Move HTTP sign-in into a shared client: both secret-store and environment credentials use one
renewal path, concurrent failures share a login, and a rejected renewed session stops retrying.
The workspace's existing reconnect registration remains authoritative. The CLI reports an
unrecoverable sign-in failure and exits instead of staying registered in a failed session.

Make terminal ownership explicit: monitor stdin, SIGHUP, IPC, and parent liveness before
provisioning; request cooperative shutdown on Windows over IPC, then remove remaining helpers.
`--detached` opts into service lifetime without terminal ownership. Folder rebinding, stable ID
selection, and the extension's loopback pre-check retain identical effects at the shared server.
Unit tests cover all resolver targets, ownership triggers, repeated credential renewal, publish
ordering/resume, and installed package tools; real Windows SSH closure remains a platform check.

## Normalize optional null fields from OpenAI-compatible providers (30.09.2026)

Chapter: `docs/spec/profiles.md` (custom model providers).

**Cause.** An OpenAI-compatible provider sends `delta.role: null` during tool calls, which the
OpenRouter SDK 3.0.0 schema rejects. `content: null` already passes; null `refusal`, `audio`, and
`function_call` fields pass through. Null tool-call `type` in a delta and `message.tool_calls` in
a JSON response also fail validation. A missing type on the initial function delta passes the
schema but fails the SDK's tool-call processing.

**Decision.** Normalize null `content`, `reasoning`, `reasoning_content`, `reasoning_text`,
`reasoning_details`, `tool_calls`, `refusal`, `audio`, `function_call`, `images`, and `annotations`
in messages and deltas, plus delta `role` and tool function `arguments`, in the shared fetch wrapper
for custom base URLs before SDK validation. Parse SSE incrementally with `eventsource-parser`
(already an SDK dependency, now declared directly), preserving UTF-8 and multiline events. Infer the type of
a tool call in either a delta or a JSON message from its function object when `type` is null or
absent. Preserve streaming `reasoning_content` and the Qwen request mapping; map JSON message
reasoning to the SDK field. Other required fields and tool argument
contents stay untouched, malformed data remains an error, and the real OpenRouter endpoint keeps
its existing response path. Rewritten responses retain status and headers except body length
and encoding. Recorded responses cover split tools, reasoning, malformed values, and SSE framing;
a local HTTP fixture exercises the same tool stream, and a host test covers profile aliases.

## UI declarations also emit from an installed host (30.09.2026)

Chapter: `docs/spec/actor-programs.md` (Reusable UI building blocks).

**Cause.** A temporary source tree reproduced that TypeScript marks even relative imports under
`node_modules` as external library sources. Emitting an imported UI source then produces no
declaration, breaking every view build and control lookup in the installed host. Explicit program
roots restore emission for simple sources, but nested package dependencies still cause TS2742:
inferred types name the outer host package instead of the dependency. Both linked and copied
dependencies reproduced this. The temporary reproductions were removed.

**Decision.** Give the UI contract compiler a virtual source root outside `node_modules`, mapping
file access and resolved paths to the real package. Resolution through that host also preserves
virtual paths in TypeScript's symlink metadata; dependencies hoisted outside the package resolve
from its physical location. Keep the collector's existing checks on emitted local references.
This fixes both external-library classification and declaration naming while reading the current
sources, without an additional generated package contract. Client and actor backend bundles use
esbuild; the workflow SDK and virtual compiler already emit explicit roots and have no inferred
UI dependency types, so they need no equivalent emission change. The packaged view check also
exposed that workflow SDK generation assumed Node types under `apps/server/node_modules/@types`,
which does not exist in the package. Resolve that type root through the installed `@types/node`
package instead.

**Path portability.** TypeScript passes forward-slash filenames to its compiler host on Windows
too, so native separator prefix checks miss the virtual root even in a checkout. The mapping now
normalizes separators and drive-letter case before every comparison and converts to native paths
only for filesystem access. Resolve the package root through `realpath` before mapping or selecting
declarations, so a pnpm root symlink and the resolved sources share one identity.

**Regression coverage.** Copy the actual UI sources under `node_modules/@example/host` with both
nested and hoisted dependencies and compare all component names and declaration contents with the
checkout, also through a root symlink into a pnpm-style store. Compare selected component contracts
too. Exercise the mapping with `path.win32` and `path.posix`, including TypeScript's forward-slash
names, drive-letter case, traversal, and sibling prefixes. Check rejected references outside the
host sources and into nested dependencies.
The package installation test also prepares an
actor view importing `@ragents/client/ui` and checks its client bundle from the installed host.

## Run scripts also start inside a running run (29.09.2026)

Chapters: `docs/spec/typescript-platform.md` (Run scripts as prepared actor programs, Open limits),
`docs/spec/actor-programs.md` (Backend and client, tests), `docs/spec/core.md` (agent_spawn,
run_configure), `docs/spec/plugins.md` (PluginHost registrations, program layout, reference
cases), `docs/spec/profiles.md` (Permissions in detail), `docs/usage.md` (Run panel, Control RAgents
as an agent). Requirement: starting a script becomes an operation of its own that also works in an
existing run; a new run is then only "create run, bind workspace, start script". This entry covers
the first stages: the host mechanism, its triggers, the result channel, the display, and shared
actor packages with their identity.

**Decision.** A script opts in with the `RUN.md` header line `embeddable: true`
(`RunScriptPackage.embeddable`); without it the lock stays, and its error names the line. A start
in a running run goes through the same `RunChatSession` path as a new one; only the start of a new
run selects the primary actor, calls `sessionStarted`, and shows the transient start status. A
restarted former primary gets its role back, as the engine's restart rule says. Everything that can
refuse the start is checked before the run changes: fixed start options against the stored values
(the message names both), bundled programs (missing ones are copied, identical ones stay apart from
the generated `tsconfig*.json`, a different package of the same name is refused with both
origins), and who holds the setup handle. The installation lives in the actor programs service
(`installScript`). A repeated start of the same template reuses its package: a stopped actor is
restarted, a removed package is activated again, then a new start input follows. Starts inside a
running run queue behind each other instead of failing with `run-starting`, so a start by an agent
never fails only because another one runs; the only 409 left is a second start while a new run is
being set up, which the start page cannot cause for a running run.

**Ownership first.** `installScript` records which template owns the packages it will create before
it copies or imports anything, and removes the record again when the start fails. Rejected: writing
the record after the import, because a failed write then left an actor and a folder without
origin, and every later start of that template failed on its own handle. A record that could not
be removed again names no actor and no folder; the next start treats it as not installed.

**Marking a start.** The content of the start input stays `{ input, options }`. Before the input is
queued, the service records the start under the command id that will queue it (`deliveries` in
`ragents.actor-programs.script`, version 2); the input's journal event carries that command id, and
`runInput` looks it up by the input's sequence, passes `start` to the generated backend entry, and
consumes the record. Every write drops records whose input is no longer queued or being processed,
so a record left over by a crash between the two writes, or a start the program already got, does
not stay. The package keeps only a counter and its open starts, at most 50. This replaces the first
version, which recorded the input id after queuing and kept every start: a failed second write, or
the 250 KB limit of plugin state after some thousand starts, left a queued start that the program
could no longer recognize. Rejected: a field on the queued input in the engine, because it would
change the journal format, the event validation, and the projection for a host concept the engine
does not need to know; and a reserved envelope in the content, because it would show up in the
journal and the actor history, any actor allowed to send inputs could forge it, and a backend built
before this change would receive it as text. Since `start` travels next to the unchanged input, a
backend built before this change keeps receiving its starts in `onInput`.

**Result channel.** `context.finish(result, { summary?, start? })` works only in turn handlers
(`onStart`, `onInput`, `onResult`); the generated entry returns the finishes, and the host checks
them against the open starts before the actor state commits, so a second or unknown finish fails the
turn without changing anything. A function passes its result to its own actor as an input, as the
spec already asks for messages in the actor's name; so every finish happens in a turn, and the
owner's summary can be journaled as runtime output of that turn. An LLM starter gets a background
input with summary and compact result, a TypeScript starter gets `onResult`, recognized by the same
command-id record as a start, otherwise the JSON in `onInput`. Background inputs of the owner keep
these deliveries out of the chat's user messages.

**Triggers.** `ragents.runs.scripts` lists the templates the caller may start with `available` and a
`reason`, instead of adding `embeddable` to the strictly parsed `PublicStartEntry`, so older clients
keep working. The run panel's menu (web and VS Code share it) and `ragents script` use it and
`ragents.runs.startScript`. The run functions `run_script_list` and `run_script_start` are host
functions like `typescript_eval`, acting on the caller's run through the run management and as the
run's owner (owner's template releases, the run's fixed options). They need the new capability
`script.start`. To give it to the coordinator but to no agent, the engine vocabulary gets
`firstHandCapabilities`: an inherited copy of such a capability is not delegable, so it reaches the
owner's direct delegates (coordinator, programs the owner installs) and stops there. Rejected: a
check on the actor's role in the function, because the grant model already expresses who may do
what; and a plain delegable grant, because every agent spawned by the coordinator or by a script
would inherit it.

**Display.** An embedded start places the setup package's first view with `canvas_layout_place`,
a new function of `ragents.orchestration` that splits the current root once and leaves a view
already shown in place; the actor program host reaches it through the plugin's service
(`surfacePlacementToken`), not the orchestration code. The chat shows runtime output of TypeScript
actors whose package a run script installed, prefixed with the handle; the existing access
projection masks it like every system entry.

**Shared actor packages.** A plugin shares a package as `actors/<name>/` next to `run-scripts/`;
`RUN.md` names it in `shared-programs` (not `programs`, which already means the script's private
bundled packages in `RunScriptPackage`). The host registers it in `host.actorPackages` and checks at
startup that names do not clash across plugins, with script handles, or with bundled programs, and
that every named package exists. A start copies it like a bundled program with the same
identical-sources rule; the origin record says `shared` with the plugin id, so a drift reloads it
from the plugin. `actor_program_ensure` is the idempotent counterpart of `actor_program_activate`:
two scripts that share a package both ensure it, and only the first installs or activates it.
Rejected: letting ensure silently reactivate an active package, because an actor that was just
rebuilt loses its running functions.

**Program identity.** `programOf(runId, actorId)` gives plugins who a program is: its origin comes
from the record only while the build still has the identity of the sources the host installed. The
identity is the hash of the package sources without the tsconfig files the host generated into it,
so an agent that edits a shared package and activates it again gets `run`, and a drift then keeps
its edits instead of reloading the plugin's sources. Rejected: recording the revision after the
activation, because that is a second write after the package exists; if it failed, the package had
an origin without proof and a reuse could not tell a legitimate package from an edited one. A stale
origin record now counts as not installed whichever template it names; only a real actor or folder
of another template is a conflict.

**Provenance and exclusion.** Under a shared name, `actor_program_ensure` and a script start accept
only the package the host installed from that plugin and nobody changed since; a package without a
host record keeps origin `run` forever, even with the same content, and blocks the name with an
error instead of being taken over, because authorizing by `programOf` is worthless if a start can
promote an agent's package. Creating, activating, removing, installing, ensuring, and reloading
share one async exclusion per run and package name, so concurrent callers wait instead of seeing an internal
"is being created"; the release after a failed start is a compare and swap per name. Rejected:
accepting identical content as proof, since the content an agent can reproduce says nothing about
who installed it.

**prepareSession.** The actor program host's `prepareSession` cancels invocations a previous server
process left open. It ran before every chat message and script start and marked calls that were
still running in this process as cancelled. It now runs once per run and process and skips
invocations of this process.

**API.** `ragents.chat.start` also accepts a running run and still returns once the start is
accepted, with errors in the chat. `ragents.runs.startScript` waits and returns
`{ actorId, handle, count }` or the error: a running run shows no start status that could carry it,
and the triggers need the answer.

## The global coordinator fills the empty main area (29.09.2026)

Chapters: `docs/usage.md` (Global coordinator), `docs/spec/plugins.md` (overview contributions).
Owner's requirement: at least the coordinator chat is visible instead of an empty screen.

**Decision.** Overview contributions get the placement `idle`: the first visible one fills the main
area while no run is open, only with `runs.read`. The overseer plugin contributes a full-size chat
on the coordinator's run with its own input; model, reasoning, and reset stay in the header dropdown.
The run chat (`PluginChat`) was rejected for this: it brings the tile surface, actor bar, journal
status, and workspace tabs, and a coordinator run shows only an empty surface there.

## Run cards name who created the run (29.09.2026)

Chapter: `docs/usage.md` (Switch runs). Owner's requirement: see who created a run from the grid.

**Decision.** The run list carries `ownerLabel`, the label of the configured user whose id the run
stores as owner (otherwise the id itself); a run created without sign-in has none. The card shows
it as "Created by <name>" below the creation date.

## Profile providers for self-hosted models, Qwen chat template, alias completion for plugins (29.09.2026)

Chapters: `docs/spec/profiles.md` (Profiles, paragraph on `MODEL_PROVIDERS`, Open limits),
`docs/spec/plugins.md` (Imports, host API, Model relay), `docs/operations.md` (Configure model
access and start). Requirement: an alias of a server profile can point to a self-hosted
OpenAI-compatible server such as oMLX, and its thinking levels take effect there; plugins can ask a
profile alias a single question.

**Why.** Aliases could only name models of built-in catalogs, and the transport always sent
OpenRouter's `reasoning` field. oMLX ignores `reasoning` and `reasoning_details`; with a Qwen chat
template, thinking is switched off only through `chat_template_kwargs.enable_thinking: false`, the
level goes as `reasoning_effort` into the template, and earlier thinking is read back as
`reasoning_content`.

**Decision.** `MODEL_PROVIDERS` in the `host` section lists providers with `id`, `baseUrl`,
`apiKey` only as `env("...")`, optional `compat` and their models (`plugin-support/model-providers.ts`,
strict like `MODEL_ALIASES`, nested `env(...)` resolved when read). The server registers them in the
one model runtime before the aliases; the alias catalog and the relay find their models next to the
built-in catalogs and the product's upstreams. `compat.thinkingFormat: "qwen-chat-template"` makes
the transport drop `reasoning`, set `enable_thinking` and `preserve_thinking`, send the mapped level
verbatim as `reasoning_effort`, and replay thinking as `reasoning_content`
(`applyQwenChatTemplate`). A model may name `thinkingLevelMap`, because `xhigh` exists only when
named. The service `aliasCompletionModelToken` (host API, no new version because nothing is dropped)
gives plugins a `CompletionModel` over an alias of the server's model runtime.

**Rejected.** A key in plain text in the profile: secrets stay `env(...)`. Clamping the effort to a
fixed set in the transport: the template decides which values it accepts, the profile maps to them.
`chat-template` with configurable kwargs: no user yet, stays unimplemented and is rejected in the
profile. Verified live against oMLX with a Qwen 3.8 template (off without thinking, `xhigh` with
thinking, a tool round trip with `reasoning_content` in the replay) and with
`apps/server/tests/model-providers.test.ts` and `packages/ai/tests/openrouter-streaming.test.ts`.

## An alias offers its own thinking levels (29.09.2026)

Chapters: `docs/spec/profiles.md` (Profiles, paragraphs on the relay and `MODEL_ALIASES`),
`docs/spec/plugins.md` (Model relay), `docs/operations.md` (Configure model access and start),
`docs/usage.md` (Selectable model). Owner's requirement: the mapping from offered level to the
model's level is stated explicitly per alias in the profile.

**Why.** Until now an alias offered the levels of its target. The models behind the aliases of a
profile, however, have very different levels, such as `off, low, medium, xhigh`, `low, high, max`
or just on and off. Anyone who switched the alias in the chat saw a different selection each time,
and a thinking level from the profile fit only some of the aliases.

**Decision.** An entry in `MODEL_ALIASES` knows the optional key `thinkingLevels`, a mapping from
offered level to a level of the target (`ModelAlias.thinkingLevels` in `packages/agent`,
`ProfileModelAlias`). `aliasedModel` assembles the alias's `thinkingLevelMap` from it: each offered
level carries what the target sends for the level it points to, every other one is `null`.
`getSupportedThinkingLevels` thus returns exactly the offered levels, for selection, catalog, role
check and relay. The model runtime sends a request to the target with this map (`targetOf`), so
that clamping and `reasoning.effort` follow the alias's levels; `off` mapped to a level sends that
level's `effort`. The relay publishes the same map, so a client sends the same as the server, and
the relay passes the request body through unchanged. Validation happens in one place,
`thinkingLevelsProblem` in `packages/agent`: when reading the list (shape, known levels, only `off`
to `off`), at startup and in `registerAliases` against the target. The default thinking level must
be an offered level (`validatedAliasModel`, also in the relay, new in the host API for this).
`@ragents/ai` exports `EXTENDED_THINKING_LEVELS` for this. Without `thinkingLevels` everything stays
as before.

**Rejected.** Computing the next higher level instead of writing it into the profile: the mapping
should be visible in the profile, and not every intended mapping is the next higher one. Applying
the mapping to the request body in the relay: the client would then show different levels than it
sends. A level other than `off` mapped to `off`: a target without its own value for `off` gets
`enabled: false`, and a level of the map cannot express that. Verified with
`apps/server/tests/model-aliases.test.ts` (list, catalog target, runtime with mapped and clamped
level) and `apps/server/tests/model-relay.test.ts` (catalog and client of the relay).

## Windows ends the MSYS group of a bash call, `timeout` up to 3600 seconds (29.09.2026)

Chapters: `docs/operations.md` (Work on Windows, Time limit of `bash`), `docs/spec/plugins.md`.
Occasion: a real test on a Windows 11 machine showed that `sleep.exe` kept running after a
timeout. MSYS does not attach the children of bash to its Windows process tree; `taskkill /T` on
bash never reaches them. Stop and timeout thus let every command keep running on Windows, including
a `grep -r` over `node_modules`.

**Decision.** On Windows every `bash` call carries `RAGENTS_BASH_CALL` with its own id. On timeout,
on stop and after the call, a short helper bash reads from `/proc` the process groups in which a
process carries this id, and names all Windows ids in them; `taskkill /F /T` ends them together
with native children (`stopMsysCall` in `managed-process.ts`). If one survives, the call fails.
Measured: a normal call thereby takes about 175 ms. The upper limit for `timeout` rises from 600 to
3600 seconds: RAgents has no background processes, a cold full build takes longer than ten
minutes, and the managed build step also allows an hour. The default without `timeout` stays 120
seconds.

**Rejected.** A Windows job object (needs native code), finding processes via the Windows parent
chain (exactly that is missing with MSYS), 600 seconds as in Claude Code (there are background
commands there).

## Open questions sit above the input (29.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host: `actionViews` and `cardSections`, tiles,
questions from `ragents.ask`, run panel with sheet), `docs/usage.md` (Run chat and surface; Run
panel and VS Code extension).

**Why.** Until now an open question stood at its place in the history and moved up with every
further line; in tiles and in the actor chat of the run panel it additionally stood as a card
section of `ragents.ask` below the history, so twice. Whoever is supposed to answer looks for the
question where they type, as with a terminal agent. quassel 0.3.0 now itself renders open actions
in a `ChatPanel` with input in a dock directly above the input, and completed ones as a record in
the history; that makes the card section superfluous. In the collapsed sheet of the run panel the
dock would have cut off the question: its cap is half the height of its own frame, and when
collapsed this frame is only as high as its measured input including the dock. The two sizes
build each other up to about the height of the input, and the question scrolled within about 90
pixels.

**Decision.** `ragents.ask` no longer carries a `cardSections` contribution (`QuestionSection` is
dropped), only `actionViews` and `attention`; its question appears via `AskActionView` in the dock
of every chat with input, also in a tile with hidden input. The sheet sets `--qsl-panel-height` on
the input to the available height (90 percent of the area), so that the dock grows up to half of
it and shows the question completely even when collapsed; the measurement of the minimum includes
the dock anyway, and the stage reserves the space along with it. The status line of the sheet no
longer repeats the question, but reports "Waiting for input" or "Waiting for N inputs". An actor
tile keeps at least 260 pixels, as with card contributions, while an action is open. The core and
the web know only open actions here, no question shape. A question that the owner of the run asks
for an actor other than the coordinator (`recipient`) thus stands only in the run chat; today only
`ragents.lsp-roslyn` asks such questions, and it asks them of the coordinator.

Rejected: automatically expanding the sheet when an action is open (it covers the mini-app the
question often refers to, and collapses again when the mouse leaves); keeping the card section
next to the dock (the same question twice); binding the dock in quassel to a different reference
size (only the sheet measures itself against its input, every other frame has its own height).

## Plugins project their states themselves, the core no longer names a plugin, VS Code shows a different version (29.09.2026)

Chapters: `docs/spec/plugins.md` (PluginHost registrations, Ownership per facet, Web
halves at runtime, Workspace, sandbox tools, and processes with the sign-in of a workstation and the
server's process sandbox, Open limits), `docs/spec/profiles.md` (Permissions in detail),
`docs/spec/core.md` (Global coordinator), `docs/usage.md` (Run panel and VS Code extension),
`docs/operations.md` (Workstation), `docs/development.md` (Extension points in the server). Continues
point (6) of "Language servers and browser come as a contribution to the executor from their
plugins" (29.09.2026).

**Why.** Owner's requirement: the core knows no plugin, no tool and no shape of a payload; a new
plugin of an existing kind needs no change to the core. Three of the guard's six frozen places
violated this in the server: `access-projection.ts` rebuilt the state of `ragents.actor-programs`
by hand for access without `runs.inspect` and hid its chat events, `provider.ts` set
`ragents.overseer` as the owner of a locally started run script package, `config-file.ts` named a
template of `ragents.reference` as an example. In addition, the startup errors of the process
sandbox named the section `ragents.workspace` four times, although the building block lies under
`plugin-support` and the setting belongs to the workspace plugin. And a VS Code extension that did
not match the server's version showed this only as a line "Workstation not signed in" on the Servers
page; nobody saw a differing version with a still compatible executor.

**Decision.** (1) `host.accessProjections(...)` reports, per id of a plugin state, what an access
without `runs.inspect` sees of it: `state(entry)` returns the visible value or `undefined`,
`chatEvent({ type, payload })` the visible chat event or `undefined`. The host applies both blindly
per id (`AccessProjectionRegistry`), in the run view as in the chat. Before that, without a
contribution, the following applies: it does not see the stored value of a start option whose
`rights` the access lacks; this keeps model and system prompt hidden, both of which require
`runs.inspect`, without the server naming their ids. A state without a projection stays unchanged,
as before for every plugin except the actor programs. The projection of the actor programs lies in
`plugins/ragents.actor-programs/server/access-projections.ts` and returns the same as before: of
the program the name, title, actor, revision and the key data of the views, of the calls only the
revision, no chat events. The id `ragents.start-options` in the old list had no writer and is
dropped. (2) `ServerProcessSandbox` gets `disableSetting`, the instruction for switching it off as
the operator writes it into the profile file; `ragents.workspace` passes `PROCESS_SANDBOX: "off" in
the section ragents.workspace` and uses the same constant for its warning. There were no further
core messages with a plugin id or section. (3) `RunManagement.create` with `kind: "package"`
requires `owner`, the plugin that starts the package; the global coordinator names itself. The
example for `defaultStartEntry` is `acme.tasks.setup`. The guard now lists only the three places of
the extension. (4) `ragents.plugins.bootstrap` additionally returns `version`, the package version
of the server (`HostBootstrap`). The workstation client names a sign-in failure due to executor state
or contributions with `mismatch: true`, recognized by the domain code instead of the class, because
`RpcError` can be loaded twice in one process. The extension compares its version with the
server's (`versionNotice`): a different version with a signed-in workstation is a warning "RAgents
version does not match: extension X, server Y - <what to update>", with a rejected state an error
that appends the server's cause and then does not show it again as "Workstation not signed in"; a
rejected state with the same version is also an error. Which side to update follows the order of
the versions per position; a server without a version counts as older, a local profile names the
host under `ragents.hostPath`. The notice is shown at the server, at the top of Start, in the
status bar (icon and background) and once per server and text as a notification with "Show
extension" and "Show servers".

**Rejected.** Putting the projection of the actor programs into the plugin but leaving model and
system prompt in the server's list: their ids do belong to the host, because scheduler and prompt
composition read them, but the rule about `rights` covers exactly them and every future technical
start option, including that of the product plugin of another repository that uses the same
building block. A single function for state and chat event: the actor programs show their state
abbreviated but their chat events not at all, and that should stay the same. An error that the
plugin supplements with its section instead of passing it along: the message would then come in
two parts, and the sandbox's self-test throws from within a child process. The message with only
the key and no section: `PROCESS_SANDBOX` is not at the top level of the profile file, the operator
would not find the place. Deriving the owner of a package from the service: the service does not
know its caller, and a binding per plugin would be a second path to `RunManagement`. The version in
`/api/access`: the response comes before sign-in, and a different version only matters for a
connected server. Tying the comparison to the executor state: that stays the same across many
versions, and precisely then the warning should appear.

## Language servers and browser come as a contribution to the executor from their plugins (29.09.2026)

Chapters: `docs/spec/plugins.md` (Plugin contract, Ownership per facet, Build and ship a
plugin, Bundle, build tool, and host API, Workspace, sandbox tools, and processes with the new
section Contributions to the executor, Provisioning per plugin, Language server plugins, Browser
checks, Open limits), `docs/development.md` (Which folder contains what, What goes through
plugins), `docs/operations.md` (Workstation), `docs/usage.md` (Servers page of the extension).
Supersedes point (6) of "One workstation executor, the same everywhere" (20.09.2026).

**Why.** The three language server plugins were plugins in name only: start, root type, loading
and extensions of Roslyn, FSAC and TypeScript lay in the executor, hard-wired in
`workspaceExecutorModules()`, together with the `.sln` reader; their names and constants stood in
the host API, the provisioning of the workstation named `ragents.lsp-roslyn`, `ragents.lsp-fsharp`
and `ragents.browser` in a fixed list, and the browser of the browser check also sat in the
executor. Another language would have changed the executor, host API, provisioning and the VS Code
extension. Owner's requirement: the core (engine, server, executor, extension, web) never knows a
tool, a language or a language server; a new language, such as Java, is just a plugin. Point (6)
wanted every executor to offer the same set; the check at sign-in now achieves this without the
core knowing the set.

**Decision.** (1) Besides `server/`, `web/` and `provision.ts`, a plugin can carry an `executor.ts`
(or `executor/index.ts`) that exports `executor: WorkspaceExecutorContribution`: a function of the
machine that returns `languageServers` and `modules`. The machine (`WorkspaceExecutorMachine`)
gives it the plugin's tool folder, files from the host's packages, the checked root resolution,
domain errors and the environment of its own processes. The build tool builds
`executor/index.mjs` from it without `splitting`; an import of a host module or of another plugin
is a build error there, types are free. The manifest names the file under `executor` (format 4).
(2) In the server `loadPlugins` loads the contributions along with the bundles, the state is the
SHA-256 of the file; the composer builds them for the server's data folder and provides them as
`executorContributionsToken`, and `ragents.workspace` builds the server's executor with them. The
order of constructor and registration is thus no longer a problem: the contributions are data of
the bundles and are fixed before any plugin registers. (3) Before sign-in a workstation asks
`ragents.workspace.clients.contributions`, loads exactly these contributions from the bundles of
its own host in the requested state, builds its executor from them and signs in with the list;
the server compares (`workspace-executor-contributions`, 409). A missing host, a missing bundle or
a different state make the sign-in fail with a cause. If the server requests other contributions
after a reconnect, a new executor replaces the old one. Because the sign-in has a new required
field and a new method, the executor state is 7. (4) `WORKSPACE_PROVISION_PLUGINS` is dropped: a
workstation provisions the built-in plugins of its host whose bundle carries a contribution, together
with the bundles they need to load. (5) The adapters with their constants lie in
`plugins/ragents.lsp-*/executor.ts`, the `.sln` reader in the F# plugin, the small `dotnet` call in
each of the two .NET plugins; the browser with `browser.*`, pages and Playwright start lies in
`plugins/ragents.browser/executor/`. `createLanguageServerPlugin` now takes only the description
(`LanguageServerDescription`). Host API 7 loses adapters, constants and browser names and gains
`executorContributionsToken`. (6) `apps/server/tests/core-boundary.test.ts` runs with
`build/check.sh` and fails as soon as the engine, the server outside `plugin-support`, the
executor, the extension or the web names a plugin id or a language server; six older places are
frozen as a list and are in `TODO.md`. Loading is also verified under the Electron runtime of VS
Code: a CommonJS bundle built like the extension loads all three contributions via `import()`.

**Rejected.** Declarative adapter data that the server sends to the workstation: FSAC has to read the
`.sln` to find the projects, Roslyn and FSAC have their own steps when loading (notifications,
`fsharp/workspaceLoad`); that would require a small language for start and loading. The
contribution as an export of `server/index.js`, loaded via the host's resolution hook: the VS Code
extension host has neither tsx nor the hook, and a hook there would apply to all extensions in the
process. Running the contributions on the workstation in a child process from the host package: a
second process boundary with its own life cycle and its own sign-in, unnecessary as soon as the
file is self-contained. Sending the file from the server to the workstation: code and provisioning of
a plugin would then come from two sources. Comparing the state of the whole bundle: every change to
the server half would make workstations incompatible whose executor stayed the same. Importing the
executor's helpers (root resolution, resolution from the host) via the host API: then the file
would no longer be self-contained. Leaving the browser in the executor: then the provisioning of
the workstation would have had to keep naming it.

## The profile's default solution loads without asking (29.09.2026)

Chapters: `docs/spec/plugins.md` (Language server plugins, Solution at start).

**Why.** A profile whose workspaces always carry several solutions, of which the same one is always
the right one, asked for the solution at the start of every run. Owner's requirement: no question
in such workspaces, in all others still the question when there are several. Only the profile
knows which solution is the right one; the Roslyn plugin stays without knowledge about projects.

**Decision.** `ROSLYN_SOLUTION_PREFERRED` in the section `ragents.lsp-roslyn` names a path within a
checkout. The solutions from `roslyn_solutions` match whose path equals it or ends in `/<default>`,
regardless of upper and lower case, because some open the folder above the checkout or above
several worktrees. Exactly one match is loaded by the start with `ifNoneOpen` like a single
solution; several matches lead to the question with only them; if none matches, everything stays
as before. The default without
`ROSLYN_SOLUTION_ON_START: "on"`, an absolute path or one with a backslash aborts the start,
because otherwise it would silently never take effect. Verified by
`roslyn-solution-on-start.test.ts`.

**Rejected.** Tying the default to another plugin's project context (the Roslyn plugin would have
to know a foreign service, and the start would depend on the order of two start hooks); detection
via the Git remote `origin` (a folder above the checkouts is not itself a repository, and the path
of the solution in the checkout is fixed anyway); several defaults as a list (so far nobody needs
more than one).

## Bash stops after 120 seconds, a workstation with a different state learns about it (29.09.2026)

Chapters: `docs/spec/plugins.md` (Bash result, Sign-in of a workstation, Open limits),
`docs/operations.md` (Time limit of `bash`, Isolation per run), `docs/usage.md` (Run panel and VS
Code extension).

**Why.** A `grep -r` over a source tree including `node_modules` ran for minutes on a slow Windows
workstation; the user could not see whether anything was still happening and had to cancel the turn.
The executor had a default of 600 seconds (`RAGENTS_BASH_TIMEOUT_SECONDS`), whereas the tool's
description told the model "no default timeout", and the tool allowed up to 2^31 milliseconds.
Claude Code stops a command after 120 seconds and allows at most 600; for builds and tests the
model itself names a longer time. On top of that came a second bug: since state 6 (ripgrep) the
sign-in of a workstation requires the field `ripgrep`. A workstation with executor 5 does not send it,
and the dispatcher rejected it with "Invalid input for ragents.workspace.clients.register: params
is missing required field ripgrep" before the handler could compare the state and give the
understandable message.

**Decision.** `bash` has a default of 120 and an upper limit of 600 seconds, both in the tool
(`BASH_DEFAULT_TIMEOUT_SECONDS`, `BASH_MAX_TIMEOUT_SECONDS` in
`packages/agent/src/core/tools/bash.ts`). Description and schema name both (`default`, `maximum`),
and the description says that builds, test runs, installations and other long commands need a
larger `timeout`. More than 600 is an input error: the engine rejects it at the schema, the tool
checks the same for calls without the engine. The operations always get the time limit (`timeout`
is required in `BashOperations.exec`); the executor's own default and the limit of the local shell
are dropped. When the time runs out, the error carries the output so far and "Command stopped
after N seconds (timeout). Narrow the command, for example search with rg instead of grep -r, or
pass a larger timeout, up to 600 seconds."; at the upper limit it says to split into shorter steps
instead of a larger `timeout`. The server inserts the schema's defaults into every model call
before handing it to an executor (`Value.Default` in `WorkspaceSandboxHost`): this way the time
limit the model sees applies on every machine, even if a workstation carries a different version of
the agent runtime, and the footprint knows it as `durationMs`. `RAGENTS_BASH_TIMEOUT_SECONDS`
remains the operator's default, now declared in the section `ragents.workspace` next to
`RAGENTS_BASH` and `RAGENTS_RG` and read at startup. It must not exceed the upper limit, otherwise
the start aborts: a default above the limit that a call may name would contradict it. A workstation
no longer reads the variable.

The input of `ragents.workspace.clients.register` is a union of the complete sign-in
(`clientRegistrationSchema`) and a sign-in with a different state, which requires only `label` and
`executor` and carries arbitrary further fields. The handler checks the state first; a different
one fails with `workspace-executor-version` and says what to update: for an older workstation the
RAgents extension or `@schlenkr/ragents` there, for a newer one the server. With the server's
state the handler checks the complete shape and rejects an incomplete input like the dispatcher
(`-32602`, the same message); a workstation that claims the current state but does not send
`ripgrep` thus still fails hard. This holds for every future state, even with new or dropped
fields, without a change to the contract. A separate state 7 is not needed as long as the new time
limit ships with state 6 together with ripgrep.

**Rejected.** Only correcting the description and leaving 600 seconds as the default: a hanging
search would still hold the turn for ten minutes. No default, only an upper limit: a forgotten
`timeout` would hold it just as long. An operator default above the upper limit that raises the
limit along with it: a call could then request less than the default, and the model would read two
numbers that contradict each other. The default in the executor of each machine: a workstation would
apply its own, while the model reads the server's in the schema. Putting long commands into the
background with `nohup ... &`: the executor cleans up the process group after every call. Making
`ripgrep` optional for the sign-in: that would fix only this field, the next state would have the
same problem, and the schema would tell an untruth for the current state. Writing the server's
state as `const` and the other as `not` into the contract: `contract.ts` also belongs to the web
half, which must not import the executor, and a contract per state would have restructured server,
workstation and tests. A pre-check in the dispatcher before the schema: a new extension point of the
engine for a single user. Verified with `packages/agent/tests/bash.test.ts`,
`apps/server/tests/bash-timeout.test.ts`, `apps/server/tests/sandbox-process-groups.test.ts`,
`apps/server/tests/workspace-clients.test.ts` and `apps/vscode/tests/workspace-client.test.ts`.

## Compaction values belong to the model (28.09.2026)

Chapters: `docs/spec/core.md` (Model context across turns, What goes into the journal, Retries and
compaction, File format), `docs/spec/profiles.md` (Relay providers and aliases),
`docs/spec/plugins.md` (Model relay), `docs/operations.md` (Configure model access and start,
Compaction of the model context), `docs/usage.md` (Selectable model), `docs/development.md`
(Journal example), `packages/agent/README.md`. Owner's requirement: the threshold must be a model
parameter, explicitly not a global absolute upper limit.

**Why.** Compaction happened from `contextWindow - reserveTokens` on, with the context window from
the catalog and configurable host-wide via `AGENT_COMPACTION_RESERVE_TOKENS` and
`AGENT_COMPACTION_KEEP_RECENT_TOKENS`. The catalog, however, names the largest window across all
providers of a model: `qwen/qwen3.8-27b` has 1000000 tokens there, 14 of 16 providers at
OpenRouter only 262144. A run therefore compacted only at about 984000 tokens and above 262144
silently switched to one of the two large providers, with a different price and without cache. A
host-wide number does not help, because a profile offers models with very different windows side
by side.

**Decision.** A model optionally carries its own values (`Model.compaction`, type
`ModelCompaction` in `packages/ai/src/types.ts`, a change to the forked runtime): `threshold`, the
absolute token count from which compaction happens, `keepRecentTokens`, the remainder kept
verbatim, and `summaryTokens`, the budget of the summary instead of 80 percent of the reserve. The
summary of the start of a split turn gets five eighths of it, the ratio of the two previous budgets
(0.5 and 0.8 of the reserve). `AgentTurn` applies the values of the model that executes the turn
(`compactionOf` in `packages/agent`); a model switch applies from the next turn on and thus already
to its check before the first step. A model without its own values has the catalog default,
exactly the previous rules: threshold `contextWindow - 16384`, `keepRecentTokens` 20000, summary
13107 and turn start 8192 tokens. `MODEL_ALIASES` is a list of objects `{ alias, model:
"provider/model", thinking?, compaction }` with `compaction` required (type `ProfileModelAlias`);
the string form with `=` and `@` is dropped. Validation happens in one place,
`compactionProblem` in `packages/agent`: when reading the list, at startup against the catalog
target, in `ModelRuntime.registerAliases` and for every model definition with values in
`registerProvider`. The rules: three positive integers; `keepRecentTokens + summaryTokens` below
`threshold`, so that a compaction ends clearly below the threshold; `threshold + summaryTokens`
below the context window, so that the request for the summary fits; `summaryTokens` at most the
target's output limit, instead of being silently capped as before. The relay passes the values on
in the `catalog` block of each alias, the client registers its relay models with them and aborts
without valid values. `context.compacted` carries `threshold` with `tokens` and `source` (`model`
or `catalog`), `pnpm driver journal` shows both. `AGENT_COMPACTION_RESERVE_TOKENS`,
`AGENT_COMPACTION_KEEP_RECENT_TOKENS` and `AgentSettings.compaction` together with the never
disabled `enabled` are dropped. The profile distribution allows lists of objects in a client
profile. `core` and `showcase` give their relay aliases values below the window of the usual
providers.

**Journal format 9.** The field is optional; lines of older formats never carry it and remain
readable. An older version, however, checks `context.compacted` with fixed keys and would reject a
new line; according to the rule in `core.md` the number therefore rises, so that it fails at the
format version instead of at an unknown field. An optional field alone is not enough for that. The
journal writes format 9 and reads 7 to 9.

**Rejected.** A global absolute upper limit: it never fits all models of a profile. The host-wide
variables as an additional default: two sources for the same number. The threshold as a share of
the catalog window: the catalog value is exactly the wrong reference size. Pinning the provider
selection to large windows: more expensive, and the threshold would stay wrong. Separate values at
the relay client: server and client would diverge. Verified with
`packages/ragents/tests/agent-runtime.test.ts` (catalog default after an overflow, model switch,
rejected values at registration), `model-context.test.ts` (threshold of the model),
`journal-storage.test.ts` (format 9), `apps/server/tests/model-aliases.test.ts` (list, catalog
target, runtime) and `apps/server/tests/model-relay.test.ts` (relay and client with the same
values).

## The extension ships ripgrep, the prompt steers the search towards it (28.09.2026)

Chapters: `docs/spec/plugins.md` (Sign-in of a workstation, Prompt contribution for the shell
platform, Bash of the executor, Open limits), `docs/development.md` (Publish the VS Code
extension), `docs/operations.md` (Work on Windows), `docs/usage.md` (Run panel and VS Code
extension), `README.md`.

**Why.** A run on a central server worked in the project folder of a Windows workstation with the
bundled MSYS bash. The model searched with
`grep -rn "..." src --include=*.ts --include=*.tsx | head` over a source tree including
`node_modules` (3.2 GB, about 71,000 `.ts` files). On a Mac this takes 17 seconds, under MSYS on a
Windows notebook it ran for minutes until the user canceled it. The bundled bash had no `rg`, and
the platform text did not steer the model towards a search that respects `.gitignore`; the text
for macOS even recommended `rg` without knowing whether it is there. Claude Code solves the same by
shipping ripgrep per platform. Separate search tools next to `bash` have been dropped since
02.09.2026 and 18.09.2026, because `bash` covers them; so `rg` goes into the bash.

**Decision.** `pnpm bundle:rg` puts ripgrep 15.2.0 from the release archives (version, target and
SHA-256 fixed in the script, on Linux the static musl version) together with `COPYING`,
`LICENSE-MIT` and `UNLICENSE` into `apps/vscode/dist/rg/<platform>`. Seven VSIX are packed: one
each for `win32-x64`, `win32-arm64`, `darwin-arm64`, `darwin-x64`, `linux-x64`, `linux-arm64` with
their `rg` (on Windows plus the bash) and the universal one without either for all other
platforms. `rg` lies in its own folder per platform, not in the `usr/bin` of the bash, because it
ships on all platforms, the bash only on Windows, and both bundles are built independently. The
extension names its `rg`, if its version carries one, directly to the workstation and to the local
host as `RAGENTS_RG`; `bashLaunch` puts its folder at the front of the `PATH` on every platform, a
named one that is missing is a hard error. Without a setting, an `rg` in the `PATH` applies. The
prompt is created on the server, the bash runs on the executor of the binding; therefore a
workstation reports `ripgrep` at sign-in next to the platform (whether its bash finds `rg`), the
server determines the same for itself at startup (`ripgrepAvailable`, host API extended by this
name). The platform text then says: search with `rg`, list with `rg --files`, `grep` only for
single files and pipes; without `rg` it names the absence and requires `--exclude-dir` for
dependency and build folders. `WORKSPACE_EXECUTOR_VERSION` is 6, because the field belongs to the
sign-in and an older workstation does not report it.

Rejected: only exclusion hints in the prompt (the model forgets them, and `grep` under MSYS stays
slow even with exclusions); `git grep` (misses untracked files and works only in Git
repositories); the `@vscode/ripgrep` in the program folder of VS Code (an internal path that can
change with every VS Code version, and not there without VS Code); a separate search tool
(contradicts the decision that `bash` covers search and directory listings); putting `rg` into the
`usr/bin` of the Windows bash (couples two bundles and would apply only to Windows).

## A message from the human ends a blocking question (28.09.2026)

Chapters: `docs/spec/core.md` (Origin of an input; File format, write boundaries, and replay),
`docs/spec/plugins.md` (Web as plugin host, Questions from `ragents.ask`), `docs/usage.md` (Run
chat and surface), `docs/development.md` (Journal example).

**Why.** `ask_user` holds the asker's turn until the question is answered, and steering waits for
the result of a running tool call. If the user wrote a message instead of an answer, it stayed
behind the blocked tool, the question stayed open, and the run hung until someone answered. A
message that a human writes to the asker makes the question obsolete. For this the core needs a
field: the journal could not distinguish a human's message from system inputs, because
`enqueuedBy` is the owner for all of them, including the automatic reports to creators, the
solution answer of `ragents.lsp-roslyn`, the answer input of `ragents.ask`, the wake-up of a
watcher, the start input of a run script and `ragents.runs.enqueueInput`.

**Decision.** `actor.input.enqueued` and the ActorInput optionally carry `origin: "human"`. It is
set only by the host's chat path (`ragents.chat.send`, `ragents.chat.sendToActor`); decision and
journal check allow it only for a human acting actor (`input-origin-invalid`, 403) and never on a
subscription input. The core checks and projects the field but does not evaluate it. The journal
writes format 8, because an older version would reject the new lines; format 7 remains readable,
since it cannot carry the field. `ragents.ask` follows a rule that depends on the state instead of
the order: a question that blocks a running turn (asked with `AskCall.turnId`) counts as done as
soon as a not yet claimed input with `origin: "human"` is waiting for the asker, regardless of
whether it came before or after the question. If it comes afterwards, the plugin closes the
question as `dismissed` with `{ supersededBy: <inputId> }`, the call gets `SUPERSEDED_ANSWER`, no
answer input is created, and the message follows as steering. If it is already waiting, the plugin
asks no question. Questions without a turn, inputs without `origin` and messages to another actor
leave a question open. The record in the web shows `SUPERSEDED_ANSWER` instead of the dismissal
text. quassel and the core's action model stay unchanged.

Rejected: hiding the card in quassel (that only hides the hang and would apply to all clients);
counting the message as the answer (the text would be in the context twice, attachments would be
lost, and the message often changes the subject); reacting to every input under the owner
(automatic reports to creators would close questions); the prefix `chat:` of the command id as the
marker (a silent convention); also settling questions without a turn (the start question of
`ragents.lsp-roslyn` would then load no solution).

## Run condition per plugin (28.09.2026)

Chapters: `docs/spec/plugins.md` (PluginHost registrations, Prompt contributions and
orchestration guidance, Ownership per facet, Workspace with `renderForRun`).

**Why.** A profile can contain domain plugins whose prompts, functions and skills apply only to
runs in a particular project. If a user bound a run to an unrelated folder of their workstation, the
model still got them and applied the domain rules to the unrelated project. The existing paths
covered this only per facet and with gaps: `renderForRun` affected neither chapters on request nor
the selected system prompts, static tool contributions know no condition per run, and an
explicitly registered skill came back via the plugin's folder as soon as the explicit contribution
omitted it for a run. A separate check in every contribution of every plugin forgets one with the
next contribution.

**Decision.** `host.runCondition(condition)` ties all run-related contributions of a plugin to a
synchronous condition on the run id that the plugin provides: prompt parts of every delivery,
functions, skills including folder skills, and agent hooks. The host evaluates it at the four
places where it resolves these contributions per run (`PromptContributionRegistry.runOverrides`,
`ToolRegistry.resolve` via `ToolContributor.runCondition`, `SkillContributionRegistry.describe`,
`AgentContributionRegistry.resolve`); what does not concern the run is missing there instead of
appearing as unavailable. If the condition throws, the turn fails with its cause, so that an
undecided run does not silently continue with or without the contributions. In addition, every
replacement per run applies equally everywhere: in chapters on request, in the prompt part of the
selected system prompts (coordinator and, with `shareWithAgents`, worker), and `renderForRun` may
return `undefined` to keep the rendered text; this way a product plugin that is not conditional as
a whole can omit individual parts per run. An explicitly registered skill path belongs to the
explicit contribution in every run. The first users are the domain plugins of an external profile,
whose contributions apply only in runs that the plugin recognizes at startup as runs of its
project and records in the journal.

**Rejected.** Putting the condition into the availability of each function (`available`):
descriptor and function would have to be restructured the same way in every plugin, and prompt
parts, skills and hooks would remain open. The condition per contribution instead of per plugin:
more registration points for the same statement; whoever has to distinguish within a plugin uses
`renderForRun` or skill paths per context.

## Separate overall zoom for VS Code (27.09.2026)

Chapters: `docs/spec/plugins.md` (VS Code shell), `docs/usage.md` (Run panel and VS Code extension).

**Why.** The interface can seem too large with an unchanged VS Code window zoom. A pure font size
change shrinks neither spacing nor controls and mini-apps.

**Decision.** `ragents.zoom` scales the entire RAgents interface in VS Code as a percentage from 50
to 200, with default 100. CSS zoom sits exclusively on the outermost webview shell; nested frames
inherit the rendering without applying the factor again. A separate host message updates open
views without reloading, so that inputs and mini-app state are preserved. The browser and VS
Code's window, editor and chat font settings are not changed. An invalid value is a hard error
that stays visible: every view then shows the message instead of its content, rather than silently
continuing at 100 percent or staying empty; the limits are defined once as `ZOOM_MIN`/`ZOOM_MAX` in
`settings.ts`, and a test keeps the schema in `package.json` in sync.

## Model context as a projection of the journal, the session layer is dropped (27.09.2026)

Chapters: `docs/spec/core.md` (Runtime boundary, Model context across turns, Model context and
agent runtime with projection, Held context and cache markers, Equipping subagents, Artifacts,
Journal and projection, File format, Run transfer, Open limits), `docs/spec/overview.md` (Terms,
Architecture, Responsibilities, Guiding principle), `docs/spec/plugins.md` (Agent hooks, Seen file
state, Preparation chat, Workstation, Run metadata), `docs/operations.md` (Data storage and logs, Transfer a
run, Compaction of the model context), `docs/usage.md` (Switch runs, Run panel), `docs/development.md` (Folders),
`packages/agent/README.md`. Resolves the open point from "Agent runtime merged in" (24.09.2026):
the engine sits directly on the loop; session, session runtime and services are gone.

**Why.** An agent's model context stood in a private session file of the forked runtime
(`sessions/<run>/chat/<agent>/ragents-<uuid>.jsonl` with `active-session.json`), next to the
journal and not atomic with it. Fork copied files, a run transfer carried two stores, a crash could
let both diverge, and compaction was visible only in the session. Now the journal is lossless for
everything the model sees, and the context is a pure, deterministic projection of it. The
projection never re-renders, it reads stored forms; as a result the prefix of a request stays
byte-identical across turns and restarts, which the providers' prompt cache needs.

**Schema (journal file format 7).** Four new events, all from the actor of the running turn:

- `model.input.presented` (`turnId`, `inputId` or `null`, `content`): the user message exactly as
  it went to the model, at turn start and on steering at its place between the steps; `null` is
  the loop's nudge after an empty answer. The text is rendered (header lines of delivered events,
  embedded text attachments); images, videos and PDFs stand as the SHA-256 of their bytes in
  `artifacts/` (`{ type, mimeType, hash }`, for files with `filename`), never as Base64.
- `model.step.completed` (`turnId`, `api`, `provider`, `model`, `responseModel`, `responseId`,
  `usage`, `stopReason`, `errorMessage`, `diagnostics`, `timestamp`, `content`): the complete
  assistant message of a model step with text, thinking (signatures, `redacted`) and tool call
  blocks (`thoughtSignature`). It stands in ONE command together with the observation events
  `model.reasoning.completed` and `model.output.completed`, which before it carry the text of the
  non-empty blocks, unabridged and in block order; a block without its own text field takes the
  next of these texts. So there is no duplicate data storage and no step without its texts. A step
  with `stopReason` `error` is written (overflow and retry decision after a restart), a cancelled
  one never.
- `model.tool-result.presented` (`turnId`, `toolCallId`, `toolName`, `isError`, `content`): what
  the model saw of a tool call, after replacement by `afterToolCall`, images as a hash. `content`
  is missing when it is exactly the text of the `tool.call.completed` or `tool.call.failed` of the
  same call (`domain/tool-result-text.ts`); only a note about ignored fields, `recordOutput` or a
  hook make it necessary.
- `context.compacted` (`turnId`, `summary`, `firstKeptEventId`, `tokensBefore`, `provider`,
  `model`, `readFiles`, `modifiedFiles`): a compaction; the summary replaces everything before the
  first kept context event.

The projection (`agents/model-context.ts`, `modelContextOf(events, actorId, media)`) reads the
actor's events in journal order, prepends to a fork an unchanged copy of its source's context up
to the end of the source's last finished turn before the `agent.spawned`, and applies the last
compaction (`packages/agent/src/core/context-log.ts`). The rules for incomplete tool calls, failed
and cancelled steps and reasoning replay stay in `transform-messages`. A model step becomes
context only once its event is written; before EVERY model request the loop gets the projection
(`transformContext`), not its own memory. The id of the model context for the seen file state is
`run.created` plus the last compaction. The state of the hooks (`call.keep`/`call.kept`) stands in
the journal as `plugin.state-replaced` with actor scope under the id of the contribution.

**Deviations from the requirement.** No separate event for model and thinking level changes: every
step carries `api`, `provider` and `model`, and based on these `transform-messages` decides on the
reasoning replay; the thinking level is not context. `model.output.completed` and
`model.reasoning.completed` stay real journal events instead of derivations, because they are the
observable contract (subscriptions, delivery with `sourceEventIds`, `event_query`, run scripts,
chat, transcript); instead the step does not carry their text again. For that they are unabridged:
the text must stay byte-exact for signatures and the cache. `model.output.interrupted` remains the
display of a cancelled stream and is not context.

**Runtime.** `@ragents/agent` loses `agent-session`, `agent-session-runtime`,
`agent-session-services`, `sdk`, `session-manager`, `resource-loader`, `system-prompt`, the
extension system (`core/extensions/`) and `source-info`, `auth-guidance`, `defaults`. What stays is
the loop, model runtime, tools, skills, compaction (now via `ContextLogEntry` instead of session
entries) and `ToolDefinition` (`core/tool-definition.ts`). Per turn the engine puts an `AgentTurn`
(`drivers/agent-turn.ts`) directly on `Agent`: tools, system prompt plus skill catalog and
preloaded skills, hooks as direct calls (`AgentHook`, `drivers/agent-hooks.ts`), retry with
backoff, compaction at the threshold and after an overflow including a single retry, split turns
and incremental summary as before. Whether an answer lies before the last compaction is decided by
its place in the journal instead of a time comparison. `AgentSessionDriver` is called
`AgentLoopDriver`, `resolveExtensionFactories` is called `resolveHooks`, `TurnRequest` loses
`forkOf` and `runtimeDirectory` (along with `Workspaces.runtimeDirectory`) and gains
`modelContext`, `recordContext` and `hookState`. An empty system prompt stays empty; the runtime's
old fallback prompt with the working directory is dropped. The preparation chat runs directly on
`Agent`. The compaction values were initially configurable host-wide; since 28.09.2026 they belong
to the model (entry "Compaction values belong to the model").

**Fork means copy.** Until now a fork got the source's context up to the spawn, truncated before
the first tool call without a result and without reasoning blocks. Because the source is usually
itself in the middle of a turn at spawn (it is just calling `agent_spawn`), half a turn with its
own input but without a conclusion thus came into the fork. Now the copy ends at the end of the
source's last finished turn; nothing comes from the running one, nothing is inserted. Reasoning
stays in: there was no documented reason for removing it, and whether it is replayed for the
fork's model is decided by `transform-messages` as for every step. Without a finished turn of the
source, `agent_spawn` rejects with `fork-without-turn` (409) instead of failing only in the fork's
first turn. Rejected: taking the running turn along up to the spawn and closing it with an
explanatory text (inserted text would not be context the source ever had).

**Cache markers in the tool loop.** The last of the three Anthropic cache markers (system prompt,
last tool, last message) stood at the last text message of the request and thus fell behind the
new tool results in a tool loop. Now it sits at the really last message (`markCacheBoundary`,
`packages/ai/src/api/ai-sdk-messages.ts`), namely at its last part: at the last tool result or at
the last part of a user message, only for an assistant message at the message itself. A marker at
the tool message would be wrong: the AI SDK merges consecutive tool messages, and the OpenRouter
provider transfers a message marker to every tool result. From three parallel tool calls on there
were thus more than four markers in the request, and Anthropic rejected every such turn with 400
("A maximum of 4 blocks with cache_control may be provided"). The adapter now counts the markers in
the finished request body and aborts before sending if there are more than four; the test counts
them at 1, 2, 3 and 8 parallel calls in the body that the provider generates (always three).
Measured via OpenRouter with Claude Haiku 4.5 and eight consecutive tool calls in one turn,
cacheRead per step: 0 (cacheWrite 13651), 13651, 15931, 17952, 19973, 21994, 24015, 26036, 28057,
uncached input per step 6 tokens. With the old position cacheRead stayed at 23397, while the
uncached input grew from 2838 to 12750. Across turns: after a restart 13219 read and 16789 written
(Anthropic drops the thinking of earlier turns on a new user turn, the prefix changes once), then
without a restart 30008/63 and after another restart 30071/61; the prefix thus stays byte-identical
across restarts. After the correction with four and three parallel reads: no 400, cacheRead per
step 7032 (cacheWrite 6635), 13667, 14346, 14441, 14535; in the next turn 13667 and 14503.
Rejected: `cache_control` at the top of the request body (no effect, cacheRead stayed flat).

**No retry of rejected requests.** The pattern for OpenRouter's "Provider returned error" also
made deterministic 400s retryable; one turn thus wrote the same error step four times.
`isRetryableAssistantError` (`packages/ai/src/utils/retry.ts`) no longer retries 4xx except 408,
409 and 429, nor Anthropic's `invalid_request_error`; the status stands at the front of the error
message ("400: ...", "Relay ... (400): ...") or as `"code": 400` in the provider's body.

**Held context.** Projecting the whole journal and rereading the media before every model request
grows with the run. `ModelContexts` (`model-context.ts`, `Orchestration.modelContext`) holds the
context per run and actor and appends only the new events (`Journal.eventsSince`); after a restart
it is built once, and rebuilt if the run's first event differs. Deletion and conversation reset
discard it (`Orchestration.forgetRun`), a locked run returns none. The projection remains the only
source: the golden cases compare held and fully projected context byte for byte. Rejected: a
shared media buffer across actors and runs (it would linger after a run is deleted); instead the
media lie once per actor in the held context.

**Transfer and links.** The export failed on absolute links such as package managers create under
`node_modules`. Now it takes relative links within the run storage along, omits outward-pointing
ones under `node_modules` (the next installation recreates them) and aborts with
`run-transfer-link` at any other outward-pointing link.

**Locked runs stay visible.** A run with a rejected journal, for instance from format 4 to 6,
disappeared from the list and therefore could not be deleted. Now it stands in
`ragents.runs.list` with the cause under `locked` (`Journal.unavailableRuns`, also after a write
error); web and VS Code show it locked, do not open it and offer deletion, which archives the files
unchanged. Without a readable journal nobody knows the owner; the run therefore counts as a run
without an owner (with sign-in visible and deletable only with `runs.read.all`).

**Minor consequences.** When the owner of a chat interrupted its turn, the chat reported the end
twice; now only the main actor's turn reports its end. The CLI journal (`pnpm driver journal`)
again shows inputs with their content, subscription inputs as a reference to their event and
compactions as a separate line.

**After the review.** A retry and the continuation after a compaction now cut off all error steps
at the end; after two error steps and an overflow the turn otherwise ended at "Cannot continue from
message role: assistant". Every tool call of the model stands in the journal: if it fails before
the start (tool missing, refresh fails, input does not fit), `TurnToolset.invoke` writes start and
error afterwards, instead of letting the turn fail on the missing presentation. A call id reused by
the model gets a suffix (`-2`) before execution, because the journal keeps calls per turn by their
id; reporting the repetition as an error result was rejected (Anthropic requires unique ids anyway,
and a model without this obligation would have failed on a formality). The agent loop's
replacement message on an error outside a model call (`isRunFailure`) no longer goes into the
journal as `model.step.completed`. `fork-without-turn` checks the same condition as the
projection: a finished turn that presented an input to the model (new `RunState.contextTurns`, not
in the run view), or a source that is itself a fork. The held context applies only during a turn
and is released at the end of the turn; holding only hashes and resolving the media per request was
rejected, because then the finished context would also be rebuilt per request. `presentToolResult`
and the tools' retry check read the journal backwards up to the start of the turn instead of
copying it per call (`Journal.recentEvents`), the hooks read their state via `Journal.select`
instead of via a clone of the whole state. Hook notes carry `transient`, the cache marker stands
before them. A cancellation during retry wait or compaction no longer reports a failed compaction.
The retry check also recognizes the status in `"status": 400` and "HTTP 400". When a run with an
old journal is deleted, `sessions/<id>/chat` moves into the archive too. Removed are the driver
events `assistant` and `reasoning` together with `appendModelOutput` and `appendModelReasoning`
(tests write model steps), `ToolDefinition.promptSnippet` and `promptGuidelines`, the never passed
`ToolExecutionContext` and orphaned exports of `@ragents/agent`.

**Streaming.** Unchanged: text, thinking and tool deltas go transiently over the live bus to web,
VS Code and CLI, the journal gets the command once per step at the end of the step. A client that
connects in the middle of a step gets the buffer of the server's chat session as before. A
cancellation writes the visible text as `model.output.interrupted`, the cancelled step does not go
into the context; a crash leaves no half step behind, the turn ends as interrupted at restart.

**Removal.** The folder `sessions/<run>/chat/` and `active-session.json` are dropped together with
creation, archiving and `layout.chatDir`/`agentChatDir`. Instead of the sessions, the run transfer
carries the contents under `artifacts/` that the run refers to (`contentHashesOf`); this way chat
attachments move along too. A run fork (`forkRun`) now inherits the model contexts of its agents
with the journal. Journals of formats 4 to 6 carry no model context and are rejected with this
cause; like every invalid journal they lock only their run.

**Verified.** Before the removal an equivalence test ran with the faux provider against the old
session (tool calls, several steps, steering, nudge, rejected calls, provider errors with retry,
cancellation in the middle of the stream, attachments, image replacement by a hook, compaction at
the threshold and after overflow, fork); projection and session context were equal, also after
`convertToLlm`. Its contexts are now the expected values in
`packages/ragents/tests/fixtures/model-context-golden.json`, except for the `fork/*` cases: they
come from the new fork semantics (copy up to the last finished turn, with reasoning), the old
session truncated differently. In addition there are tests for restart
(byte-identical prefix of the first request after it), crash in the middle of the stream, streaming
without step events before the end of the step and the hook state.

Rejected: deriving output and reasoning events only in the projection (subscriptions, delivery and
`event_query` would need virtual events with their own ids and sequences); storing every step
completely with the observation events next to it (duplicate text); media as Base64 in the
journal; reading the projection only at turn start (then an unwritten step would still be
context).

## Chat building blocks from the quassel library (27.09.2026)

Chapters: `docs/spec/plugins.md` (Host API, Tailwind and stylesheet, Chat building blocks),
`docs/spec/overview.md` (Terms), `docs/development.md` (Folders, Developing quassel and RAgents
together). Replaces "No more vendor construct (01.09.2026)": the chat is again a separate library,
quassel (github.com/SchlenkR/quassel, npm `quassel`, MIT), extracted from state 4a9deed, and RAgents
consumes it as a dependency instead of a copy.

**Why.** The chat building blocks already knew no product before; as a library they can be used
by other applications, and RAgents no longer carries a second version. So that it stays ONE look,
quassel renders with the host's base building blocks and reads its tokens.

**Decision.** The general building blocks are removed from `apps/web/src/chat/`, as are
`apps/server/src/chat-events.ts` and `chat-attachments.ts`; server and web import the contract from
`quassel/events`, the components from `quassel`. `QuasselHost` gives quassel `Button`, `Toggle`,
`Card`, `StopButton`, `Popover` and `PopoverContent` from `apps/web/src/ui` as slots and allows the
links `flow:...` in every Markdown; the web's entry points and the chat and Markdown building
blocks of the mini-apps wrap it around their content. `apps/web/src/ui/quassel.css` includes
`quassel/chat.css` after the host's utilities and maps every `--qsl-*` variable to the tokens from
`theme.css`. Plugins share quassel as a whole library via the host API, because slots, link policy
and announcement region are context and module state; the modules
`@ragents/web/chat/{ChatInputToolbar,ChatMessages,ChatPanel,DetailModeSwitch,Markdown,types}` and
`@ragents/host/chat-{events,attachments}` are dropped. That is `HOST_API_VERSION` 6; collected with
it, `eventResultSchema` also drops out of `@ragents/engine`, which has had no user since
26.09.2026. The chat's variables are renamed (`--chat-*`, `--composer-height`,
`--input-card-radius`, `--scroll-cover` carry `--qsl-`), `announceMessages` is called `announce`:
the history is no longer a live region, quassel announces finished answers and new actions once.
The public chat types of the mini-apps (`Message`, `ChatAttachment` and their parts) are declared
by `client-ui/chat-contracts.d.ts` itself, because the contract must stay readable for authors
without foreign packages; the type check of client UI and bridge keeps it in sync with quassel in
both directions. The chat's behavior is still tested in `apps/web/tests`, against quassel with
RAgents' wiring, because quassel itself has no tests.

Rejected: forwarding modules under `@ragents/web/chat/*` (the host API would stay stable, but every
building block would have two names); quassel's own base building blocks (the same look, but a
second source that would diverge with every change to `apps/web/src/ui`); quassel's stylesheet
before the host's utilities (then the base classes of the slots, such as rounding and padding,
would win over quassel's classes).

## Error messages of actor program activation limited (26.09.2026)

Chapters: `docs/spec/actor-programs.md` (Diagnostics, type check, and domain tests). A test run with
25 deliberate type errors returned 2.5 KB, one line per error; but the amount was unlimited, and
messages of the client build came without line and column. Like the test report, the activation
now reports the count and the first ten errors with location; `actor_program_diagnostics` names the
rest (plugin guide, section 9).

## File state at the host instead of a hash in the call, like Claude Code (26.09.2026)

Chapters: `docs/spec/plugins.md` (Workspace, sandbox tools, and processes, "Seen file state").
Owner's requirement: `read`, `edit` and `write` manage the file state like Claude Code, the model
never passes a hash.

**Why.** In real runs 13 `edit` calls carried `expectedHash`, 9 copied correctly, 4 made up; all
four rejections because of a stale state went back to made-up hashes, none to a real change. In
addition, one run read the same unchanged file completely six times. A hash in the call requires
the model to copy 64 hex characters, against the rule "models copy nothing".

**Decision.** `expectedHash` drops out of the schema of `edit`, the line `[Content SHA-256: ...]`
out of `read`, the hash out of the success message of `edit`. The server keeps the seen state in
memory per run, actor, model context and path and passes it to the executor as the field `seen`;
the executor checks file and content hash and reports the new state back. `edit` and `write` on an
existing file that was not read or has changed since fail with a named cause, an unchanged repeated
`read` of the same excerpt answers with a notice. The model context comes from the agent runtime
(session and last compaction, `ToolScope.modelContext`); only direct calls of the model carry it,
calls from TypeScript run without a marker. `WORKSPACE_EXECUTOR_VERSION` is 5, because an older
workstation does not know `seen` and reports no state back.

Rejected: the marker in the executor (on a workstation it survives a server restart and would meet a
newly counted model context after a compaction, i.e. a wrong "unchanged"); a key via the resolved
file on the server (the server does not know a workstation's paths, therefore the path as written
plus a check of the resolved file in the executor); modification time and size instead of the
content hash (too coarse for fast changes of the same size). Limit: if the model names the same
file with a different path (alias versus relative), it counts as unread; that requires a `read`,
never a wrong notice. This decision replaces the line about `expectedHash` in the entry on the
deviations of the agent runtime further below.

## Lean tool results as a rule (26.09.2026)

Chapters: `docs/spec/plugins.md` (Plugin guide, section 9, evidence base), `docs/development.md`
(Rules). Owner's requirement: tool results deliver only what the model does not have yet.

**Why.** An evaluation of 25 real runs of a server profile showed about 1.3 MB of tool output
directly to models, half of it from 41 calls over 8 KB. Verbatim echoes were rare; the bulk came
from the whole state after every change including unchangeable catalogs, from the bash limit of 50
KB (once almost entirely a single minified line), from complete event envelopes and from
declarations that every answer repeats. The existing decision "no echo, no hex"
(`docs/spec/core.md`) applies only at `toolResultEventOf` for event payloads; plugin functions
deliver their results past it, and `read` and `edit` still show full SHA-256 values.

**Decision.** The rule stands as section 9 in the plugin guide and as a short rule in the handbook.
Queries are exempt: their answer is the requested result and not a repetition, so `event_query`
stays complete and limited only by its limit. The violations found are in `TODO.md`.

**Implementation.** Additional chapters: `docs/spec/core.md` (Tool results, `actor_list`,
`run_configure`), `docs/spec/typescript-platform.md` (`typescript_api`),
`docs/spec/actor-programs.md` (Test report, `actor_program_controls`) and `docs/spec/plugins.md`
(Workspace, sandbox tools, and processes; Browser checks). `bash` outputs at most 20 KB and visibly truncates lines over 1000
characters, the full output stays in the log file; `read` keeps 50 KB and 2000 lines, because it
reads page by page with `offset`, and its notice for an overlong line splits it with `fold`. Failed
tests of an activation are reported by a dedicated reporter with count, name, message, expected and
actual and the location relative to the program instead of raw TAP output. The browser reports a
failed request once instead of as HTTP, console and network error. Messages from `read`, `edit`
and `write` name the path as passed. Changing tools confirm briefly: `event_subscribe` returns
`subscriptionId` and `sources`, `event_unsubscribe`, `run_configure`, `canvas_layout_replace` and
`todo_replace` return `null`. Event results name only their actual types via
`eventResultSchemaOf`, and their payloads repeat neither `reason` nor `title` nor `mediaType`;
`eventResultSchema` stays for foreign plugins until the next jump of the host API.
`typescript_api` returns for `names` only the entries in `RAgentsCapabilityMap`, the declarations
of `context` once via `context: true`. `actor_program_controls` returns for a control only its
files, `actor_list` returns the size of the tool list instead of the list itself and the names
only with `toolNames: true`, because no code reads the list. In numbers: the result of
`typescript_api` for a function shrinks by about 2.6 KB, the result type of `actor_input` from
about 4 KB to 0.4 KB.

## Solution at the start of a run, solution list and switching in the tab (25.09.2026)

Chapters: `docs/spec/plugins.md` (Ownership per facet, Executor, Language server plugins),
`docs/spec/profiles.md` (Permissions in detail), `docs/development.md` (Extension points). Owner's
requirement: a new run should load the .NET solution of its workspace into Roslyn by itself, ask
immediately if there are several, never for run scripts; the model should find and additionally
load solutions, the user switch in the tab.

**Why.** Only the start itself knows whether a run starts via a run script; the journal knows the
template of a script only after its actor is built, a free message never. A host hook after the
workspace and the first actor, before the first input, decides this without timing: no actor has
had a turn, so nobody has opened anything yet, and the marker in the journal keeps the pass to one
per run, even across restarts. Concurrent opening is resolved by the executor, not the plugin:
`ifNoneOpen` checks and claims in one step and also counts calls that are still resolving their
path. Outside a turn only the owner may give commands; therefore the owner asks, as the host
confirmation of the actor programs already does, and `ragents.ask` gets `recipient`, so that an
answer orphaned after a restart lands with the coordinator instead of expiring.

**Decision.** `SessionLifecycleContribution.sessionStarted({ runId, startEntry })` in the core,
without knowledge about tools. Adapters with `solutionExtensions` (Roslyn) get `<id>_solutions`
(tool and operation, `git ls-files` without `node_modules`, `bin`, `obj`, without Git the folder
search) and `<id>_switch`; `<pluginId>.solutions` and `<pluginId>.switch` (additionally
`runs.write` and the new `<pluginId>.write`) serve the tab. Switching does not wait for loading,
because a proxy in front of the server aborts long requests. Loading at start belongs to the Roslyn
plugin (`ROSLYN_SOLUTION_ON_START`, default `"off"`), FSAC and TypeScript stay without it. An action
posed by the owner no longer carries a name in the chat, because it is a question from the host. If
someone opens an instance while the start question is open, the plugin discards it via the new
`AskService.withdraw` (without loading, without input to the coordinator); the trigger comes from
`onOpened` of the language server framework after tool open and switching.
`WORKSPACE_EXECUTOR_VERSION` is 4: an older workstation does not know the new operations and would
silently skip `ifNoneOpen`; it is rejected at sign-in.

Rejected: deriving the decision from the state of `ragents.actor-programs` in the journal (a
foreign plugin, and visible only after the script actor is built); a `beforeModelCall` hook in the
first turn (asks only with the first message and only if a model runs); the question in the name
of the coordinator (the core allows an agent's commands only in its turn); switching as a sequence
of snapshot, close and open in the server (three paths to the executor, open to others in
between). Open: when switching, an open of other roots that is still resolving its path remains;
a question after a server restart depends on the coordinator turning the passed-on answer into
`<id>_open`. Verified by `language-server-startup.test.ts` (search with and without Git,
`ifNoneOpen`, switching), `roslyn-solution-on-start.test.ts` (0, 1, n, script start, once per run,
open instance, answers, restart, stop), `language-server.test.ts`,
`workspace-owner-access.test.ts`, `run-script-start.test.ts`, `skill-prompt-start.test.ts`,
`start-options.test.ts` and `language-server-panel.test.ts`.

## On Windows a bundled bash, on the workstation the inherited environment (25.09.2026)

Chapters: `docs/spec/plugins.md` (Workspace: environment, prompt contribution of the shell, bash on
Windows; Open limits), `docs/operations.md` (Work on Windows), `docs/development.md` (Publish the
VS Code extension). Owner's requirement: the model still gets exactly one tool `bash`, also on
Windows. There RAgents only uses a bash that it ships itself, and `git` stays the user's Git.

**Why bash and not a PowerShell tool.** The models are trained on bash, our skills, prompts and
run scripts are bash, and a second tool would mean different prompts and examples per platform.
PowerShell passes objects through the pipe instead of text; what a model writes there is a
different language with different errors.

**Why a bundled bash and not the user's Git Bash.** Which Git Bash version is installed, where it
lies and what its `/etc/profile`, its `bash.bashrc` or a `PATH` with Cygwin or WSL make of it is
beyond RAgents' control; a search via `Program Files` and the `PATH` in the worst case found the
old `System32\bash.exe` of WSL. A fixed version from a defined archive (Git for Windows
PortableGit, pinned by SHA-256) behaves the same on every machine and is part of the Windows VSIX.
Busybox (`ash`, different options for almost all tools) and `just-bash` (a reimplemented bash in
JavaScript without real processes) are not a bash that models and scripts can rely on. The
selection is lean: bash and the GNU text tools together with their DLLs, which the build script
determines from the PE imports; Git, Perl, editors, SSH, GnuPG, OpenSSL and terminals stay out. Git
is the `git.exe` from the `PATH`, so that the user's sign-in (Credential Manager), `~/.gitconfig`
and `~/.ssh` take effect without further ado.

**Why the workstation inherits and the server does not.** On one's own machine the run's bash should
work like the developer's terminal: their toolchain variables, proxy settings, sign-ins. The
allowlist took that away and gained nothing, because the environment is their own anyway; only the
variables of the surrounding VS Code and `BASH_ENV`/`ENV` stay excluded, so that no startup file
slips into `bash -c`. On the server the environment carries keys and tokens that do not belong to
the run's user; there the allowlist stays. The choice is an explicit parameter
(`baseEnvironment`), not a switch by platform or operating mode. The extension's local host does
not inherit yet, because its environment contains secrets that the extension passes to it
(`TODO.md`).

**Decision.** The executor's context carries the bash (`bash`); on Windows it is required, without
it `bash` fails with a cause, there is no search anymore (`getShellConfig` throws on Windows
without a path; the stdin path for WSL is dropped). Everywhere the start is
`bash --noprofile --norc -c`; on Windows the `usr/bin` of the bash stands at the front of the
`PATH` and `MSYSTEM` is dropped. The extension names the bash directly for its workstation and via
`RAGENTS_BASH` for its local host; without the extension you set `RAGENTS_BASH` yourself. Packed
are a universal VSIX without bash and one each for `win32-x64` and `win32-arm64`; the ARM64 version
carries the same x64 programs, because MSYS2 has no native ARM64 userland. The programs are under
GPLv3 and LGPL; the bash carries license texts, package versions and the source references to Git
for Windows and MSYS2 in `NOTICE.txt`, only `etc/nsswitch.conf` is changed.

## Tab area of the run panel as a pop-out instead of below the chat (25.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel, Workspace tabs).
Owner's requirement: the tabs of the toolbar (Files, Language server, Documents ...) no longer open
at the bottom of the main area, but cover it almost entirely, like the other pop-outs of the run
panel (run details, recipient). On closing, the main area is unchanged.

**Why.** Below the chat the tab area shared the height with chat and stage; both became small, and
the handle had to be readjusted for every tab.

**Decision.** `RunPanelWorkspace` lies absolutely over chat and stage with the rest dimmed; X,
Escape, a click beside it or another click on the button close it. At a width of at least 960
pixels, when two areas stand side by side, it covers only the right part. Handle and height are
dropped; the state per run is now only `{ tab }` under the new key
`ragents.run-panel.workspace-tab:<runId>`, the old entries are ignored without migration.

## Shared pop-out spacing and backdrop (25.09.2026)

Chapters: `docs/spec/plugins.md` (shared UI building blocks, Run panel).
Pop-outs take their spacing of 8 pixels from `PopoverContent`. Dialogs, dimming pop-outs and chat
sheet use the same theme value `--backdrop`, so that the stronger dimming is maintained centrally.
The recipient search stands next to the title in the shared pop-out header and searches visible
as well as hidden actors.

## Homepage as a handwritten page without a structure check (25.09.2026)

Chapters: `docs/spec/overview.md` (Product homepage), `docs/development.md` (Homepage rules).
Owner's requirement: the redesigned homepage is taken over as it is; the generator's sticker and
structure rule is dropped.

**Why.** The rule required exactly one sticker per core feature, one section with
`data-core-feature` and one guide link. The new page has stickers that jump to the same scene from
two angles, and sections without their own sticker; the rule would have forced the page into a
shape the owner does not want.

**Decision.** `docs/homepage/index.html` is handwritten, with `homepage.css` and `homepage-*.js`.
The generator no longer checks its content (`homepage-structure.ts` and its test are removed); it
still takes over its header for the guide pages and publishes the files named in
`homepageFiles`. Content guidelines are in `docs/development.md`: short direct sentences, principle
diagrams with general roles, scroll-bound animations without smoothing, only proven features.
## Model aliases of the profile for own runs and relay (25.09.2026)

Chapters: `docs/spec/profiles.md` (Model providers), `docs/spec/plugins.md` (Model relay, Host
API), `docs/usage.md` (Selectable model), `docs/operations.md`. Owner's requirement. Alias names
existed only for clients of the relay (`RELAY_MODELS`); a server's own runs named providers and
real model names, and the model selection showed `openrouter/<model>`. The existing relay was not
suitable for this: it is an HTTP path for other servers, the own server would have to query itself
at startup and hold a token for itself. Decided: `MODEL_ALIASES` in the section `host`
(`plugin-support/model-aliases.ts`, since 28.09.2026 objects with compaction values, entry
"Compaction values belong to the model") is the one list; `RELAY_MODELS` is dropped, the relay
offers exactly these aliases. The server registers them under the provider `alias` in the one model
runtime (`ModelRuntime.registerAliases`, a change to `packages/agent`): catalog data and thinking
levels come from the target, the request goes out with the target, every event comes back with
the alias, and earlier answers of the alias count as the target's own, so that reasoning
signatures are preserved. A product plugin uses the aliases with `AGENT_PROVIDER: "alias"`; without
`AGENT_MODELS` all aliases are selectable, displays name no provider (`modelLabel`). The thinking
level at the alias is its default in exactly one place: a role thinking level without a value
takes it over (`roleThinkingLevel`), and a switch in the chat to another alias preselects it.
`configuredModelAliases`, `modelLabel` and `roleThinkingLevel` are new in the host API, without a
new `HOST_API_VERSION`, because nothing is dropped. `core` and `showcase` now carry their relay
aliases under `host`.

Catalog: `deepseek/deepseek-v4.1-flash` was missing. `pnpm update:models` would have changed about
3900 lines (new models, new prices and limits, reformatted entries); therefore only this entry is
added, with values from `GET /api/v1/models` and `compat` like the other DeepSeek V4 models. The
thinking levels follow the API's `reasoning` block: `supported_efforts` go out verbatim, "off" as
`effort: "none"`, as long as `mandatory` is not set. `update-model-catalog.ts` now derives the same
rule for new entries; for Qwen3.8 27B, GLM 5.3 and GLM 5.3 Flash it yields exactly the tables
maintained so far.

Rejected: aliases as additional models of the real provider, because the display then names the
provider; renaming the model in the catalog alone, because the request then sends the alias to the
provider; a second alias list per product plugin. Open: title model (`COMPACTION_MODEL`) and tool
models of plugins still name real names, because they run via their own paths. Verified with
`apps/server/tests/model-aliases.test.ts` (catalog, levels per target, outgoing request per level,
return path with alias, history, defaults) and `apps/server/tests/model-relay.test.ts`.

## Recipient selection as a tree "who created whom", short description per actor (25.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel), `docs/spec/core.md` (Ownership, Short description),
`docs/usage.md` (Run panel and VS Code extension). Owner's requirement. The recipient pop-out in
the run panel was a flat list with handle, kind and state; in a run with coordinator, implementer
and 37 rule reviewers you could not see who belongs to whom and what each one does. Decided: the
pop-out shows a tree from `createdBy` (`addresseeTree` in
`plugins/ragents.orchestration/web/run-panel/addressee-tree.ts`, rendering in `AddresseeTree.tsx`),
coordinator at the top, per entry handle, short description and state; from four siblings of the
same kind (kind and first handle word) on, a collapsible group with a state count, the search only
from more than twelve actors. The origin was already reliably in the journal: `createdBy` is the
actor of the creating command, and the journal semantics check it together with `agent.spawn` on
writing and loading; the interface guesses nothing. New is the optional short description
`description` in `agent.spawned` and `script.created` (at most 160 characters, whitespace
collapsed), set via `agent_spawn` and for TypeScript actors from the package description of the
actor program, shortened; `actor_list` returns it, the orchestration prompt asks for it. Old
journals load without the field, the interface then takes the first line of the first own input or
a differing display name. `actorDescriptionMaxLength` is new in the host API, without a new
`HOST_API_VERSION`, because nothing is dropped.

Rejected: deriving the description from the actor's prompt, because it arrives empty without
`runs.inspect` and role texts are not a heading; grouping by the same prompt or model, because
reviewers of the same kind have different prompts; a separate group field in the core, because the
handle stem suffices and the core would thereby get a presentation question; the limits of this
heuristic are in the Open limits of `plugins.md`. Verified with
`apps/web/tests/addressee-tree.test.ts` (tree, groups, description, states, search),
`apps/web/tests/addressee-tree-browser.test.ts` (pop-out in the run panel with 37 reviewers:
nesting, group collapsed and expanded, search, selection) and
`packages/ragents/tests/actor-description.test.ts` (field via `agent_spawn` and engine, limits,
loading with and without the field).

## Detail level and timestamps in every chat from one building block (25.09.2026)

Chapters: `docs/spec/plugins.md` (Chat building blocks, Tile chat, Host API), `docs/usage.md`.
Owner's requirement. The timestamp switch stood only in the input of the run chat; actor chats in
run panel, tile and inspector, the preparation chat and the global coordinator built their own
inputs without it, and the tile hid timestamps permanently. Decided: `useChatViewSettings` and
`ChatViewSwitches` (`apps/web/src/chat-view-settings.tsx`, new in the host API, without a new
`HOST_API_VERSION`, because nothing is dropped) provide detail level and timestamps for the
switches and message list of every chat; `chat-timestamps.ts` merges into it, the storage key
stays. The timestamp choice applies per run and actor, chats without input also show the switches
as long as messages appear, and the preparation chat stamps its messages locally. Mini-app chats
stay without switches, because there the program determines the rendering via props. Verified with
`apps/web/tests/chat-view-switches-browser.test.ts`.

## `ragents run` without a folder (25.09.2026)

Chapters: `docs/usage.md` (Control RAgents as an agent), `skills-for-agents/ragents/SKILL.md`.
`ragents run` always chose a folder binding and thereby failed on profiles without existing server
folders and on templates that fix the binding via `fixed-start-options`. Decided: the folder is
optional, without it `run` chooses no binding, and the default of the profile or template applies.
A single value is always the task, two are folder and task; the count decides, not a look into the
file system, because a task can look like an existing path and the same line would otherwise be
read differently depending on the machine. If the template fixes the binding and a folder is
named anyway, `run` aborts before creating with a cause (template from
`ragents.plugins.bootstrap`), instead of overruling one side; `--workstation` requires a folder.
Verified with `scripts/agent/agent-cli.test.ts`.

## Model and thinking level in the run's chat, also after the start (24.09.2026)

Chapters: `docs/usage.md` (Selectable model), `docs/spec/plugins.md` (Start options, Slots),
`docs/spec/profiles.md` (Permissions in detail). Owner's requirement. Since the start selection shows
only tiles, the model of a new run could only be chosen in the preparation chat of a template with
a guide, and after the first message not at all. Decided: the model selection stands in the chat
input of every run (`ChatSurface` in `PluginChat.tsx`, so browser and run panel in VS Code are the
same), already in the empty run and afterwards. It remains the start option `ragents.model`: the
same list and choice, the same rights from the option's `rights` (`runs.inspect`, plus
`runs.create` and `runs.write` of the methods), the same check by `accept` against the models of
the profile's model selection and the levels of the model. New is
`StartOptionContribution.changeable`: such an option does not lock after the start, the host
writes its choice into the journal as `plugin.state-replaced`. The scheduler takes the model stored
there for every turn of the run coordinator (`coordinatorSelection`), as does the attachment check
on sending; a running turn keeps its model. A switch to a model that cannot process images, videos
or files in the coordinator's conversation fails with a reason, as with the global coordinator
(`model-history-unsupported`). For this `selectStartOption` is asynchronous. In the web every option
counts as locked until the server's first response after the first message, after that its
`locked`.

Rejected: a separate method for the model of a running run, because it would have defined rights
and allowed values a second time; an event that changes the actor's execution, because the stored
plugin state is already in the journal and carries the choice before the start just the same.
Open: a template that fixes the model binds it only for the start; after that a user with the
rights can switch. The switch does not check images from tool results, only attachments of inputs.
Verified with `apps/server/tests/chat-model-choice.test.ts` (real scheduler: without
`runs.inspect` neither list nor choice, only models of the model selection and their levels, the
choice before the first message in the first turn, a switch from the next one on),
`start-options.test.ts`, `chat-attachments.test.ts` and
`apps/web/tests/start-page.browser.test.ts` (chat input in the browser and in the run panel of VS
Code, with and without `runs.inspect`).

## Start selection in the browser like Start in VS Code, new runs there only on the server (24.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host: draft and start selection, Slots, Run panel
and VS Code, Workspace), `docs/spec/profiles.md`, `docs/spec/actor-programs.md`, `docs/usage.md`.
Owner's requirement. On "New run" the browser showed a task input with attachment, model, thinking
level and send, below that workspace and system prompts and a searchable list with preview; the
run panel in VS Code, by contrast, has no separate selection page: the extension's Start shows
tiles, "New chat" opens the empty run, a template starts immediately, only a guide asks first.
Decided: the start selection (`StartSelection`) consists of the same tiles as Start, `StartTiles`
extracted from `panel/StartPage.tsx`, and starts like the run panel via `startEntryDirectly`;
`defaultStartEntry` now also arrives in the web for this. Selection via list and preview, free task
input and start options are dropped there; the start options stay in the preparation chat of a
skill template with a guide, otherwise a new run takes the defaults. Second, the browser offers no
workstation as a machine for new runs. The place for this is the host, not the building block:
`RunPanelHost.machines` is `server` in the browser and `all` in VS Code, `RunPanelHostProvider`
passes it on as `OfferedMachines`, the web app without a host stays with the server, and every
start option gets it as `machines`; the workspace selection then shows workstations or only the
server. The server stays unchanged, VS Code and `ragents run` still bind to workstations. Specific to
the browser remain the draft as a dialog over the previous run and the missing server block,
because the web app knows exactly one server.

Rejected: keeping the start options as a bar above the tiles, because the page would then no
longer look like Start; querying the host in `WorkspaceBindingControl` or in `StartSelection`,
because the difference lies with the host. Verified with
`apps/web/tests/start-page.browser.test.ts` (browser only server, run panel in VS Code also the
workstation; tiles and start paths), `start-tiles.test.ts`, `workspace-binding.test.ts`,
`run-panel-host.test.ts` and `plugin-bootstrap.test.ts`. The fixtures of
`run-panel-start-browser.test.ts` and `run-panel-focus-browser.test.ts` had not started since the
plugin errors in the web (`failures` was missing) and have been updated.

## `ragents run` and `send` follow the turn via the server (24.09.2026)

Chapters: `docs/usage.md` (Agent commands), `skills-for-agents/ragents/SKILL.md`. Both commands
read the journal file in the data folder of the local profile. If `RAGENTS_URL` pointed to a server
with a different data folder or on another machine, they never found it and waited forever,
although the turn had long been finished. Decided: they follow the turn like web and VS Code via
the channel `ragents.run` and `ragents.runs.view`, i.e. only with `runs.read`; the local file is no
longer a source for them, not even on the same machine. Their own input is the owner's new input
with the sent text, its `claimed.turnId` the turn, whose status is the end. The view knows per tool
call only name, status and times and shows them only with `runs.inspect`; the tool lines therefore
lose their input, and `--json` returns the steps of the view instead of journal events.
`ragents.runs.events` would have kept the journal form, but requires `runs.inspect` and loads the
whole journal on every change. If the stream breaks or a request fails, the command ends with 1 and
the cause; the health poll every five seconds is dropped. `journal` still reads locally, with
`RAGENTS_URL` via `ragents.runs.events`.

## Every start option names its rights (24.09.2026)

Chapters: `docs/spec/profiles.md` (Permissions in detail), `docs/spec/plugins.md` (Start options).
Owner's requirement. `ragents.startOptions.list` and `.select` required `runs.inspect` across the
board; a user without this right could therefore bind a run to their folder or workstation neither in
the web nor in VS Code nor via `ragents run`, although only the model selection gives technical
insight. Decided: `StartOptionContribution.rights` names an option's rights, the methods now
require only `runs.read` and `runs.create` (the choice additionally `runs.write`). Model and system
prompt selection declare `runs.inspect`, the folder binding nothing. An option without the rights
is missing from the list instead of appearing as not selectable: `selectable: false` still
delivers value and rendering and would have revealed models and prompt texts. Choosing it fails
with `access-denied`, also via `options` of `ragents.overseer.createRun`. An option of another
plugin without `rights` is thus visible without `runs.inspect`.

## Forms in the mini-app frame, activating after removal (24.09.2026)

Chapters: `docs/spec/actor-programs.md` (Backend and client, Create, edit, and activate, Tile host
and functions tab). Owner's requirement. A view's frame was sandboxed without `allow-forms`;
Chromium then fired no `submit` ("Blocked form submission"), and `UI.Form` never submitted.
Decided: `allow-forms` in the iframe attribute and in the CSP directive `sandbox`;
`form-action 'none'` stays, a real submission to an address remains impossible. Verified in
`apps/web/tests/actor-view-frame.test.ts` with the CSP of the frame route. Second,
`actor_program_remove` stopped the TypeScript actor, whose handle stayed taken, and a package of the
same name failed on activation with "Handle already belongs to an actor". Decided: if the owner of
the handle is a stopped TypeScript actor, activation restarts it (`restartActor` in the name of the
caller, like the stop on removal) instead of creating one; its state must fit the new schema. Any
other owner remains an error with a cause.

## Every root belongs to a machine: an alias runs on the server, even in a run on a workstation (24.09.2026)

Chapters: `docs/spec/plugins.md` (Ownership per facet; Workspace, sandbox tools, and processes;
Server process sandbox; Language server plugins; Skills and starting tasks),
`docs/spec/actor-programs.md` (Packages and actor binding), `docs/spec/core.md` (Skills of the
agent runtime, Workspace in the system prompt), `docs/spec/typescript-platform.md` (Execute code),
`docs/operations.md` (Server process sandbox, Data storage and logs, Isolation per run). Owner's requirement.

**Finding.** A run bound to a workstation sent every operation to its executor, but only the server's
executor knew the server's roots: the workspace of the actor programs under `@actors` and the skill
folders. `read @actors/...` failed with "Unknown working directory alias", `$RAGENTS_ACTORS_DIR`
was empty in the workstation's bash, and the SKILL.md under its server path lay "outside the working
directory". The prompts promised both nonetheless. Because every VS Code run with a folder is bound
this way, you could neither build mini-apps nor read skill files there; spec and test cemented the
defect.

**Decision.** Every root belongs to a machine: the run's root to the machine of its binding, the
roots with an alias to the server. An operation runs at the executor of the machine that owns the
addressed root; the binding determines only the run's root and thus where an operation without an
alias runs. Which roots an input addresses is declared by the operation's module as a footprint;
`SandboxServices.execute` asks for it before dispatch at the server's executor, which carries the
same modules as every workstation, and sends an operation with an alias to it, in the context of the
run on the server. A call across both machines fails with `workspace-roots-mixed`. `bash` takes a
`cwd`: with an alias it runs on the server in the same process sandbox as every other process of
the run there, and only this bash has the variables of the server's roots; there is no separate
lock for it, because the path resembles the Node processes that a run on the server starts anyway.
Skills stand under `@skills/<name>/`, read-only in every binding. What a prompt says about roots is
created per run: the workspace's self-description names aliases, path and variables per binding,
plugin prompts and tool descriptions name only the alias.

**Why the reasons of 20.09.2026 do not apply here.** The entry "One workstation executor, the same
everywhere" rejected a switch per path: the binding `client` back then sent five basic operations
to the workstation and kept the tool logic on the server, every basic operation had to decide per
path, there were no language servers with `client`, and the server's Git credentials went into a
foreign bash. Now a whole operation moves per root, and both executors carry the same modules with
the whole tool logic; each keeps its language servers; the switch lies in one place before dispatch
and asks for the alias, not a path; and the bash on the server is not a foreign bash, but runs in
the run's sandbox with its folders. "No mixed roots" remains for the single call: it reaches
exactly one machine.

**Decided during construction.** The footprint hangs on the module
(`WorkspaceExecutorModule.footprints`, per operation a function of the input that never throws,
queried via `WorkspaceOperationExecutor.footprintOf`) instead of on the operation, so that
`operations` remains a directory of functions; the executor rejects a footprint for a foreign
operation when being built. It names `{ roots: { aliases, runRoot }, durationMs? }`: the duration
an input itself requests belongs to it, so that `durationOf`, the last place where the sandbox host
read a tool input (the bash's time limit), is dropped; `commands.run` declares its `timeoutMs` this
way, and no caller has to name `durationMs` for it anymore. Aliases exist only on the server,
therefore every alias goes there, even an unknown one: the server then names the known ones, as in
a run on the server, instead of the workstation reporting "known: none". The bash's parameter is
called `cwd`, relative to the working directory or with an alias, never absolute, because an
absolute path applies only on one machine; it belongs to the agent runtime's bash, the resolution
of the alias to the executor, and a read-only folder is allowed, so that a bash can read in the
skill folder. `WORKSPACE_EXECUTOR_VERSION` is 4, because an older workstation would silently skip
`cwd`. The skill alias is `@skills/<name>` per skill as its own read-only root directly on its
folder: no copied index that goes stale, and no symlinks that lead out of the root; the name is the
folder name anyway. In return a skill name applies once in the whole profile and is checked at
startup, `files.list` and `files.read` resolve an alias with a subfolder, and
`workspaceProcessContext` rejects duplicate or nested aliases. `Skill.location` is the location for
the model, `filePath` remains the one the host reads from. The self-description is created during
resolution from `WorkspaceSandboxHost.serverRoots()`, the registered roots and the skills, without
calling `directoryFor`, which would create folders when resolving all runs at startup. The file
tools still resolve `$RAGENTS_..._DIR` at the start of a path, because the global coordinator knows
its journal folder only via the variable and always works on the server.

Rejected: not offering the server's roots at all in runs on a workstation, because there would then
be no mini-apps and no skill files there, and VS Code binds every run with a folder to the
workstation; separate file functions per plugin following the pattern of `document_write`, because
every plugin with a root would need reading, editing, writing and diagnostics twice and the
language servers would still not reach its files. Verified with
`apps/server/tests/workspace-foreign-machine.test.ts` (file tools, language servers, bash,
`typescript_eval`, skills, mixed call, self-description and an actor program from creation to
activation in a workstation run), `process-sandbox.test.ts` (bash with alias in the run's sandbox)
and `pnpm check:remote-workspace` with actor program and skill. What remains open is that the
process bar and diagnostics tab of a run on a workstation show only what runs at the executor of the
binding (`TODO.md`).

## Additional folders for the process sandbox in the workspace contract (24.09.2026)

Chapters: `docs/spec/plugins.md` (Ownership per facet, Server process sandbox). A
workspace contributed by a plugin can need folders outside its folder: a Git worktree per run
whose shared repository (`git rev-parse --git-common-dir`) lies elsewhere. The sandbox blocked it,
and Git via bash failed with `not a git repository`. Decided: `SessionWorkspace.sandboxFolders`,
and thus also the `WorkspaceResolution` of a contribution, names per folder `directory`, absolute,
and `access`, `read` or `write`; the sandbox host takes them over when building the run's rules, a
relative path is an error. The core knows no Git in this, and the permission applies only to
processes, not to the file tools. Host API list and manifest stay as they are: the field is part
of a type, not a new value. Verified on macOS with a real sandbox in
`apps/server/tests/process-sandbox.test.ts`: `git status` and a commit in the worktree succeed only
with the declared folder.

## Schema violations with path, typed templates, creation all or nothing (24.09.2026)

Chapters: `docs/spec/overview.md` (Binding rules, rule SCHEMA VIOLATIONS NAME PATH AND REASON),
`docs/spec/actor-programs.md` (Packages and actor binding, File permissions, Create, edit, and
activate, new section Templates and creation, Open limits), `docs/spec/plugins.md` (Dispatcher),
`docs/spec/typescript-platform.md` (TypeScript actors). Three classes of errors were related:
templates carried fields that the authoritative schema no longer knows, without anyone noticing;
the rejection did not name the field, so only guessing helped; and a failed creation left half a
folder behind that blocked the name without appearing as a program.

**A schema violation names path and reason, everywhere via `schemaComplaints`.** Dispatcher
(input, result, channel parameters), operations and start options of the plugin host, tool
results, `package.json.ragents`, the backend contract and the test SDK of the actor programs
(bundled into `testing.js`) no longer answer with a blanket sentence or the first message of
`Value.Errors`, but with every violated path and its reason. The prefix of every message stays.
For this `schemaComplaints` takes the name of the root (`params`, `result`, `value`, `ragents`,
`contract`), because "input" would be wrong for a result or a package file, and never returns an
empty reason.

**Templates are typed values against the authoritative schema, and all of them are created and
activated in the test.** The `ragents` metadata of a template is an `AppPackage`, `package.json` is
created from it on creation (`templateFiles`), and the type of the files rules out a second version
as text. If the schema loses a field, the compiler reports every template that still sets it; the
new test creates every template and activates it with type check, build and its tests, so that its
source code also does not silently go stale against the platform. `width` and `height` are dropped
from the templates and from the spec sentence; the host determines the size of a view.

**Creation is all or nothing, even after a crash.** A package is created in
`actor-workspace/.staging/` on the same file system, all steps run there, and only a `rename` makes
it visible under `actors/<name>`. The pnpm workspace, diagnostics and agents thus never see half a
package, and an error leaves the name free. POSIX `rename` replaces an empty target folder,
therefore the host checks synchronously immediately before whether the name is taken; a
reservation in the process rules out concurrent creations of the same name. Remnants of a crashed
server run are cleared away by the next creation in the run, which spares the running creations of
the process that it knows; the journal lock prevents a second process for the same run.
`importPackage` creates the sources of a run script the same way. The staging folder lies in the
synchronized workspace, so that owner and permissions arise as before; for this
`syncWorkspaceOwnership` skips entries that disappear during the synchronization.

**No package knows its folder.** `prompts.js` bound `readPrompt` to the absolute folder at
installation, so after the rename to the staging. It now determines its package from
`import.meta.url`; this applies equally to the copy in the build folder. Rejected: rewriting
`prompts.js` after the rename, because then something can still fail after the one visible step
and the package would be half right. A backend must not bundle the module for this; the host
builds with external packages, and `workflow-foundation.test.ts` now builds the same way.

Rejected: only deleting `width` and `height` from the templates, because the next schema change
would break the templates unnoticed again and the message would still name nothing; a try/rm in
`scaffold`, because it shows half a package during construction, cleans up nothing after a crash
and in the error case can delete a folder that another call has created in the meantime.

## Input bridge also through mini-app frames (24.09.2026)

Chapters: `docs/spec/plugins.md` (VS Code extension), `docs/usage.md` (VS Code operation).
The previous keyboard and clipboard bridge ended in the run panel. A mini-app lies in a further
iframe; typing worked there, but HEX pasting and VS Code keyboard shortcuts did not reach their
target. The existing handlers are used together via the already checked frame connections. The
VS Code root activates the transport; further hosted frames pass it on. There is no special
treatment of individual text fields and no second shortcut list. Local text editing and handled
events stay local; normal browsers continue to use their native input.

## Process sandbox for everything a run starts on the server (24.09.2026)

Chapters: `docs/spec/plugins.md` (Workspace, new section Server process sandbox; Open
limits), `docs/spec/profiles.md` (Permissions in detail, Open limits), `docs/operations.md` (Server
process sandbox, Data storage and logs). Owner's requirement: on the server, `bash`, `commands.run` and the
Node processes of the TypeScript platform run in a process sandbox; on a workstation it stays the
developer's bash.

**Why.** The profile's rights limit which methods a user calls, not what native code of a run
reads on the server machine. A snippet of the global coordinator could read other users' journals,
every bash of a run the storage of other runs and the secrets in the home of the server account,
and everything was allowed onto the network. A system account per user would have closed this only
for files and required a server with root rights.

**Decision.** The sandbox is `@anthropic-ai/sandbox-runtime` in fixed version 0.0.77 (Apache-2.0):
Seatbelt on macOS, bubblewrap with network and PID namespace on Linux, network only via a proxy
with a domain allowlist. It hangs in one place: the server's sandbox host passes it to a run's
process context, every process start in the executor wraps itself via `sandboxedLaunch`; no tool
and no core knows it. The rules are created per run from its folders (read and write: workspace,
server folder, registered roots, home, NuGet cache, own temp folder; blocked: homes, temp and data
folder of the server, readable again: host folder, toolchains, own storage, read-only roots). The
allowlist stands in the section `ragents.workspace` (`PROCESS_SANDBOX_NETWORK`); the default npm,
NuGet and GitHub covers package installation, restore and Git over HTTPS, the server's own address
is always included, because the global coordinator reaches its server via it. Switching off is
possible only explicitly (`PROCESS_SANDBOX: "off"`); Windows without this setting, Linux without
bubblewrap and a machine on which the probe process fails at startup abort the start. Windows is
left out because the library there sets folder rules only for the whole session, not per run.

**What was adjusted for this.** Tools prescribe locations that the sandbox would otherwise break:
in the sandbox `PATH` names the targets of its symlinks, on macOS `/tmp/.dotnet*` and
`/tmp/MSBuild*` together with Unix sockets under `/tmp` are allowed and `trustd` is reachable, .NET
stays on IPv4 and MSBuild without reused nodes, build server and shared compiler, so that no build
process of one run accepts jobs of another. Readable folders that contain a writable one are split
into their remaining entries, because bubblewrap otherwise lays them over it write-protected;
likewise permitted folders that contain a blocked one (such as a project folder around the data
folder), because Seatbelt otherwise blocks the permissions within the block again. Verified with
`apps/server/tests/process-sandbox.test.ts`, `pnpm check:remote-workspace` and a real
`dotnet build` including NuGet restore, `npm install`, `pnpm install` and `git clone` in the
workspace on macOS and Linux (container).

## Continuous background for mini-app and chat (24.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel).
The base color of the mini-app (`--app`) continues behind the reserved chat area. The areas stay
separate in the layout, without the previous color jump. The outer frame gets square corners at
the top and bottom; the inner chat card keeps its border and shadow.

## Status line aligned with the chat input (24.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel).
The answer preview in the collapsed chat uses the same horizontal spacing as the input. Its
previous own spacing let the text stick out beyond the field edge on the left.

## Align chat timestamps with the first line of text (24.09.2026)

Chapters: `docs/spec/plugins.md` (Chat building blocks).
Timestamp and content share the first text baseline. A fixed top offset did not fit the different
paddings of step groups and message bubbles; as a result the time stood visibly higher than the
associated message.

## One term per thing (24.09.2026)

Chapters: `docs/spec/overview.md` (new section Glossary, Terms), all spec chapters,
`docs/spec/actor-programs.md` (formerly `run-modules.md`), `docs/usage.md`, `docs/operations.md`,
`docs/development.md`, `README.md`, homepage and guide (chapter `guide-plugins`, formerly
`guide-extensions`), `docs/concepts/run-fork.md` (formerly `run-templates.md`). Owner's
requirement: docs, interface and code used different words for the same thing (canvas, work
surface, tile surface; environment, destination, target, connection; run, conversation, session;
entry, start template, tile; parent coordinator, overseer), and the same word for different things
(stage, template, workspace, extension).

**Decision.** The "Glossary" table in `overview.md` is authoritative: surface (code `surface`),
tile only on the surface, stage for the one mini-app in the run panel, template for entries of the
Start page (kinds skill and script, code stays `StartEntry`), run fork for the concept of the copy,
workspace and workstation kept apart, bar for the tab bar, server for an entry of the VS Code
extension (code `connection`), global coordinator, profile for the profile file and role for the
model default, plugin for RAgents and extension only for VS Code, hook instead of agent extension,
run instead of the German "Lauf", conversation and session, actor program as the only name of
the programs. Server instead of environment, because "environment" on the same page already
means environment variables and every entry is exactly one RAgents server, including the locally
started profile; that is also what it is called in the binding (`machine: "server"`).

**Code without old names.** Host API 5 is not published yet, so its names change without a new
number and without a transition: `runManagementToken` (type `RunManagement`), `runGuardToken`,
`runWorkspaceProviderToken`, `SurfaceControllerProvider`, `useSurfaceController`, `actorTone`;
`stopChatActor` is dropped together with `stop` in `SessionContext` and `useChat`. The message
layer names `ragents.runs.list`, `ragents.runs.delete` and the channel `ragents.runs` instead of
`ragents.sessions.*`. In the web, slot and contributions are called `surface` and
`surfaceElements`, the dialog area `surface`, a plugin's chat event `kind: "plugin"`
(`pluginEvents`), the settings `agentHooks`. Where "surface" already meant something else, it is
now named after its thing: color tone (`actorTone`, `data-tone`), display location of a chat
(`display`), page in the location of the global coordinator (`page`) and placement of a start
option on the Start page (`page`). The VS Code extension speaks in code only of `connection`,
including command ids and context keys.

**What stays.** Journaled names do not change, because there are no migrations: the tool
`canvas_layout_replace` (stands in the tool selection of actors and in capabilities of activated
programs; an unknown name would make their next turn fail), the placement kind `canvas` in the
state of the actor programs and the role as `profile` in journal and `model_list`. The plugin
contract still calls a run `Session` in type names (`SessionContext`, `sessionMetadata`,
`storage.session`); that is about 3800 places, partly agent and sign-in sessions, and gets its own
restructuring (TODO). Rejected: aliases for old method, command and host API names, because the
course knows no legacy paths. `docs/decisions.md` stays unchanged as history, only chapter
references point to the new files.

**Global coordinator without a shell with sign-in.** With users, the global coordinator no longer
has `bash`: the shell would run as a server process and could read other users' journals. It then
sends its JSON-RPC calls from snippets with `fetch` and its token from `process.env`; without
sign-in `bash` stays. An existing coordinator with `bash` in the tool selection reports
`global-tools-changed` until its conversation is reset. The boundary is thus not completely
closed: snippets are native Node code of the server without their own system account
(`profiles.md`, Open limits). Chapters: `core.md` (Global coordinator), `profiles.md`.

## Binding of a run: machine and folder separated (24.09.2026)

Chapters: `docs/spec/plugins.md` (Ownership per facet, Run panel, Host API, Workspace, sandbox
tools, and processes including shell, files, processes and browser, Open limits),
`docs/spec/core.md` (Transfer, Server folder), `docs/spec/profiles.md` (core), `docs/operations.md`
(Browser, Session isolation, Transfer a run), `docs/development.md`. Owner's requirement:
`ragents.workspace.binding` with `fresh`, `path` and `client` mixed up WHERE a run works with WHICH
folder, and `WorkspaceRuntime.kindOf` mixed up the kind of a contributed workspace with the
binding.

**Two settings.** The binding is `{ machine, folder }`: `machine` is `"server"` or
`{ client, label }`, `folder` is `"fresh"` or `{ path }`, all four combinations are valid.
`machine`, because the executor of exactly one machine decides where work happens, and spec and
executor already talk this way; rejected: `where` (not a noun, reads badly in code) and `host`
(taken in code for `PluginHost` and the host API). `folder` instead of `workspace`, because the
workspace is both together.

**New folder per run on the workstation.** At sign-in the workstation names its folder for runs
(`runsDirectory`, required; VS Code and the headless workstation take `runs` in their data folder),
and `accept` records the run's folder below it as `{ path, fresh: true }`. The resolution needs the
path without the workstation and always the same one, because the server resolves all workspaces
at startup and prompt and runtime name it. Rejected: taking the path from the registry during
resolution (fails without a connection), a symbolic `cwd` that only the workstation resolves (the
server needs the path), and recording the folder for runs in the `machine` part (it belongs to the
folder, and the separator logic would be there twice). It is created by the executor there, with
the new module `runFolder` (`create`, `remove`); the server's executor rejects both, because there
the host creates the folder. The host creates it before the first task, never during cleanup, and
takes it along when the run is deleted. `WORKSPACE_EXECUTOR_VERSION` is therefore 3; a workstation
with an older package is rejected at sign-in.

**Contribution on the workstation.** `WorkspaceResolver.workstation` provides the new folder there
with label and steps, operations of the executor with input (`prepare` after creation, `release`
before removal), because a plugin's code never runs on the workstation. A Git worktree works this
way with `commands.run` (test `workspace-foreign-machine.test.ts`); a separate worktree operation in
the executor is rejected as long as it has no second user. A contribution without `workstation`
rules out the new folder on the workstation (`workspace-binding-unsupported`), instead of silently
offering an empty one there that replaces its kind; such an external plugin therefore does not
offer it.

**`placementOf` instead of `kindOf`.** Per run the runtime answers `machine`, `folder` and, if a
contribution provided the new folder, `kind`. An external plugin now queries its worktree as "on
the server and of its kind". Because the service behind `workspaceRuntimeToken` thereby loses a
member that a built bundle calls, the host API is 5; new is `RUN_FOLDER_OPERATIONS`.

**No migration, one mapping.** Older journals carry `{ kind: ... }`. `storedWorkspaceBinding` maps
the three values on reading to exactly one combination each (new folder on the server, existing
folder on the server, existing folder on the workstation); server, `ownerOnly` and web read stored
values only via it. That is the only legacy path: journals are immutable, the mapping loses and
invents nothing, and locking would have made every existing run unusable without anything being
unclear. `accept` and fixed start options take only the new form; a template with the old form
fails the schema check at profile startup. Whatever matches no form locks the run with a cause as
before.

## Steering: messages to a running turn go into that turn (24.09.2026)

Chapters: `docs/spec/core.md` (Scheduler and turns, Agent session and agent runtime, Interrupting a
turn, Chat projection, File format, Open limits), `docs/spec/overview.md` (Turn),
`docs/development.md` (The five terms, Journal example), plus the list of changes in the entry
"Own behavior in the agent runtime". Owner's requirement: wire up steering cleanly. Spec and
interface promised "cutting in", the agent runtime had queues for it, but RAgents never called
them: every message to a working agent waited for its end and got its own turn.

**The engine fetches, the runtime does not push.** Before every model request the agent loop
queries a steering source; the engine answers it via `TurnRequest.claimSteering`, and only at that
moment does the scheduler write `turn.input-steered` for the claimed inputs. So there is no window
in which a message is in the runtime but still waiting in the journal or vice versa: what the
source no longer queries, because the turn ends or is cancelled, stays waiting and starts the next
turn. Rejected: calling `AgentSession.steer` on every new input, because the engine would then not
know whether the loop still saw the message before its end; a message would be either duplicated
(its own turn afterwards) or lost.

**A separate event instead of a second turn start.** `turn.input-steered` names turn and input; the
input counts as claimed by this turn (`steered: true`). `turn.started` remains the one start of a
turn, the replay of old journals does not change. Because an older version would reject the new
event, the journal writes file format 6 and still reads 4 and 5. The journal check requires that
the turn is running and that no older waiting input is skipped; that only an agent takes steering
is checked by the decision alone, so that this rule can grow later without breaking the journal.

**Rules.** Steering exists only for actors with the agent driver and only during their turn; a
TypeScript actor has no model that could see something before a next request, its inputs wait as
before. All waiting inputs of the actor are claimed at once, in journal order, up to before the
first with more than 30000 characters of content: that is the limit the spec already named for
steering text; a longer text waits together with everything after it for its own turn, instead of
being truncated or breaking the order. After the cancel signal a turn claims nothing more; what it
claimed before belongs to it like its start input. The source is already asked before the first
request, so a turn also gathers messages that were already waiting before its start. Attachments
go the same way as at turn start; if their preparation fails, the turn fails with this cause.

**Tools run to completion.** The runtime could push a running tool call into the background on
steering: an intermediate result to the model, the real result later as a tagged message. That is
not compatible with the journal: the call would stay open beyond its turn, and a turn with open
calls fails. Therefore removed are letting it keep running, the follow-up queue (RAgents starts a
new turn after a turn anyway), `steer`, `followUp`, `queue_update`, `streamingBehavior` and the
queue modes. Whoever does not want to wait interrupts the turn.

**Visible in the history.** Chat and actor history carry their input id on every incoming message;
`turn.input-steered` marks it at its place with "Fed into the running turn". During a turn the send
button is labeled "Feed into the running turn". `ragents send` follows a fed-in message to the end
of its turn. The core knows no tool in this; it knows turn, input and driver kind.

## One global coordinator per user, its tools act as that user (24.09.2026)

Chapters: `docs/spec/core.md` (Parent coordinator), `docs/spec/profiles.md` (Run ownership,
Ownership in detail, Permissions in detail, Open limits), `docs/spec/plugins.md` (Rights of the
coordinator, Header), `docs/usage.md` (Global coordinator). Owner's requirement: every signed-in
user has their own coordinator, without sign-in exactly one.

**Why.** The shared run `overseer` acted via the token of the service identity `host-service`
with `runs.read.all`, `runs.create` and `runs.inspect`. Everyone who was allowed to write to it
thereby got these rights, saw other people's runs and created runs that belonged to
`host-service`; in addition the shell read the journal folder of all users, and all users shared
one conversation including model context.

**Id and ownership.** The plugin forms the run id from the user: `overseer-` and 24 hex characters
of the SHA-256 of the id, without sign-in `overseer-single`. A hash, because user ids may contain
capital letters and dots, run ids may not. Instead of `runId`, `GlobalChatPolicy` now names
`runIdFor` and `isCoordinator`, `workspaceDirectory` per run, `resetIntentDirectory` with a marker
per coordinator, and `inputContext`, `contextPrompt` as well as `model.forTurn` get the run id. The
rights check (`runOwned`, `runReachable`) allows a coordinator id only for the user it belongs to:
not for `runs.read.all` and also not as long as no run exists under it yet, otherwise someone else
could create and own a user's coordinator first. The first message to one's own coordinator needs
no `runs.create`; it does not create a free run. The web queries the id with the new method
`ragents.overseer.coordinator`; VS Code shows no coordinator and needed nothing. Rejected: an alias
id `overseer` that the server rewrites per caller, because every route, every channel and every
file address with a run reference would then have to know it.

**Access of the tools.** The service identity `host-service` is dropped. Every coordinator gets a
token for its user (`coordinatorAccessToken`), valid only via loopback and only for `/rpc`,
`/rpc/stream` and `/help/`; the server resolves it on every call into the user's current state from
the profile file (`coordinatorSnapshot`), a removed user is not signed in. With `anonymousUser` the
token stands for anonymous access, with `ACCESS_TOKEN` it stays that token, and on an open server
there is none. The host derives who owns a coordinator from its id and the configured users, not
from the journal. With users, the journal folder is dropped as a read root; the coordinator reads
journals via `ragents.overseer.readEvents`. The host shell stays without its own system account
(open limit in `profiles.md`).

**No takeover of the old conversation.** The former shared run `overseer` is not assigned to any
user: it contains messages and results of several users and a shared model context, which cannot
be separated by user, and its results were produced with the rights of `host-service`. Any user,
for instance its first writer, would thereby own what others had asked. On top of that the course
without migrations applies. The id stays reserved (`isCoordinator`), so that the journal does not
show up in lists as an ordinary run; the server does not open it, nobody reaches it, its journal
stays in place byte-identical, and a turn fails with `coordinator-without-access`. Whoever no
longer needs it deletes `runs/overseer` and `sessions/overseer` with the server stopped. The same
applies to the coordinator of a removed user.

**Incidentally.** Since `workspaceAccessible`, `ragents.overseer.listRuns` returned fields in the
run list outside its contract and failed via the message layer; it now outputs only the
contractual fields. The model selection stays shared for all coordinators. Host API stays 4: the
shape of `globalChatToken` changes, but no listed id, and only `ragents.overseer` provides the
contract.

## Operations docs split: usage in usage.md, operations in operations.md (24.09.2026)

Chapters: `docs/usage.md` (new), `docs/operations.md`, `docs/development.md` (Documentation,
Tools, checks, and publishing), `docs/spec/core.md` (Parent coordinator, Security lockdown of
the agent runtime), `docs/spec/plugins.md` (Example of a skill entry),
`docs/spec/actor-programs.md` (Frame, layout, forms, and chat building blocks),
`docs/spec/overview.md`, `docs/spec/profiles.md`, `scripts/homepage/homepage-guide.ts`. The
occasion was the docs scan: on about 1800 lines `operations.md` mixed usage, operations, developer
tools and repetitions of the spec.

**Usage and operations separated.** `docs/usage.md` says what a user, or an agent as a user, sees
and does: start surface, run chat, surface, settings, global coordinator, run panel, VS Code
extension, `ragents run` and `pnpm driver`. `docs/operations.md` says how to install, start and
operate RAgents: access, browser, package, connect, run transfer, Windows, data storage, workspace.
Build and check tasks, homepage build, concept audit, publishing of package and extension, the real
browser probe and the check runner for the remote workspace now stand in `docs/development.md`
under "Tools, checks, and publishing". Rejected: a single file with sharper headings, because
users and operators ask different questions and the file would have kept growing anyway.

**Duplicates of the spec replaced by references.** What was already in the spec has disappeared
from the operations docs and is linked there: TypeScript functions and snippets
(`typescript-platform.md`), author notes on actor programs and skill entries (`actor-programs.md`,
`plugins.md`), structure of the run scripts, process stop, browser check, workstations, sign-in,
ownership and stored model and title defaults. Mechanics that stood only in the operations docs
have moved into the spec: the environment variables and the service identity of the global
coordinator and the security lockdown to `core.md`, the example of a skill entry to `plugins.md`,
three author rules to `actor-programs.md`. The section "Fixed procedures" is dropped entirely; it
repeated `core.md` and still described deletion without confirmation.

**Guide chapters from several files.** `guideChapters` names per chapter a list of source files
from the same folder; the blocks are joined in this order. "Get started" takes installation, start
and rebuild from `operations.md` and then the first run and the tile surface from `usage.md`, "Web
and VS Code" comes entirely from `usage.md`, "Distributed work" entirely from `operations.md`. The
chapters stay the same; only "Get started" is reordered, and its paragraph on development mode
with Vite now stands in German in `development.md`, because it concerns developers and not users.

## Follow-up work on interrupting: CLI, agent loop, tool names, stop reason (24.09.2026)

Chapters: `docs/spec/core.md` (Interrupting a turn, Equipping subagents, Chat projection),
`docs/operations.md` (Control RAgents as an agent, Drive runs from external clients). The occasion
was the review after the rework "Chat stop interrupts only the turn".

**`ragents stop` and `pnpm driver stop` interrupt.** Both promised to cancel the running turn, but
called `ragents.chat.stop` and thereby halted the whole run. Now they read the primary actor from
`ragents.runs.view` and call `ragents.runs.interruptTurn`, like the chat input; the emergency stop
is explicitly called `stop <run> --run` and stays `ragents.chat.stop`, which also cancels a running
start preparation. Rejected: merely renaming the command honestly, because an agent as a user of
the command line almost always means only the turn and would otherwise lose every run with the
first stop. A run without a primary actor is an error with a reference to `--run`, not a silent
switch to the emergency stop. The description of `ragents.chat.stop` in the contract now names the
emergency stop instead of "coordinator's turn".

**No model request after cancellation.** After a cancellation during a tool call, the agent loop
queried the model once more with the tool error, and a context hook that returned only after the
cancellation likewise led to a request. The check therefore sits directly before the provider call,
after all hooks, and not only at the start of the loop: only there does it also see cancellations
that arrive during context rebuilding or key resolution. The result is a cancelled assistant
message without content, the same shape as a cancelled stream, so that loop and runtime need no
separate path.

**Unknown tool names stop the actor at creation.** `agent_spawn` already rejected unknown names,
but actors created by the host, a run script or an actor program were checked only by the turn,
and for the agent driver not at all: a typo in `toolNames` never stood out, the tool was simply
missing. For every actor it executes (all drivers except `manual`), the scheduler resolves the
names like a turn at creation (`agent.spawned`, `script.created`) and at restart, counts currently
unavailable functions as known and stops the actor with the unknown names as the reason before it
gets a turn; until the check is finished, the actor starts no turn. Rejected: putting the check
into the command's decision, because decisions are synchronous and tool resolution depends
asynchronously on the actor context; and counting unavailable names, because rights and state may
change during the run.

**Stop reason once in the chat.** If the owner stopped an actor in the middle of a turn, the reason
stood twice in the primary chat and in the actor history, from `turn.interrupted` and from
`actor.stopped` of the same command. At `actor.stopped` the projection checks whether the same
command interrupted a turn of the actor and then omits the line; it keeps the interruption, because
that also closes the open tools with the reason. Rejected: omitting the line at the interruption,
because a pure `interruptTurn` would otherwise show no reason at all.

**File view names the source of a rename.** `GitWorkspaceView.file` optionally takes
`previousPath`, the source of a rename from the change list that the client already knows. This
way a provider can look up the one file instead of recomputing the whole list for every click;
without the source, Git pairs a rename only across the whole tree. The parameter is optional so
that existing providers and callers stay valid.

## Chat stop interrupts only the turn, a stopped actor shows the way back (24.09.2026)

Chapters: `docs/spec/core.md` (Interrupting a turn, stopping an actor ..., Interrupting a turn,
IDs, handles, and creating actors again), `docs/spec/plugins.md` (Rights in server and web
contributions, Web as plugin host), `docs/operations.md` (Run chat and work surface, Run panel and
VS Code extension, Global coordinator). The occasion was a real run: the button "Stop work" in the
chat input stopped the primary actor together with its descendants permanently via
`ragents.runs.stopActor`, although no model was running at all, but a commissioned actor was
working; without a primary actor it stopped the whole run via `ragents.chat.stop`. After that the
chat was dead and the input gone. Owner's requirement: "Stop model" and "Stop run" are two
different things.

**Interrupt instead of stop.** New is `ragents.runs.interruptTurn` (`runId`, `actorId`, optional
`reason`) with the rights of stopping. It ends only the actor's running turn via
`TurnScheduler.interruptTurn`: cancel signal (also for running function calls), limited waiting
for the driver so that the visible partial answer stays as `model.output.interrupted`, then
`turn.interrupted` in the name of the owner. The actor, its model session, its children and the
run stay; without a running turn nothing happens. Rejected: writing the event into the journal
first and letting the scheduler follow, because then the partial answer would be lost, as today
with `actor_stop`; and waiting without a deadline, because a driver that ignores the cancellation
would otherwise hold the request forever. After the deadline the turn ends in the journal alone.

**Button only for one's own turn.** Every chat input (run chat, actor chats in tile, pop-out and
run panel, global coordinator) shows "Stop work" only while its actor has a turn, and then calls
`interruptTurn`. If only another actor is working, the input keeps pulsing but offers no stop.
No input calls `ragents.chat.stop` anymore; "Stop run" in the title bar (`ragents.runs.stopAll`)
and "Stop" on the actor card (`stopActor`) remain the deliberate paths. Cancelling a still running
start preparation from the input is thereby dropped; there was no visible button for it during the
preparation anyway (TODO).

**Stopped actor with a way back.** Instead of a locked or missing input, a chat whose actor is
stopped shows `@handle stopped: <reason>` and, with `runs.write` and `runs.inspect`, "Restart"
(`restartActor`, whose rights stay unchanged). For the run chat this was not enough: stopping the
primary actor sets `primaryActorId` to `null`, and a restart did not make it the primary actor
again, the chat stayed dead. Therefore the run remembers the actor stopped as primary
(`stoppedPrimaryActorId`, until a primary actor is chosen), and `restartActor` by the owner or
`run.configure` chooses it again in the same command. That is a new decision, not a changed
projection of old events; journals stay valid. Rejected: letting the stopped actor remain primary,
because session, roles and stop limits rely on a primary actor being active. Host API stays 4; new
are `interruptActorTurn`, `chatPrimaryId` and the module `@ragents/web/chat/StoppedActorNotice`,
`stopChatActor` stays until the next jump.

## Collapsed chat keeps border and shadow (24.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel), `docs/operations.md` (Run panel).
Border, background and drop shadow also apply to the collapsed chat. The handle row becomes more
compact; its wide focus outline is dropped. Keyboard focus stays visible on the small bar, so that
the size control remains recognizable via keyboard.

## Chat handle changes the expanded height (24.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel), `docs/operations.md` (Run panel).
The dragged height belongs to the expanded chat. When collapsed, only the measured height of
handle, status and complete input remains. Previously dragging changed the resting position, while
opening always led to 90 percent; that reversed the desired operation. Dragging and keyboard
changes open to the chosen height, which is stored per run. Automatic opening uses the same value;
without a chosen height, 90 percent remains the default.

## Run list and interface respect read access to the workspace (24.09.2026)

Chapters: `docs/spec/plugins.md` (Session metadata, Access in the browser, Workspace tabs, Run
panel, Workspace and workstation, Open limits), `docs/spec/profiles.md` (Run ownership),
`docs/operations.md` (Rights). Occasion: two open points from the review of the workspace.

**Metadata by access.** `sessionMetadata.describe` got no access; if an admin with `runs.read.all`
saw another person's run that belongs only to its owner, a branch contribution, for example,
queried the executor on the owner's workstation for it. Now a contribution that reaches the
workspace declares this with `requiresWorkspace: true`, and the host calls it only where the
caller may reach the workspace (`runWorkspaceAccessible`, the same rule as
`assertRunWorkspaceAccess`); otherwise it stands under `metadataUnavailable` without a call.
Rejected: passing the access to `describe`: then every contribution would have to check itself,
and an intermediate state per run (like the branch intermediate state) would still serve other
callers. Without a caller, i.e. host-internally, the list reaches no `ownerOnly` workspace,
matching the service identity. The declaration is voluntary; a contribution that forgets it still
reaches the executor (open limit).

**Tabs by access.** For such runs web and VS Code showed files, process bar and language servers,
which then failed. The run list reports `workspaceAccessible` per run; tabs and header
contributions with `requiresWorkspace` are missing if it is `false`. The Files tab stays, because
the server's file storage remains readable, and then offers only that. A run not yet listed counts
as reachable, because a new run belongs to the viewer; the check stays with the server. Host API
stays 4, `workspaceAccessible` is added as a name of the web.

## No personal names in docs and tests (24.09.2026)

Chapters: `docs/development.md` (Rules). Decisions, rules, self-test and tests no longer name any
person: wishes stand as a requirement or with "the owner", quotes as a factual statement, test
users are called `alice`. Names remain only where they are needed legally or as metadata
(`LICENSE`, `author`, license section).

## Workstation: catch up on stop, stream loss, windows, read access and sign-in (24.09.2026)

Chapters: `docs/spec/plugins.md` (Workspace and workstation, Processes, Files tab, Open limits),
`docs/spec/profiles.md` (Run ownership, Ownership in detail), `docs/operations.md` (Stop
processes, Rights, Session isolation, Check runner), `scripts/remote-workspace/README.md`.
Occasion: review of the workspace of 24.09.2026 with seven significant findings.

**Stop during a disconnection.** The executor of a workstation survives a disconnection together
with background processes, language servers and browser; a stop or deletion during this time went
through empty with `whenReachable` and never arrived. Now the registry records a stop that does not
reach the workstation (not connected, ten seconds without answer, superseded connection) per owner,
id and run and delivers it at the next sign-in, before every new task of this run; if the
workstation stays signed in and silent, again every 30 seconds. Rejected: reconciliation by the
workstation on reconnecting: a stop is an event, not a state, a stopped run can keep running, and
the workstation could only recognize deleted runs, not stopped ones. The price stands as an open
limit: a server restart forgets the record.

**Loss of the event stream.** On loss of the stream the `RpcClient` cancels all handlers still
running for the server (`RpcPeer.cancelIncoming`), and recognizes a half-open stream by 45 seconds
without data; before, `files.watch` and long bash commands kept running, and after every reconnect
one more watch was added. The file module has `stopRun` and `shutdown`, which end open watches. The
channel `ragents.workspace.browse` watches again every five seconds after a running watch ends,
instead of staying dead until resubscribing. If a new connection supersedes the sign-in of the same
workstation, the old one's open calls fail immediately.

**Stop without a folder check.** `stop` on the workstation failed at the check of the offered
folder as soon as a window had closed the run's folder; it now checks no folder. The same check,
like that of the file module, correctly accepts a drive root such as `/`
(`containsWorkspacePath` via `path.relative`).

**Id per window.** All VS Code windows shared one id from the `globalState`; the second window
displaced the first at the server, and signing out of one deleted the other's entry. The id now
lies in the window's `workspaceState`, and `unregister` acts only via the connection that holds the
entry. Runs bound to the old shared id no longer find their workstation; there is no migration.

**Process display per run.** A shared polling interval across all runs let a hanging workstation
freeze the display of all users for up to 15 minutes. Every run is now queried by itself, with a
time limit of five intervals that also cancels the executor; `whenReachable` cleanup waits ten
seconds, below the plugins' stop limit. Signing out the workstation waits at most three seconds for
the server and ends the executor immediately, so that a hanging server holds nothing when VS Code
closes; the order of sign-in and sign-out stays.

**Reading only by the owner.** Decided: the workspace of a run that only its owner operates is
reachable, even for reading, only by that owner, not by `runs.read.all` and not by the service
identity `host-service`. With the change, "read" reached as far as the owner's machine; via the
coordinator with the service token, anyone allowed to write to it could read files of other
people's workstations. The check is generic (`assertRunWorkspaceAccess` via `ownerOnly` and owner)
and is available as the host service `workspaceGuardToken`; the Files tab (working directory),
process display and language server state call it before every path to the executor. The journal
stays readable for those authorized, as does the server's file storage. Host API stays 4, the name
is added. The decision of 23.09.2026 on `host-service` thus applies only to the journal.

**Sign-in only with a user.** Decided: only a signed-in user of a profile with `users` may sign in a
workstation over the network; without users there is only one owner for all access, and anyone
with the shared token could have bound runs to someone else's machine. Without users the sign-in
applies only via loopback (`MethodContext.local`), otherwise `workspace-client-login-required`. The
extension then does not sign in and names the reason at the server.

## Bundles: used names in the manifest, file swap instead of folder swap, build only what is stale (24.09.2026)

Chapters: `docs/spec/plugins.md` (Build and ship a plugin, Web halves at runtime, Bundle, build
tool, and host API, Profile distribution, Open limits), `docs/spec/profiles.md` (Start paths,
Server-delivered profiles, access token), `docs/development.md`, `docs/operations.md`. The
occasion was the review of the plugin bundles with eight significant findings.

**Names instead of just a number.** New names of the host API come without a new number; a bundle
built against a newer host of the same number ran on an older one and silently got `undefined` in
the web, and via `Promise.all` the whole interface then failed. Now the manifest (format 3) names
every used name in `hostNames`, the host checks them when resolving the plugin list, and a name
that is nevertheless missing in the registry throws on loading. The web shim reads every name from
its own value module without side effects: this way esbuild still discards unused ones, and the
metafile names exactly the used names without searching the output. A web half that does not load
is a plugin error above the interface instead of its failure. The number of the host API stayed 4,
because the list has not changed; the manifest format rose so that an older host rejects new
bundles with a clear message. Loading and building read `host-api.json` via the same check against
`HOST_API_VERSION`.

**Namespaces and `import()`.** Both bypassed the name list: in the server the tool now reads every
access to a namespace and rejects one that is passed on, in the web the warning
`import-is-undefined` is an error, and `import()` of a host module is a build error, in the server
except for fully shared libraries.

**CommonJS in the server.** esbuild's `__require` throws in ESM output; a banner of the tool forms
`require` from `createRequire(import.meta.url)`. The rule against `createRequire` stays for plugin
code that would look itself up with it.

**No folder swap.** Two renames briefly left a running server without a bundle folder, and parallel
runs collided at the target. Node cannot swap a folder atomically (that would need `renameat2` or
`renamex_np`, or links that package, archive and `tsx watch` each treat differently). Therefore
every changed file arrives at its place individually by rename, the manifest last, remnants
afterwards; unchanged files stay, and `tsx watch` restarts only on changed server files. A lock
file per target makes parallel runs wait. The same applies to the web. `pnpm build:plugins` builds
only what is stale; so that a library or tool update still arrives, `sourceRevision` includes the
host's inputs (lockfile or `package.json`, host API, build tool).

**Minor items.** `--watch` builds each time from a freshly read description. The stylesheet is
recompiled as soon as a class list changes, not only in dev mode. Free without a token are only the
delivered files of the web halves, no source maps (they carry the source text) and no plugin routes
under `/plugins/`. `revision` now has readers: package build, `connect` and the staleness check. The
distributor rejects a client profile with an absolute or `~/` path, instead of the client loading
a foreign bundle or none; `connect` creates no links from the archive.

## Run list: rights first, then metadata, in parallel and with a time limit; conflict with the template before the start (24.09.2026)

Chapters: `docs/spec/plugins.md` (Session metadata, Start options), `docs/operations.md` (Entries
with fixed start options). Occasion: review of web, VS Code and an external plugin repository.
Since a workspace plugin reads the branch via the run's executor, every fetch of
`ragents.sessions.list` cost one call per run in the journal, sequentially and also for runs the
caller is not even allowed to see; a connected but silent workstation held up the list of all
users per run until its cancellation, again on every poll.

**Filter first, then describe.** `ChatSessionProvider.list` takes a filter by id;
`ragents.sessions.list` and the list of the parent coordinator pass the rights check into it,
instead of filtering afterwards. Titles and metadata are created for each visible run
concurrently.

**Time limit per contribution instead of per list.** `SessionMetadataContributionRegistry.describe`
queries all contributions concurrently and waits at most 1.5 s per contribution. A contribution
that does not answer in time or throws is missing under `metadata` and stands with the reason
under `metadataUnavailable`; before, a throwing contribution made the whole list fail. The reason
is not a silent fallback value, the plugin's interface decides how to show it. The limit is fixed,
because the list comes from every client every few seconds; whoever computes expensively keeps an
intermediate state themselves.

**Conflict with the template before the start.** `StartOptionState.chosen` says whether someone
made a choice before the start. Only a choice, not a default, makes a start via a template fail
with `start-option-fixed`; the preparation chat thus shows a conflict at the fixed option, locks
"Create run" and offers "Apply template values". Nothing else is overwritten without an explicit
action.

## Review of the engine: retry, subscriptions, journal format, handles, skills (24.09.2026)

Chapters: `docs/spec/core.md` (Agent runtime, Stop procedure, Subscriptions, Handles, File format),
`docs/operations.md` (Journals of the overseer), `docs/development.md` (Journal example). The
occasion was the review of engine, agent runtime and server side after the agent runtime was
merged in.

**A turn fails on the last answer, not on the first.** The turn dispatcher recorded the first
provider error; the session then retried (429, 503) or compacted after a context overflow and
continued successfully, the turn nevertheless ended as `failed`, and the creator got "FAILED".
Retry and overflow rescue, which the entry on the merge explicitly keeps, were thus ineffective in
the journal. Now the dispatcher remembers only the error of the respective last assistant message;
cancellation and hook errors remain final.

**Turn ends and stops belong to the one affected.** Subscriptions compared `sourceActorIds`,
`sourceActorKinds` and `includeSelf` with the writer of an event. A coordinator subscribed to the
end of its worker thus learned nothing if the human or another actor stopped the worker - exactly
the path the entry on stop and handles recommends. `eventSubjectOf` (`domain/model.ts`) names the
owner of the turn for `turn.finished` and `turn.interrupted`, the target actor for `actor.stopped`
and `actor.restarted`, otherwise the writer; delivery and journal check use the same function.
Without `includeSelf` the interruption of one's own turn no longer wakes a subscriber. The report to
the creator already resolved the affected actor this way.

**File format 5, format 4 stays readable.** The encoding has not changed, but the rules have: since
the scan of 24.09.2026 turns with open calls fail, and subscriptions deliver by the affected actor.
An older version rejected such journals with a semantic contradiction ("still has running tool
calls"), for instance an older npm package on the same data folder as a checkout. Now the journal
writes format 5 and reads 4 and 5; an older version fails at the first new line with the format
version. A run transfer was never affected, it requires the same host commit. From now on the
number rises as soon as an older version would reject newly written lines; old journals that
violate a new rule are isolated as before, not migrated.

**Repeated run stop with the same id.** The `RunStopper` wrote its collective stops under
`<id>:pass:1:before-cleanup`. If a caller repeated the stop with the same id after a new actor had
been created, the id collided with a different payload, and the new actor kept running. A hash of
the stopped actors is now part of the id.

**A handle names exactly one actor.** The journal check assigns every handle in the run only once,
also to stopped actors, and a new spawn gets a suffix like `worker-1`. The rule "active before
stopped" in `actorByHandle` and the check for a foreign active holder in `restartActor` were thus
unreachable and gave the impression that a restart by handle could hit the wrong actor. Both are
removed, as are the tests with made-up twins.

**Skills with the same name are an error again.** Since the host reads the skills, two skills with
the same name from different plugins stood in the catalog, and preloading silently took the first.
Opening the runtime now fails with both paths, as formerly with the runtime's loader.

**The check of the session folder is gone.** `SessionManager.open` always sets the folder to the
one passed, so `#assertRuntimeDirectory` compared it with itself. Checking against the header
would have locked sessions after a transfer and old sessions with the workspace in the header; a
test records that a session in a different folder continues together with its history.

What remains open is the duplicate stop line in the primary chat and the race between scheduler
and collective stop at run stop (`TODO.md`).

## Agent runtime merged in: only what RAgents uses (24.09.2026)

Chapters: `docs/spec/core.md` (Agent runtime), `docs/spec/plugins.md` (Rules of the host API,
Build tool), `docs/development.md` (Folders), `docs/operations.md` (Security lockdown), the list
"Own behavior in the agent runtime" below, the READMEs of `packages/agent` and `packages/ai`.
Occasion: since host API 4 the fork is no longer a plugin contract, and the scan of 24.09.2026
counted about a third of the handwritten fork without users. Every removal is backed by a search
across this repository and the external plugin repository; the host API stays as it is.

**No search, no installation.** Package management, Git helpers, output guards, project trust,
prompt templates, project files like `AGENTS.md` and loading extensions from files are gone, and
with them the dependencies `jiti`, `glob`, `semver`, `hosted-git-info`, `minimatch` and `chalk`. An
extension is now only an inline factory. The silent package installation, against which the entry
on server, executor and scripts had built in a refusal, is thus structurally ruled out; its test is
dropped.

**No tool replacement from the runtime.** The session brought its own local read, bash, edit and
write, which the engine never activated. Only if a workspace tool did not come as a function of the
host did the engine reload the runtime and switch on the built-in one, with `client` on the
server's folder. `ragents.workspace` provides names and functions in the same plugin, the path was
reachable only in tests. `TurnRequest.workspaceTools`, the engine's reload path,
`AgentSession.reload` and the session's built-in tools are gone; all tools of an agent come via the
host's functions. Also removed: `model-resolver.ts` (both callers always give a model, a session
without a model is now an error), the tool factories `create*Tool` and `createCodingTools` together
with their relatives, and image generation in `packages/ai`.

**Session without a command line.** Model cycling, tree navigation including branch summary, bash
execution by the user, slash commands and the `/skill:` extension, export, manual compaction,
session names and labels, session statistics as well as switching, new session, fork and import of
the session runtime are gone, plus `SessionManager.list`, `forkFrom`, `continueRecent` and
`createBranchedSession`. The extension API now has only what the hook adapter
`drivers/agent-hooks.ts`, skill preloading and the engine's tool dispatcher need (list below). With
`session_shutdown` the deadline for completion handlers is dropped; ending a run still waits for
factories and hanging hooks, the tests for this run via the `context` hook. Steering remains an
open question of principle, automatic compaction and retry remain.

**Settings and access as values.** The `SettingsManager` read `settings.json` from `AGENT_HOME_DIR`
and wrote `defaultModel` and `defaultThinkingLevel` back on every model and thinking level change;
the thinking level thus became the default of later sessions without an explicit choice, a state
outside the journal. Now there is `AgentSettingsInput` with compaction, retry and request time
limits and otherwise fixed defaults; without a choice by caller or session, `medium` applies.
`auth.json`, `models.json`, the resolver for `!command` and `$VARIABLE` values, OAuth, sign-in,
credential storage and dynamic model catalogs are gone: a key comes verbatim from a provider's
registration or, for the built-in provider, from `OPENROUTER_API_KEY`. An invalid registration
aborts the start instead of letting the provider silently be missing. The host key
`AGENT_HOME_DIR`, the folder `apps/server/agent-home` and its entry in the package are dropped; the
external plugin repository no longer copies it in the container.

**One source for skills.** The host checks every SKILL.md strictly (`plugin-support/skills.ts`),
the runtime read the same folders once more with its own, laxer rules. Now the server passes the
read skills (`skillOfDirectory`) via `resolveSkills` to the engine; the runtime knows only the type
and the catalog lines in the prompt.

**One package fewer.** `@ragents/agent-core` lies as `packages/agent/src/loop/` in the only package
that imported it; with it the unused declarations `ignore` and `yaml` and the engine's dev
dependency on it are dropped. The engine now lists `@ragents/ai` as a runtime dependency, because
it uses values from it. `@ragents/agent` no longer describes itself as "Coding agent CLI",
`appConfig`, `agentConfig` and `config.ts` are gone, as is prepending `~/.agent/agent/bin` to the
PATH of the local bash, which the executor replaces with its own operations.

What remains open is what only works with a fundamental cut: putting the engine directly on the
loop (session, session runtime and services are then adapter leftovers), steering, the reasoning
replay and the tools in the executor.

## Language rule of the docs: guide blocks in English, everything else in German (24.09.2026)

Chapters: `docs/development.md` (Documentation: three places, one rule), plus all spec chapters,
`docs/operations.md`, `README.md` and `TODO.md`. Which language applies in spec and operations docs
was stated nowhere. In fact it already applied that the sections between `<!-- guide:... -->` are
English, because they become the public guide, and the rest German. The consequences were English
paragraphs outside the markers, German text under English headings and the same thing twice in
the same chapter, once per language.

Decided: guide blocks in English, everything else in the spec, `docs/operations.md`,
`docs/decisions.md`, `TODO.md` and `docs/concepts/` in German. A guide block comprises whole
sections including the heading; German text after it gets its own German heading. The guide quotes
the interface as it is labeled, i.e. in German, with an English paraphrase in parentheses; there
are no made-up English labels in any interface. Rejected: translating the guide separately,
because it would then be a second copy of the text. Duplicate versions are merged (`profiles.md`:
sign-in, function selection, limits, the English section "Current limits" is dropped;
`plugins.md`: contract, bundle and host API, skills). Open work now stands only in `TODO.md`,
permanent limits only under "Open limits". `ragents.config.example.ts` is deleted: it could not be
started, was wrong since the bundles with a source folder in `PLUGINS`, and the templates are
`core` and `developer`.

## Host API 4: only what plugins import, without the agent runtime, dead code in the same go (24.09.2026)

Chapters: `docs/spec/plugins.md` (Core boundary, Plugin contract including the new section Agent
hooks, Build and ship a plugin, Bundle, build tool, and host API with the rules, Chat building
blocks, Workspace), `docs/spec/core.md` (Inputs during a turn), `docs/development.md`,
`docs/operations.md`. The occasion was the scans of server, web and extension, plugins and agent
runtime at the state of 24.09.2026, which independently recommended shortening the host API before
the next merge, while besides this repository only one plugin repository depends on it. Every
removal of a name is a new `HOST_API_VERSION` and a rebuild of all bundles; therefore everything is
collected in one jump to 4.

**The host API names names, not just modules.** Until now a module in `host-api.ts` released every
value it exported, and each of them was a versioned promise: server 71 modules with 953 names, of
which 451 from host code, 145 from the forked agent runtime and 357 from libraries, web 47 modules
with 617 names, of which 272 from host code. Now `host-api.ts` names per host module the values
that plugins import; a library (`react`, `typebox`, `tar` and the others) stands in it entirely
with `LIBRARY`, because its names come with its version. Current state: server 63 modules with 171
names from host code, web 46 modules with 112. The lists were measured by bundling every half of
every plugin of this repository and of the external plugin repository with measuring dummies for
the host modules; what survives tree shaking is in the list. A module from which plugins take only
types has an empty list; the web registry no longer stores it. `pnpm update:host-api` checks every
name against the module's values and rejects a library with a name list and host code without a
list. The build tool already enforced the names before (shims in the web, check of the server
imports), now it enforces the short list. All other exports of the modules are internal again.

**Five rules, set down in the spec.** Only what a plugin actually imports; plugins outside this
repository count too, because their bundles break just the same (this answers question 2 of the
server scan). What exactly one plugin uses and the host does not lies in that plugin. The agent
runtime is not part of it, plugins get narrow contracts in the host. From the executor only the
names that plugins need. An entry without users is dropped at the next jump. Several entries that
the scans listed as unused are used by the external plugin repository and stay:
`useOptionalPageOpener` (two plugins there, the run panel provides the opener in VS Code; so the
page opener chain is not dead), `awaitWithSignal`, `frontMatterOf`, `createPromptReader`,
`DiffCode`, `errorFrom`, the subpaths `git-config-environment`, `managed-process` and
`session-ident` of the executor, `handlebars`, `withAbort`, plus in the executor
`terminationGraceMs` and `ManagedService.exited()`, which the server scan considered dead.

**What moved into plugins.** `actor-programs/capability-resolver`, `limits` and `operations` now
lie in `ragents.actor-programs` (`assertSharedDescriptorContract` had no caller and is gone),
`workspace-tool-naming` and `shell-platform` in `ragents.workspace`. Remaining in the host despite
a single plugin are `actor-programs/client-runtime`, because it reads the CSS of the host web and
would not be runnable in a bundle, and `runtime-bridge`: `ragents.ask` must subscribe to the
journal from the start of the engine, because it also passes on to the asker the answer to a
question asked before a restart; a subscription only at the first `ask()`, as the plugin scan
suggested, would lose it. The product building blocks (`product-model-settings`, `product-relay`,
`product-start-options`, `model-choice`, `chat-display-policy`, in the web `product/*`) are used by
two product plugins, the language server part by three; according to rule 2 they stay in the host.
Whether the three language server plugins become one remains a question of principle.

**The agent runtime is no longer part of the host API.** `@ragents/agent`, `@ragents/ai`,
`@ragents/ai/providers/all` and `@ragents/ai/providers/openrouter` are out of the list. What
plugins needed from it has a contract in the host:

- The agent extensions in the plugin contract (`InlineExtension`, `ExtensionAPI`) are two hooks:
  `beforeModelCall` returns a hidden note before the next model call and holds a JSON value in the
  conversation history with `call.kept`/`call.keep`, `afterToolCall` replaces the result of a tool
  call. None of the three plugins with a contribution used more (project check of the actor
  programs, image display of the browser, a progress note outside). The engine translates a
  contribution into an extension of the runtime (`drivers/agent-hooks.ts`); the fields `global`
  and `tools` had no user and are gone, tools come via `host.functions`. With them went
  `AgentToolDescriptor`, `describeTools` and the tool kinds `agent-extension` and `agent-builtin`
  of the settings, for which there was no source anymore.
- The product plugins fetch a provider's built-in catalog via `builtinCatalog` from
  `plugin-support/model-choice`, which already existed.
- A single model question without history and tools (the search interpreter of an outside plugin
  built its own model registry with OpenRouter for this) is `openRouterCompletionModel` from
  `plugin-support/model-completion`: model from the built-in catalog with its thinking levels,
  request and result as the host's own types, fastest provider, no retry, a truncated, failed or
  cancelled answer is `unfinished`.
- `defineTool` together with `agentToolFrom` replaces `defineRunFunction` there; `agentToolFrom`
  stays internal in the host, `AgentToolMetadata` is its own type instead of an excerpt from the
  runtime.

Host signatures still name types of the runtime, such as a model in the catalog; plugins only
pass them through. This makes every further merge of the runtime internal.

**Dead code, removed in the same go.** Proven dead means: no caller in this repository and in the
external plugin repository, tests excluded.

- Extension: the commands `ragents.openRun`, `openRunInBrowser`, `stopRun`, `moveAppToRunPanel`
  and `openArtifact` from the time of the explorer together with the stop helper, documents for
  artifacts, `artifactText`/`artifactUrl` and `textArtifact`; `ragents.openAppInCenter` only in
  the form that the host test calls; `ragents.openJournal` stays (`TODO.md`). The summary of a run
  now carries only what the pages read (id, title, time, state, open actions, problem); with `apps`
  the import of `ragents.actor-programs` and of the contract of `ragents.workspace` in
  `run-model.ts` is dropped, which triggered the throw from the entry of 24.09.2026; the isolation
  of an unreadable run view stays. The host test reads the mini-apps from the run view. Plus
  `selectedRunId`, `select`, `streamStatus`, `streamMessage` and the workstation state in the
  snapshot.
- Web: `centerMode` together with the tile surface's feedback, of `ChatSurfaceOptions` 4 of 21
  fields remain; the timestamp switch of the run chat always follows the stored choice.
- Server: `Engine.registry`, `catalogModels` (the engine carries the catalog with `modelList`),
  `onChatSessionPersisted` together with `persisted` in the runtime's session store, the re-export
  of `assertRights`, `isRpcPath`, `PLUGIN_SERVER_FOLDER`, `canUseWorkspace`; `stopLineage` and
  `lineageSteps` from the engine (entry of 24.09.2026); `ManagedRunStart.user` now applies with the
  new number. The executor's index no longer exports 29 names without an importer.
- Engine: `agentFrom`, `promptFor`, `emptyRegistry`, `AgentToolPlugin`, the schemas of the
  TypeScript diagnostics, `SchemaOf`, the aliases `WorkingActor` and `AgentThinkingLevel`,
  `modelSelectionOf`, `SubscriptionStatus`, `isExecutableActor`, `defaultContract`;
  `manualExecution` was used only by tests and lies in their helpers.
- Agent runtime: the never reached files `core/index.ts`, `core/experimental.ts`,
  `utils/tools-manager.ts`, in `ai` `utils/node-http-proxy.ts`, `abort-signals.ts`,
  `deferred-tools.ts` and `hash.ts`, plus `footer-data-provider.ts` with `fs-watch.ts` (only
  re-exported as a type), `session-resources.ts` (never registered cleanup functions, the call was
  ineffective) and in `http-dispatcher.ts` everything except the default and the parser of the
  time limit; this drops the dependency `undici`.

**TypeScript tools registered once.** `typescript_api` and `typescript_eval` were registered by the
profile composition and then once more by the engine, protected only by a `WeakSet`. Now only the
composition registers them, before the host is sealed; the engine finds them among the host's
tools. Tests that assemble a host by hand register them themselves.

## Engine: stop of a branch in one command, one rule for actor references, open tool calls end with the turn, no path from the agent runtime (24.09.2026)

Chapters: `docs/spec/core.md` (Scheduler and turns, Stopping, Tool calls, Wake-up and reports to
the creator, System prompt, IDs and handles), `docs/spec/plugins.md` (Runtime methods, Workspace
with `client`). The occasion was the scan of engine, plugins and agent runtime at the state of
24.09.2026; every fix has a test that was red before.

**Reports to the creator.** The automatic report "Your actor's turn ... was interrupted" took the
writer of `turn.interrupted` as the child, not the owner of the turn: if a worker stopped its
sub-worker, the engine reported to the coordinator that the worker's turn was interrupted. Now the
actor that owns the turn applies. At the same time it was open who is reported on a deliberate
stop. Decided: a stop reports nothing to anyone, regardless of who stops; only an interruption
without a stop (cancellation, time limit, restart) and a failed turn are reported. Whoever stops
knows it themselves, and a run stop must not re-trigger the primary actor with reports about its
stopped workers; with the correct attribution exactly that would otherwise have been triggered by
every stop of the owner. Whoever waits for an actor that someone else can stop subscribes to its
end. Subscriptions still compare the writer of the event, which is open in `TODO.md`.

**Stopping a branch is one decision.** `actor_stop`, the method `ragents.runs.stopActor` and the
`RunStopper` stopped an actor and then every descendant in a separate command; if one failed,
children of a stopped actor kept running, and `actor_stop` wrote the stops of the descendants in
the name of the owner instead of the caller. Now `stopActor` produces interruption, `actor.stopped`
and the removal of the subscriptions for the actor and all active descendants in one command, in
the name of whoever stops; with `stopActors` the `RunStopper` stops all active descendants of the
owner except the primary actor in one command before and one after cleanup. The engine no longer
needs `stopLineage` and `lineageSteps`; as names of the host API they stay until the next version
jump and also stop the lineage in one command. `descendantsOf` now takes any collection of actors,
a run view still fits.

**One queue per run.** The writing runtime methods ran through a single queue for all runs, and
`stopAll` held it until the stop including plugin cleanup was finished (up to 15 s final stop);
for that long, inputs, answers and stops of all other runs hung. Now `KeyedSerialQueue` serializes
per run and forgets a run as soon as its queue is empty.

**One rule for actor references.** Handles were resolved differently in six places: with or
without NFC, with or without lower case, with or without precedence of the active actor, and three
functions called `actorOf` had three meanings. Now the rule stands once in
`domain/actor-reference.ts` (`handleKey`, `actorByHandle`, `actorByReference`: `@` optional, NFC,
lower case, active before stopped), the engine resolves with it in `guards.ts`, `agents/tools.ts`,
`http/methods.ts` and the mediators, `restartActor` and `stopActor` of the methods also take an id
or handle. Plugins get them via the host API (`@ragents/engine`, and for both halves
`@ragents/engine/src/http/contracts`), only names are new, the version stays; with them they
resolve in `ragents.watch`, `ragents.transcript`, `ragents.actor-programs` (server and chat targets
in the web) and `ragents.orchestration`. The functions of the same name are now called
`commandActorOf` (who gives a command, in their turn) and `existingActorOf` (journal check),
`handleLabelOf` formats a handle in `agents/tools.ts`; `agentActorOf` and `isActiveCommandActor`
had no caller and are gone.

**Open tool calls have a state and a source.** When the scheduler cancelled a turn, it wrote
`tool.call.failed` for open calls, a stop and recovery after restart wrote only `turn.interrupted`,
and the projection made "interrupted" out of that; for this the scheduler searched the whole
journal for open calls, and the journal check kept a third table. Now the end of a turn ends its
open calls as `interrupted`, with `turn.interrupted` as with a failed `turn.finished`, and nobody
writes an error event for it. Scheduler and journal check read the turn's `toolCalls`; the check
only remembers which calls already have a source. Primary chat and actor history close the calls
with the reason of the turn end; for this the primary chat also shows an interruption written by
someone else, and a result there applies only to the last call with that id, because ids may recur
in a later turn. Journals from the time before read unchanged.

**The agent runtime names no path.** Two own changes, `omitCwd` and `workingDirectory`, made the
runtime write the line `Current working directory` when no workspace chapter stood in the prompt,
i.e. precisely for actors without workspace tools, and with the path of the workspace. With the
binding `client` that is a folder on the workstation, while `typescript_eval` of these actors runs
in the server's folder; the entry of 22.09.2026 wanted to name exactly the server folder to them.
The preparation chat thus got the server path `AGENT_HOME_DIR`. Decided: both options are removed;
a custom system prompt stays in the fork as the caller gives it, and RAgents always gives one. Only
the chapter that the scheduler appends for actors with workspace tools names the working
directory. An actor without these tools gets no line, not even the server's, unlike what the entry
of 22.09.2026 had decided: `typescript_eval` works via `context.functions` and relative paths, the
folder in which it runs is a detail of the host and with `client` not the project, an absolute
server path in the prompt would only be an invitation to write past the workspace, and the engine
knows neither the tool nor a prompt text for it anyway. The list "Own behavior in the agent
runtime" is updated: the one change replaces the two, and scope, paths, previously missing changes
and the tests per change are corrected.

## Server, executor and scripts: owner for managed runs, no package installation, paths from the caller (24.09.2026)

Chapters: `docs/spec/profiles.md` (Optional sign-in and rights), `docs/spec/plugins.md`
(Environment of the executor, Language server, Open limits), `docs/operations.md` (Operate as an
agent, Transfer a run). The occasion was the scan of server, executor and scripts at the state of
24.09.2026; every fix has a test that was red before.

**Managed runs belong to their caller.** `ragents.overseer.createRun` and the rest of the session
management created runs without an owner; with sign-in the caller no longer saw their run
afterwards, and `readRun`, `sendMessage` and `stopRun` did not find it. `ManagedRunStart` now
carries the acting user (`user` instead of `userId`), the host passes it on to start, message and
package start, and the run gets it as owner, exactly as with the chat. The host's service access is
the user `host-service` here, as already with `chat.send`. The shape of `ManagedRunStart` is part
of the host API; a foreign plugin that calls the session management directly must supply `user`.
The version number of the host API rises with the next collected jump.

**RAgents installs no packages.** The forked agent runtime silently installed a missing package
from `packages` of the settings via npm or git as soon as the resource loader resolved them,
likewise an extension source `npm:`/`git:`. The loader now does not resolve settings at all when
extensions, skills and prompts are switched off (this is how engine and preparation chat call it),
and otherwise with a refusal instead of an installation; a non-local extension source is a hard
error. That is another own change to the agent runtime; the package management itself will be
removed entirely later.

**Sandbox without an account carries the machine's user.** Without its own account the executor
set `USER` and `LOGNAME` to `root`, although the process runs under the machine's user; now the
process's values stay, with an account its name applies.

**A failed language server root does not block the others.** `<id>_diagnostics` without `root`
failed at the first failed instance, even if other roots were ready. Now the result names the cause
of the failed instance next to the findings of the others; only if all have failed is it an error.
A root that already failed at the path check stands resolved instead of as raw text and can be
closed with `<id>_close(root)`. The operations check their input themselves, because not every
caller comes via a TypeBox schema.

**Scripts compute paths from the caller.** Without a folder argument `pnpm workspace-client`
signed in `apps/server`, because pnpm and the command `ragents` start there; like `ragents run` it
now takes `callerDirectory()`. `pnpm provision` resolves a profile path from the caller instead of
from the repository root, `pnpm run-transfer --workspace` requires an absolute path, because it
applies on the target server. The driver reads port, data folder and password like the server
(`readProfileTarget`, `resolveProfileUsers`); an `env(...)` in `host.DATA_DIR` without a set
variable is an error there and in `readProfileTarget` instead of the default folder.

**Minor hardening.** `stop --host` ends the remembered PID only if the host reports the same PID
from `/health` under the remembered address; for this `/health` returns it too. `pnpm connect`
accepts state, profile and file of the server description only if they stay in the cache. The
check of the remote workstation reads the server's announcement only as a whole line.
`install-local.sh` starts a restarted server with its previous port and data folder.

## Web and VS Code: guide also on tile start, superseded starts do not count, sign-in expiry via /rpc, a broken run stays one line (24.09.2026)

Chapters: `docs/spec/plugins.md` (Start, Runs and the start of a template in the run panel),
`docs/spec/profiles.md` (Optional sign-in and rights). The occasion was the review of web and
extension at the state of 24.09.2026.

**One path for templates with a guide.** The tile start in VS Code started every template directly,
a run script with the start value `null`; a guide like that of the discussion round was never
asked, the package silently took its default value. The run panel now decides itself with
`registry.guideFor`, because only the web knows the guides of the active plugins: without a guide
it stays with the click that starts immediately, with a guide it takes the start selection
including `openStartEntry`, the same path as the web app. A second reimplementation of the guide in
the panel's start process would have needed a `SessionContext` that does not exist there. The
extension takes over `guide` from the templates only for the label ("Set up" instead of "Start",
as in the web app).

**A start counts only as long as it is the current one.** `RunLaunch` started in the effect and
protected itself with a marker against the double effect of StrictMode; without a key this
swallowed a second template, and the still running promise of the first later opened its run over
one chosen in the meantime. The start now runs in the command itself, once per click, and its
result takes effect only if its id is still that of the current start; every transition of the
panel sets this id via one place (`replaceLaunch`). Cancelling the created run on the server is not
provided for; it stays in the list.

**Expiry of the sign-in.** `observeAccessExpiry` still knew the old prefixes `/chat` and
`/ragents`; the data, however, run via `/rpc` and `/rpc/stream`, protected are `/api`, `/rpc` and
`/files`. The pattern now follows the server; a 401 of the event stream goes via the same `fetch`
and shows the sign-in immediately, not only at the next window focus.

**A broken run no longer paralyzes the extension.** An invalid program state threw in
`actorProgramViews`; via `store.runs` the throw reached `syncContext` and blocked panel and status
bar of all servers. `runSummaryFrom` now catches per run and returns the list line with the reason
(`problem`), the page shows it at the line. Nobody reads the field `apps` that triggers the throw;
it is dropped with the collected removal of the dead code, until then the isolation also protects
against any other read error of a single run view.

## Plugins as bundles completed: the profile distribution distributes bundles, the package builds foreign plugins, the concept is spec (24.09.2026)

Chapters: `docs/spec/plugins.md` (Build and ship a plugin, Bundle, build tool, and host API, Bundles
at any location, Profile distribution, Open limits), `docs/spec/profiles.md` (Product profiles,
Server-delivered profiles), `docs/operations.md` (Build and check tasks, Work without a checkout,
Connect to a server), `docs/development.md`, `scripts/package/README.md`, homepage (Distributed
work, Plugins and profiles). With this entry the rework from `docs/concepts/plugin-bundles.md` is
finished: step 5 (distribution and package) and step 6 (spec). The concept is deleted; what it
defined (bundle and manifest, description, host API list and export names, version contract, build
tool, native dependencies, built-in plugins, plugin repos next to the host) now stands in the named
chapters, the instructions for foreign authors as the guide section "Build and ship a plugin".

**The profile distribution stays.** Its removal was considered (`TODO.md`), because since the
removal of the client profile in the external plugin repo no profile names `CLIENT_PROFILE_FILE`;
the decision is to keep it and switch it to bundles, because it is the way to give a profile
together with its own plugins to machines without a checkout. The archive now contains exactly the
profile file and the files of the bundles it names by path, packed from their shared folder
without an intermediate copy. No web anymore: since step 4 the host's web is the same for every
profile and lies in every host installation, the copy in the archive was duplicated and made the
archive dependent on the version of the server host. `WEB_DIST_DIR` had no user other than
`connect` and is dropped as a host key; the server always delivers `apps/web/dist/` of its host,
and the check of the web against its sources thus applies without exception in a checkout. With
`server/web.ts` the only user of `@ragents/host/host-web` among the plugins was dropped; the module
is out of the host API list, `HOST_API_VERSION` is therefore 3, and every bundle must be rebuilt.

**Version contract of the distribution: host API instead of commit.** Until now `connect` required
exactly the server's commit, because the archive carried the web of the server host and the
built-in plugins came from the client's host. Now `ragents.profile.describe` names the number of
the host API (`hostApi`) against which the bundles in the archive are built; the distributor checks
it at startup with the same reader as the server. Before downloading, `connect` checks two things
on the local host: the same number, because the bundles are built against it and the local web
loads their web halves only via the registry of the same host API, and a built-in bundle for every
plugin named by id, because these come from the local host. Why no longer the commit: bundles and
web fit together via the host API, not via a shared build; a commit comparison would force every
developer onto a new package for every server version, even if nothing changed in the host API.
Commit and package version still stand in the description, now only as advice on a mismatch
(`npm install -g @schlenkr/ragents@<version>` or `git checkout <commit>` together with
`pnpm build:plugins` and `pnpm build:web`); `HOST_VERSION` stays for this for containers without
`.git`. Not checked are the keys per plugin (the client's start does that) and the declared exports
of built-in plugins that do not belong to the host API (open limit in `plugins.md`, line in
`TODO.md`). `readHostApiVersion` reads the number from `host-api.json` of a host at any location,
because the VS Code extension checks the host it will start, not itself; the plugin uses the same
function and thus needs no new module of the host API. A fetched bundle that the start rejects now
names `ragents connect` instead of `ragents plugin build` as the remedy (`isFetchedBundle`).

**The package builds foreign plugins.** It already carried the finished web and all built-in
bundles. New is `pnpm check:package` (`scripts/package/package-plugin.test.ts`): the built package
via `npm install --global` into its own prefix, in it in an empty folder `ragents plugin build` for
a plugin with server and web half including type check, a plugin with a type error fails with a
cause, then `ragents start` with its own profile; the host delivers method, web half, class in the
stylesheet and the web from the package. The test found a gap: the forked agent runtime runs from
its sources, its types exist only built under `dist/`, and that was not in the package; every
plugin that names `@ragents/ai` or `@ragents/agent` failed the type check there. The package now
carries their `.d.ts` (`declarationFolders`), and `pnpm build:package` builds `build:agent` first
for this. `pnpm check:package` is not in `pnpm check`, because it installs against the registry.
After the web build, `scripts/remote/connect-start.test.ts` was added to `pnpm check`: a real server
distributes a profile with a foreign bundle, `connect` fetches it into an empty data folder and
starts it with the web of its host.

**Model relay.** Checked whether `ragents.model-relay` would have a user without distribution: yes.
Every profile can take the models of another server with `AGENT_PROVIDER: "relay"`, and the profile
of an external plugin repo does that for a local programming profile. `core` and `showcase` list
the relay without a neutral profile using it; it stays unchanged.

Evidence: `pnpm -r typecheck`, `pnpm lint`, all suites except the known failures
(`reference-run-scripts` three times, `workflow-foundation` once, eight web tests), the browser test
against the built web, `pnpm check:homepage`, `pnpm check:remote-workspace` (47 ok),
`pnpm check:package`, in the external plugin repo the full check with bundles against host API 3.

## The web loads plugins as bundles, and there is one web for all profiles (23.09.2026)

Chapters: `docs/spec/plugins.md` (Plugin contract for bootstrap, Bundles at any location, Tailwind,
Profile distribution, Open limits), `docs/spec/profiles.md` (Product profiles, Start,
Server-delivered profiles, Access), `docs/spec/overview.md` (Build scripts), `docs/development.md`,
`docs/operations.md`, `scripts/package/README.md`, `apps/web/README.md`,
`docs/concepts/plugin-bundles.md` (step 4). Until today Vite built a separate web per profile into
the data folder from the plugin sources, which every bundle named via the manifest field `source`;
for this the package shipped Vite, and every start with a new profile or a new host version built.
Now the host builds its web once to `apps/web/dist/`, independent of the profile, and the web
halves come as bundles from the server at runtime: instead of `web: boolean`,
`ragents.plugins.bootstrap` names the addresses `web.entry` and `web.css` under
`/plugins/<id>/web/`, both entry points of the web set up the registry of the host modules
beforehand, and the web loads every web half with `import(url)`. There is one stylesheet,
`/ragents.css`, compiled at startup from the classes of the host sources and the `classes.json` of
the bundles, because Tailwind determines the order of utility and variant and separate stylesheets
per plugin violate it (concept, section 3). `/plugins/...` and `/ragents.css` are reachable without
a token like `/assets/`: the run panel in the VS Code webview is a foreign iframe without a cookie,
and plugin interfaces are as little secret as the host's web; only a bundle's `web/` folder is
delivered, never server code or assets.

Stale bundles and a stale web are a hard startup error of the server in a checkout, with the
command to rebuild; only `scripts/start.sh` builds by itself. Why not build, as `start.sh` does:
the server is the shared path of `pnpm start`, `ragents run`, `ragents start` and the VS Code
extension, and all four run the same way from the package, where there is nothing to build. A
build at startup would need Vite, cost about 7 s, would compete for the same `apps/web/dist` and
`bundles/` with several hosts of one checkout, and would hide that the checkout has changed.
Detection works via hashes: the build tool writes `sourceRevision` into the manifest (hash over the
source folder without `node_modules` and without its target) instead of `source`, the web build
writes `host-web.json` with every read source file and its hash. An external bundle no longer names
its source folder; therefore only its repo checks whether it fits, building before start and
tests. The manifest thus has `format` 2, and because `@ragents/host/web-build` dropped out of the
host API list (replaced by `@ragents/host/host-web`) and `webEntryOf` as well as `webSourceOf` were
dropped, `HOST_API_VERSION` is 2.

The profile distribution is waiting for a decision (`TODO.md`) and is only adapted so far that it
runs: instead of its own Vite build it puts the host's finished web as `web/` into the archive;
`connect` and the archive format are unchanged. The package now carries the built web including
help and no Vite anymore; its checks run in `pnpm check` after the web build. The homepage
generator composes `showcase` from the bundles, so that the reference shows what a user gets.
Rejected: a cache of the stylesheet in the data folder, because compilation costs about 70 ms and a
cache would need its own invalidation. Noticed along the way: the web from the package had no help
so far; now it lies in the built web. `start.sh --dev` got stuck, because
`pnpm build:plugins --watch` built all bundles once more at startup while the server was reading
them: at the moment of the swap a class list was missing, and `tsx watch` then waited for a change
that never came. The watch therefore builds at startup only what is missing or does not fit the
sources; a stylesheet request that hits a swap fails on its own with 500. In the image of an
external repo the swap of the built web failed at renaming the old folder (`EXDEV` in the overlay
file system); the web build now deletes and then renames.

Evidence: `pnpm -r typecheck`, `pnpm lint`, all suites except the known failures, the browser test
against the built web, `pnpm check:remote-workspace --vscode` (49 ok), `start.sh core` and
`start.sh core --dev` with a look at the interface, both startup errors (changed plugin, missing
source state of the web) triggered by hand.

## The server loads plugins only as bundles (23.09.2026)

Chapters: `docs/spec/plugins.md` (Plugin contract, Self-contained plugin folder, Bundles at any
location, Provisioning per plugin, Profile distribution, Open limits), `docs/spec/profiles.md`
(Product profiles, Start), `docs/development.md`, `docs/operations.md` (Custom profiles and
plugins), `docs/concepts/plugin-bundles.md` (step 3). `PLUGINS` names an id, i.e. a built-in bundle
under `bundles/<id>/`, or the path of a bundle folder; `server/index.js` is loaded without
compilation, the provisioning as its export `provision`. A source folder in the profile is a hard
error that names the command to build; there is no way back via sources, because otherwise every
rule of the build tool (host API list, exports, no file lookup via its own location) could be
bypassed by a second path. At startup the host checks `format`, `api` against `HOST_API_VERSION`
and `uses` against the plugin list and `requires`, each with a cause and the command to rebuild.
The resolution hook is strict for code in a bundle: `@ragents/plugins/<id>/<export>` leads to
`server/exports/<export>.js` of the bundle, bare imports only from the server list and as if they
came from `apps/server/src/main.ts`, so that host modules keep their identity; `@ragents/workflow`
is an alias in the hook instead of a tsconfig path. The loader thread gets the mapping from id to
folder via a port with acknowledgement, because external bundles lie at any location. Noticed
during construction: `tsx` loads a `.js` file without a `package.json` with `"type": "module"` as
CommonJS, and its `require` bypasses the ESM hook; the hook therefore always loads bundle files as
ESM, instead of requiring a `package.json` from every bundle. For code outside bundles (profile
files, tests over plugin sources) the open fallback stays. The runner `pnpm check:remote-workspace`
found a bug in addition: `pnpm provision --workspace` resolved only the three plugins with tools,
but the bundle of `ragents.browser` imports an export of `ragents.documents`, and the check of
`uses` aborted the sign-in of every workstation. The provisioning of a workstation therefore also
loads the bundles whose exports these plugins use.

`pnpm build:plugins` builds the built-in plugins without type check (decided: `pnpm -r typecheck`
already checks the sources, the type check cost 9 s per start); `scripts/start.sh` builds before
every start, with `--dev` additionally continuously, the test entry of `apps/server` likewise,
`pnpm build:package` puts the bundles into the package and aborts if one is missing. In this step
the web still builds from sources via Vite; so that it finds the sources of a bundle, the manifest
carries the field `source` (relative to the bundle) until web bundles are loaded, which the profile
distribution also uses for its client web. The composer reads `manifest.web` from the bundle and no
longer from the folder (`ProfileComposition.web`). The composing tests load bundles; tests that
replace a plugin's classes via prototype do not reach its classes in the bundle, which is recorded
in the concept.

## The build tool ragents plugin build and the export names of the host API (23.09.2026)

Chapters: `docs/concepts/plugin-bundles.md` (step 2, sections 2 to 4 and 9); names and paths from
step 1 updated in `docs/spec/` and `docs/operations.md`. `ragents plugin build
<folder...> [--out] [--watch] [--no-typecheck]` (`apps/server/src/plugin-build/`, in the checkout
`pnpm ragents plugin build`) builds a plugin source folder into a bundle with exactly one entry
point `ragents-bundle.json`; the loading path of server and web stays unchanged until steps 3 and
4. Why a dedicated tool with fixed esbuild settings instead of a template for the author: only this
way does every bundle look the same and every place that does not hold up in the bundle stands out
with a cause at build time instead of at load time (imports outside the host API, its own folder
and declared exports, file access via its own location, binary files, type errors, assets that do
not come along). `apps/server/src/host-api.json` holds the value names of every module of the host
API, taken from the types and, for JavaScript libraries, intersected with the runtime; the shims of
the web half are generated from it, and a test turns every change of the names red until it is
deliberately accepted with `pnpm update:host-api`, which refuses removed names without a higher
`HOST_API_VERSION`. Why names instead of signatures: a built bundle breaks hard on missing names, a
changed meaning remains the decision of the developer whom the red test leads there. The registry
of the web modules is ready as `apps/web/src/host-modules.ts` and is only called with step 4.
`ragents-plugin.json` additionally knows `assets`. Incidentally, `apps/web/vite.config.ts` now
forwards `/rpc`, `/files` and `/health` to the server; without that, `pnpm dev:web` and `--dev` did
not reach the message layer.

## Package names @ragents/*, one host API list and cross-imports only via exports (23.09.2026)

Chapters: `docs/concepts/plugin-bundles.md` (step 1); `docs/spec/plugins.md`, `profiles.md`,
`core.md`, `overview.md`, `actor-programs.md` and `docs/operations.md` update the names and paths
after their ongoing translation (`TODO.md`). Groundwork for plugins being loaded as finished
bundles: a bundle may take from the host only what the host explicitly offers, and from other
plugins only what they explicitly export. Until now every plugin reached into arbitrary files of
host and neighbors, and the actor programs reached into the host tree via `import.meta.url`.
Decided: the packages are called `@ragents/*`; `@aicontainer/server` is called `@ragents/host`,
because `@ragents/server` is the SDK of the actor programs, `@aicontainer/ragents` is called
`@ragents/engine`. `apps/server/src/host-api.ts` names per half the modules of the host API and
`HOST_API_VERSION`, against which bundles will be built in the future;
`apps/server/tests/host-api.test.ts` checks the built-in plugins against it. Every plugin describes
itself in `ragents-plugin.json` (id, exports per half); an import of another plugin needs an export
and the owner in `requires`. A plugin finds its files via `pluginAsset(id, name)`,
`pluginAssetPath` is removed. Moved into the host were the tool chain of the actor programs
(`plugin-support/actor-programs/`, `apps/web/src/actor-programs/client-ui/`), the run view
(`@ragents/web/run-view`), the actor conversation, the language server tab and the product building
blocks; the orchestration knows the actor programs only via their context `ProgramSlot`, and the
actor programs require `ragents.orchestration` for this. The behavior is unchanged. Custom profile
files and plugins outside the repo adjust their imports.

## The public homepage consists of the product page and the guide (23.09.2026)

Chapters: `docs/development.md` (Documentation), `docs/operations.md` (public guide sections).
The homepage should explain the idea and the way of working of RAgents. Executable samples and the
complete technical reference distract from that and are relevant mainly for development and
internal checks. Therefore the public export contains only the product page, the guide and the
conceptual mini-app. Building block reference, developer reference, LLM index, JSON-RPC and OpenRPC
files as well as sample previews stay outside `docs/homepage/dist/`. Technical sources and
generators remain in the repository, so that contracts and internal documentation can still be
generated and checked.

## A runner checks the workspace on a foreign machine, and the agent runtime works by itself on the server (23.09.2026)

Chapters: `docs/spec/core.md` (System prompt and agent runtime, Chat attachments, Run stop),
`docs/spec/plugins.md` (Workspace, sandbox tools, and processes; Open limits),
`docs/spec/profiles.md` (Start modes) and `docs/operations.md` (Session isolation, Build and check
tasks, Stop services and background processes, Attachments in the chat, Parent coordinator,
Selectable model). Until today all tests with server and workstation ran on one machine, on which
every path exists on both sides. The runner `pnpm check:remote-workspace`
(`scripts/remote-workspace/`) drives a run against a Linux container as the workstation from the
built package, with a script model instead of a language model, and found errors immediately.

First, every model turn of a run bound to a workstation failed before the model was asked: the
agent runtime got the workstation's path as `cwd` and checked on creation that it exists
(`assertSessionCwdExists`). Reviewed what else it does locally with its `cwd`: session header and
existence check; the project's settings under `.agent/` and resources from there (untrusted for
us, nothing is read); context files `AGENTS.md` and `CLAUDE.md` up to the root (off with
`noContextFiles`); `cwd` and `exec` of the extensions, resolution of relative paths and the
built-in tools (inactive, the tools come from the executor). So the existence check is what took
effect, and every other place would have taken effect as soon as an option switched it on. The
same mistake was in the driver: it wrote a binary chat attachment to `<working-directory>/attachments`
on the server, with `client` into a folder that does not exist there, or into the server's copy of
the same name.

Decided: two concepts instead of a switch. `TurnRequest.workspace` is the working directory of the
tools as the model sees it, for the runtime only a name. `TurnRequest.runtimeDirectory` provides,
only when a runtime is created, its folder on this machine; for this the host takes
`Workspaces.runtimeDirectory`, on the server the `cwd` of `serverProcessContextFor`: with `client`
the run's own folder in the session storage, otherwise the workspace itself, so nothing changes for
`fresh` and `path`. The runtime gets it as `cwd`, the path for the prompt separately as
`workingDirectory` (tenth own change, added in the entry "Own behavior in the agent runtime").
Existing sessions still open, because the driver prescribes the `cwd` of a session file on opening
anyway. The host stores attachments via `Workspaces.storeAttachment`, on the server via the new
operation `files.attach` of the executor, which takes over the previous storage with a free name;
this way they lie where the file tools read. `FixedWorkspaces` accepts no attachments, because it
knows no executor and the storage would otherwise exist twice.

Noticed and fixed along the way: the workspace description (entry "The workspace describes itself
in the system prompt of every actor" of 22.09.2026) never reached a prompt in the server. The
scheduler appended it only when workspace tools came from the agent runtime; `ragents.workspace`,
however, provides them as functions, and then they dropped out of this list. The scheduler's test
knew only the first path. Now every workspace tool counts, regardless of where it comes from; the
agent of a workstation run reads "Your working directory is the project folder ... on the
workstation ..., not on the server" instead of a raw line, an actor without these tools keeps the
line with the path of the workspace.

Second, the emergency stop failed after browser use in the container. The cause was not ending
Chrome: the run's marker in Chrome is intended, the process module ends it, and the workstation
stayed alive in all runs. On shutdown Chrome starts a helper process that makes itself unreadable
with `PR_SET_DUMPABLE`; its `/proc/<pid>/environ` returns `EACCES`, and the Linux table took that
for a missing permission and aborted display and stop. On every Linux workstation with a running
`ssh-agent` every stop would thus have failed. Decided: without root the table reads only own
processes, and a locked one of them carries no recognizable marker and belongs to no run; as root
it stays the error with the hint about CAP_SYS_PTRACE. An unhandled error from playwright did not
occur, and the order of the modules at stop is not the cause, because `ragents.processes` cleans
up in parallel anyway. Once the workstation instead lost the connection in the final cleanup; not
afterwards, the cause is unexplained and is in `TODO.md`.

The consequence was a separate bug independent of the browser: if the final cleanup failed, the
run stayed in quarantine until a further stop succeeded; messages were accepted, but no turn
started anymore, without a message. That is what the entry "Final cleanup belongs to the stop
response" of 08.09.2026 had intended. Now the quarantine applies while the cleanup is running; if
it ends with an error, the stop reports the error, the server log names it, and the run accepts
work again. Another stop cleans up once more.

Third, `ps -E` on a Mac does not show the environment of programs from the system volume, measured
for `/bin/sleep`, `/bin/bash`, `/bin/sh`, `/bin/zsh`, `/usr/bin/perl`, `/usr/bin/ruby` and
`/usr/bin/tail`; Node, Homebrew programs and Xcode's Python are readable. Verified in the product
with the server's executor: a `/bin/sleep` with a marker detached from a `bash` call does not
appear in the display and survives the stop, a `node` detached the same way appears and ends with
it. There is no reliable second detection without the environment: a process that survives the
call has left its process group and session, and its parent process is then launchd; what stays
in the group, the bash call ends itself. That is an open limit in `plugins.md` and a line in
`TODO.md`.

Minor findings: with `--port 0` the parent coordinator got `RAGENTS_API_BASE_URL` with port 0,
because its workspace is created while the server is being built and the port was fixed only
afterwards. The server now binds first and answers requests only after it is built; without HTTP
the variable is missing. Without `AGENT_MODELS` the start aborted when agent and coordinator named
the same model, because the duplicate check also hit the list of profile models; it now applies
only to an explicit `AGENT_MODELS`, and the check profile does without. The host test of the VS
Code extension now looks for language servers and `sleep 120` only among the descendants of its
extension host, follows the PIDs found until they end and recognizes a misplaced language server
by the marker of its run; a second RAgents next to it no longer disturbs it.

Evidence: `pnpm check:remote-workspace` without a switch, with `--shared-path` and with
`--browser`, each green three times in a row; it now also checks that a binary attachment lies in
the container and that the prompt names the workstation's folder, not that of the runtime.
`--vscode` was not run.

## A stopped executor is never reused, every sign-in of a workstation builds its own (23.09.2026)

Chapters: `docs/spec/plugins.md` (Workspace, sandbox tools, and processes; Browser checks).
The workstation (`WorkspaceClient`) held one executor for its whole lifetime. Signing out, including
the one from `update` without a folder, ended it with `shutdown`, a later sign-in kept using it:
the language server host stayed ended (`TypeScript start was stopped`) until the extension
restarted, and only for that reason did the browser module do without a lock.

Decided: `shutdown` of executor and module is final, a module may reject with a cause afterwards.
The workstation builds a fresh executor from `workspaceExecutorModules()` per sign-in and ends it
with the sign-out. That is simpler and more robust than a sign-out that only releases the runs,
because this way `shutdown` keeps its one meaning, no module has to be able to restart and no
caller needs an additional shutdown. After `shutdown` the browser module rejects every operation
on the page, because nobody would close a Chrome started afterwards; this takes back the exception
from the entry below.

Decided during construction: the sign-out signs off at the server before it ends the executor, and
waits for a running sign-in for this; a later sign-in waits for the sign-out. Otherwise the renewed
offer of a folder overtook the sign-out, which was still waiting for a slow language server, and
the server removed the just newly signed-in workstation. The answer to an old sign-in no longer
changes the state, and a task that arrives in the middle of the sign-out no longer runs in the
ended executor. A connection loss ends nothing; afterwards the workstation signs in again with the
running executor.

## The browser check runs at the run's executor, the server holds its evidence (23.09.2026)

Chapters: `docs/spec/plugins.md` (Browser checks; Workspace, sandbox tools, and processes;
Provisioning per plugin; Self-contained plugin folder and ownership; Open limits),
`docs/operations.md` (Check web applications in the browser, Session isolation) and
`docs/development.md` (Developing). `ragents.browser` always started Chrome on the server. For a run
bound to a workstation, however, the agent starts the checked application on the workstation, and
`localhost` of the server browser is a different machine. The entry "The workspace has exactly one
access path" of the same day had therefore announced the browser check as the next module of the
executor.

Decided: browser, page and everything the page touches are a module of the executor
(`browserModule`, operations `browser.open` to `browser.close`), the same code on server and
workstation; `stopRun` and `shutdown` of the module close the browser. The server half of the
plugin keeps tools, schemas, skill, the storage of the captures in the file storage of
`ragents.documents`, evidence, viewport and life cycle and calls the rest via
`SandboxServices.execute`. The cut follows what previously lay in `RunBrowser`: session, queue,
page, error list, navigation and the validity of a check concern the page and lie with the
executor; capture list, `restore`, last capture and the evidence that other plugins read
synchronously via `browserRuntimeToken` are permanently visible in the run and lie with the
server. So that the server knows the evidence without asking back, every operation returns the
state of the page next to its result. After a failed call it fetches it with `browser.state`,
because a failed check or action has already discarded the validity at the executor and an old
check time would otherwise remain; if the executor is unreachable, the page counts as closed, which
is the safe direction. The executor knows the current captures only as ids that the server
assigns; names and addresses stay with the server. The server sets the check time with its clock,
not the workstation, because procedures compare it with server times and two machines do not have
the same clock. A screenshot comes back as Base64 in the result; a separate path for binary data
is not worth it for images of this size.

playwright-core does not become part of the executor package. The module imports only types and
loads the library in the call via `createRequire` from the host root of this machine, like the
TypeScript adapter its language server. This keeps the VS Code extension's bundle free of
playwright-core, and a workstation without a host fails only at `browser_open` with a cause.
Chrome comes from `BROWSER_EXECUTABLE_PATH` in the environment of this machine, otherwise from the
provisioned Chromium. On the server the profile section writes the value into its environment as
before; it does not move to the workstation, because a server path means nothing there.
`pnpm provision --workspace` therefore also provisions `ragents.browser` next to the language
servers: without its own Chrome, the first start of `pnpm workspace-client` or of the extension
downloads Chromium, as it downloads Roslyn and FSAC. Chrome starts as before with the safe
environment, the `HOME` of this machine and the run's marker.

Decided during construction: the server holds the chosen viewport and passes it along with every
`browser.open`. Since 16.09.2026 the spec promised that it survives a browser restart in the same
run; the code forgot it with the session. Now that is true, until the server restarts. Browser
operations from tool calls carry their id, so that the workstation logs them like the other tool
calls. The module's shutdown closes every browser but does not lock the executor, because a
workstation signs in again with the same executor after a folder change (taken back in the entry
"A stopped executor is never reused" of the same day); "The browser service is stopped" is still
said by the server half after its shutdown. `WORKSPACE_EXECUTOR_VERSION` stays 2: the state of the
same day is not yet in any commit, and one version covers rework, commands and browser.

Removed along the way, because the files were now free: `SessionWorkspace.ensureWritable` had had
no caller since the rework and is removed together with its implementations in the workspace
plugin and at the global coordinator; `WorkspaceClientExecution.tool` is called `operation`, like
the field of the contract.

## A plugin calls a program in the workspace as a command without a shell at the executor (23.09.2026)

Chapters: `docs/spec/plugins.md` (Workspace, sandbox tools, and processes). Since the executor is
the only access to the workspace (entry "The workspace has exactly one access path" of the same
day), a plugin that itself needs a program in a run's folder had no way there. `bash` is a tool of
the model: with a shell, serial per run and with an output for the model instead of an exit code
for code. The other modules read files, processes or diagnostics. The occasion was the change view
of a product plugin, which calls `git` in the run's folder and evaluates the output on the server;
for this it accessed locally and stayed empty for a workstation.

Decided: a new module of the executor package, `commandModule` with the operation `commands.run`,
runs a program with arguments, without a shell, in a folder relative to the run's root, with the
executor's environment and account, with a mandatory time limit and limited output, and returns
exit code, `stdout` and `stderr`. This way the same applies to programs as to files: one path for
every binding, the binding decides the machine, and the caller evaluates.

Why no Git read module: it would be narrower, but would have to map every question of a view
(branch, merge base, list, diff) as a separate operation or pass Git arguments through, and then it
is the same command with the program `git`. How a workspace names its branches and what it
measures changes against is known only to the plugin anyway; the executor should know nothing of
it. Why without a shell: arguments often come from data, such as file names, and must not be
interpreted. This is not a command lock; whoever reaches `execute` also reaches `bash`.

Decided during construction: the time limit has no default, because only the caller knows how long
its program needs; above the safety limit of a workstation it passes the same duration as
`durationMs`. The output is limited to 2 MiB per data stream, because a workstation's result comes
back as JSON via a request with a 32 MiB limit and a control character takes six characters there;
above that the module discards, reports the truncation and lets the command run to the end, so
that the exit code is preserved. An exit code other than zero is a result, as with `bash`. The call
accepts no additions to the environment, so that no secret of the server moves into a process on
the workstation. The command runs within the frame of the workspace (`runOperation`), so that
deletion and stopping wait for it as for a tool, and `stopRun` and `shutdown` cancel running
commands. On Windows the module rejects `.cmd` and `.bat`, because Node starts them only via a
shell. The folder is checked by the same function as in the file module (`workspaceDirectory`).
The executor's version is not incremented separately for this; it has already risen with the
rework of the same day.

## The workspace has exactly one access path, the run's executor (23.09.2026)

Chapters: `docs/spec/plugins.md` (Workspace, sandbox tools, and processes; Language server plugins;
Open limits), `docs/spec/typescript-platform.md` (native execution, Execute code, Open limits) and
`docs/operations.md` (Stop services and background processes, Work on Windows, Data storage and logs,
Session isolation). A run bound to a workstation sent only the model's tool calls to the
workstation, and that via a fixed list in the executor: four sandbox tools, hard-wired language
server names, `stop`. Everything else that touches the workspace's machine got a local handle on
the server. The Files tab read `SessionWorkspace.currentRoot()` with `readdir`, `readFile` and
`fs.watch`, the process display scanned and ended in the server's process table, `typescript_eval`
read a file under `path` locally, and TypeScript platform and actor programs got the workstation's
path as `cwd` via `processContextFor`. With `fresh` and `path` the local handle is right by
chance, with `client` silently the wrong machine: 404, wrong content, and whoever signed in their
own workstation with the folder `/` and bound a run to it read the server's files via the Files
tab. Nobody saw this, because in the tests server and workstation run on one machine and every
path exists on both; every new function was thus local at first and remote only if someone thought
of it.

Decided: a run's workspace has exactly one access path,
`SandboxServices.execute(runId, operation, input, options)`, and where an operation runs is decided
solely by `executorFor` via the binding. The executor is an open registration:
`WorkspaceOperationExecutor` is built from modules, every module registers named operations and
optionally `stopRun` and `shutdown`, the executor itself knows no name, and an unknown one is
`workspace-operation-unknown`. Sandbox tools, language servers, files and processes are modules of
the package (`workspaceExecutorModules()`); server and workstation carry the same ones, and the
browser check on the workstation becomes another one. After `edit` and `write` the tool module asks
all modules for an annotation, so the language servers append their diagnostics without one module
knowing the other. Progress is a JSON value (`bash` stays at `{ text }`). Duration, watching until
cancellation (`untilAborted`) and cleanup without a counterpart (`whenReachable`) stand explicitly
in the call's options, not in a name list or in a tool's input; this way the safety limit in
`clients.ts` does not choke any watch. The contract `ragents.workspace.client.execute` takes
`operation` instead of `tool` and `toolCallId` only for a tool call, `stop` belongs to the contract
instead of the executor, and `WORKSPACE_EXECUTOR_VERSION` is 2. A domain error carries id and status
(`WorkspaceOperationError`) and arrives at the server as the same `DomainError`, regardless of
where it arose.

Plugins no longer get a local handle: `processContextFor` has disappeared from `SandboxServices`.
What really runs on the server, TypeScript platform and actor programs, gets
`serverProcessContextFor`; with `client` it points to the run's own folder in the session storage,
never to the workstation's path, which need not exist there. `currentRoot()` and
`ensureWritable()` fail loudly with a cause for `client`, so that a future mistake stands out
immediately instead of silently reading the server (`ensureWritable` is dropped in the entry "The
browser check runs at the run's executor" of the same day). Files tab, process display and
`typescript_eval` with `path` go via the executor; the file storage of `ragents.documents` lies on
the server, does not belong to the workspace and is read directly with the same functions of the
package. The process plugin keeps contract, rights, methods, channel, interval and life cycle.

Decided during construction: paths of the file operations are relative to the run's root and are
checked where reading happens. An alias stands in a separate field instead of in the path, because
a folder named `@something` in the project could otherwise no longer be opened in the tab;
`typescript_eval` splits `@actors/...` itself for this and no longer accepts `..`, which never led
into another root anyway. In `stopRun` the process module ends every marked process of the run,
even without `ragents.processes` in the profile; for a workstation the sandbox host stops its
executor and the server's, because the TypeScript platform runs there with the same marker. The
rights check between SIGTERM and SIGKILL is dropped, because no callback reaches across the
connection; the method checks rights and run before the call, and the cancellation of the request
reaches the executor. Concurrent queries of several runs share one table scan in the executor, so
the server stays at one scan per interval. On Windows the process module rejects state and ending
with a cause, instead of rejecting the plugin at startup, because a server on Windows can serve
runs on another workstation; its cleanup is dropped there. The workstation now logs only tool
calls of the model, so that the process display with its two-second interval does not flood its
log. A test with a workstation whose folder does not exist on the server records the path
(`apps/server/tests/workspace-foreign-machine.test.ts`): every local access fails there on the
missing path, and a workstation with the folder `/` returns only its own files.

## A start template fixes start options, checked in one place (23.09.2026)

Chapters: `docs/spec/plugins.md` (Plugin contract: entries and start options; Web as plugin host:
start surface and preparation chat; VS Code extension: New run), `docs/operations.md` (Run
scripts, VS Code extension) and `docs/spec/typescript-platform.md` (Run scripts). Finding from a
real run: "New run" in the VS Code extension always preset the binding `ragents.workspace.binding`
with the opened folder, also for templates that can only work in the per-run folder on the server.
These procedures noticed this only at runtime and refused. A template had no way to say which
start option it needs, and the start paths with an entry (tile, preparation chat,
`ragents.chat.start`, parent coordinator, driver) each set start options according to their own
logic.

Decided: an entry optionally carries `fixedStartOptions` (option id to value), contributed
explicitly or in a `RUN.md` as the header line `fixed-start-options` with a JSON object. The core
knows only this mapping, no workspace and no procedure. On sealing it checks that every fixed
option is registered and its value satisfies its schema. Whether `accept` accepts the value is
decided only by the start, because it can depend on the actor. It is applied in exactly one place,
`RunChatSession.#startChoice`: the fixed value replaces choice and default, `accept` checks it with
the user who starts, and a previously chosen differing setting is `start-option-fixed` (409) with
template and option in the message. Nothing is overwritten silently, because a deliberate choice
would otherwise disappear without feedback. For an already created run the same applies against the
stored value. So that a skill entry takes the same path, the first message names its id:
`ragents.chat.send` has the field `entry`. Until now only the prepared text arrived at the server.
Run scripts run via `ragents.chat.start` with an id anyway, also from the driver, from
`ragents run --entry` and from `ragents.overseer.createRun`.

The interfaces follow this instead of replicating it. The start surface shows a fixed option in the
preview of the template and in the preparation chat as fixed with its value, instead of offering a
selection that fails in the end. When starting from VS Code, the run panel presets only what the
template does not fix. For a template with a fixed workspace the extension asks for no folder and
does not preset the binding. The procedures' runtime refusal stays as a safeguard for runs that
were created without this template.

Incidentally: the parameter `userId`, which the entry below passes through the session, has become
a `StartChoice` there of user and fixed values. It remains a parameter per call, not a remembered
state.

## Workstations belong to their user, a run bound to one is operated only by its owner (23.09.2026)

Chapters: `docs/spec/plugins.md` (Plugin contract: start options; Rights in server and web
contributions; Workspace, sandbox tools, and processes; Open limits), `docs/spec/profiles.md` (Ownership
in detail) and `docs/operations.md` (Sign-in and profile permissions, Session isolation, Transfer
a run). A run with the binding `client` executes `read`, `write`, `edit`, `bash` and the
language servers on a workstation's machine, with its `HOME` and thus with the Git, SSH and NuGet
credentials of its developer. The sign-in remembered the user, but nobody checked it afterwards.
Four gaps followed from this. `ragents.workspace.clients.list` showed all workstations to everyone
with read rights. The start option accepted every signed-in workstation and offered all of them in
the web, because `StartOptionContext` knew only the run; a second user could thus bind their run to
someone else's machine and run `bash` there. Execution went by the id alone, and because a
disconnected workstation leaves the registry, another user could sign in with the same id
afterwards: they got the tool calls of other people's runs including commands and file contents and
could have returned forged results. And `runs.read.all` means "see and operate": `assertRunRights`
and the message layer let messages, inputs and answers through into someone else's bound run, and
thus commands on its owner's machine.

Decided: the registry keeps a workstation under owner and id. Sign-in, sign-out, `info`,
`executorFor` and `list` always take the owner along; two users with the same id have two entries
that never touch. So there is no foreign entry anymore that a sign-in or sign-out could run
against, and `workspace-client-foreign` is dropped; a sign-out hits only one's own entry.
`clients.list` returns only the caller's workstations, even with `runs.read.all`.
`StartOptionContext` carries the acting user (`userId`, without sign-in `null`), and every path to
`defaultValue`, `accept` and `describe` passes it through as a parameter from the access of its
request: list, choice, preparation, attachment check, the defaults at creation, catalog and
`createRun` of the parent coordinator. The session does not remember it. The binding option
accepts and shows only workstations of this user; a foreign one behaves like an unconnected one, so
that the answer does not reveal that it exists. The actual boundary, however, is the execution: it
always looks for the workstation of the run owner (`RunState.ownerUserId`, decision of 22.09.2026)
with the id of the binding, also for the prompt contribution about the platform. This also takes
effect when choice and creation of a run come from different users. A run without an owner fits
only a workstation signed in without a user. There is no fallback to any workstation with the same
id, because exactly that was the gap.

For the fourth point the core knows a single new, generic state: "only the owner operates this
run". A start option declares it via the optional `ownerOnly(value)` for its stored value, and the
host reads it like the owner from the journal (`runOwnerOnly`), without a cache. It hangs on the
start option, because the binding is itself one and thus already stands in the journal; a separate
extension point would have needed a second place for the same fact. The binding option declares it
for `client`, not for `path`: a server folder works with the server's means, which an access with
`runs.read.all` co-manages anyway. It is enforced at the same bottlenecks as ownership:
`assertRunRights` rejects the kinds `write` and `write-inspect` for everyone except the owner with
`run-owner-only`, the message layer does the same for every contract with `runs.write`, so that
questions, mini-app actions and future contributions are protected without code of their own, and
the message via the parent coordinator goes through the same check. For this, stopping gets its own
kind `stop` with the rights of `write`, so that `ragents.chat.stop`, `ragents.runs.stopActor` and
`ragents.runs.stopAll` stay allowed; reading is not affected. Status 403 instead of 404, because
the access sees the run and disguising it would only confuse. Ending a single process requires
`runs.write` and thus counts as operating; stopping the whole run remains possible, so nothing is
lost. Without sign-in there is exactly one access, and there the restriction does not apply.

The host's private service identity (`host-service`) keeps `runs.read.all` but does not operate
such a run. It acts for the server, and everyone who may write with the shared parent coordinator
acts through it; if it were exempted, anyone with this right could trigger commands on someone
else's machine via the coordinator. Passing the human behind the tool call through the service
identity, so that the owner can also operate their run via the coordinator, would be a separate
rework; it can still read and stop.

Existing runs without an owner that are bound to a workstation find it only if it is signed in
without a user; with `anonymousUser` that means creating the run anew. Journals are not rewritten
for this. Runs created via `ragents.overseer.createRun` still have no owner; a workstation binding
there is checked for the caller, but finds no workstation at execution as soon as the profile names
users or an anonymous access. That is the safe direction and is in `TODO.md`.

## The run panel shows a continuous loading state and in VS Code never the run list (22.09.2026)

Chapters: `docs/spec/plugins.md` (Chat building blocks with `ChatSurfaceOptions.notice`, Run panel,
VS Code extension, Open limits) and `docs/operations.md` (Run panel and VS Code extension, Usage).
When starting a run from VS Code, the run panel's run list flashed briefly: the extension first
shows the run panel without a run and sends the start request only afterwards, and without a run
the panel showed the list, which only makes sense in the browser without a Start page. After that,
while the server prepared the run and the run script set up agents and mini-app, an empty chat
without any notice stood in the run panel for several seconds.

Decided: in the host `vscode` the run panel never shows the run list. Without a run a loading state
stands there until the start request arrives; if it does not arrive within five seconds or the
panel cannot execute it, it names the reason and leads to the Start page instead of loading
forever. The solution lies entirely in the web, the extension stays unchanged, because its flow is
correct and only the display in between was missing. From the click to the first content, a
mini-app or a conversation contribution in the chat, the setup looks like a single display:
loading the profile, waiting for the host, `RunLaunch` and the setup in the chat share the
component `StartupNotice`, the same header and the same place; the tile surface uses the same
component. What is displayed is decided by the existing generic logic of the tile surface
(`canvasStartupState`), which knows only states such as preparation, work, question, stop and error
and never a tool or a mini-app. The chat gets the notice via `ChatSurfaceOptions.notice` instead of
the history, so that the input stays usable. System lines and work steps do not count as content,
because even the preparation of the workspace writes a system line. A hold time of 1.5 seconds
bridges the gap until the run view has caught up with a finished start status; it does not apply
to establishing the connection, so that an empty, idle free run stays without a loading state.

## The homepage explains concepts with static system diagrams (22.09.2026)

Chapters: `docs/homepage/index.html` and the generator sources under `scripts/homepage/`. The
product page had used several interactive demos as illustration. As a result, concrete examples
looked like the actual product definition, the old freely arranged work surface stayed visible, and
events and journal appeared as two separate functions.

Decided: the public homepage is in English and names web and VS Code as the two interfaces. The
four core ideas setups, agent communication, TypeScript and mini-apps get small static concept
diagrams. The current run panel layout replaces the free surface. Events and journal are one shared
point with an ordered event log. Server and workstation appear in a single distributed system
diagram. The console stays an automation path, but not a client advertised on the product page.
The diagrams explain contracts and relationships; they do not claim executed model runs.

## The workspace has an owner, a custom kind is a contribution (22.09.2026)

Chapters: `docs/spec/plugins.md` (Self-contained plugin folder and ownership; Workspace, sandbox
tools, and processes), `docs/spec/profiles.md` (Profile core) and `docs/operations.md` (Data
storage and logs, Session isolation). A profile that builds its workspace differently from the host had only
one way so far: its own plugin that registers `workspaceRuntimeToken` and `sandboxServicesToken`
itself. That way it cannot run next to `ragents.workspace` - `ServiceRegistry.provide` aborts at
the second provider -, and everything the host can already do in terms of workspace mechanics (the
bindings `fresh`, `path` and `client`, the workstation registry, the start option, the binding
state) had to be rebuilt or imported there. Every assumption "there is a folder on the server" then
blew up individually as soon as a run was bound to a workstation.

Decided: the workspace belongs to `ragents.workspace`, and a custom kind is a contribution via the
existing `workspaceResolverToken`. For this the hook is extended as far as this role needs, and no
further: `WorkspaceResolver.kind` names the kind (`id`, `label`, `serverFolders`, optionally
`directoryPattern`), the resolution may now return everything that `SessionWorkspace` knows - up to
`hostSandbox.ident`, the account under which the sandbox executes -, and `stopSession(runId,
sandbox)` as well as `deleteSession(runId)` give the contribution its own cleanup per run, placed
around the stop of the host's sandbox. The bindings themselves stay unchanged; the kind occupies
`fresh` and rules out `path` where a workspace with its own rights does not tolerate a server
folder. Whoever wants to ask centrally which kind a run's workspace is asks
`WorkspaceRuntime.kindOf(runId)` - one place instead of a case distinction per procedure.

Plus a bug that becomes visible across two machines: with the binding `client`,
`ragents.workspace` set the session's `cwd` to a folder of the server, although the tools run on
the workstation. The agent runtime appends this `cwd` as `Current working directory` to every
system prompt, so the agent named a different path than the one it used. Now the bound folder is
`cwd`, `currentRoot()` and `ensureWritable()`, and the server no longer creates anything for a
bound run. Actor programs have their own folder anyway; `typescript_eval` thus runs in the
workstation's folder and is no longer provided for on the server - that is the more honest
statement than a second path nobody sees.


## A run belongs to the user who created it (22.09.2026)

Chapters: `docs/spec/profiles.md` (Run ownership) and `docs/operations.md` (Sign-in and profile
permissions). Until now all users with read access shared the runs of a profile. Every developer access
thus saw the tasks, journals and working directories of all others, and a guessed run id was
enough to open someone else's run.

Decided: the run remembers its user where its other metadata lives, namely in the journal.
`run.created` carries an optional `owner.userId` next to the human participant, and the projected
`RunState` derives `ownerUserId` from it; the run view for clients stays unchanged and does not
name it. No second store comes into being, and a restart changes nothing, because the value is
replayed from the same events as the rest of the run. The new right `runs.read.all` stands for
"sees the runs of all users"; `*` includes it like any other right.

Enforcement is server-side only, and at the choke points everything passes through instead of in
every single method: `assertRunRights` checks ownership after the rights and thereby covers chat,
start, stop, run view, journal, artifacts and the host's event channels; the message layer
additionally checks every input and every channel parameter carrying `runId`, so a contribution of
an extension is protected along with it without code of its own; the delivery routes check the
`runs/<id>` segment of their address; the run list filters; the parent coordinator resolves its
run references only through the caller's runs; and the surface context of a message must not name
someone else's run. Someone else's run answers like a nonexistent one (`run-not-found`, 404), so a
guessed id reveals nothing.

Existing runs do not get an owner added after the fact. The journal is not rewritten, and there is
no reliable source for whom such a run belonged to: the human participant carries only a display
name and a normalized handle. They therefore count as runs without an owner and remain reserved
for accesses with `runs.read.all` - the safe direction, because nobody gets to see anything they
were not allowed to see before. The same holds for every run created without sign-in, and for an
imported run without an owner in the archive. Profiles without sign-in stay untouched: there is
exactly one access there, and the rule only takes effect when user sign-in is enabled. The host's
private local service identity carries `runs.read.all`, because it acts for the server and not for
an operator.

## State icon and text in the environment chip have separate space (22.09.2026)

Chapters: `docs/spec/plugins.md` (VS Code extension: Start). The dedicated icon button in the
environment chip had 10 pixels of padding on the left and 4 pixels on the right. As a result the
icon visibly sat to the right, while the content began after the edge with only 4 pixels of
spacing. The icon area is now 32 pixels wide and centers the icon; the content area starts with
8 pixels of padding. A browser test checks both measures geometrically.

## Secrets for the local host live in SecretStorage (22.09.2026)

Chapters: `docs/operations.md` (VS Code extension). A locally started host only inherited the
extension's environment. If VS Code starts from the Dock or Finder, the shell's variables are
missing there, and a profile that resolves its values via `env("NAME")` did not come up. Writing
the values into the settings was out of the question: `settings.json` is a plain-text file and
ends up in backups and sync. The new setting `ragents.hostEnvironment` therefore carries only the
names, checked against `^[A-Za-z_][A-Za-z0-9_]*$`; the values live under `ragents.host-env:<NAME>`
in SecretStorage and only arrive through the inherited environment when the host starts. If a
value is missing, the host starts anyway, and the `RAgents` channel names only the name.

## Stop keeps the visible beginning of the answer (22.09.2026)

Chapters: `docs/spec/core.md` (Stop paths). Until the regular model completion, live text only
lived in the transient chat. A cancellation therefore lost the already-read beginning of the
answer on the next replay. The agent runtime records the open text on cancellation as
`model.output.interrupted` before the scheduler interrupts the turn. The dispose path also saves
it before it removes the dispatcher. The new event is conversation history only: no finished
result, no `Turn.outputs` entry and no subscription source. The existing text cursors prevent a
duplicate display during the transition from stream to journal.

## The homepage does not publish a copied-together LLM bundle file (22.09.2026)

Chapters: `docs/spec/overview.md` (Public references) and `docs/operations.md` (Homepage build).
The HTML documentation and its targeted Markdown, TypeScript and OpenRPC references already cover
the same content in structured form. `llms-full.txt` duplicated all texts in one large file,
enlarged the export and offered no additional contract. The generator therefore no longer creates
and publishes it; `llms.txt` remains the short index to the individual sources.

## A local host does not outlive its extension (22.09.2026)

Chapters: `docs/spec/profiles.md` (Start modes) and `docs/spec/plugins.md` (Web as plugin host).
When the VS Code extension started the host of a local profile environment, the child process
survived every window reload and every VS Code crash: `deactivate` was empty, and the `dispose`
entry threw away the promise of `disconnect()` with `void`, so nobody waited for
`RunningHost.stop()`. The orphaned host kept holding the writer lock under
`<DATA_DIR>/runs/.writer.lock` along with a fresh heartbeat; the new host aborted with "Another
runtime process already owns ..." and the environment showed as failed in the panel.

Decided: two independent paths. `startHost` passes `RAGENTS_PARENT_PID` to the child process, and
the host watches that process with `apps/server/src/parent-watch.ts` every five seconds via
`process.kill(pid, 0)` (ESRCH means gone, EPERM means alive under a different owner); if the caller
is gone, a line on stderr names the cause and then exactly the `shutdown` function of the signal
handlers runs, so the lock is released regularly. The interval is `unref()`ed and never keeps the
host alive; a set but nonsensical value is a hard start error, a missing variable changes nothing
(start via `scripts/start.sh`, CLI, tests). In addition, `deactivate` now waits for a module-wide
cleanup function that disconnects all sessions and stops every own host in the process; like
`shutdown` in the server it is memoized as a promise, so the `dispose` entry of the subscriptions
awaits the same run instead of a second one. The wait is limited to four seconds, because VS Code
only gives the extension host a short time to clean up on reload - the orderly path is the fast
one, the watchdog in the host covers the rest.

## The chat handle determines the retraction depth (22.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel). The automatic expansion of the bottom chat remains.
The handle, previously only clickable, now also changes the visible resting height by dragging and
remembers it per run as an offset from the measured minimum. This way even growing inputs stay
fully visible. The minimum height includes borders and actual element heights, so the top rounding
of the input is not cut off. While dragging, the automatic behavior pauses; afterwards it uses the
chosen resting position again.

## New runs in VS Code start with focus in the chat (22.09.2026)

Chapters: `docs/spec/plugins.md` (Run panel and host). Opening the VS Code panel used to focus
only the shell; before typing, an extra click into the chat was needed. A new run therefore
requests focus for its visible chat input once, as soon as the connection is up and the input is
ready for typing. This also applies after a template start. Existing runs and browser views keep
their behavior; later messages and reconnects do not move the cursor again.

## The workspace rules are tied to its tools (22.09.2026)

Chapters: `docs/spec/plugins.md` (Prompt contributions). `plugins/ragents.workspace/prompt.hbs`
names the write boundaries, the ban on remote Git operations and the missing network in `bash`.
The contribution named no `requiresTools` and therefore only reached the coordinator:
`basePromptFor` gives actors that are not the coordinator only contributions with
`delivery: "initial"` AND a matching `requiresTools` - precisely the sub-agents that write in the
same folder with the same tools never saw the rules.

Decided: the registration binds the contribution with `boundToTools` to `read`, `edit`, `write`
and `bash` and explicitly keeps `delivery: "initial"`; the default of `boundToTools` would be
`on-demand` and would show the text only in the chapter retrieval. The names come from
`agentWorkspaceToolNames` in `apps/server/src/plugin-support/workspace-tool-naming.ts`, i.e. from
the same table from which the scheduler names an actor's tools; engine and server core still know
no tool. The text does not appear twice in the prompt: `composeWith` builds the coordinator
prompt, the second branch of `basePromptFor` builds that of the other actors, and the two paths
exclude each other.

## The workspace describes itself in every actor's system prompt (22.09.2026)

Chapters: `docs/spec/core.md` (System prompt per turn), `docs/spec/plugins.md` (WorkspaceRuntime).
Finding from a real run: a run bound to a project folder on a workstation answered "The working
directory is currently still empty". Two causes.

First, the workspace's note never reached the model: `emitSystem` produces a chat event for the
surface, not for the model context. `plugins/ragents.workspace/prompt.hbs` nevertheless claimed "A
system note at the start says where it is"; the sentence is gone. Second, the agent runtime
appended the server-side storage folder to the system prompt as `Current working directory: ...` -
with the `client` binding exactly the empty folder, while the tools run in the real project on the
workstation.

Decided: `SessionWorkspace` gets the optional field `description`, which the workspace formulates
itself (binding `path`, `client`, `fresh`; for `fresh` with the path the resolver delivered). The
core passes it through generically - `SessionWorkspaces` remembers it per run,
`Workspaces.description(runId)` reads it, the `TurnScheduler` appends it as the last chapter to the
system prompt of every actor that has workspace tools, also on the second construction path
`refreshTools`. The scheduler decides this via the already existing `workspaceTools`; engine and
server core still know no tool and no prompt text.

A contribution via `host.prompts` would not have been enough: `basePromptFor` gives actors that
are not the coordinator only contributions with `delivery: "initial"` AND a matching
`requiresTools`, and that is exactly why no sub-agent saw `prompt.hbs` until now.

Deviation from the original draft: the description appears exactly once in the prompt. The draft
had the agent runtime output the description INSTEAD OF the raw path; together with the
scheduler's chapter the same paragraph would appear twice in a row. Instead the runtime only
suppresses its own line (ninth own intervention, see "Own behavior in the agent runtime"): the
turn request carries `workspaceDescribed`, the agent driver passes it into the session as
`omitCwd`, and `buildSystemPrompt` then leaves out `Current working directory: ...`. An actor
without workspace tools keeps the raw path, because for it the server-side folder really is the
working directory of `typescript_eval`.

## Forward VS Code keyboard shortcuts from the embedded run panel (22.09.2026)

Chapters: `docs/spec/plugins.md` (VS Code extension), `docs/operations.md` and
`apps/vscode/README.md`. Keyboard events do not leave an iframe; VS Code's webview listener
therefore only heard the shell. The run panel forwards unhandled keydown/keyup events together
with the physical key, keycode and modifiers to the shell. The shell checks source and origin and
provides them as DOM events for VS Code's existing key resolution. This way user-defined bindings
apply as well, without rebuilding commands in the extension.

The existing clipboard bridge remains: Hex simulates Cmd+V, while VS Code's paste command only
reaches its direct webview document. Local editing, IME and keys already handled by the chat
therefore do not go through the new path. Because of the asynchronous frame boundary, these local
keys take precedence over competing VS Code bindings.

## Default entry per environment, tile per reachable environment, the plus takes the default, error message behind the state icon (22.09.2026)

Chapters: `docs/spec/profiles.md` (Export `defaultStartEntry`), `docs/spec/plugins.md` (Bootstrap,
VS Code extension: Start), `docs/operations.md` (Operating the extension),
`apps/vscode/CHANGELOG.md`. Owner's decision after the acceptance of the Start page.

**An environment can have a default entry, and it is a property of the profile.** Next to
`config`, `users` and `anonymousUser`, the profile file gets the fourth optional export
`defaultStartEntry`, a string with the id of an entry. `config-file.ts` checks the shape,
`profile/compose.ts` gives it to the `PluginHost`, and the latter rejects on sealing an entry that
no plugin of the profile has registered - with the list of registered entries, a hard start error.
`publicProfile` delivers it as `PublicPluginProfile.defaultStartEntry` only if the entry is among
the templates released for the user; otherwise the field is missing and the templates remain. The
extension passes it through (`RunStore.defaultEntry`, `TargetSnapshot.defaultEntry`,
`TargetView.defaultEntry`); a default that is not among the delivered templates is an error of the
environment in the store, the page guesses nothing. `core`, `showcase` and `developer` set no
default. Why: which entry is the normal one is known by the profile, not by the surface and not by
the user per click.

**New starts with one tile per reachable environment.** With a default that is its template,
looking like the others, with the marker "Default" in the category line and not a second time in
the list; without a default the tile "New chat" (category "No template", "Empty run, the task
takes shape in the chat.", dashed edge, plus), as it stood in the overview the day before. The
section thus appears as soon as an environment is connected and allows new runs, and the counter
counts all tiles. Why: the empty chat was only reachable behind the plus, and the section was
missing entirely without templates.

**The plus on the chip takes the same default.** With a default it sends `newRun` with `entryId`
("New run from <template> on <environment>"), without one, as before, without `entryId` ("New chat
on <environment>"). `RAgents: New run` remains, only the first line per environment is, when a
default exists, its template (suffix "Default") instead of "no template". Why: one click, one
result, and the profile decides which.

**The error message sits behind the state icon.** For `failed`, `unreachable` and `forbidden` the
icon in the chip is a small button of its own ("Show error of <environment>") that opens a
`Popover` from `ui/popover.tsx`: state word as heading, the full message from
`TargetState.message` as selectable text (`stateDetail`, the same source as the Environments page;
monospace for multi-line output), below it "Open output" (new panel action `showOutput`, the
extension shows the RAgents channel) and the chip's action word ("Retry" or "Sign in"). The
popover survives the brief `connecting` of an automatic retry and closes as soon as the
environment is free of errors. For `login-required` the lock opens the sign-in dialog, in all
other states the icon has no action of its own; the left part of the chip keeps its action. A
popover instead of a dialog, because the message belongs to the chip and the eye should stay
there. Why: until now Start showed only the red icon and "Retry" on an error, the cause was only
on the Environments page.

## Actions only in the VS Code title bar, split environment chips with action word and target line, stop uniformly red (22.09.2026)

Chapters: `docs/spec/plugins.md` (VS Code extension: Pages, Vocabulary, Stop),
`docs/spec/core.md` (Stopping a run), `docs/operations.md` (Run panel and VS Code extension:
Operation), `apps/vscode/CHANGELOG.md`. Owner's finding on the first day of the new panel pages.

**The actions are only in the view's title bar.** Start, Runs, Environments, New run and Refresh
existed three times: in the native title bar (`view/title`), in the page header and as a gear next
to the heading "Environments". Now only in the title bar, as VS Code intends; `PanelHeader` carries
only the back arrow and title, Start has no header at all anymore, because the title "RAgents" is
already at the top. The jump into `settings.json` moved from the header of the Environments page
down next to "New environment". Why: the same icon three times on top of each other reads as three
different things.

**The environment chip is a split button.** Until now only the tiny state icon was clickable, and
nobody noticed it. The left part is a `button` with state, name and an action word that depends on
the state (Sign in, Retry, Start, Connect, Runs; "starting ..." is disabled); the right part is
the plus. "Runs" opens the Runs page filtered to the environment: the `page` action carries
`environment` for this, the extension returns it as `PanelState.runsEnvironment`, the page shows
the filter as a pressed toggle that a click removes. The switched-off filter chips above all
environments do not come back; the filter is the path from the chip, not something that stands on
the Runs page by itself. Why: a click on a chip must visibly do something, and the word says what.

**The target line comes from the extension.** Below the name, in the monospace of the time, stands
where the environment goes: `local · <profile>`, the server's host, or `<host> · local` for a
client profile distributed by the server. The data is delivered by `TargetView.route`, built in
`overview-model.ts` from the connection (`profileNameOf`, `serverHost`) and the new
`TargetSnapshot.localHost` (the session talks to a host it started itself). Why: the page would
have had to guess the profile name from the path and the distribution from nothing at all.

**One stop, one glyph, one word.** The stop button was not recognizable as a stop; a red sign is
customary. Two rules: state icons never carry a square (stopped is now an empty circle instead of
a circle with a dot), and every real stop button is `StopButton` from `ui/stop-button.tsx`, a
filled square in `--destructive` with the same hover and disabled state - in the run panel header
(previously `CircleStopIcon` in gray), at the chat input, at the processes and in the menu entry of
`ragents.orchestration`. Ending the whole run is called "Stop run" everywhere, never again "Stop
execution"; "Stop work" remains the interruption in the chat, a different action. The remaining
"Lauf" leftovers in surface texts are now called "Run". Why: the term is "run" throughout the repo,
and a gray circle with a square is neither a state nor a button.

**The run list is a grid.** `RunList` is a CSS grid with the columns checkbox (only in selection
mode), state, title, time and environment (only from two environments on); row and button are
`grid-cols-subgrid`, so that time and environment sit at the same edge in all rows, no matter how
long the title or the name is. The browser test checks exactly that. Why: columns that jump from
row to row are not columns.

## The extension is an app of four pages, with one vocabulary and compact time (22.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host: Run panel in the extension),
`docs/operations.md` (Run panel and VS Code extension), `apps/vscode/README.md`,
`apps/vscode/CHANGELOG.md`, `TODO.md`. The basis is the accepted overall draft
`docs/ui-drafts/app-2026-09-22.html` (version 6) with the owner's selection of the toggles; images
of the pages are next to it as `docs/ui-drafts/app-2026-09-22-*.png`.

**Four pages instead of overview and settings.** `PanelState.page` now carries `start`, `runs`,
`run` and `environments`; a header names the page, two icons lead to Runs and Environments. Why:
the overview was one page with three jobs, and the full run list would have made it so long that
the tiles below would never come into view again.

**One vocabulary for all pages, the word only in the tooltip.** Per state one colored icon
(`apps/web/src/ui/state-icon.tsx`) and exactly one word (`apps/web/src/ui/state-vocabulary.ts`,
without React, so the extension can read it too): a run is running, waiting for input, idle,
ended, failed or cancelled; an environment is connected, ready, starting, requires sign-in, is
unreachable or stopped. Why: at 420 pixels every word costs title width, and three pages that name
the same state differently are three truths.

**No tool term in the panel.** The waiting run names the number of open inputs, not the term of
the plugin that is currently asking; "question" appears nowhere anymore. Why: the panel belongs to
the product, not to the plugin that happens to be waiting - the same boundary the engine drew on
the same day.

**Time is compact and without "ago".** `now` under one minute, then `5 min`, `3 h`, `1 d`, `2 d`,
from seven days on the date `13.09.` (`apps/web/src/ui/relative-time.ts`); the spelled-out form
appears only in the `title`. No special case for yesterday - a series without an exception reads
faster than one with. Why: the time sits in a fixed column next to state and environment, and "5
minutes ago" does not fit there.

**The Explorer tree is dropped.** `explorer.ts`, `explorer-model.ts`, the view container in the
activity bar, its welcome text and its menus are gone; the badge of the waiting inputs now sits on
the run panel's view. Why: Start and Runs show the same environments, runs and templates flatter
and with state; a second navigation tree next to them would be a second truth that would have to
be maintained with every change. Price: a run's journal no longer has an entry point in the
panel; the command `ragents.openJournal` remains, but is listed in `TODO.md`.

**A local profile starts on activation, not on demand.** The state "not started" is no longer
shown, the "Start" and "Stop" buttons are dropped from the page; `startProfile` and `stopProfile`
remain in the contract for now, because the host test needs them for running from a fetched
package. Why: an environment without templates is an empty tile, and the switch to stdio, which
saves the port entirely, comes separately later.

**The run panel header gets a back arrow.** The expand arrow with the run list as an overlay
(`listOpen`) is dropped; in its place the arrow always leads to the Start page, as its own message
`showStart` in `run-panel/host-contract.ts`. On the right are the environment pill (new as
`?environment=` in `RunPanelPageQuery`), the state icon and the stop as an icon. Why: `runChanged`
reports a consequence, not an intention, and the expanded list was a second version of the same
list without an exit from the run.

**Deleting remains the host's business.** The Runs page sends `deleteRuns` per environment with the
ids, confirmed beforehand in a dialog; the extension calls `ragents.sessions.delete` and refreshes
the list. Removing an environment now also asks back in a dialog instead of in the row. Why: a
confirmation that stands in the row shifts the list underhand, and a multi-selection does not fit
there anyway.

## The engine no longer knows a tool shape: one waiting action with an opaque payload (22.09.2026)

Chapters: `docs/spec/core.md` (Pending actions), `docs/spec/plugins.md` (Core boundary, Web as
plugin host), `docs/operations.md` (Run panel and VS Code extension). Owner's finding: the engine
must not know any tool and any tool shape, but it knew exactly one.
`packages/ragents/src/domain/events.ts` carried, next to the generic `kind: "action"`, the case
`kind: "question"` with `question: { options, multi }`; processed in `model.ts`, `projection.ts`,
`event-validation.ts`, `event-semantics.ts` and `runtime/decisions/actions.ts`, produced by the
plugin `ragents.ask`, rendered all the way into `apps/server/src/chat-events.ts` (role
`question`), `apps/web/src/chat/QuestionCard.tsx` and the counters in `apps/vscode/src` and
`apps/web/src/panel`. The principle was already in `docs/spec/overview.md` ("Plugins own domain
logic and integrations. The core knows no business domain.") and in the core boundary of
`plugins.md`; the case distinction in the event was its direct violation.

**One case instead of two.** `action.proposed` now carries `owner: string | null` and
`payload: JsonObject | null`, `action.resolved` carries `result: JsonValue | null` instead of
`response: string | null`. `ActionKind` and `ActionQuestion` no longer exist. The payload is only
checked as a JSON object and never read. The owner also replaces the previous case distinction for
authorization: an action without an owner is the core's generic approval case (`action_propose`)
and requires `action.propose`, an action with an owner belongs to the plugin and does not require
it. Previously this was tied to `kind`.

**The shape belongs to the plugin.** `ragents.ask` puts `{ question, options, multi }` into the
payload and answers via its own contract `ragents.ask.answer`. Its web part registers the rendering
via the new extension point `actionViews` (exactly one component per owner, symmetrical to the tool
presenters; the host passes it like `renderTool` through a context to `ChatMessages`).
`QuestionCard` has moved from `apps/web/src/chat/` to `plugins/ragents.ask/web/`; its place is
taken by the generic `PendingActionCard` with title, "waiting for input" and "Discard". The
previous `questionResponder` and `SessionContext.respond` are dropped - a plugin calls its own
contract, the host only the generic discard. The `FlowInspector` now also shows actions
generically including owner and payload and no longer depends on `ragents.ask`.

**Old journals are rejected, not migrated.** An `action.proposed` with `kind` fails in event
validation with exactly this cause; the affected run is isolated like every run with an invalid
event, the server and the other runs keep running. Reason: a migration on read would have
permanently taught the engine that `question` belongs to `ragents.ask` - exactly the coupling that
disappears here. File format 4 and event schema 3 stay unchanged; no version bump is needed,
because the existing isolation is already the right answer.

**The counter has a generic name.** `questions` becomes `pendingActions` (run, actor, mini-app,
environment list), `openQuestions` in the watcher state also becomes `pendingActions`, and the
labels say "waiting for input" instead of "question" (`apps/vscode/src/{store,
explorer-model,overview-model,run-model,extension}.ts`, `apps/web/src/panel/{contract,
target-state}.ts`). `pendingInputs` stayed free: it still counts waiting ActorInputs.

## Chat options remain properties set from outside (22.09.2026)

Chapters: `docs/spec/plugins.md` (Chat building blocks). Font and spacing, time formats and day
separators, code blocks, speech bubbles and senders, message actions, send key and scrolling after
sending are optional props. The owner wants to configure these options exclusively from outside;
no new settings surface is created for it. The existing default values are preserved. Editing and
re-requesting are host callbacks, so that the shared chat building blocks do not invent
product-specific journal or model operations. The jump after sending is limited locally to the
respective ChatPanel and only follows a successful, non-empty input.

## Chat width and timestamps are controllable by the host (22.09.2026)

Chapters: `docs/spec/plugins.md` (Chat building blocks), `docs/operations.md` (Run chat and work
surface). The history was limited to 760 pixels, the input to 880 pixels; answers additionally
lost eight percent of width. History and input now share their width and side margins, by default
without a maximum width. Embeddings can set both values together. The run chat gets a clock button
with a stored selection per run and primary actor. Timestamp value, change callback and visibility
of the button remain separately controllable from outside; the reusable toggle has no storage of
its own. The 120-pixel tolerance of the jump-to-end arrow only affects its visibility. It does not
change the existing detection of intentional reading back and thus prevents unwanted jumping back
during running answers.

## The run panel gets the workspace tabs as a rail on the right edge, the Network tab is dropped (21.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host: Workspace tabs, Canvas bar and actor list,
Run panel, Open limits), `docs/spec/actor-programs.md` (Actor list), `docs/operations.md` (Run
chat and work surface, Run panel and VS Code extension, Operate as an agent),
`docs/homepage/index.html` (Access paths), `apps/web/README.md`, `apps/vscode/README.md`,
`apps/vscode/CHANGELOG.md`, `scripts/homepage/homepage-extensions.ts`, `TODO.md`. Requirement: the
run panel is the working view and is to replace the web view; in VS Code, files, documents,
functions, executions and the language server diagnostics were completely missing so far, because
`ChatWorkspace` in the `panel` layout only passed on the tab ids. Of four mockup variants (A:
narrow icon bar on the right edge like VS Code's Activity Bar, B: chip row at the bottom edge like
the mini-app chips, C: drawer at the bottom edge with a handle, D: no space in the panel, tabs in
the Explorer tree and as editor tabs in the middle), A was chosen.

**The rail is part of the run panel frame, not of the orchestration plugin.** `RunPanelRail` and
`RunPanelWorkspace` live under `apps/web/src/run-panel/`; `ChatWorkspace` draws them in the branch
`layout === "panel"` to the right of and below the `RunPanel` of the canvas contribution. This way
they exist with every canvas contribution and without one (chat only), and the stage, sheet and
chat of the orchestration panel stay untouched: the tab surface is a sibling below them, the sheet
ends at its top edge. That is also why the remembered state (open tab, height) lives in a core
key, `ragents.run-panel.workspace:<runId>`, and not in the plugin's
`ragents.orchestration.run-panel:<runId>`, following the same pattern
(`createLocalStorageSetting`, strict parser, hard error). `PluginChat` still keeps ONE tab state
for both layouts; in the run panel it is fed by the stored tab, so that `navigation.openTab` and
`activeTabId` apply there just as in the web. The surface is closed until someone picks a tab, so
that every tab can carry a dot for new content; `activeTabId` is empty while the surface is closed.

**Network is gone.** The tab was the actor chat, which the run panel has long shown itself, plus
the inspection pages (inbox with routing, turn, subscription, action, artifact with diff), which
are to become reachable from the chat later. Removed are `ORCHESTRATION_TAB_ID`,
`OrchestrationInspectorPanel`, `IconOrchestration`, the history with back (`navigateFromPanel`,
`navigateBack`, `useOrchestrationController`), `tabId` and `selectionRevision` on
`CanvasContribution` and `CanvasController` together with the check "canvas tab is not
registered" and the exception in `PluginChat.openTab`, the `run-app` entity presenter of the
program plugin and the name button "open in inspector" in the actor list. What remains is the
canvas controller as the one selection on the surface: app entries of the canvas bar, tiles and
pop-outs report it, an artifact opens the documents, everything else becomes the selected tile and
the location for the global coordinator. `FlowInspector` and its tests remain for the later entry
point from the chat; until then references to its detail pages only lead to the selection (Open
limits).

## The work column is called run panel (21.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host, Run panel in the extension, Open
limits), `docs/operations.md` (Run panel and VS Code extension, Settings),
`docs/development.md`, `docs/homepage/index.html` (Access paths), `apps/web/README.md`,
`apps/vscode/README.md`, `apps/vscode/CHANGELOG.md`, `TODO.md`. The embedded run view used to be
called the work column, in code `column`: the page `column.html`, the folder
`apps/web/src/column/`, the canvas contribution `Column`, the view `ragents.column` of the
extension. Rationale: "column" only describes the shape, not the role. The run panel is the
embedded run view, in the browser as in VS Code, and is to replace the full web view in the medium
term; the name says what it shows, not how narrow it is.

**A pure rename, no behavior changes.** The page is called `run-panel.html`
(`apps/web/src/run-panel.tsx`, `src/run-panel/`), the layout value of the address is `panel`
instead of `column` (`app` remains), the canvas contribution `RunPanel` next to `Center`, the
message to the host `returnToRunPanel`; the orchestration plugin delivers it from `web/run-panel/`
(`RunPanel`, `RunPanelSettings`, `run-panel-state.ts`, `run-panel-actors.ts`). In the extension
the view is called `ragents.runPanel` (command `ragents.runPanel.focus`), the container
`ragents-run-panel`, the command `ragents.moveAppToRunPanel` and the context value `app-panel`. The
setting is called `ragents.orchestration.runPanel` with the label "Run panel". The browser keys
move along (`ragents.orchestration.run-panel:<runId>`, `ragents.orchestration.run-panel-settings`);
old values expire, course "no migrations". Unchanged are `panel.html` with `apps/web/src/panel/`
(the extension's overview and settings page without a run), `WorkspacePanel` (the web's sidebar)
and the property `Panel` of the plugin contributions (workshop tab, overview); "column" remains
where a table or grid column is meant. The earlier entries of this file keep their wording, that is
chronicle; where they name the chapter "Work column and VS Code extension", it is called "Run panel
and VS Code extension" today.

## The homepage says that agents talk to agents (21.09.2026)

Chapters: `docs/spec/overview.md` (Product homepage), `docs/homepage/index.html` (Agents),
`README.md`, `apps/vscode/README.md`, `TODO.md` (Ideas). The occasion was a look at Hermes Agent
0.21 (Pantheon): named bots in group rooms that address each other, with mentions of a specific
agent and traceable handoffs. RAgents has had that since the core: handles, `actor_input` to
exactly one participant, `agent_spawn` including fork, `event_subscribe`, every conversation as a
tile and in the journal. It just stood on the homepage as "use agents in parallel" and "pass
results on to each other", without the word addressing. The sticker is now called "Agents talk to
agents", the section explains handle, direct message, helper, fork and subscription and says that
every conversation stays visible; the two READMEs follow. What Hermes has beyond that and is
missing here is listed as an idea in `TODO.md`: costs per helper in the tool result and a schema
check for LLM answers.

## The examples leave core and get their own profile showcase (21.09.2026)

Chapters: profiles (Product profiles), plugins (Skill entries and reference cases), operations
(Choose a sample, Install locally, Work without a checkout), `ragents.config.core.ts`, new
`ragents.config.showcase.ts`, `scripts/homepage/homepage-catalog.ts`,
`scripts/package/build-package.ts`. `core` used to carry `ragents.reference`: 27 skills and 6 run
scripts, from the word game via the balcony planning to the moderated round. Whoever took `core` as
a template for a real profile got 33 start templates for free that have nothing to do with their
work.

**core is the template, the examples are teaching material.** Therefore `core` no longer names the
plugin, and the new profile `showcase` is exactly `core` plus `ragents.reference`. Nothing is
deleted: the examples remain in the repository, can be started with `./start.sh showcase` and are
still open to every own profile file as a plugin ID. Sign-in, models, relay aliases and language
servers match `core`; only the profile name, product descriptor (`ragents-showcase`) and port are
its own.

**Port 4711, not 4712.** `showcase` should be able to run next to `core`, so it needs its own port;
according to the spec, 4712 belongs to the non-startable configuration template
`ragents.config.example.ts`. So: core 4710, showcase 4711, template 4712, developer 4715, and in
dev mode plus 1000 each.

**Addendum on the same day: 4713 instead of 4711.** Port 4711 is already taken in the local
development environment. `showcase` therefore gets 4713. So: core 4710, template 4712, showcase
4713, developer 4715, and in dev mode plus 1000 each.

**The public reference comes from showcase.** The homepage catalog reads the plugin list of a
profile file statically (`showcasePluginIds`); without examples in the profile the reference would
lose its example pages and the built-in help its "Start sample" button. It is therefore generated
from `showcase`, while `core` starts lean. If a server runs with `core`, the start button in the
help stays off - it only shows what the profile offers.

## The README becomes a short English GitHub entry point, the handbook moves to docs/development.md, the homepage goes online via GitHub Pages (21.09.2026)

Chapters: `README.md`, new `docs/development.md`, `AGENTS.md`, `CLAUDE.md`, `docs/operations.md`
(Public homepage and developer reference), `scripts/package/build-package.ts` (`homepage` in the
package manifest), new `.github/workflows/homepage.yml`. The README was far too chatty for what it
is on GitHub: the first page for someone who finds the repository. In truth it was the handbook
for development and AI assistants, almost 600 lines of German, with a preamble that, like the old
homepage, had accumulated every change in operation.

**Two files, two readers.** `README.md` is now the short English entry point: what RAgents is, the
seven core features of the homepage in one sentence each, installation from npm and the
Marketplace, getting started, connecting to a central server, building from source, links,
license. Everything that stood below that before (terms, journal, structure, folders, plugins,
profiles, configuration, developing, the rules for AI assistants) is unchanged in
`docs/development.md`; only the preamble with the operating details is gone, because
`docs/operations.md` already has them. `AGENTS.md` and `CLAUDE.md` point there. The README is thus
no longer a source of rules, and it says so too.

**Draft in German, have it translated.** The English text is not written by hand: the German draft
was to be translated by a RAgents agent with GLM 5.3. That was at the same time the first use of
`ragents run` for an in-house writing job: the draft lay in a scratch folder, the run was bound to
it with `path`, the model came from the environment via `AGENT_MODEL`, `AGENT_COORDINATOR_MODEL`
and `AGENT_MODELS` (as a JSON array), and the agent produced exactly one file with `read` and
`write`. Five words were reworked. The German draft is working material and is not in the repo;
whoever changes the README writes in German again and translates the same way.

**GitHub Pages from the build.** On every push to `main`, `.github/workflows/homepage.yml` builds
the agent runtime and the homepage and publishes `docs/homepage/dist/` via `actions/deploy-pages`
at https://schlenkr.github.io/RAgents/. It is built from the sources, rather than uploading the
checked-in `dist/` folder, so the page never lags behind the code and an error in the generator
shows up in the workflow instead of on the page. README, handbook, operations documentation and
the `homepage` field of the npm package name this address. What remains to be set once in the
repository settings under Pages is the source "GitHub Actions"; until then the deploy job fails
with exactly this hint.

## The package builds its web itself, and a local profile no longer needs a checkout (21.09.2026)

Chapters: profiles (Product profiles, Server-delivered profiles), plugins (Profile distribution),
operations (Work without a checkout, Build after changes, Operate as an agent, Run panel
and VS Code extension), `scripts/package/README.md`, `apps/vscode/README.md`. The official path
used to end at one point: whoever installed `@schlenkr/ragents` and the extension could only start
profiles distributed by a server with it. An own profile with own plugins only worked from the
checkout, because the web is built per profile with Vite and Vite only lived there.

**A developer's normal case is a local profile with own plugins**, not a server-delivered one.
Therefore the package builds its web itself, with the same code the checkout calls
(`apps/server/src/web-build.ts`). Vite and the dependencies of the web build are dependencies of
the package; Vite is resolved from `apps/web` of the host folder - in the checkout from
`apps/web/node_modules`, in the package from its own. There is thus no branch "package or
checkout", but one start path with one anchor.

**It is built into the data folder, not into the package.** The result lives under
`<data folder>/web/<profile>/`, the note next to it as `<profile>.json` with host folder, profile
file and host version; if `index.html` is missing or the note does not match, it is built,
otherwise not. That is the same rule the extension previously had with `ensureWebBuilt` and its
global state, only at the place where the data folder also lives: a package folder belongs to
npm, and two profiles of the same host must not overwrite each other. `scripts/start.sh` takes the
same path and sets `WEB_DIST_DIR` to it; `apps/web/dist` remains for `pnpm build:web`.

**`ragents start` now takes a path**, not just a name: a profile of the host (`core`,
`developer`), a `ragents.config.<profile>.ts` anywhere, or a fetched version. The order is fixed,
the file name carries the profile name, and the start provisions, builds and boots. `ragents run`
stays without web and says so in its help - an agent needs no surface, and the web build would
lengthen every start by seconds.

**The extension also fetches the package for a local profile.** Without `ragents.hostPath` and
without a checkout next to it, it installs `@schlenkr/ragents` in the version listed in its own
`package.json` under `ragents.packageVersion`; a server keeps naming its version itself. The rule
"a developer connection with `profileFile` requires a checkout" is thus dropped. The field is
written along when the package is published, and publishing the extension rejects a deviation from
the most recently published package version, so the two never drift apart.

**Costs.** The package brings `vite`, `@vitejs/plugin-react` and `@tailwindcss/vite` along, plus
the web dependencies declared in `apps/web/package.json`, because the `web/` halves of foreign
plugins build against the host's web and otherwise choke on `dompurify` and the like. The archive
barely grows: 773 to 780 files, 4.20 to 4.22 MB unpacked, 1.06 MB packed. The price is paid in the
installation, which goes from 43 to 47 direct dependencies and thus from 244 to 283 MB under
`node_modules`. In return no developer needs pnpm anymore, and a first start costs about two to ten
seconds of build once per profile. The help (`/help`) stays out of the package build: it comes
from `docs/homepage/dist` at about 12 MB, a multiple of the whole package.

## The panel overview is a surface with tiles, the environment is called environment, and a click is a click (21.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host, Work column in the extension, Start
selection), `apps/vscode/README.md`. Draft A from `docs/ui-drafts/panel-overview-2026-09-21.html`,
revised in `-v2.html`, with the owner's changes. The card per target, the chip row for filtering
and the problem banners above it are gone.

**"Environment" instead of "target", everywhere someone reads it.** Headings, buttons, error
messages, command titles, the settings explanation and the README say environment; in the code the
types `Target*` may stay, because renaming the contract explains nothing the text does not already
say. Reason: "target" has a second meaning in a workshop full of runs and tasks, "environment"
does not.

**The overview is draft A without filters: environments, runs, start templates on one surface.**
The environments stand as flat rows with a state dot; only an environment with a problem carries a
button (Sign in, Retry, Start, Connect), Disconnect and Stop belong in the settings. Below that the
runs of all environments as one list by time, below that the templates as a tile grid with search
and category groups. Reason: one surface instead of one card per environment shows four times as
much at 420 pixels, and the filter was a control that only made the same list smaller.

**No `ListDetail` for the tiles.** It has measured itself since 19.09.2026 and would turn into a
list with a detail page at 420 pixels; then every start would be two clicks again. The grid is
`repeat(auto-fill, minmax(182px, 1fr))` - two columns at 420, four at 900 -, shape and tone (skill
round and `--primary`, run script square and `--success`) come from `ListDetail`, so that both
start surfaces speak the same language.

**The environment stands as a muted line above the title, plus a color edge.** The options were
groups per environment, a pure color edge and a prefix in the title. With two environments, groups
would have told the whole catalog twice and cost twice as many headings; a prefix costs title
width exactly where it is scarcest; a color alone is not a name. The separate line costs nothing
of the title, stays readable and keeps the structure the same, whether there is one environment or
five. The color comes from a hash of the name, not from the order, so it stays put when resorting.
With exactly one environment - the everyday case with `core` - both line and edge are dropped, and
the "Environments" section shrinks to its one row.

**A click means a click.** A tile creates the run on its environment, starts it and opens the work
column on the running run; a run script via `ragents.chat.start` with the start value `null`, a
skill via `ragents.chat.send` with its prepared task. The tile "New run" opens an empty run whose
task takes shape in the column's chat. Reason: the path was overview, New run, New run, template,
run - four clicks for something the overview had already fully described.

**This drops the column's start selection in the panel case.** `StartSurface` remains for the
browser (`host !== "vscode"`); in the `vscode` host the column starts the entry itself
(`RunLaunch`) and meanwhile only shows a loading hint and, if it goes wrong, the reason. A run
script's guide is skipped in the process - `null` is the documented way to take its defaults.
Reason: two start selections in a row are not a selection but a question without a question.

**Dialogs instead of inline forms in the settings.** The page is a list of rows; "New environment"
and "Edit" open the same dialog, "Sign in" a second one, from the overview as from the settings.
Editing is an action of its own (`updateServer`, `updateProfile`) that replaces the entry in place
in `ragents.connections`; removing and re-creating would have lost the stored sign-in data. Reason:
three expanded forms one below the other were longer at 400 pixels than the list they were about.

**`TargetEntry` carries `kind` and `category`, a run script may name a category.** The tile groups
need a category per entry; skills had one, run scripts did not. The server contract received it
additively (`category` in `RUN.md`, optional); without a category a run script still stands under
"Run scripts" - in the tile view as in `StartSurface`.

## The column stays in the iframe and gets the clipboard via the shell (21.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host, Work column in the extension),
`apps/vscode/README.md`. The owner dictates with Hex. In the Copilot chat and in the web surface in
the browser the text arrived, in the input field of the work column in the extension it did not,
although typing works there.

**The cause lies neither with Hex nor with the accessibility features.** Hex writes the text to the
clipboard and sends a simulated Cmd+V (`Hex/Clients/PasteboardClient.swift`, `pasteWithClipboard`
and `postCmdV`); the path via the accessibility features does stand behind it as a third strategy,
but is never reached, because `postCmdV` blindly reports `true`. On macOS no program generates the
paste command itself: AppKit delivers it via the application's menu. VS Code has no menu item with
the role `paste` for this, but intercepts the keystroke in the webview
(`webview/browser/pre/index.html`, `handleInnerKeydown`) and then sends the command back to the
webview's document as `execCommand("paste")`. `execCommand` only acts in its own document. An
iframe of foreign origin never gets it - neither the intercepted keystroke nor the command
delivered afterwards. Measured in a separate VS Code instance: the same textarea directly in the
webview accepts the paste, in the nested iframe nothing happens; with the command AppKit would
deliver, it accepts it there too. Both are confirmed with Hex. The same holds for copy and cut,
which were thus dead as well.

**The fix sits in the shell, not in a rebuild.** The column executes the three commands itself in
the `vscode` host (`apps/web/src/column/clipboard.ts`): it can copy and cut on its own, because it
may write to the clipboard from a real key gesture. It may not read - `clipboard-read` is denied in
an iframe of foreign origin, but granted in the webview's document. The shell therefore reads the
text for it and sends it back (`clipboardRead`, `clipboardText`); the extension sees nothing of
this. Pasting uses `execCommand("insertText")`, so that the input gets a real `input` event and
React, the caret and undo are right.

**This drops the separate webview bundle.** Rebuilding the column as its own bundle in the webview was in the TODO for
exactly this case. It stays unbuilt, because it does not carry the finding better than sixty
lines: the column bundles the web parts of its server's plugins and is built per profile, a bundle
in the extension could not contain them. It would therefore still have to come from the server,
just without an iframe - with CORS for changing `vscode-webview:` origins, an absolute base URL in
every fetch, asset resolution at runtime and an opened CSP. That is many times the surface for the
same result. The iframe also remains for the mini-app tabs, which use the same shell and get the
bridge along.

## Language servers: one instance per run AND root instead of per run (21.09.2026)

Chapters: `docs/spec/plugins.md` (Language server plugins). Until now there was exactly one
language server per run and language: a second `roslyn_open` with a different root silently
replaced the first. That is exactly the kind of silent surprise an agent does not notice - it opens
the second solution, gets a success message and then queries diagnostics of the first, which no
longer exist. And it does not fit the work at hand: a repository often has several solutions, and
a change to the shared library is something you want to check in both at the same time, without
loading back and forth between them.

The key is therefore run plus root. `<id>_open` starts an instance for exactly this root if it does
not exist yet, and leaves the others standing; for the same root the call stays idempotent. The
return value names the root and the number of open instances, so the model knows what it is
working with without a second query. There is deliberately NO branch "one or several": the host
keeps `Map<runId + "\n" + root, ServerEntry>` plus the remembered roots per run, and every path -
idle, error state, stop, shutdown - goes through the same key.

Choosing the instance is the same rule everywhere, not three: the longest root prefix. Without
`paths` the diagnostics ask every open instance with its own `git status -- .` in its root; with
`paths` each file is answered by the instance whose root contains it; the annotation after
`edit`/`write` makes the same choice and stays silent if no instance fits. A file outside every
open root is a named error that names the open roots, instead of silently asking the wrong
instance. For this, every adapter now knows `rootDirectory` next to `resolveRoot`: Roslyn and FSAC
get a project file, TypeScript a folder, and the host needs the folder for the prefix - a statement
from the adapter instead of a `stat` in the host.

New is `<id>_close(root?)`, because replacing has disappeared as a cleanup path: end one instance
specifically, without `root` all of the run's. The 20-minute idle timeout still applies per
instance, run end and shutdown end all of them. The diagnostics tab's snapshot is thus a list of
instances with root, state and summary instead of a single state; the `closed` state is dropped, a
run without instances has an empty list. The tab shows one card per instance, the badge counts the
errors of all instances together.

## Homepage: three levels per core feature, distributed work and the three access paths as core features (21.09.2026)

Chapters: `docs/spec/overview.md` (Product homepage), `docs/spec/core.md` and
`docs/spec/plugins.md` (Open limits), `docs/operations.md` (Guide markers `clients` and
`distributed`, Run chat and work surface, Switch runs), README (For AI assistants),
`docs/homepage/index.html`, `scripts/homepage/homepage-guide.ts`, new
`scripts/homepage/homepage-structure.ts`. The owner wanted the construction of the homepage, which
until now was only practiced, recorded: a sticker in the intro, a section on the main page, a
chapter in the guide. And he wanted to lift two things onto these levels that were only side
clauses on the page so far: distributed operation (host at the developer, profile and models from
the server, tools at the project, run transfer) and the three access paths web, VS Code and
console, whose extension and npm package were published today.

**The rule is checkable, not just described.** A section carries `data-core-feature`, a sticker
`data-sticker` with the section's anchor. When generating and checking, `assertHomepageStructure`
requires the bijection between stickers and sections, per section a link to an existing guide
chapter, and at most two lines per sticker. A sticker without a section or a capability without a
guide chapter thus shows up in the build, not only when reading. That was the simplest form in
which the rule is more than a sentence in the README that agents take literally or overlook.

**The workspace merges into the section "Working distributed".** The one contract for the run
folder is exactly the mechanism that makes distribution possible; a separate sticker next to it
would have told the same thing twice. Seven stickers remain. The function diagram shows server,
host and project folder with the three connections fetching the profile, model call and moving
the run.

**The main page is slimmed down.** The section on the surface had 1700 words, two paragraphs of
which were an operating log (copy icon, scroll space, pixel widths, canvas checkbox); rule 6 of the
README ("bring the homepage along in the same commit") had led agents to append every UI change
there. What of it was not already in `docs/operations.md` is now there (Run chat and work surface,
Switch runs); the main page says one sentence per capability and refers to the guide. The same
for mini-apps, journal, start and plugins. Rule 6 now says this explicitly. With the removal of
the free canvas, the last sentence that still denied it has also disappeared.

**Two guide chapters from the operations documentation.** `clients` takes over work column and
extension (operation, installation, sign-in; not publishing and development), Operate as an
agent and Drive runs from outside. `distributed` takes over Work without a checkout (without
the publish part), Connect to a server, Transfer a run and Work on Windows. For this, the
example hosts in the operations documentation are neutral (`ragents.example.com`,
`/path/to/project`), because the exclusion rule rejects private names and paths on the public
pages. The chapters are in the guide group Trying out, after Starting samples.

**Four concept files with status "Built" are dissolved**, as the README requires:
`docs/concepts/remote-profile.md`, `host-distribution.md`, `run-transfer.md` and
`workspace-tools-proxy.md`. Their what is in `profiles.md` (Server-delivered profiles),
`plugins.md` (Model relay, Profile distribution, Workspace, Provisioning) and `core.md` (Moving a
run to another server), their why in the entries from 19 to 21.09.2026 here. What was still
missing within their boundaries is now in the Open limits: quotas and two developers on one
machine (relay), partial results on connection loss (workstation), fetched versions without
cleanup (extension), no built web for profiles shipped with the package, as well as host commit
and `DOCUMENTS_DIR` when moving. Older entries here still name the files as the place of the plan
at the time; that is chronicle and stays.

## The work column gets a third view "Chat only" (21.09.2026)

Chapters: `docs/spec/plugins.md` (Work column, Open limits), `docs/operations.md` (Work column
and VS Code extension), `docs/homepage/index.html` (Surface). The sheet remains right as long as
you want to keep the mini-app in view: it slides up when the mouse is over it, and back down again.
In the VS Code extension, however, the column sits alongside for hours, and there the chat should
be calm and pinned, without sliding in and out. Instead of rebuilding the sheet for this, a third
view is added: "Chat only" next to "Chat below" and "Chat right", switched via a segment group at
the top of the column header, visible as soon as a mini-app is selected. Like the other column
values, the choice is stored per run in the browser; the earlier values `auto`, `floating` and
`docked` map onto today's, any other value is a hard error.

In "Chat only" the stage is torn down, not hidden. That is the simpler rule: one branch less in the
sheet mechanics and no invisible frame that keeps running. The price is stated in the spec: the
mini-app's transient state does not survive the switch; the journaled state comes back by itself
when switching back. In the extension this is the obvious combination anyway: the app as an editor
tab in the middle, the column next to it only as a chat.

In the process the spec was brought in line with the code: `closeDelay` is at 150 milliseconds,
not 450, and the 220 milliseconds after focus loss were not written down anywhere until now.

## The free canvas is removed, the tile surface remains (21.09.2026)

Chapters: `docs/spec/plugins.md` (Web as plugin host, Open limits),
`docs/spec/actor-programs.md` (Tool cards and tiles, Tile host and functions tab),
`docs/spec/typescript-platform.md`, `docs/spec/overview.md`, `docs/spec/core.md`,
`docs/spec/profiles.md`, `docs/operations.md` (Use the tile surface, Run chat and work surface,
Settings), `README.md`, `docs/homepage/index.html` and the wording in `docs/concepts/`. Work now
happens only in the tile view. The free surface next to it was the largest single item of the web
code: camera, its own measure/arrange engine with seven layout groups, shapes, lines with label
spacing, resize handles, collapsing, overview mode and arrow-key navigation, together about 3500
lines of code and tests. None of it carried anything for the daily work, which happens in tiles
and in the work column. So melt it down instead of expanding it: a run's work surface is the tile
surface, there is no mode anymore, no pan, no zoom and no camera.

The tool contract becomes lean as a result. `canvas_layout_replace` only has `root`, replaces the
state completely and checks depth, count, unique participants and weights in one place. The run
coordinator gets its own short prompt for this, the global one only passes on layout wishes. What
a model can get wrong has thus shrunk to one parameter.

Nothing is migrated. The personal arrangement lives under a new browser key, the old entries are
orphaned. A program state with `nodes`, `shapes`, `lines` or `mode` is rejected on read and names
the keys found; the run continues with the derived start layout, and a single tool call sets it
straight again. Silent tolerance for legacy states would have softened the check again, to serve a
case that exists twice here.

Two things fell along with it: the layered-work depth only made sense on the free cards, tiles
have none, so the depth levels disappear from the settings and the style remains as a look - matte
surfaces, straight outlines, 17 pixels radius, headers darkened by four percent. And the three
reference skills 120, 130 and 140 demonstrated exclusively free layouts; they are deleted, and in
their place the concept catalog has the concept "Tile surface" with two usage examples. A skill
entry that demonstrates the layout tool is missing and is listed in `TODO.md`.

## The executor resolves the TypeScript server only on call, from the host folder (21.09.2026)

Chapters: `docs/spec/plugins.md` (Language server plugins),
`docs/concepts/workspace-tools-proxy.md` (Constraints). The installed `.vsix` got stuck on
activation: "Cannot find module 'typescript-language-server/lib/cli.mjs'". The executor's
TypeScript adapter resolved the language server when loading the module
(`createRequire(import.meta.url).resolve(...)` as a constant in
`packages/workspace-executor/src/language-server/adapters/typescript.ts`). The `.vsix` is
deliberately packed without `node_modules`, and the bundle pulls the executor in on activation; in
the checkout and in the host test this never showed up, because `node_modules` lie next to it
there.

Two rules instead of one exception. First: no module of the executor resolves anything, downloads
anything or looks at the disk on import. Roslyn and FSAC already did it right, their `serverPath()`
runs in `launch`; TypeScript now does too, and `typescript_open` fails there with a cause instead
of taking the whole extension down with it. Second: where the TypeScript server comes from is a
parameter, not a branch. Symmetrically to the tool folder of Roslyn and FSAC, the run's context
carries a `hostRoot`, from which `createRequire(<hostRoot>/package.json)` resolves. Every caller
sets the value: the server and `pnpm workspace-client` their own root (`hostRoot()`), the extension
`ragents.hostPath` or the host it last started (`ragents.lastHostPath`, the fetched package under
`<globalStorage>/hosts/<version>/`). If the extension does not know a host yet, only TypeScript is
missing; overview, settings and connecting work.

A test that did not exist would have caught this: `apps/vscode/tests/extension-bundle.test.ts`
builds `dist/extension.js`, copies it into an empty temp folder without `node_modules` and calls
`activate` there in a child process with a stub `vscode`. In addition, the host test in real VS
Code takes the packed file instead of the checkout with `RAGENTS_HOST_TEST_VSIX=<path>`:
`launch.mjs` unpacks it and uses `extension/` as `--extensionDevelopmentPath`.

## The VS Code extension goes into the Marketplace via its own script (21.09.2026)

Chapters: operations (Work column and VS Code extension). The extension was `private` and only got
onto a machine as a self-packed `.vsix`. It goes into the Marketplace as
`schlenkr.ragents-vscode`, and the path there is `pnpm publish:vscode` following the same pattern
as `publish:package`: the token only in the child process's environment (`VSCE_PAT` from
`AZURE_DEVOPS_VSCE_RAGENTS_PAT`), every output through a mask, every error message one line, no
confirmation after publishing. Checked before building: `vsce verify-pat schlenkr` and
`vsce show schlenkr.ragents-vscode --json` against the version, so that a second run with the same
version fails at the check and not at the Marketplace. Addendum on the same day: the publisher is
called `purestate`, not `schlenkr` - that is how it is set up in the Marketplace, and only for it
does `vsce verify-pat` pass; the extension is thus called `purestate.ragents-vscode`. The npm scope
remains `@schlenkr`, unaffected by this: Marketplace and npm are separate namespaces.

The extension's version remains a number of its own in `apps/vscode/package.json`; tying it to the
root's `version` would mean always publishing the npm package and the extension together, although
they have something new at different frequencies. Addendum on the same day: it is no longer bumped
by hand. `pnpm publish:vscode` asks `vsce show` for the published versions, increments the last
digit of the highest one and writes it into `package.json` before packing - one step instead of
two, and no publish fails anymore because of a forgotten bump. If a higher version than the
published one is already there, the file wins; manual work thus remains exactly for minor and
major. The dry run names the version and writes nothing. The same path applies to the npm package
(see the entry on it), and the task `publish: all` does both one after the other. `vsce` comes via
`pnpm dlx @vscode/vsce@4.0.0` instead of as a devDependency: a fixed version is enough for
reproducibility, and the tool does not belong in the dependencies of the extension, which is packed
without `node_modules`.

`.vscodeignore` is an allowlist (`**` and exceptions), because `vsce` always lets exceptions win: a
`!dist/**` also brings the sourcemap and the test runner back in, which is why
`dist/extension.js` and `dist/webview/**` are listed individually. This turns 14 files and 3.2 MB
into 12 and 1.2 MB. `vsce` only takes the `LICENSE` from the extension's folder; the script copies
the root's one next to it for the run and removes it again afterwards, instead of keeping a second
copy in the repository.

## PolyForm Shield 1.0.0 as the license, metadata and README in the npm package (21.09.2026)

Chapters: README (License), `docs/concepts/host-distribution.md` (Boundaries). Before the first
real publish of `@purestate/ragents`, a license, metadata and a README for the npm listing were
missing. The PolyForm Shield License 1.0.0 was chosen; the text is in `LICENSE` verbatim, above it
the `Required Notice` line provided by PolyForm with the rights holder.

**Why Shield.** The three things that should apply are exactly the three things Shield says: a
company may use and operate RAgents, also commercially and also for its own customers without
further ado; it may change and redistribute it; it may not turn it into a product or service that
competes with RAgents. That hits the case at hand - someone takes the host, attaches their own
profile and sells it as their workshop. Shield draws this boundary narrowly around competition and
leaves everything else free; a clause that specifically forbids resale is not needed alongside.

**Why not FSL.** The Functional Source License states the same competition boundary, but lets it
fall to Apache 2.0 or MIT after two years per version. An expiry is a decision about a future
nobody knows, and it makes the license need explaining: every version would have its own date.
Without expiry the statement stays the same across all versions.

**Why not PolyForm Noncommercial.** It forbids exactly what should be allowed. The expected user is
a developer in a company who operates RAgents on company machines; that is commercial use and would
be a license violation under Noncommercial, although it competes with nobody.

**What goes into the package.** `build-package.ts` copies `LICENSE` and `scripts/package/README.md`
to the root of the package (there as `README.md`, the source does not additionally appear under
`scripts/package/`) and writes `license: "PolyForm-Shield-1.0.0"` as the SPDX identifier,
`author`, `repository`, `homepage`, `bugs` and `keywords` into the generated `package.json`. The
same three fields `license`, `author` and `repository` are in the root `package.json` and in
`apps/vscode/package.json`; the root stays `private`, the extension no longer does (see the entry on
the Marketplace). The package README is English like the listing and names installation, the
eight subcommands with one example each, the prerequisites and the license; the documentation
itself stays in the repository, the package only refers to it.

## Four commands for an agent: `ragents run` waits, `developer` becomes a profile of the repo (21.09.2026)

Chapters: profiles (Product profiles), operations (Operate as an agent, Work without a
checkout), `docs/concepts/host-distribution.md`, README, `skills-for-agents/ragents/SKILL.md`. The
goal was that a foreign AI agent - for example Claude Code - starts RAgents on the same machine and
has it program a project, in a few commands and with an instruction it loads.

**Why a separate command facade and not `pnpm driver`.** The driver is a test tool and not a client
in the sense of this architecture (entry on remote operation from 19.09.2026); it fires and returns
immediately. An agent needs three things it does not have: **waiting** until the turn is over,
**bookkeeping** in the form of an exit code, and a **stable contract** that costs little context.
Hence `ragents run`, `send`, `journal`, `stop` - four commands, one fixed output shape, the last
line always `run: <id>`. Exit code `0` on `turn.finished` with `outcome: "completed"`, `2` on
`turn.interrupted`, `1` on a failed turn or a connection problem. The driver remains the test tool,
unchanged; both share the journal evaluation via `scripts/agent/journal.ts`, and `run-driver.ts`
has been switched over to it.

**Binding `path`, not `client`.** The server runs on the same machine as the project, so there is
nothing to proxy: `ragents.startOptions.select` with `{ kind: "path", path }` before the first
message. A workstation client would be a second process, a second sign-in and a round trip with no
return.

**It waits for exactly its own turn.** The message lands in the journal as `actor.input.enqueued`
with the sent text as `content`; through it the command finds `inputId`, then the `turn.started`
with this `inputId` and finally its end. This holds for a new run as for a follow-up task and needs
no knowledge of the primary actor. The journal is read continuously from
`<data folder>/runs/<runId>/journal.jsonl` from the last byte offset, not via
`ragents.runs.events`: same machine, and refetching the whole journal on every event would be
quadratic with large tool outputs. The price is a latency of 400 milliseconds and the tie to the
same machine - exactly the assumption the `path` binding also rests on.

**The host is started, but never guessed.** `run` checks `GET /health` like
`scripts/start-vscode.sh`, otherwise starts `apps/server/src/main.ts` detached (`detached`, log
under `<data folder>/host.log`) and records address and PID in `<data folder>/host.json`.
`ragents stop --host` ends exactly this PID, never a process pattern. It starts the server directly
and not `scripts/start.sh`, because the same path must apply in the package and in the checkout
(decision 7 in `host-distribution.md`); in exchange this host builds no web.

**`developer` becomes a profile of the repository.** It lay as
`selftest/ragents.config.developer.ts` next to the test helper, so that the assertion about the
profiles of the public repo holds (20.09.2026). A programming profile is, however, just as neutral
as `core` and is now the default profile of the agent commands; the assertion in
`start-script.test.ts` therefore reads `["core", "developer"]`. Its key is called
`OPENROUTER_API_KEY`, because `env(...)` deliberately knows no fallback - a missing value is a hard
start error with a cause, not a silent second attempt. Both profiles go into the package, and
`ragents start <profile>` boots a profile of the host before it looks in the cache of fetched
versions. An ad-hoc profile is a copy of this file; there is no generator, because a profile file
is already the simplest form of itself.

**Addendum 21.09.2026: the same profile for all commands, including sign-in.** The core case "start
RAgents with an external profile and implement work item 1234" failed in four places, all with the
same cause: the facade only knew a profile as a name next to the host. `--profile` now takes a
name **or** a path and uses the same function for it as `ragents start` (`localProfile` in
`apps/server/src/profile-target.ts`, plus `selectProfileTarget` for port and data folder); there is
no second resolution path anymore, and `RAGENTS_PROFILE` sets the same for a whole shell. The
`host.json` record was moved to `apps/server/src/host-record.ts`, because both start paths write
it: `ragents run` for its detached host and `ragents start` for its foreground process (`noteHost`
in `scripts/remote/connect.ts`, cleaned up again at the end). This way `stop --host --profile
<profile|path>` hits both equally; only `--port 0` cannot be remembered, because the port is only
determined during the run. `ragents --help` and `ragents help` show the usage with exit 0 - the
`.mjs` facade previously filtered them out as an unknown command -, without an argument it stays
exit 1.

Sign-in takes the same path as with `connect`: a profile with `users` requires in `RAGENTS_TOKEN`
the personal token of the user, which the profile names as `token: env("...")`. A sign-in dialog
belongs in the surface, not in a facade for agents, and a password in an environment variable
would be the worse trade. A missing `env` is no longer a start error here: without the variable
set, the user has no token and keeps signing in with their password - otherwise an external
profile could not start on another machine where `RAGENTS_TOKEN` is missing. On `401` the facade
does not name the server response alone, but the way forward: "The profile requires sign-in; set
RAGENTS_TOKEN to your user's personal token".

Two things came up during the real run-through with an external profile and are solved along with
it. A profile without `ragents.workspace` does not know the start option
`ragents.workspace.binding`; `run` therefore first asks `ragents.startOptions.list` and only binds
if the option exists - otherwise it says on stderr that the folder stays unbound, instead of not
creating the run at all. And a run script only determines its chat partner during the run
(`run_configure` with `primaryActor`); until then the server rejects the first message with
`actor-chat-unsupported`. `run --entry` waits for it instead of failing on it - for one minute, at
the same interval as the journal.

## The extension no longer knows an active connection: all targets at once, one overview in front (21.09.2026)

Chapters: plugins (Web as plugin host), operations (Work column and VS Code extension),
`apps/vscode/README.md`. What was wanted was no longer a staged flow: choose a server, sign in,
then runs. Instead, a settings page for servers and local profiles and, in front of it, a merged
overview of what runs where, across all targets, with the new run started from there.

**All configured targets at once.** `extension.ts` keeps a map from target to session instead of
one session; every server entry connects by itself on activation, every session has its
connection, its store, its workstation client and, for a local profile, its host
(`src/sessions.ts`). A target that requires sign-in or does not answer only changes its own state;
the others keep working. This drops `ragents.chooseConnection`, the active connection in the
global state and the status bar "active connection" - it now counts the connected targets and
opens the overview with one click. The workstation client of this window registers with every
connected server under the same id; the `client` binding remains the path for new runs, no matter
on which target.

**Local profiles on demand.** An entry with `profileFile` appears as "not started" in the
overview; the host only starts when a run is created there or someone chooses "Start", and runs
until the end of the VS Code session or until "Stop". Its start templates only come after the
start: an entry comes into being with the registered plugins, not from the profile file. Offline,
the `skills/` and `run-scripts/` of the plugin folders could be read, but that would be a second,
incomplete source - the entries registered in code would be missing - and would need set
`PRODUCT_*` variables just to show a list. One source is better than half a one.

**The overview is the aggregation, not another step.** Without a selected run, the panel shows one
card per target with state, its runs, "New run" and its start templates; a template opens the
start selection directly with this entry (`newRun` carries an `entryId` for this, and
`StartSurface` now accepts it for skills as for run scripts). The settings page next to it creates
servers **and** local profiles, removes them and keeps the sign-in data per server; until now
`profileFile` only worked via `settings.json`. Both pages are one entry point of the web app
(`panel.html`, `apps/web/src/panel/`, built with `pnpm build:panel`) that runs without a server;
it replaces the connection page. The work column remains what it was: the run keeps running in the
iframe of its own server, with its web and its token.

**Not `ListDetail`.** The start selection uses it rightly, but in the panel the surface is about
400 pixels wide; there it turns into a list with a detail page, and every run would need two
clicks instead of one. The overview is therefore one card per target made from the same UI
building blocks (`Card`, `Button`, `Input`), and the templates stand below it, expandable.

**Commands are distributed.** `ragents.newRun` asks for target and template in a QuickPick,
grouped by target; `Stop run`, `Sign out`, `Disconnect` and `Connect` take the target of the
selected run, otherwise the only fitting one, otherwise they ask. The decision about this is a pure
function (`resolveTarget`, `newRunChoices` in `src/overview-model.ts`), so that it can be checked
without VS Code; the same holds for the overview itself and for the Explorer, which shows the
targets as groups with their runs. The host test got a third path: two servers at once, a new run
with the `client` binding on the second, and a disconnect that only affects one of the two.

Noticed along the way: `typescript_diagnostics` without `paths` checks the files changed according
to Git. Since `selftest/workspace-project` is checked in, the deliberately broken `src/broken.ts`
no longer shows up there; the host test now checks the file the run itself changed.

## The package is called `@purestate/ragents`, one source for the version, and the extension fetches it itself (21.09.2026)

Chapters: profiles (Server-delivered profiles), plugins (Profile distribution), operations (Work
without a checkout, Connect to a server, Work column and VS Code extension),
`apps/vscode/README.md`; concept `docs/concepts/host-distribution.md`. The package from
20.09.2026 was built but unpublished: name, version scheme and the path to the user were still
open. Now it goes public on npm.

**The name `ragents` is taken**, so the package gets the sender's scope: `@purestate/ragents`. The
command is still called `ragents` - the `bin` entry does not depend on the package name, and in
the `PATH` the short name is the right one. A scoped package is private by default on npm, which
is why the generated manifest carries `publishConfig.access: "public"`; that is in the package
instead of on the command line, because otherwise a forgotten `--access` would be a private
publication. Addendum on the same day: the scope is `@schlenkr`, not `@purestate` - the
organization `purestate` does not exist on npm, and the user scope is the one the token may write
to anyway; the package is thus called `@schlenkr/ragents`.

**One source for the version**: the `version` field in the root's `package.json`. The build takes
it over, the distributing server names it (`packageVersion` in `ragents.profile.describe`), and it
is bumped by hand, one line. No automatic bump: only a human knows whether a change is worth a new
version. Addendum on the same day: publishing has become one step, and the version is part of it.
`pnpm publish:package` asks `npm view` for the published versions, increments the last digit of
the highest one and writes it into the root's `package.json` before building - the human decides
with the call that there is a new version and does not also have to change the line themselves; a
forgotten bump and the abort caused by it are gone. If the file already has a higher version than
the published one, the file wins: minor and major remain manual work, the last digit does not. Only
the line with `version` is written, the dry run only computes the version. The truth about the
exact state remains the commit in `ragents.hostVersion`; the version is what a developer installs.
That is exactly why the server names it: on a mismatch, `connect` no longer says "fetch the
matching version", but `npm install -g @purestate/ragents@<version>`. `pnpm publish:package`
builds, checks and publishes; it rejects a version that is already on npm and names the line to
change. The token comes from `npm_key` and only goes as a registry key into the environment of the
`npm` child process - not onto the command line, not into a file, and every output of npm runs
through a mask.

**The extension fetches the host itself.** A published `.vsix` runs from no checkout and would be
useless without a host. If `ragents.hostPath` is empty and there is no host next to the extension,
it installs the package into its own storage (`<globalStorage>/hosts/<package version>`, one
folder per version) - in the version the server names, with the `npm` from the `PATH`. After that
it is the same start as always: the start code only sees a different `hostPath`, there is no second
path. Without a server nobody knows which version would be right; a developer connection with
`profileFile` therefore still depends on a checkout, and that is recorded as a limit. Fetched
versions stay where they are: cleaning up would need the question of which version is still in
use, and that only arises once there are more than a handful.

## The host becomes an npm package: only Node at the developer, the server builds the web (20.09.2026)

Chapters: profiles (Server-delivered profiles), plugins (Profile distribution, Open limits),
operations (Work without a checkout, Connect to a server, Build after changes, Work on Windows),
`apps/vscode/README.md`; concept `docs/concepts/host-distribution.md`. Package 9 from
`remote-profile.md` was the last open line there: a developer should only need Node. Until now
`connect` required a Git checkout at exactly the server's commit, with pnpm, `pnpm install`,
`pnpm build:agent` and a web build per profile.

**The package has the shape of the repository.** `apps/server/src`, `apps/web/src`,
`packages/*/src`, `plugins/*`, `scripts/*` - the same folders in the same places. In many places
the host computes from its own file to the root (`hostRoot`, `pluginsRoot`, `WEB_DIST_DIR`, the
`createRequire` anchors of the actor programs); if the package keeps the shape, each of these paths
stays correct and there is no second case in the code. What makes up the package is its selection
alone: no tests, no documentation, no extension, no `node_modules`.

**Built means selected, not compiled.** The server loads `.ts` at runtime: the profile file, every
plugin, the plugins from the server's archive, the compiler worker. A bundle would have to give up
this rule; instead the package brings `tsx` along and starts like the checkout with
`node --import tsx apps/server/src/main.ts`. Profiles stay `.ts` and are not precompiled. This had
to cost two things: the resolve hook `host-resolution-hooks` is now JavaScript, because Node loads
it in the loader thread and does not strip types under `node_modules` there; and the fetched
profile version gets a `package.json` with `type: "module"`, because Node reads a `.ts` file
without this marker as CommonJS, and then neither the hook nor the `@aicontainer/*` links take
effect. Both are the same rule in the checkout as in the package.

**The web comes from the server, per profile.** A web build depends on the profile's plugin set,
and plugins from the archive bring their own `web/` parts. Therefore the distributing server builds
the web of its client profile itself and puts it under `web/` into the archive; `connect` sets
`WEB_DIST_DIR` to it. The archive's version thus also covers the web. The plugin list for this
build comes from the same check that packs the archive (`PLUGIN_LIST_FILE`), not from loading the
profile file a second time: its `env(...)` are not set on the server. The price is recorded as a
limit: a distributing server needs Vite and builds once on every start.

**The host commit comparison becomes the comparison of the package version.** The package carries
the commit it was built from in its own `package.json` (`ragents.hostVersion`); `readHostVersion`
reads it there and otherwise from `.git`. The check stays the same and stays hard, only the advice
differs: `git checkout` for the checkout, "fetch the matching version" for the package.

**One `bin` with four subcommands** (`connect`, `start`, `provision`, `workspace-client`), because
four names in the `PATH` would be four paths. Each starts the same file that `pnpm connect`,
`pnpm provision` and `pnpm workspace-client` also start; `ragents start <profile>` boots an already
fetched version without asking the server, which `connect` has noted as `current.json`. This takes
pnpm out of the start path: `connect` calls provisioning and server as
`node --import tsx <script>`, and the web build is dropped entirely.

**The extension does not distinguish package and checkout.** `ragents.hostPath` points to either,
the marker is `package.json` next to `apps/server/src/main.ts`, the start command is the same.
Only a developer connection with `profileFile` still builds a web, because no server delivers one
there; that is the checkout path and stays so.

**The build determines the dependencies from the code**, not from a maintained list: from the
imports of the included files (also `require.resolve` and `@import` of the CSS files) plus the
libraries that the actor programs link into their workspace at runtime (`runtimeLibraries`, now a
file of its own, so that plugin and build read the same truth). Every version is pinned to the one
installed in the checkout; a name without a version aborts the build. The checkout keeps individual
packages in two versions side by side (`typebox`, `@types/node`), the package names one of them
and the build says which - that is recorded as a limit.

## A run moves as an archive: same host version, same id, replay as after a restart (20.09.2026)

Chapters: core (Moving a run to another server, Open limits), operations (Transfer a run, Data
storage and logs); concept `docs/concepts/run-transfer.md`. The item "run transfer between servers" was a
later line in `remote-profile.md` with three open questions. They are now decided, each in the
direction of the simplest solution that holds.

A run is its journal plus the files the journal does not contain, and both already live in
exactly two places today: `runs/<id>` and `sessions/<id>`. The transfer packs these two folders
and a manifest into a `tar.gz`; it needs no more knowledge about the content. This way model
contexts, actor programs, the file storage of `ragents.documents` and the working directory of the
`fresh` binding move along without a rule of their own, because they all live under
`sessions/<id>/plugins/<plugin-id>/`. On the target, `Journal.adopt` enters the records and
rewrites the payloads from the contents read; after that the server resolves the workspace and
opens the session - the same steps its start takes for every run. There is no second load path
that could go stale.

**Absolute paths in the journal** stay as they are. The journal is immutable, and the paths in
`tool.call.*` are history: replay calls neither models nor tools again, so nobody resolves them
again. Only the workspace is resolved anew, and it comes from the target's session storage, not
from the journal. The price is recorded as a limit in the chapter: the model still sees the
source's paths in its context and fails at the workspace boundary if it picks them up again;
relative paths and the system prompt rebuilt per turn carry the rest.

**The `path` binding** has no folder on the target. The import rejects it, unless the caller names
a replacement folder; then it appends a new `plugin.state-replaced` with the new binding to the
journal instead of rewriting an old event. The start option is stored as plugin state anyway, so
this is not a special path, but the same path once more. `fresh` moves with its server folder,
`client` stays `client`. The server does not know the binding itself: for this, `WorkspaceRuntime`
got the facet `transfer` with `boundDirectory`, `assertDirectory` and `rebind`, which the plugin
`ragents.workspace` answers.

**The artifact storage** no longer needed a decision of its own once the whole session storage
moves along. A storage that a profile deliberately places outside with `DOCUMENTS_DIR` stays
behind; that is recorded as a limit.

In addition, four decisions that prevent damage. The manifest carries the host commit and executor
version, and the target rejects on a mismatch - without a force switch, because a journal from a
different version is not a case for "it will probably work out". The run keeps its id, and an id
that is already taken aborts the import before anything is created; two runs with the same id
never exist. The export requires an idle run, because an archive in the middle of a turn would be a
snapshot of half-finished writes. And the export copies: the source stays where it is, because an
export that cleans up right away destroys work if the import fails - whoever no longer needs the
run there deletes it explicitly.

The path consists of two operations of the message layer (`ragents.runs.export` with `runs.read`
and `runs.inspect`, because the archive contains model contexts; `ragents.runs.import` with
`runs.read`, `runs.write` and `runs.create`) and the script `scripts/run-transfer/`. No surface: as
long as there is one user, the command line is the honest version. The archive goes through JSON
as Base64 and is therefore limited to 16 MiB, a third below the body limit of 32 MB; the limit is a
hard error with size and number, not a silent truncation.

## The extension checked in real VS Code: no `flush`, connecting by itself, registry without corpses (20.09.2026)

Chapters: plugins (Workspace, Workstation registry), operations (Work column and VS Code
extension), `apps/vscode/README.md`; concept `docs/concepts/workspace-tools-proxy.md`. A run of the
extension with the `client` binding in real VS Code showed three things.

First, `ragents.chat.stop` via the extension's own connection took 15 seconds and ended at the
time limit of the plugin stop, while the same stop via a foreign connection took 839 ms. At the end
of every task, the workstation waited for `transport.flush()`, i.e. for all running POSTs of its
connection - among them the `chat.stop` POST, which the server can only answer once the
workstation's response has arrived. Circular waiting. `flush` is removed without replacement,
because the ordering already sits in the message layer: `RpcClient` queues notifications and
responses one after the other via `#outgoing`, so a progress update goes out before its result
anyway. A variant that only counts notifications and responses would have been the same guarantee
a second time.

Second, the extension did not connect in a fresh user folder, although exactly one connection was
configured: it only opened the remembered active one. The decision from 19.09.2026 ("With exactly
one configured connection, the extension connects by itself") holds and is now implemented -
`initialConnection` takes the only configured connection, otherwise the most recently active one.
This drops the workaround via `connectTo` in the host test.

Third, the registry collected orphaned workstations: every ended extension instance stayed as
`connected: false` and appeared in the binding selection. A disconnected workstation now leaves the
registry entirely, and `WorkspaceClientInfo` loses the field `connected`. Nothing needs the dead
entry: a run carries id and label in its binding, the selection in the web still shows a bound,
missing workstation as "(not connected)", and `executorFor` reports the same cause "The
workstation <label> is not connected" for a missing entry as before. Re-registration creates the
entry anew anyway. Addendum on the same day: because the workstation first releases its handlers
when unregistering and the server can thus see the disconnect before the unregistration,
`ragents.workspace.clients.unregister` is now idempotent - an unknown workstation returns `null`,
only a foreign one stays 403.

## The relay names only the alias, titles without a title model block no start (20.09.2026)

Chapters: plugins (Model relay, Open limits), profiles (Model providers, Model for automatic
titles), operations (Connect to a server). The relay run with two local servers showed two
product bugs.

First, a client profile with `COMPACTION_PROVIDER: "relay"` and an empty `COMPACTION_MODEL` did
not start as soon as the alias catalog contained no text model with the thinking level `off`:
`TitleSettingsStore.create` threw on an empty catalog, although an empty default turns title
generation off. The check is removed without replacement, because it was redundant anyway: a
default or a stored state that names no model of the catalog still fails the validation of the
selection. If the catalog stays empty and nobody names a model, the selection is `null`, no titles
are created, and the settings say that the provider offers no model for headings.

Second, the provider's response carried its own `model` field, which the agent runtime writes as
`responseModel` into the developer's model context - i.e. exactly the secret the alias is meant to
hide. On the way back, the relay now replaces `model` with the alias in every SSE block and in the
non-streamed response, and removes `provider`, because that field names the provider by name.
Decided per field: `id` and `system_fingerprint` stay, because they name neither model nor provider
and the client needs the id for matching; everything else, including an error text of the
provider, passes through unchanged. In addition, the relay provider prefixes a rejected model call
with its address ("Relay <address> (401): ..."); otherwise the developer's journal only contained
the relay's bare text without a source.

Addendum to "Remote operation built" (19.09.2026), point 7: the sentence "the relay only reads
along the stream, changes nothing" no longer holds as such. It stays right in intent - no parsing
of the model response, no streaming logic of its own, no buffering of the output - but the two
fields that give away the secret are replaced or removed by the relay line by line in the same pass
that reads `usage` along.

## Provisioning per plugin instead of install.sh (20.09.2026)

Chapters: plugins (Provisioning per plugin, Self-contained plugin folders, Plugin folders anywhere,
Language server plugins, Profile distribution, Open limits), profiles (Data storage,
`provisioned(...)`, Server-delivered profiles, Open limits), operations (Install locally, Browser
check, Connect to a server, Session isolation), README; package 6 from
`docs/concepts/remote-profile.md`. Until now a plugin brought its dependencies as `install.sh`,
collected by `scripts/install-plugin-dependencies.sh`, and a profile then carried an absolute
machine path to the language server. That only worked with Bash, only knew the repo plugins, never
said whether something was missing, and `pnpm connect` set up nothing at all on another machine.

Decided: (1) A plugin that needs tools brings a `provision.ts` with `check(target)` and
`apply(target, log)`. `check` returns `ready` or a named gap with an instruction and the statement
whether `apply` can close it; `apply` itself starts with `check` and does nothing on `ready`. This
makes idempotency a property of the contract and not of the caller's discipline. (2) `target` is
`<data folder>/tools/<plugin-id>/`, so it depends on the host's data folder and not on the
repository; two profiles on one machine have two tool folders, and that is the price for a profile
being allowed to pin its tool. A `provisioned.json` next to the files holds the pinned version; a
version change is a gap again. (3) Everything is pure Node code: `fetch` downloads Roslyn and
fsautocomplete as NuGet packages, a small ZIP reader in the host (`plugin-support/zip.ts`) unpacks
them. Instead of `dotnet tool install`, the FSAC provisioning chooses the folder of the highest
.NET runtime that `dotnet --list-runtimes` reports, and the adapter starts the `.dll` via `dotnet`;
this way no provisioning step needs a shell. (4) A missing `dotnet` and a
`BROWSER_EXECUTABLE_PATH` pointing to nothing are gaps that `apply` may not close; Chromium, on the
other hand, is fetched by `ragents.browser` via the pinned `playwright-core` CLI into its own cache,
because Playwright manages its browser cache itself. (5) A profile names a provisioned file with
`provisioned("<plugin-id>", "<path>")`, resolved when loading the profile file against the same
data folder the start uses. No machine path anymore in `core`, `example` and the developer
profile, and a client profile can do the same. (6) `pnpm provision [<profile>|<path>]` loads the
profile file like the server and reports per plugin `ready`, `installed` or `missing: <reason>`;
`connect` calls it between fetching and starting, the VS Code extension before starting the local
host. A remaining gap aborts the start.

Decided for the workstation: it is supplied with the same provisioning and the same tool folder
scheme and calls it itself - `pnpm workspace-client` on start, the extension on activation via the
same command in the host checkout. It has no profile, so its data folder is
`~/.local/share/ragents/workspace/`, and exactly the plugins of the language servers its executor
offers are provisioned. The alternative of giving it a mechanism or tool directory of its own would
have produced a second truth; the alternative of not provisioning it at all would have left the
developer with two environment variables. To match, the adapters in the executor know the tool
folder as the default: `hostToolFile` resolves `DATA_DIR`, otherwise the workstation folder, and
`ROSLYN_LANGUAGE_SERVER` and `FSHARP_LANGUAGE_SERVER` respectively are only overrides for a
self-installed server. On the workstation a gap is not a start error: it can read, write and build
without Roslyn, and only the call of the language server fails with it.

Removal completed: `install.sh` of `ragents.lsp-roslyn`, `ragents.lsp-fsharp` and
`ragents.browser`, `scripts/install-plugin-dependencies.sh` and the `install` field in
`plugin-list.ts` are deleted; profile distribution no longer excludes `install.sh`, but
deliberately packs the `provision.ts` of an archive plugin, because the client executes it.
Checked: `pnpm provision selftest/ragents.config.developer.ts` twice against an empty tool folder
(first `installed`, then `ready`, no file changed), a server with this profile and a headless
workstation with `roslyn_open` and `typescript_diagnostics` on both paths.

## Windows as a client platform, built without a real run (20.09.2026)

Chapters: plugins (Sandbox tools and processes, Open limits), operations (Work on Windows, Data
storage and logs); concept `docs/concepts/remote-profile.md`, package 7. The executor started `/bin/bash`
hard-coded, sent signals to negative PIDs, always put its data under `~/.local/share`, and the
prompt contribution on the shell platform only knew darwin and linux. On a Windows workstation none
of it would have run. The principle stays: Node standard APIs and Git Bash, no platform layer of
our own, an unknown platform stays an error.
Decided: (1) The executor's bash comes from the agent package's shell resolution
(`getShellConfig`), which finds Git Bash on Windows and drives the old `System32\bash.exe` via
stdin; `getShellConfig` gets the platform as a parameter, so that the Windows branch can be checked
without a Windows machine. The executor rejects anything that is not a bash: the resolution's `sh`
fallback would be a silent fallback under a tool called bash.
(2) Instead of a signal to the negative PID, on Windows `taskkill /T /F` ends the process tree, via
the agent package's existing `killProcessTree`; this applies to the bash as to
`managed-process.ts`, and the grace period before SIGKILL is dropped there, because Windows has
nothing gentle to offer. The tree is only ended if the process still exists, so that not every
finished command causes a taskkill.
(3) The data folder lives under `%LOCALAPPDATA%\ragents\<profile>`; if `LOCALAPPDATA` is missing,
that is a hard start error instead of a guessed path. The sandbox's HOME redirect also sets
`USERPROFILE`, and the safe environment passes through the Windows base variables (`SystemRoot`,
`ComSpec`, `PATHEXT`, `APPDATA`, `LOCALAPPDATA` and siblings), without which hardly any program
starts there. (4) `ragents.processes` rejects the start on Windows with a named cause, as proposed
in the concept: a process table for win32 would be work for a display nobody asked for, and an
empty display would be a silent lie.

Symmetrically: the prompt contribution on the shell platform now names the platform of the
executor that runs the run, not that of the server - for `fresh` and `path` that of the server, for
`client` the one the workstation reported on registration. The snapshot of the prompt
contributions is still created exactly once at start; for this, a contribution may bring a
`renderForRun(runId)` that the server lays over the rendered text per run
(`PromptContributionRegistry.runOverrides`). Synchronous, because a turn's prompt is composed
synchronously; anything else would have made `basePrompt` in the scheduler asynchronous and
re-rendered the whole prompt per turn. If the bound workstation is currently not registered, the
contribution says exactly that, instead of guessing a platform or letting the turn fail.

Unchecked: there is no Windows machine here. Everything is checked only with unit tests that
simulate the platform (shell resolution, data folder, environment, prompt contribution per
platform, rejection of `ragents.processes`). The real run on Windows with `connect`, `read`,
`edit`, `bash` and diagnostics is the only open line for package 7 in the TODO.

## A failed tool call always names its cause (20.09.2026)

Chapters: core (Tool calls in the journal), plugins (File storage). In run 82d041c3,
`browser_check` and `actor_program_activate` stood in the journal without an error text:
`failToolCall` rejected an empty `error` as an invalid value, and with it the whole event vanished
along with its cause. The text could become empty in three places: an `Error` without `message`
(the cause was only in `cause`), an error completion of the model with an empty result text, and a
diagnostics band without an entry. Decided: (1) `tool.call.failed` always carries a non-empty
`error` - the message, otherwise the text of the cause, otherwise "Error without a cause"; the
decision layer replaces instead of rejecting, because an event without a cause is worse than a
replacement text. (2) The error lists of the actor program plugin fall back to a named text if no
message remains. (3) `show_document`, like `document_write`, is a native model tool: via
`typescript_api` plus `typescript_eval` a display cost three rounds instead of one.

## One workstation executor, the same everywhere (20.09.2026)

Chapters: plugins (Workspace, sandbox tools, and processes; Language server plugins;
Self-contained plugin folders; Open limits), operations (Session isolation); concept
`docs/concepts/workspace-tools-proxy.md`. The `client` binding from 18.09.2026 sent five basic
operations (`readFile`, `writeFile`, `access`, `mkdir`, `exec`) to the workstation and left the
tool logic on the server. That forced a decision per path, forbade language servers with `client`,
sent the server's Git credentials into a foreign bash and gave `typescript_eval` a `cwd` that does
not exist on the server. Decided: (1) There is exactly one executor for the workstation tools, the
package `packages/workspace-executor`: the four sandbox tools, process groups, environment, path
checking and the language server sessions including the three adapters. Server and extension
import the same package; registration reports its version, a difference is an error with a cause.
(2) The contract `ragents.workspace.client.*` only has `execute` besides register, unregister and
list; progress is the output as `{ text }`, cancellation stays `rpc.cancel`. (3) In the server,
every workstation tool is only description, schema, prompt contribution and forwarding to
`SandboxServices.execute`; there is no "local or remote" branch anymore, `onRemote`,
`remoteEnvAdditions`, `SessionWorkspace.remote` and `assertLocalWorkspace` are gone. (4) The
extension always binds `client`, also on the same machine; `sameMachine` is dropped, the round trip
via localhost costs nothing and there is only one path. (5) Every executor sees the folders of its
machine and builds its environment from them; from the server come only run markers, `CI`,
`GIT_OPTIONAL_LOCKS` and the sandbox's Git rules. (6) The three LSP adapters move into the
executor, so that every executor offers the same set; the plugins shrink to description,
configuration keys, tab and forwarding, and `registerEditAnnotator` is dropped, because the
executor knows its own language servers. (7) The file storage is no longer a bash path:
`document_write` in `ragents.documents` writes into it, `source` fetches a project file via the
run's `read` proxy; `RAGENTS_FILES_DIR` disappears from environment, path resolution and prompt,
the display remains. (8) A run with the `client` binding additionally gets its folder on the
server, so that `typescript_eval` and the actor programs have a `cwd` that exists.

Decided during the build: the interface `execute(runId, tool, input)` also carries the UI query
`<id>_snapshot` and the cleanup `stop`, so that the contract stays at one operation and the
diagnostics tab also works with `client`. Progress is the truncated output snapshot of the bash
tool (`{ text }`) instead of raw blocks, because the tool produces it anyway.
`contributeSandboxEnv` only existed in the spec anymore and is dropped without replacement: the
executor finds its toolchain via the `PATH` of its machine. The shared client half lives in
`plugins/ragents.workspace/client/`, because the contract lives there; the extension and the new
headless workstation `pnpm workspace-client` use exactly this code. What remains open is the
two-machine run; the prompt contribution on the shell platform still names the server's platform.

Rework after the first end-to-end run (20.09.2026): `HOME` stays the developer's home on the
workstation - they work there with their own credentials for Git, SSH and NuGet, a redirect would
break that; the redirect is a property of the executor in the container. So that nothing is
written into the home in the process, the process context carries its own `logDirectory` for
language server logs, which every caller sets (server: session storage, workstation:
`os.tmpdir()`); the executor has no branch for it. `document_write` loses `source`: the mode
fetched the project file via the model output of the `read` tool, and that is truncated for large
files and downscaled for images - not reliable for a copy. A project file now gets into the storage
via `read` and then `content`. Further: `<id>_open` and `document_write` are native tools, because
otherwise the model has to call them via `typescript_api` plus `typescript_eval` (three rounds
instead of one); `<id>_diagnostics` without `paths` resolves `git status` against
`git rev-parse --show-toplevel` and narrows with `-- .`, so that a workspace may be a subfolder of
a repo; the bash waits for `close` instead of `exit`, so that the stdio streams are drained before
the result is produced; and a connection loss in the middle of the call reports
`workspace-client-disconnected` with the workstation's name instead of "The event stream was
ended". Trimmed: `createSandboxTools` returns a typed mapping from name to call instead of an array
with a cast to a five-parameter signature, the second time limit above the executor's becomes a
single safety limit, `WorkspaceSandboxHost.shutdown` only stops the run's executor (with the
`client` binding no sandbox ever comes into being in the server), `storageRoot` drops out of the
shared context (only the server sets and reads it), and the alias `SandboxProcessContext` as well
as unused exports of the package are gone. The developer profile lives as
`selftest/ragents.config.developer.ts` next to the test helper, so that the assertion about the
profiles of the public repo holds; `scripts/start.sh` and `pnpm driver` take a path for this
(`PRODUCT_PROFILE_FILE`).

## `ListDetail` measures itself: drill-in instead of two narrow columns (19.09.2026)

Chapters: plugins (Start selection, Dialogs), actor-programs (`ListDetail`). In VS Code the
surface is often 700 to 1000 pixels wide. There the start selection stayed two-column, because the
switch depended on a media query on the browser window and only took effect at 700 pixels; list
and preview each got about 350 pixels and became unreadable. Decided: (1) The building block is its
own `@container/list-detail` and switches by its own width, as `Grid` and the work column already
do. (2) The threshold is at 900 pixels; CSS and the measurement in code use the same constant, so
that rendering and click behavior never drift apart. (3) Below the threshold the detail view is a
page of its own: the search and filter bar give way along with the list, what remains is the entry
and a back button. (4) A `ResizeObserver` at the root replaces `window.matchMedia` and clears the
detail view away as soon as the surface becomes wide again. This applies to every use of the
building block, so also to mini-apps and the reference catalog.

## The extension starts the host itself: connections instead of a server address (19.09.2026)

Chapters: operations (Work column and VS Code extension), `apps/vscode/README.md`; package 8 from
`docs/concepts/remote-profile.md`. What was wanted was being able to choose in VS Code: a
completely local profile, configurable and stored, or a server profile with an address, plus a
small settings page with choosing, creating and disconnecting. Decided: (1) A connection is a
named entry in `ragents.connections` with three kinds: profile (the extension starts the host from
`ragents.hostPath` with `--port 0` and reads the announcement), server (token in SecretStorage,
flow of `pnpm connect` via the same function `prepareProfile`, no second path) and running server
(the previous `ragents.serverUrl`, which merges into it without a legacy path). (2) Connection
management sits in the column on the right, not in the Explorer (owner's requirement): without a
connected session, the column's webview shows a page of its own with state, connection list,
Connect, Disconnect and New instead of the iframe; the Explorer only shows a pointer there, the
status bar changes when a connection exists, the creation wizard is a QuickPick. (3) Everything per
connection lives in a session that a switch disposes of and rebuilds; a window reload is no longer
necessary, not even on settings changes. (4) The host gets the personal token as `RAGENTS_TOKEN`; a
client profile names it the way `pnpm connect` already does. (5) The web is only built if
`apps/web/dist` is missing or the profile or host commit has changed since the last build,
otherwise every connect took a minute. (6) With exactly one configured connection, the extension
connects by itself; otherwise it opens the most recently active one. The host start is pure Node
with `taskkill /T` on Windows, but unchecked; Windows remains package 7, with a focus on macOS and
Windows, Linux secondary.

## Remote operation built: token, model relay, relay provider, profile distribution, connect (19.09.2026)

Chapters: profiles (Server-delivered profiles, Sign-in, Model providers, Open limits), plugins
(Model relay, Profile distribution), operations (Sign-in, Model access, Connect to a server, Data
storage and logs), README. Packages 1 to 5 from `docs/concepts/remote-profile.md` are built; the concept
only keeps the open packages 6 to 9. Decided during the build: (1) Two rights of their own instead
of `runs.read`: `models.use` for the relay and `profile.fetch` for profile distribution, so that a
developer token does not have to read runs of the central server. (2) The host version must match
exactly (Git commit), in line with "no migrations"; `connect` names the command for switching and
does not switch by itself. (3) The archive contains the profile file and only the plugins named by
path; plugins by id are taken by the client from its host checkout, which is at the required
commit anyway. This saves a second copy of the repo plugins and keeps the archive small.
(4) `CLIENT_PROFILE_FILE` is a key of the distributor plugin, not of the host, because the domain
plugin owns its configuration; the path is relative to the server profile file. (5) The server now
has ONE model runtime: title model, preparation and engine share it, and `ProfileContribution` got
`providers`, so that a plugin registers providers there before anyone looks up a model. The product
plugin therefore only builds its model settings on initialization, after fetching the catalog from
the relay. (6) The relay catalog delivers reasoning, thinking levels, input types, context size,
output limit and `compat`, but no costs, because the price would give away the model; relay models
cost 0 at the consumer. (7) The relay only reads along the passed-through stream to log `usage`;
nothing is changed. (8) The provider behind an alias comes via the neutral service
`modelUpstreamsToken`, which the product plugin delivers; this way another product plugin can also
feed the relay, and the OpenRouter key stays declared once. (9) The client profile is checked
without its environment (structure, sections, secrets as `env`), the keys per plugin only at the
client, because a probe compose of foreign plugins on the server would have side effects. (10)
`tar` is a dependency of the repository root like the TypeScript language server, so that plugins
find it. Provisioning (package 6) and Windows (package 7) are still missing; `connect` sets up no
language servers. Addendum (20.09.2026): point 7 only holds with restrictions - the relay replaces
`model` with the alias in the passed-through stream and removes `provider`; see the entry "The
relay names only the alias" above.

## Remote operation: the server runs at the developer, models and profile come from the server (19.09.2026)

Chapters: none changed; plan in `docs/concepts/remote-profile.md`. What was wanted was a concept
for RAgents with a remote server. At first "one plugin host in two places" was on the table: every
function with an execution location (server, client, or wherever its resource lives), the same
runtime half of a plugin in the server and the VS Code extension, client bundle from the server. A
challenger review (Fable 5.1) checked this against code and rules and rejected it: `create(host)`
of the candidates pulls engine services (`ragents.workspace/server/index.ts:29`,
`language-server/plugin.ts:18`), a client host would need dummies or two branches per half;
`ToolScope` contains `runtime` and `invokeFunction`, a smaller scope would be a second kind of
function; the functions in question have two resources in two places (`typescript_eval` with `cwd`
in the client folder, language servers for `@actors` and project, browser check against the test
setup, Git with credentials from the server); lifecycle and process management would come into
being a second time at the client; Roslyn, FSAC and Chrome are not JavaScript bundles. On top of
that, the `client` binding has never run across two machines.

Decided: (1) The RAgents server runs where the files are, i.e. at the developer, with the `path`
binding; language servers, browser, processes, Git stay unchanged. (2) Access to the models is a
secret of the central server: a plugin delivers an OpenAI-compatible relay with alias names, at the
consumer it is another provider (`AGENT_PROVIDER: "relay"`). (3) The profile is maintained
server-side and fetched into a cache as an archive before the start; the server starts by path as
with any profile, the rule "no reloading at runtime" stays. (4) Personal tokens in the profile
instead of a sign-in service of its own. (5) Plugins get an idempotent provisioning instead of
`install.sh`; Windows becomes a client platform with Node APIs and Git Bash. (6) The extension
stays thin and starts the local host. Deferred: workstation client and the two-places idea as a
future feature with recorded constraints, run transfer between servers. `pnpm driver` is a pure
test tool and not a client in the sense of this architecture.

## The API is JSON-RPC with typed contracts, HTTP and stdio are transports (18.09.2026)

Chapters: plugins (Message layer, Plugin contract, Web as plugin host, Workspace), core (Layers,
Overseer), profiles (Start modes, Rights), typescript-platform, actor-programs, README. The server
was also to start as a console process without a port and the extension was to be able to switch
between HTTP and stdio, with a message API that is type-safe in the web and in the backend; the
REST-like HTTP API was to go away, not live on behind a facade. Decided: (1) One contract per
capability as a TypeBox object in the plugin's `contract.ts` (`defineOperation`, `defineChannel`),
server (`implement`) and web (`rpc.call`) derive their types from it; no codegen, no second
description. (2) JSON-RPC 2.0 with its own small core in the engine (`packages/ragents/src/rpc`):
symmetrical peer with cancellation (`rpc.cancel`) and progress (`rpc.progress`), subscriptions as
methods, callbacks from the server to the client via `implementedBy: "client"`. `vscode-jsonrpc`
remains reserved for the language servers, because its stream model does not fit POST plus SSE and
browser bundling would gain nothing. (3) Two transports for the same dispatcher: HTTP with
`POST /rpc` and `GET /rpc/stream`, stdio with one message per line. (4) Rights are in the contract
and are checked in the dispatcher; rights per run stay dynamic at the host (global chat).
(5) Delivery stays HTTP: static surface, frames, artifact and attachment contents under
`/files/...`, sign-in; the extension point `http` is only there for that now. (6) Start modes
`--port N`, `--port 0` with an announcement on stdout and a generated token, `--stdio`; a lock on
the profile folder is the caller's business, not the server's. (7) The reference for humans and
models is generated from the registrations of all contracts as Markdown and OpenRPC; OpenAPI is
dropped. The rebuild ran in one go across core, all plugins, web, extension, driver and tests,
without legacy paths.

## Workspace: one contract as the seam, binding per run as the direction (18.09.2026)

Chapters: plugins (Workspace, sandbox tools, and processes; Open limits), homepage (Sticker in the
hero, section The workspace). For publication without the private product, the VS Code extension
lacks the link to the project folder: it does not know the workspace, and core works in an empty
folder per run. Requirement: the extension should know where the files are, and a workstation
should later also be able to attach to a remote server, with the files local and models, knowledge
base and tools on the server. Decided: (1) The server stays the one process per profile, the
extension is a client; it does not start a server per window the way Claude Code starts its CLI.
(2) `WorkspaceRuntime` and `SandboxServices` are the only seam to the working directory, now stated
in the spec; in core this already holds. (3) The binding per run is the start option
`ragents.workspace.binding` with the kinds `fresh`, `path` and `client`; on an explicit instruction
to build everything in one piece, all three are built, and the concept for it is deleted. Decisions
during the build: resolution never fails because of a missing client or folder, because the server
resolves all workspaces at start and a dead run must not block the start; only the tool call
reports the cause. A workstation connects outward via the existing event stream (channel
`workspace-client:<id>`, results via POST), so that it works behind NAT and with VS Code Remote;
the id is stable per VS Code installation, because it is in the journal of bound runs. Only the
five basic operations (readFile, writeFile, access, mkdir, exec) go to the client, the tool logic
stays on the server; paths in server roots stay with the server. If the client reports the same
hostname as the server and the server sees its folders, the extension preselects `path` instead of
`client`, so that language servers and the process display are preserved; with `client` the
language server plugins reject the start with a cause. The preselection runs generically via the
host signal `newRun` with `startOptions`, the column knows no workspace domain logic. The
`WorkspaceResolver` hook remains for the content of a fresh folder.

## Plugins and profiles live anywhere (18.09.2026)

Chapters: plugins (Plugin folders anywhere), profiles (Product profiles). RAgents is going public;
the plugins of a private product, its profile, its tests, containers and deploy scripts have moved
into a repo of their own, which is edited next to the host via a VS Code workspace. Requirement:
a plugin must be able to live anywhere on disk, also for third-party authors.
Decided: (1) `PLUGINS` accepts paths, `PRODUCT_PROFILE_FILE` a profile file outside the repo,
`start.sh` a name or a path. (2) Host code is imported via the packages `@aicontainer/server`,
`@aicontainer/web`, `@aicontainer/ragents` and `@aicontainer/plugins/<id>`; all relative `apps/`
imports of the plugins are switched over, `client-ui` excepted. (3) A loader hook and a Vite
resolver resolve bare imports of external files via the host; plugins need no `node_modules` of
their own. (4) The web bundle is created from the profile instead of from a static glob;
`manifest.web` turns a missing web half in the bundle into a hard error. (5) No symlinks, no nested
repos, no reloading at runtime. Rejected: symlinks of the private plugin folders into the repo,
because they break the relative imports and leave traces in `.gitignore`. The package names
`@aicontainer/*` stay for now; a rename is a decision of its own.

## Unknown tool fields are removed, not rejected (18.09.2026)

Chapters: core (Tool validation), plugins (Provide functions). In a control run, Qwen 3.8 27B called
a tool without input 23 times with invented fields (`previous`, `__unused`), nine times in a row
for the same agent (3.8 minutes), although the reasoning named the right shape every time.
The rejection came from the agent loop ("root: must not have additional properties", without field
names) and did not help the model. Decided: no longer reject. Specifically: (1) The argument check
in `packages/ai/src/utils/validation.ts` no longer enforces `additionalProperties: false` at the
root (eighth own intervention in the agent runtime); its error message names unknown fields by
name, also nested ones. (2) The engine is the one place for the tolerance: `TurnToolset.invoke`
removes unknown top-level fields of a closed object schema, runs the tool with the cleaned input,
writes `ignoredFields` as an optional field into `tool.call.started` (no format version, no
migration) and returns them to the driver as `ToolInvocation`; the agent driver prepends a German
hint line to the result for the model, which for a tool without input says exactly that. (3)
Missing required fields, wrong types and nested unknown fields remain hard errors; the engine
message also names the removed field names. (4) `invokeFunction` (snippets, `context.functions`,
capabilities of actor programs) removes nothing; the compiler checks there. The driver contract now
separates `invoke` per driver kind: agent gets `ToolInvocation`, script still the plain value.
Tests: `packages/ragents/tests/tool-validation.test.ts` (full path with faux model, journal and
model context), `run-functions.test.ts` (engine directly), `packages/ai/tests/validation.test.ts`.

## Stall ticks not into the journal (18.09.2026)

Chapters: plugins (Watcher). A control run showed 15 wake-ups, 2 of them necessary: 13 were
heartbeats during running review rounds, in which the observed source rightly waits for another
actor and produces no events. A wake condition can therefore limit the stall to phases outside
such a round. After `ready` the watcher kept evaluating every 120 seconds and wrote every verdict
into the journal; a stall tick without a wake-up now stays in memory and produces no journal entry.

## Start agents as a fork of their principal (18.09.2026)

After a coordinator had analyzed a task, an agent it commissioned used to start cold and read
everything again; the analysis only reached it as a summary in `instructions`. At the owner's
request, `agent_spawn` gets the field `forkOf`: `agent.spawned` records the source, and on the
first turn the agent driver creates the new agent's context file as a copy of the source's context
branch, truncated before the first unanswered tool call and without reasoning blocks;
`forkableBranch` in `drivers/agent-runtime.ts` is the rule for this. System prompt, tools and model
come from the new agent; the AI layer converts foreign model history anyway. Both prompts say that
the history before the first task is one's own preliminary work and is not to be read again.
Chapters: `docs/spec/core.md` (Model context, Equipping subagents).

## Watcher without a model: wake condition as TypeScript, heartbeat every two minutes (18.09.2026)

Chapters: plugins (Watcher), operation. In a control run, the small judge model
(`qwen/qwen3.6-35b-a3b`) had justified 4 of 9 traceable wake-ups with invented changes
("completedTurns from 14 to 15", although the list presented had no such entry) and issued one
against its own reasoning; the non-wake-ups were not traceable at all, because they were not
journaled. The owner's proposal: solve this without an LLM, imperatively with a well-built
TypeScript script. In addition: the watcher must never fall asleep; if the observed source reports
nothing, the LLM should look for itself every one to two minutes.

Decided: (1) A watcher's condition is the body of a TypeScript function
`(now, before) => string | undefined` over the already deterministic state; on creation it is
type-checked against `WatchState` with the shared compiler and at runtime executed in a `vm`
context with a 200 ms limit. No model, no `WATCH_MODEL`; `judge.ts` and the profile section
`ragents.watch` are gone; the concept `watch-plugin.md` is implemented and deleted. Server code and
LLM actors pass the same shape, so an LLM actor passes code instead of a sentence. (2) Every
evaluation, including one without a wake-up, is kept with reason and presented changes as one of
the last ten verdicts in the plugin state on the run. (3) The stall is the heartbeat: the monitor
of a workflow sets `stallAfterSeconds` to 120; without an event from the observed source the
watcher reports again per period, also during a running turn, and the wake hint tells the
coordinator that it should then read status and activity and either report what is running or give
the next step. A turn end with an unfinished task takes precedence over the stall. (4) The watcher
measures time with the runtime's clock (`Orchestration.now()`), not with `Date.now()`, otherwise
test runs with a fixed clock see weeks of stall. The two locks from the previous day (idle source,
unchanged change list) remain as prefilters. The wake conditions are tested with all branches
(`apps/server/tests/watch.test.ts`).

## The agent runtime's tool set is read, write, edit, bash (18.09.2026)

The tools `grep`, `find` and `ls` are removed from `packages/agent`: the server never wired them,
search and directory listings go through `bash` as with Claude Code; the tool set is `read`,
`write`, `edit`, `bash`.

## Findings from a control run: reviewers in batches, idle source for the watcher (17.09.2026)

A control run of a prepared workflow with the same task as an earlier run took considerably longer,
five interventions by the driver and seven review rounds. The code change is correct, the extra
costs are regressions of the changes from 16/17.09. For each finding it is decided where the
solution lies:

1. The control actor ran with `maxConcurrent: 50` in a loop against the limit of 64 capability
   calls per input (five per reviewer): rounds 1 and 2 aborted after 15 reviewers, the
   coordinator patched the actor program itself and introduced a follow-up bug (rounds 3 to 5).
   Domain-specific in the run script: assignment in batches of ten per input with self-trigger,
   parallelism 25 (50 was too hard), program test with 33 rules at 25.
   The runtime's limit stays; it protects against endless loops.
2. The coordinator read, patched and activated the control actor. Decided: coordinators may in
   principle build and change infrastructure; in a prepared workflow they may not. So no host
   ban, but a paragraph in the workflow's coordinator prompt: the run's actor programs are
   infrastructure, errors are reported verbatim as a blocker, TypeScript actors are only operated
   via their functions (free text to the control actor aborted every round again).
3. The watcher woke 21 times, 2 were necessary (continuation after an unfinished turn, ready). 19
   wake-ups were acknowledgments with one model call each, but every call carried the entire
   history (up to 133k tokens). Cause of the wake-ups: instructions piled up at the observed
   source, every turn end in the chain formally satisfied "turn ended and not finished"; the small
   model also woke against its own reasoning and with invented changes. Generally in
   `ragents.watch`, deterministic before the model: no evaluation while the source is executing a
   turn or inputs are waiting for it (exception: stall); do not present empty or unchanged change
   lists again. The strategy (deterministic state, small model without history) stays.
4. The coordinator's context consisted of 70 percent old thinking, which `packages/ai` sends back
   into every follow-up call for every OpenRouter model. Assessment: whether a model needs this is
   model-dependent, there is no common way; so no blanket omission. Open as a TODO: model feature
   in the catalog and a test with GLM 5.3 flash.
5. `browser_check` failed 23 times because of noise from the application under test, although the
   assertion held; `noErrors` had no description in the schema. Generally in `ragents.browser`:
   description added (the browser phase prompt already named `noErrors: false`).
6. The context contribution of the project diagnostics (five real TS errors in a run script)
   reached all 157 reviewers; one of them hallucinated four findings from it. Generally in
   `ragents.actor-programs`: the contribution only applies to actors that have the actor program
   tools available (`applies`). The project errors themselves remain as a TODO.

Not changed: the base of about 7k tokens per coordinator call (system prompt and contracts); it is
cheap when the provider cache takes effect. With GLM 5.3 flash the cache did not take effect in a
third of the calls, because OpenRouter switches among 28 providers; a configuration key for provider
pinning (`compat.openRouterRouting` already exists) is listed as a TODO. Chapters:
`docs/spec/plugins.md` (Watcher), `docs/spec/core.md` (Context contribution).

## The host shows web pages when it can (17.09.2026)

Chapters: plugins. "Open application" and the application preview of a domain plugin always opened
the modal dialog with an iframe, also in VS Code, where a tab in the Simple Browser is more natural.
Instead of giving every place a VS Code special case, there is a neutral `PageOpener` context in
the web app: the column provides it in the `vscode` host from the new contract message `openPage`,
in the browser it is missing. Domain plugins ask for it and otherwise fall back to their dialog;
the dialog remains for log and errors.

## Dark as the surface default (17.09.2026)

Chapters: plugins. The dark rendering, as the column takes it over from the editor theme in VS
Code, should also be the default in the browser. Without a stored choice, the web app therefore
starts dark instead of light; Light and System remain selectable under Appearance, a choice stored
in the browser still applies.

## Column with focus on the mini-app: one header, sheet chat, addressee in the input bar (17.09.2026)

Chapters: plugins. The column in VS Code used up four rows before content came: the wide web
toolbar as a two-line header, a chip row for the only mini-app, whose title the stage directly
below repeated, and actor chips which, with the default `Active`, showed all 70 standby review
agents and wrapped. Following the draft `docs/ui-drafts/vscode-column-focus.html`, this now
applies: one header with title and state, the header contributions (branch, system prompts, turn,
stop run) behind the title as a popover; a mini-app gets the stage without a chip row and heading,
its button for the middle appears on hover; the chat is a sheet at the bottom edge that slides up
to 90 percent of the surface on mouse, focus or handle, without shifting the layout (explicitly
wanted was the feel of iPhone sheets: flush at the bottom, free at the sides, round at the top, and
no movement of the input when expanding, which is why only the height slides and the input stays
anchored to the bottom edge); the pin docks it as before, from 900 pixels of width it lies to the
right. The addressee moves as a pop-out into the input bar next to the detail level and Send, along
with the first working actor with a spinner. The actor display now has the default `Visible`
everywhere: whatever is hidden on the canvas also belongs behind the number in the header and
pop-out. For this, `ChatSurfaceOptions` gets `toolbarRight`, `ActorChatControls` the rendering
`column` with both slots. Not built: a compact format of the header contributions; the popover
shows them unchanged as long as only the column needs it. Addendum on the same day: the owner wants
to set the width and both delays himself, which is why they are a setting `Work column` under
Appearance instead of constants in the code. Second addendum: the pin has given way to a layout
switch with `Automatic`, `Sheet`, `Below`, `Beside`, because the owner also wants to fix the
arrangement by hand; beside, the chat gets a vertical handle for its width. When pushed down, the
sheet shows no frame, but a status line instead (question, current work or last spoken line), so
you can see whether the chat is doing something. Third addendum: the four-way switch was too much.
Only right or below is chosen now, and below the configured width the chat always lies below;
`docked` together with the stage height is removed, previously stored values are mapped onto the
two positions. In addition, a menu at the top right with settings, "Open in browser" and sign-out;
in VS Code the sign-out goes via the host (`logout` in the column contract), because the extension
host holds the token. Fourth addendum: "New run" is the first card of the run list instead of a
button in the header, and the back arrow is a chevron that folds the list over the running run;
Escape returns to the run without having left it. The web app's run overview shows the same card
instead of its button, so that both entry points look the same. The test instance from
`scripts/start-vscode.sh` now starts in a session of its own (`setsid` via Perl, second fork
against the controlling terminal), because the VS Code task otherwise ended it when it ended
itself. The view is simply called `RAgents`, and without a reachable server its webview shows a
hint with address and error instead of an empty iframe; a second task starts the test instance
against a second profile, and both replace a running instance instead of refusing. Nobody should
have to start the server first and then the instance by hand, which is why the script also starts
the server for each profile itself if it does not answer, and waits for `/health`.

## Grouped steps as the default of all chats, plugin sources in the Tailwind build (17.09.2026)

Chapters: plugins. The detail level `grouped` applies everywhere as the default: host policy,
global coordinator, server fallback of the product policy and the configuration of the profiles
are now set to `grouped`; selections stored in the browser still take precedence as before. In the
process it turned out that the Vite build did not scan the plugin folders: `@source` with a
directory glob (`plugins/*/web`) finds no files, only `plugins/*/web/**/*` does. The plugins'
utilities (inspector spacing, status bar, material colors) were therefore missing from the built
stylesheet; fixtures and the mini-app compiler were not affected, because they pass the folders
explicitly.

## Work column and VS Code extension, sign-in via token (17.09.2026)

Chapters: plugins, profiles. What was wanted was RAgents at the edge of VS Code: on the left an
Explorer of the runs, on the right a column with chat and mini-apps, the middle for code (draft E
from `docs/ui-drafts/vscode-sidebar.html`). Implemented without a second surface: `column.html` is
a second Vite entry point of the same web app, `PluginChat` gets a `layout`, and the column itself
is a `Column` contribution of the orchestration plugin next to its `Center`, because the host does
not know the run view and stays plugin-neutral. The extension under `apps/vscode` is a thin shell:
native tree, webview with an iframe on `column.html` in the secondary sidebar (VS Code knows
`viewsContainers.secondarySidebar`), one editor tab per mini-app. The open questions of the draft
are decided:

- Sign-in: the sign-in cookie does not arrive in the iframe of a VS Code webview (third-party
  context, SameSite). Instead of a separate bundle (CORS and base URLs in every plugin), the
  extension host signs in itself, keeps the session token in SecretStorage and passes it to the
  iframes in the address; the server accepts the token as a bearer and, for GET requests without
  headers, as the query parameter `access`. The same applies to the older `ACCESS_TOKEN`; in
  exchange the built assets are open and only page navigations are redirected. The mini-app frames
  allow the VS Code webviews as ancestors.
- Secondary sidebar: available from VS Code 1.134; the extension requires this version.
- Multiple windows: the column state stays per webview storage, i.e. per window; sufficient,
  because the server does not need to know anything about it.
- `PluginChat` needs the layout parameter, `renderChat` alone is not enough: providers, header
  portal and start dialog also belong in the column, canvas bar and workshop do not.
- The location `surface: "column"` for the global coordinator is dropped, because the column does
  not show it; it reports no location.
- The Explorer shows actors only with their server state; the personal actor display lives in the
  webview and is not known to the extension host.

A column without an iframe remains a TODO line; the concept `vscode-extension.md` is
deleted. A host test (`pnpm --filter ragents-vscode test:host`) checks the extension in a real VS
Code against a running server, also with sign-in and `ACCESS_TOKEN`.

## Watcher with a wake condition instead of a fixed monitor (17.09.2026)

Chapters: plugins, core. Four runs from 16.09.2026 showed: the monitor already sent only deltas,
and the coordinator almost never queried the status afterwards (4 of 53 wake-ups). The effort lay
in the wake-up itself: each was a full coordinator turn with 11k to 39k input tokens and a growing
history, and in 12 of 13 cases the coordinator only retold what the mini-app shows anyway; empty
wake-ups ("turn ended, nothing changed") triggered unnecessary tool rounds. The wake rule and the
progress comparison were hard-coded in a server class of a domain plugin.

Decided: (1) New neutral plugin `ragents.watch`. An actor says in a sentence whom to observe and
when to wake (`watch_create`, plus `watch_list`, `watch_remove`). The service tracks the state
deterministically (lifecycle, turns, inputs, questions, last output text, optionally the result of
a named operation, stall) and lets a small model without history decide only this: wake or not.
Every evaluation sees the condition, the current state, the changes since the last wake-up and the
last three verdicts; the context stays constant. Model in the profile section (`WATCH_MODEL`,
default `qwen/qwen3.6-35b-a3b`). Definitions and baseline are stored as plugin state in the journal
and survive a restart. (2) The plugin order matters: `ragents.watch` comes before the plugins that
use it in profiles. Still open are a local provider for the small model, a second user and an
optional narrator (`TODO.md`); the concept is in `docs/concepts/watch-plugin.md`.

## One surface, one group label: Card and SectionLabel (17.09.2026)

Chapters: plugins. After the Tailwind switch, the same surface description stood as a class chain
in a dozen places, and the small all-caps label was typed anew at every section. `Card` is now the
house surface (`rounded-panel`, host outline, card surface, `shadow-bar`) and has replaced the
ad-hoc surfaces in sign-in, appearance, overview, settings, canvas hint and reference preview;
deviations are attached as `className`. The shadcn API stays unchanged. New is the building block
of our own `SectionLabel` for the group label; labels that are a heading or a `dt` stay their
element. Floating surfaces with a component of their own, the material cards of the canvas and the
lighter inner surfaces of a card stay unchanged. `SectionLabel` is available to mini-apps via the
same library, but stays out of the generated building block catalog: it takes the native `div`
props, whose table would flood the reference with almost 300 lines.

## Coordinator header: wider, fixed height, toasts only with a closed history (17.09.2026)

Chapters: plugins. After the Tailwind switch the header grew with a two-line coordinator input,
the short-answer toast was narrow and its X sat inside the text. The owner wanted the coordinator
50 percent wider (570 instead of 380 pixels), the toast twice as wide and cleanly laid out, a
header that never grows, and toasts only when the history is not expanded. The toolbar input is now
fixed to one line and scrolls, header and contribution have a fixed 45 pixels; the toast is one row
of text area and round X; a short answer while the history is open is discarded.

## Entire surface on Tailwind and shadcn, one token file (17.09.2026)

Chapters: plugins, actor-programs. Since 15.09. Tailwind only applied to the controls and the
mini-app frames, the rest of the surface ran on about 8,700 lines of custom CSS in host and plugins
with `--qsl-*` tokens and a second token layer in `theme.css`. The goal was the same technique
everywhere and without redundancy. Decided:

- `apps/web/src/ui/theme.css` is the only token source; `tokens.css` and `ui.css` are gone, as is
  every `--qsl-*` and `--ui-*` variable. Additional host colors, material colors, shadows, radii
  and animations are Tailwind theme tokens and thus usable as utilities.
- The host entry point loads Tailwind with Preflight; the reset rules for `data-slot` and
  `base.css` are dropped. All class stylesheets (`app.css`, `chat.css`, `panel.css`,
  `host-widgets.css`, the plugin `plugin.css`, `material.css`, the mini-app `styles.css`) have been
  merged rule by rule into utility classes on the elements and deleted.
- Recurring patterns are components instead of classes (`ToolbarItem` and siblings in
  `Toolbar.tsx`, `Badge`, `Empty`, `Alert`, `Card`, `Spinner`); context runs via `data-*`
  attributes and `in-data-[...]` variants (`data-surface="material"`).
- CSS remains only for markup generated by others: highlight.js, react-diff-view, xyflow.
- Tests no longer select via classes. The mini-app compiler and the homepage builds also scan the
  host sources; the homepage gets its tokens from `theme.css` and only scans its own `.tsx`
  sources, not its generated outputs.
- The frame stylesheet compiled per program lives as `frame.css` in the build folder
  (`stylesFile`), no longer per view in the program JSON; otherwise two-page programs would burst
  the 250 KB limit. Already installed programs need to be activated again.
- The compact scale (`--spacing: 0.235rem`, `text-sm` 0.78rem) stays deliberately; pixel values of
  the old rules are rounded to the nearest step, so the surface is a few pixels tighter or wider
  than before in some places.

## Actor display `Visible` (17.09.2026)

`Display` gets the mode `Visible` between `Active` and `LLM agents`: only actors whose card or tile
is currently on the canvas, plus the primary actor, whose entry point the bar is. The bar should
limit itself to what can be seen on the surface; `Active` only hides stopped actors and without
stopped actors acts like `All`. The basis is the stage entries from `publishStageEntities`, which
already determine the grayed-out entries; this makes the mode apply equally on the free canvas and
in tiles. Chapters: `docs/spec/plugins.md`; operation and homepage are adjusted.

## Detail level "grouped" for steps (17.09.2026)

Between `chips` and `compact` stands the new detail level `grouped`: all thinking and tool steps
between two answers collapse into one expandable row "N steps", expanded they appear as the
single-line rows of the `compact` mode with the same popover. What was wanted was grouping the way
Codex shows it, without the group immediately spreading out all details when opened; first the
group, then the row, then the popover. For this the single-line rendering has been pulled out of
`Bubble` into `TraceLine` and is used by both modes. Chapters: `docs/spec/plugins.md`.

## Detail level per display surface (17.09.2026)

Canvas card, side inspector and pop-out of the same actor used to share the remembered detail level
(key run + actor). It is wanted per surface: read "everything" in the inspector, stay grouped on
the card. `useChatSteps` takes a third id `surface` into the key; `ActorChat` and
`ActorChatControls` pass their rendering through, the pop-out reports itself as `popout`, tile
inspectors as `canvas`. Without a surface the previous key remains valid. Chapters:
`docs/spec/plugins.md`.

## Reminders for running turns via the context contribution, preview never only in the iframe (16.09.2026)

An autonomous run brought up friction points; for each point it is decided whether the solution is
general or domain-specific:

1. After one minute without a report, the monitor queued a reminder as input for a running agent.
   An input never reaches a running turn; the reminder was only processed afterwards as a turn of
   its own ("The report has been submitted after the fact"), changed detail texts, and the
   coordinator answered the follow-up ping with "No change". The reminder text expected exactly
   this case, the delay was built in. General rule in `core.md` (Scheduler and turns): an input
   that refers to the running turn is always stale when processed and must not be queued; the only
   way into a running turn is the agent runtime's context contribution (`agentRuntime`
   contribution, event `context`), as the project diagnostics of the actor programs already use
   it. With it, a domain plugin adds a non-displayed message before every model call of a due
   turn; open user questions suppress it.
2. The preview dialog stayed empty: the application under test loads a library that leaves every
   non-top window for `about:blank`; in the agent's Playwright browser it is the top window.
   General: applications may refuse embedding, and the host does not detect this across the
   origin boundary. Rule in `plugins.md` (Web as plugin host): a dialog with a foreign web
   application names the address and always offers "Open in new tab".
3. Time analysis of the run: one review round took 3.8 minutes with 10.3 minutes of individual
   time, because `maxConcurrent: 3` in the workflow definition only allowed three instances at the
   same time (a leftover from before the compiler pool). Decided: parallelism 50, practically
   unlimited; the order "first call alone, then all" for the provider cache stays.
4. Tool count: 86 calls of one agent, 39 of them `typescript_eval` snippets without a single line
   of logic, only individual calls of browser, report, status and diagnostics functions; another
   36 snippets for context and report. Every wrapper costs context and about one second of
   compiler, and delivers contract errors as TS diagnostics. Decided: more tools native. The
   previous rule ("native only if the detour loses something") is replaced by an assignment
   (`plugins.md`, Provide functions): native is what is called and read on its own (operation,
   report, status, diagnostics); snippet is what combines, filters or passes values on.
   `nativeTool: true` on the browser functions (except `browser_viewport`) and the language server
   diagnostics; the prompts say what is direct and require bundling independent calls in one
   response. Calls whose result is passed on stay snippets, so that no values get copied by hand.

Chapters: `docs/spec/core.md` (Scheduler and turns), `docs/spec/plugins.md` (Web as plugin host).
The generated references under `docs/homepage/` have been updated with `pnpm generate:homepage`.

## `scripts/` organized by topic (16.09.2026)

The `scripts/` folder was flat with 30 files: the homepage generator with its tests, run driver,
model catalog and concept audit lay next to the two entry points. Requirement: subfolders by topic
instead of 30 flat files. Decided: `scripts/` only keeps the entry points `start.sh` and
`install-plugin-dependencies.sh`, which README, Dockerfile, example configuration and documentation
name. `scripts/homepage/` contains all `homepage-*.ts` with tests, `generate-homepage.ts` and
`tsconfig.homepage.json`; `scripts/driver/` contains `run-driver.ts` with its test;
`scripts/maintenance/` contains `update-model-catalog.ts`, `concept-audit.fsx` and
`concept-audit.test.py`. The files were moved with `git mv`, only relative imports, root
calculations and path literals were changed (`package.json`, `build/homepage.sh`,
`tsconfig.homepage.json`, `homepage-extensions.test.ts`, `concept-audit.fsx`). Generated homepage
files were regenerated.
Affected: `README.md` (Folder table, Developing), `docs/operations.md`, `docs/spec/overview.md`.

## Driving runs from outside: `pnpm driver` in the repository (16.09.2026)

The day's autonomous runs were driven with a loose helper tool outside the repository (HTTP API
plus journal evaluation, sign-in via Playwright). Assessment: this is a useful tool and belongs in
the repository, configurable instead of hard-coded. Decided: `scripts/run-driver.ts` as
`pnpm driver` with the commands new-run, send, stop, sessions, journal and usage. Profile via
`PRODUCT_PROFILE` as with `start.sh`, address from `host.PORT` (`RAGENTS_DRIVER_URL` overrides),
data folder from `DATA_DIR` or the profile default, sign-in via `POST /api/access/login` with
`RAGENTS_DRIVER_USER` and the password from the profile file; without a user for a profile that
requires users, a hard error. The journal evaluation is tested as pure functions
(`scripts/run-driver.test.ts`, runs with the homepage script tests). Run reports and handoff stay
outside the repository.
Affected: `docs/operations.md` (Drive runs from outside), `README.md` (Developing).

## Delivered tool results count, empty model responses get a nudge (16.09.2026)

In a control run, 4 of 18 instances in one review round failed technically, not on the merits, and
cost a follow-up round of about 11 minutes. Two model responses consisted only of reasoning
without text and without a tool call, with stop reason `stop`; one instance ran into the provider
timeout; and one instance delivered its report via a tool call, after which its turn ended with
"Upstream idle timeout exceeded", whereupon the completion with `error` reset the review.
Requirement: time limits stay, reviews may take long. Decided:

1. A tool result in the journal stays valid, no matter how the turn ends afterwards; the rule is
   in `core.md` (Scheduler and turns).
2. On a response without text and without a tool call, the agent loop
   (`packages/agent-core/src/agent-loop.ts`) nudges exactly once with a user message; if the next
   response stays empty, it becomes the error response "Model returned an empty response twice."
   and the turn ends via the existing error paths as `failed` (runtime output and reason in
   `turn.finished`), not as `completed`. Text or a tool call reset the count; time limits are
   unchanged. Tests: `packages/agent-core/tests/empty-response.test.ts` (new test script of the
   package, added to `build/check.sh`) and `packages/ragents/tests/agent-runtime.test.ts` for the
   driver's turn result.

Chapters: `docs/spec/core.md` (Scheduler and turns). The generated references under
`docs/homepage/` are to be updated with `pnpm generate:homepage`.

## Findings from two autonomous runs (16.09.2026)

Two autonomously driven runs yielded ten friction points; for each point the owner decided whether
the solution lies in the engine, the host, neutral plugins or the domain plugin. Decided in general
and implemented:

1. WAKE GUARANTEE as a rule in `core.md`: whoever asks an actor to end its turn and wait for a
   wake-up must guarantee to wake it; a passively waiting LLM coordinator is not a wake-up. After a
   synchronous tool call, an agent ended its turn and sat still for 14.5 minutes until a human
   intervened. The domain plugin's monitor, which sees the turn end via journal observation anyway,
   is now this observer: with a non-terminal phase, no waiting input, no running or commissioned
   further actor, no open question and no handoff to the coordinator, it queues the concrete next
   step from the workflow state, only once per state; a second turn end without a change is
   reported to the coordinator as a stall.
2. New test `apps/server/tests/prompt-snippet-contract.test.ts`: all TypeScript examples from
   prompts, skills and run script prompts (fences and single-line `context.functions` chains) are
   compiled with the snippet compiler against the run context declarations of the profile
   fixtures; Handlebars placeholders are neutralized beforehand. Found and fixed: a prompt accessed
   a possibly empty entry unchecked with `entries[0].path`. Six examples are covered.
3. `bash` delivers a nonzero exit code as a result (`Command exited with code N` as the last line),
   not as a tool error; tool errors remain start, time limit and cancellation (eight failed
   attempts caused by `grep` without matches and `grep -P`). The workspace plugins deliver a prompt
   contribution bound to `bash` with the shell's platform from `process.platform`
   (`plugin-support/shell-platform.ts`), an unknown platform is a start error.
4. Browser targets get `nth` (0-based) or `first: true`, `browser_check` gets `count` (visible
   matches instead of uniqueness); strict mode errors still name the candidates and now also the
   way out; pure visibility and address checks wait at most 5 seconds instead of 15 (six failed
   attempts of 15 seconds each).

Chapters: `docs/spec/core.md` (Actors, inputs, events, and subscriptions), `docs/spec/plugins.md`
(Sandbox tools, Browser checks). The generated references under `docs/homepage/` are to be updated
with `pnpm generate:homepage`.

## Coordinator tokens: compact function results, lean typescript_api (16.09.2026)

Measurement in one run: the coordinator needed 31 model calls with 933k input tokens; 731k of them
accrued after the start of a commissioned agent, 356k alone for five monitor pings without any
change, each of which cost a `typescript_eval` call and a "No change" answer. The context grew to
40k tokens, mainly through the `typescript_api` result with duplicate schemas (32k characters) and
a snapshot with 50 entries (20k). Four failed attempts came from contract gaps: a mandatory empty
argument (TS2554), `undefined` in results, a field binding only at runtime, a field in the
description but no longer in the schema.

Decided, in general and not only for this run: (1) A monitor forms a fingerprint from the observed
state and only wakes the coordinator on a change; the input names the change, the coordinator
reports without a status query. A turn end of the observed source always remains a ping. (2) Model
functions deliver compact results: status functions without long lists and defaults; lists only
on explicit request as a short list; the mini-app reads the full snapshot via an operation of its
own. (3) Contracts: an empty or purely optional input schema allows the call without an argument;
`undefined` under an object key counts as absent on input and output, `exactOptionalPropertyTypes`
is off in the snippet and program compiler; the binding between fields is stated in the field
descriptions and thus in the declarations. (4) `typescript_api` with `names` delivers TypeScript
declarations with field comments from the schema `description`s, shared schemas once as an alias
and JSON schemas only with `schemas: true`. (5) macOS process list: lines with a PGID and an empty
state count as an existing group. (6) New rule with a test: field semantics belong in the schema,
function descriptions name no field names; `apps/server/tests/run-function-description-drift.test.ts`
checks all registered contracts. Two design rules are in the spec; an engine generalization of the
change-driven wake-up only follows with a second observer. Chapters: `docs/spec/plugins.md`
(Provide functions), `docs/spec/typescript-platform.md` (Short descriptions and details, Execute
code), `docs/spec/core.md` (Actor state).

## Snippet compiler as a warm worker pool (16.09.2026)

Every compilation used to start a new worker thread that loaded TypeScript, parsed all lib and
declaration files and then ended; in one run that cost about half a second of pure preparation per
snippet and, with parallel reviewers, waiting time up to the time limit. Decided: up to eight
long-lived workers with request ids, per worker an LRU cache of parsed libraries and declarations
(256 entries) and `oldProgram` for structural reuse; snippet sources always stay fresh. Measured:
471 ms cold, 10 ms warm with the same declarations. A worker that exceeds the time limit or dies is
ended and replaced on the next demand; a compiler error in the request leaves it alive.
Diagnostics, `compilationHash` and emit are unchanged; the existing compiler tests run unchanged,
two new ones check reuse with a timing ratio and the replacement of a dead worker. Chapters:
`docs/spec/typescript-platform.md` (Execute code).

## Browser viewport 1920 x 1080 with switching via a function (16.09.2026)

The screenshots of a run were cut off: the run's browser ran at 1440 x 1000, the application under
test needs a width of 1920 (ribbon overflow, legend and table clipped). Decided: `ragents.browser`
starts at 1920 x 1080 (16:9, scaling 1, i.e. full HD PNGs without enlargement, matching the
existing screenshot convention). Addition: the model must be able to change the size itself, for
example for narrow layouts; for this there is `browser_viewport`, and the value stays per run until
the next change.
Affected: `docs/spec/plugins.md` (Browser checks), skill `browser-testing`. The generated building
block reference is to be updated with `pnpm generate:homepage`.

## The user name comes only from the sign-in (16.09.2026)

A coordinator greeted a tab with the name of another user. Cause: according to the journal, the
run belonged to the second user, because a second tab in the same browser was signed in as that
user and had thereby replaced the shared cookie; the first tab still showed the old name, but sent
the other session along. Decided: a tab reloads the signed-in user on every focus and takes over
the change. In addition, a user name now appears only once in the system, in the user list of the
profile file; prompts, skills and test fixtures speak of the administrator or use neutral example
names. Chapters: `docs/spec/profiles.md`.

## Run deletion answers immediately, the cleanup is a deletion job (16.09.2026)

Deleting 17 runs took 20 to 40 seconds per run (removing the working directory, stopping language
servers and processes) and the client deleted one after the other; the confirmation dialog seemed
frozen for minutes. Decided: `DELETE /chat/:id` answers with `202` as soon as the intent to delete
is durably recorded. From then on the run is invisible and the sessions list is triggered;
stopping, removing and archiving run as a deletion job in the background, errors go to the server
log, completion on the next start stays as before. The client sends multiple deletions in
parallel. As a nested page dialog, the confirmation dialog gets a backdrop of its own, because
Base UI renders none for nested dialogs. Affected: `docs/spec/core.md`, `docs/operations.md`.

## AGENTS.md merged into the README (16.09.2026)

The owner's objection: the README is the better entry point, most people read it anyway; a second
entry point next to it scatters things. Added to that was the observation that Claude Code only
loads `CLAUDE.md` automatically, Codex only `AGENTS.md`, and the repo so far had no `CLAUDE.md`: a
Claude session started without the spec and without the decisions. Decided: required reading,
documentation rule, way of working and rules are now in the README section "For AI assistants";
the folder descriptions and check commands have been merged into the existing sections.
`AGENTS.md` remains as a two-liner for Codex, `CLAUDE.md` imports the README with `@README.md` for
Claude Code; both are pure pointers without content of their own, so that nothing ages twice.
Chapters: none; changed are README, AGENTS.md, CLAUDE.md and the references in `selftest/GUIDE.md`,
`TODO.md` and the maintenance comments of the homepage.

## Star view in mini-apps via the shared FlowDiagram (16.09.2026)

A mini-app drew its star itself as an SVG with a hard-coded background; the removal of the dot grid
in the shared `FlowDiagram` therefore did not reach it. Decided: diagrams in mini-apps go through
`FlowDiagram`, which for this gets `layout="star"` (first node in the middle), `viewport="fit"`
(width and height fitted, no scrolling), `actions` with `onAction` on cards and `status` on edges.
The diagram has no background of its own. Affected: `docs/spec/plugins.md`, `docs/operations.md`,
`docs/homepage/guide-programs.md`.

## Contract drift reactivates packages instead of locking the run (16.09.2026)

After a server rebuild, a mini-app's run from the previous evening reported on every call
"Capability contract of status has changed; activate the package again". Cause: overnight
`snapshotSchema` had gained `formatting` and lost `audience`, but the package in the run was bound
with the schemas from the previous evening, and nothing reactivated it. The question was whether
contracts could be compared structurally and only real breaks rejected. Decided:

- No schema comparison. A subtype checker for TypeBox (input contravariant, result covariant,
  special role of `additionalProperties: false`) would be a project of its own and would only guess
  what the code tolerates. The hash stays the detection, the type check of the newly built package
  is the compatibility test: green means keep running, red means a real break with the compiler
  error as the cause. Chapters: `docs/spec/typescript-platform.md`.
- The reactivation runs in the actor's call queue, before the execution of the waiting call; there
  are no running calls of the same actor there, which is why the idle check is dropped only for
  this. Input and capability binding are resolved against the new definition after the
  reactivation, so that changed capability lists also take effect. A handler or call stays bound
  to the revision with which it was resolved; only the reactivation it triggered itself may change
  it, a package replaced otherwise still rejects it.
- Packages from run scripts get the current plugin sources on drift, not the files copied at start:
  plugin and server change together, the run follows. For this the run remembers the entry id as
  the plugin state `ragents.actor-programs.script`; a name match across all scripts would be
  implicit and could overwrite own packages. Own packages are built from their working files, as
  `actor_program_activate` would do.
- As a rule for capability authors, `docs/spec/overview.md` states what a compatible contract
  change is: inputs may accept more, results may not guarantee less; the measure is the value set,
  not the number of fields. Of the three changes to `snapshotSchema`, only the new optional
  `formatting` was compatible, and not even that for a package that passes the snapshot through a
  closed schema of its own.

## Work indicator in the run chat follows the whole run, chip survives own inputs (15.09.2026)

The run chat only showed the work scenes during a turn of the primary actor. As soon as the
coordinator delegated and waited for sub-agents, the run seemed idle, and on the next coordinator
turn the display jumped back on. The run chat now uses the same reading as the run list: it is
working as long as any agent or program is executing a turn (live status of the primary actor or
`lifecycle.running` in the run view), and only while the connection exists. Stop button and
placeholder follow the same signal. Cards and inspector keep their actor-related run state. In
addition, the current step chip disappeared as soon as the operator sent another message during
the work; own inputs sent afterwards no longer end the chip, any other message still does.
Chapters: `docs/spec/plugins.md`; operation adjusted.

## UI library on shadcn/ui, Base UI and Tailwind (15.09.2026)

Chapters: plugins, actor-programs. The control library of our own from 07.09. (Button, IconButton,
Chip, Segmented, Tabs, SelectMenu, Modal, Dialog with `ui-*` classes and Floating UI) is replaced by
shadcn/ui on Base UI. The deciding factor: mini-apps are mostly written by models, and they know
the shadcn API (`variant="outline"`, `Select/SelectTrigger/SelectContent`,
`Tabs/TabsList/TabsTrigger`, `Dialog/DialogContent`) and Tailwind without instructions; React Aria
was examined as an alternative and rejected because it is less well known. Decided:

- The components live as our own sources in `apps/web/src/ui/` via the shadcn CLI
  (`components.json`, style `base-nova`) and are passed through without prop names of our own;
  host, plugins and mini-apps (`@ragents/client/ui`) use the same API, icons from `lucide-react`.
- The look is the shadcn default, the colors come via `theme.css` from the `qsl` tokens; the
  layered work for controls and the mini-app surface `mini-app.css` are dropped, materials still
  apply to canvas and cards.
- Tailwind only for controls and mini-apps: in the host without Preflight (`tailwind.css`), in the
  mini-app frame fully (`frame.css`), compiled per view in the mini-app compiler and in the
  homepage builds with `@tailwindcss/node`. The rest of the host surface keeps its CSS.
- Building blocks of our own remain `ListDetail`, `SvgEdge`, the host's page `Modal` as well as the
  mini-app extras `Form`, `DataTable`, `FilePicker`, `AppLayout`, `Stack`, `Grid`,
  `TaskProgress`, `DocumentViewer` and `DiffViewer`, now made from shadcn parts and Tailwind.
- The lookup catalog and the homepage document our own building blocks; for the shadcn
  components, the documentation of shadcn and Base UI applies.

## Tabs and folded cards in mini-apps (15.09.2026)

After the selection, a mini-app shows the subject in the header and four tabs via a new shared
`Tabs` building block; agent prose stands in folded cards, the action bar contains only actions.
Chapters: `docs/spec/actor-programs.md`.

## Run overview by activity with personal read state (15.09.2026)

The existing card grid gets day groups by last journal activity and subtle status colors. A hint
of its own distinguishes new activity from running work. The local read state uses loaded journal
revisions per user and run; hidden views and list queries confirm nothing. The running indicator
checks all actors in the scheduler, so that an active worker stays visible while the primary chat
is idle.
Affected: `docs/spec/plugins.md`.

## Mini-app contents and diagrams at natural size (15.09.2026)

The downscaling of the entire mini-app frame to 90 percent is dropped; its viewport uses the
actual dimensions. Diagrams start and center at 100 instead of 80 percent. This way two nested
defaults no longer shrink text, controls and cards. The automatic width adjustment is preserved
when space is short.
Affected: `docs/spec/actor-programs.md`.

## More spacing between diagram cards (15.09.2026)

The default spacing of the automatic layout increases by about 30 percent: from 40 to 52 within a
level and from 72 to 94 between levels. This leaves more free space between the boxes. Affected:
`docs/spec/actor-programs.md`.

## Clip diagram cards at the outer rounding (15.09.2026)

For cards without sub-items, the rectangular header area reached over the lower rounded corners.
The card now clips its content areas at its outer outline. Dimensions, shadows and connections
stay unchanged. Affected: `docs/spec/actor-programs.md`.

## Separate pop-out scrolling from the canvas bar (15.09.2026)

The fixed-position actor pop-outs remain DOM children of the canvas bar. Its native mouse wheel
handler therefore also intercepted events from the chat and prevented its normal scrolling.
Pop-outs now mark their own scroll boundary; the bar's handler skips events from such areas, also
at their content edges.
Affected: `docs/spec/plugins.md`.

## Chat following, stop action and clearer diagram states (15.09.2026)

The follow state did not reliably distinguish manual reading back from a scroll position limited
by the browser. It now takes the actual scroll intent into account and is preserved across layout
changes and hidden views. Browser checks cover size changes, streaming, rendering changes and
manual scrolling. The empty composer wires its stop action to the respective actor and its
children; missing stop callbacks had previously left a disabled send button behind.
Affected: `docs/spec/plugins.md`.
Diagrams keep status chips and mark their states more strongly by color, without additional
height. Animation requires an explicit running signal instead of an implicit default value.
Affected: `docs/spec/actor-programs.md`.

## Direct working tools and locally scoped UI state (15.09.2026)

The four file/shell tools read, write, edit and bash are additionally offered natively. Individual
calls thus need no type-checked TypeScript wrapper; implementation, working roots and actor grants
stay identical. Orientation and role prompts distinguish direct tools from workflow functions.
Affected: `docs/spec/core.md`, `docs/spec/typescript-platform.md`.
The file browser no longer holds module-global component values. Panel width and expansion state
belong to the respective run. This way operating actions do not carry unintended defaults over to
other instances. Affected: `docs/spec/plugins.md`.

## Tool rendering per chat (15.09.2026)

The rendering of tool calls was only separated by coordinator and agents. The selection now belongs
to run and actor, so that other chats stay unchanged. Main view, canvas and inspector of the same
chat use the same preference.
Affected: `docs/spec/plugins.md`.

## Reduce the chat tile to the selection (15.09.2026)

The first chat tile now only shows its centered selection text. The header and the additional
explanation are dropped. The tile stays usable even while loading is in progress, because its
selection is purely local. Affected: `docs/spec/plugins.md`.

## Diagrams at 80 percent by default (15.09.2026)

The shared diagram renderer uses 80 percent as the initial and centering scale. Width-fitted
diagrams stay at most that large and shrink further when space is short. The React Flow scaling
covers text, cards, connections and spacing together; the content height follows the same scaling.
This way FlowDiagram and WorkflowDiagram match the other mini-app contents. Affected chapter:
`docs/spec/actor-programs.md`.

## Shared scroll space below the last chat message (15.09.2026)

Chat histories get two text lines of bottom content padding, at least the height of the fade zone.
The measured input height is added when the composer is visible. The previous different paddings
for pure histories and chats with input are dropped; material cards only change the side padding.
This way the last message stays fully readable even without an input, and the existing
auto-scrolling takes the free space into account automatically. The composer measurement is also
kept on re-render: the previous brief removal of its height could limit the scroll position and
switch off follow mode.
Affected chapter: `docs/spec/plugins.md`.

## Keep running chat answers together on new inputs (15.09.2026)

New inputs used to close the running answer block; further streaming chunks appeared below the
user message as a separated continuation. The shared message projection now extends the open block
at its original position and checks its conversation and turn assignment. Actor histories no
longer produce an artificial turn completion when an input is queued. This way output and input
stay separately readable also on journal replay.
Affected chapter: `docs/spec/core.md`.

## Workflow as a compact overview without enlargement (15.09.2026)

The width adjustment enlarged narrow workflow graphs beyond their normal card size and thus
counteracted the browser zoom. It now only shrinks when space is short and centers the remaining
space. The default rendering limits phase titles to two lines and work items to one line with a
status dot. Full texts remain available on hover; long reports no longer affect the card height.
`detailLevel="full"` keeps the detailed rendering as an explicit option. Already installed
mini-apps contain a compiled client package of their own and need a rebuild to pick up the change.
Affected:
`docs/spec/actor-programs.md`, `docs/spec/plugins.md` and the public building block reference.

## Status bar with edge spacing and clearer separators (15.09.2026)

The status bar leaves 12 pixels of space on the left for rounded window corners. Short,
higher-contrast separators make the control groups more clearly recognizable. Affected:
`docs/spec/plugins.md` and the surface section of the homepage.

## Workflow definition as the source for instructions and graphics (15.09.2026)

Phases, transitions and freedoms of a prepared workflow used to stand separately in the prompt and
in the diagram. `@ragents/workflow` connects them in a neutral TypeScript contract. Longer
instructions remain referenced files; the host assembles them per role. The state contains current
work items and dynamic groups. Existing control actors continue to execute and check the binding
service and user grants. A domain workflow and the neutral learning afternoon use the same
contract; `WorkflowDiagram` binds it to the existing rendering. This way reuse is verified on two
real workflows, without introducing a second workflow engine. The extension guide and the author
guide describe the usage including prompt resolution and extension limits.
Affected chapters: `docs/spec/actor-programs.md`, `docs/spec/typescript-platform.md`,
`docs/spec/plugins.md`.

## Redundancy review explicitly against the open changeset (15.09.2026)

The reviewer prompt and the start task name the actual review scope against HEAD: staged,
unstaged, new and deleted files in the run. The existing reuse rule also covers duplicate checks,
derivable states and unnecessary intermediate layers; documented contract and trust boundaries are
exceptions. This keeps the review limited to newly introduced or worsened problems and produces no
second overlapping rule task.
Chapters: `docs/spec/plugins.md`.

## React Flow and ELK replace Mermaid (15.09.2026)

The shared diagram building block gets structured nodes and edges instead of Mermaid text. React
Flow renders cards, status and the interactive view, ELK computes layout and connections. This way
mini-apps use the same visual language as the rest of the surface; LLMs need neither diagram
syntax nor coordinates. Mermaid including export, instructions, template and dependency is dropped.
Chapters: `docs/spec/actor-programs.md`, `docs/spec/plugins.md`; public reference and homepage
adjusted.

## Offer copying without an additional message row (15.09.2026)

The copy icon sits at the top right above user messages and becomes visible on hover or keyboard
focus. It reserves no additional height in the chat history. On devices without hover it stays
visible. Chapters: `docs/spec/plugins.md`; homepage adjusted.

## Stop the whole run via the title bar and the coordinator (14.09.2026)

The full stop is reachable directly in the run title bar, also without the agent inspector. For
this the primary actor gets `run_stop`; a prepared coordinator uses it on a request to cancel
instead of an ineffective message to busy workers. Both use the existing session stop boundary
including plugin cleanup. The tool does not wait for its own turn end, to avoid a mutual wait
state. Conversation and files are preserved. Chapters: `docs/spec/core.md`,
`docs/spec/plugins.md`; homepage adjusted.

## Isolate runtime data outside of source projects (14.09.2026)

A working directory under `RAgents/.data` inherited the outer pnpm workspace during the regular
build despite a correct working directory. The shared default is therefore under
`~/.local/share/ragents/<profile>`; the start rejects data paths in Git/package projects, also after
symlink resolution. There is no automatic data migration and no journal rewrite. Chapters:
`docs/spec/profiles.md`, `docs/spec/plugins.md`; operations and entry point adjusted.

## Mermaid as a mini-app building block (14.09.2026)

Mini-apps can render diagrams from local sources with the shared `MermaidDiagram`. This way they
do not have to implement graph layout, theme and error display individually. The public reference
and the controls template make the building block directly testable.
Chapters: `docs/spec/actor-programs.md`, `docs/spec/plugins.md`; operation and homepage adjusted.

## Keep bash completion on macOS for ended process groups (14.09.2026)

While investigating a supposedly stuck run, `kill EPERM` was visible after ended bash calls. An
isolated macOS experiment reproduces this signal error for process groups that only consist of
zombie entries; the group composition of the run at the time is not documented retroactively. On
macOS `EPERM`, the existence check reads only PGID and status. Only groups proven to have ended are
treated as cleaned up, even if they end between the check and the signal. Real errors stay errors,
while the actual command completion is no longer lost because of this special case. Chapters:
`docs/spec/plugins.md`; operation adjusted.

## Widen expanded actor chats by 40 percent (14.09.2026)

At the owner's request, the chat pop-outs of the LLM actors use 784 instead of 560 CSS pixels of
width. The shared positioning still limits them to the available window space.
Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Keep background tasks out of the conversation (14.09.2026)

The progress monitor appeared in the chat as a user with its internal instructions. Native
ActorInputs can now mark their rendering as background. Delivery, execution and journal stay
complete; the main chat and the actor conversation only hide the task. The understandable answers
are preserved. A prepared workflow uses this marker for periodic and final status checks.
Chapters: `docs/spec/core.md`, `docs/spec/plugins.md`; operation and homepage adjusted.

## Adopt new program layouts automatically (14.09.2026)

A personal tile size could permanently hide later program layouts and thus make new participants
invisible. Personal layouts now store their program base. As soon as the program changes the mode
or tile tree, the new default is adopted directly; unchanged program layouts keep the personal
sizes.
Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Take over the login name when creating a run (14.09.2026)

The product default entered every human participant under a fixed name, also when started by
another user. Chat and setup start now take over the trusted display name from the sign-in;
without a user a neutral default applies. Existing journals stay unchanged.
Chapters: `docs/spec/profiles.md`.

## Clear the search input immediately on submit (14.09.2026)

Clearing after a successful response left the text standing during the search. Enter and the
search button now clear it immediately; a failed call restores the input for correction. The
additional success counter is dropped. The browser test holds both requests before their response
and already checks the empty field at that point.
Chapters: `docs/spec/plugins.md`; operation adjusted.

## History icon and program sources in every actor detail view (14.09.2026)

The X in the view bar selected the history and looked like a close button. A speech bubble now
names this function pictorially. The source tab also takes the activated actor program into
account instead of only the older direct `actor.source` field. Headless actors thus get the same
access to their TypeScript code. Program plugin, source code endpoint, file selection and syntax
highlighting remain the shared building blocks; no second file access comes into being. Sources
only load on opening and again after a program activation.
Chapters: `docs/spec/plugins.md`, `docs/spec/actor-programs.md`; operation and homepage adjusted.

## Show the creation time on run cards (14.09.2026)

Runs with the same name could only be told apart by their last activity. The run cards
additionally show "Created" with date and time from the original journal state. The existing
update display and sorting are preserved. Run list and management API deliver the time along; runs
not yet created have none.
Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Keep the focus ring at the edge of mini-app contents (14.09.2026)

The bounded content of `AppLayout` cut off the outer focus ring of a search row on the left. Four
pixels of padding with a compensating margin keep the ring inside the scroll area and preserve the
previous alignment. The shared layout rule also applies to already installed views on reload.
Chapters: `docs/spec/actor-programs.md`; homepage adjusted.

## Extension guide from concrete integration findings (14.09.2026)

The work on data access, coordinator and workers, language servers and mini-apps showed the same
boundaries in several places: domain function and view, prompt and actual structure, activity and
result, as well as render test and interactive host frame. From this, the public guide explains
eight strategies and a decision aid for functions, scripts, actors and views. Concrete evidence
paths and their reach stay in the internal spec chapter; fixed models, domain filters and product
paths do not become general rules. No new abstraction mechanism and no second documentation store
comes into being.
Chapters: `docs/spec/plugins.md`, `docs/spec/actor-programs.md`; homepage and guide references
adjusted.

## Short search interpreter and visible language server preparation (14.09.2026)

The item selection of a domain plugin accepts free text. A single model call in the plugin
translates it into validated filters; query and list takeover use the existing services. This
needs no further actor or coordinator turn. Model and thinking depth are configured separately,
time and output are limited. Clarification errors preserve the previous list. Enter and the search
button are handled explicitly in the mini-app, because the host iframe allows no native form
submission.

A prompt instruction alone did not open any language servers at run start. The prepared TypeScript
program now starts them in parallel with the selection, using the roots of the product run. The
neutral host and the diagnostics view distinguish loading, confirmed readiness and errors. Status
queries do not wait for the start; stopping and root changes discard late results and clean up
processes. The tests use isolated processes and no product data.
A payload test of the existing model adapter also shows that, depending on the catalog mapping,
`off` explicitly sends `enabled: false` or `effort: "none"`; the interpreter uses this existing
path. The chosen flash model offers only enabled levels in the catalog.
Chapters: `docs/spec/plugins.md`, `docs/spec/profiles.md`, `docs/spec/core.md`; operation and run
description adjusted.

## Make the working actor visible (14.09.2026)

The running worker was invisible in the fixed two-tile layout. Its own actor program now shows real
activity and the reported work step in a small third tile. It uses existing actor views and a
reading plugin operation, no additional AI. Idle and errors stay separate from the checked result;
internal traces are not delivered. The host bridge keeps 512 recently used request ids instead of
permanently aborting after 512 calls. This way the periodic status display also works on longer
runs.
Chapters: `docs/spec/plugins.md`, `docs/spec/profiles.md`, `docs/spec/actor-programs.md`;
operation adjusted.

## Domain instructions with the responsible plugin (14.09.2026)

The new data search was reusable, but its instructions stood in the prepared workflow. At the same
time, the previous domain chapter required exclusively its own result view and assumed the service
access for personal queries. The plugin now delivers a short tool-bound initial hint and separate
detail chapters for data query and view. `typescript_api` loads the matching chapter based on the
actual functions, also for specially created coordinators. The run prompt and its skill describe
the handoff into their mini-app; general search rules stay with the domain plugin. The function
overview stays short. The existing prompt composition and the data contracts need no extension for
this.
Chapters: `docs/spec/plugins.md`; operation and agent instructions adjusted.

## Fixed local addresses per profile (14.09.2026)

The automatic fallback on occupied ports led to changing addresses and could show a different
application when opening a familiar URL. The profile files now fix the server port under
`host.PORT`: core 4710, configuration template 4712. Only an explicitly set `PORT` overrides this
default. The start script and server reject occupied and invalid ports before plugin
initialization; port 0 and the automatic port search are dropped. Running instances are not ended.

In dev mode the backend ports stay the same. Vite uses a fixed 5710 for core with `strictPort` and
the matching backend as the proxy target; the port is checked before the start. The standalone web
dev start uses 5710 with backend 4710.
Chapters: `docs/spec/profiles.md`; README, operation and self-test instructions adjusted.

## Mouse pointer and copying in the chat (14.09.2026)

The text cursor over the history looked like an input area. The shared chat now shows the normal
mouse pointer; the explicit text cursor rule of the canvas preview is dropped. User messages get a
small copy icon for their unchanged text, with success and error feedback. This applies in all
rendering forms of the shared renderer. Chapters: `docs/spec/plugins.md`; homepage adjusted.

## Shared maximum size for mini-apps and chat cards (14.09.2026)

The earlier enlargement of the actor limits left mini-apps at 960 by 720 pixels. Their resize
handles now use the same maximum of 2880 by 2700 pixels as chat cards. The shared source prevents
the upper limits from drifting apart again.
Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Show the current step with Quassel chips and work scenes (14.09.2026)

The plain status line in `current` mode suppressed the familiar chips and the work animation. The
mode now uses the same chip rendering as the other chats. Restricted accesses keep generic labels
without technical details. The shared work scenes follow the actual run state; a pause in the
message stream no longer hides them after 20 seconds. Chapters: `docs/spec/plugins.md`,
`docs/spec/profiles.md`; operation and homepage adjusted.

## Show the current work phase also for restricted accesses (14.09.2026)

A completed run seemed inactive during the browser check: without `runs.inspect`, the server
projection and card chat also removed the information about running steps. The server now delivers
content-free status markers; the web only shows the current thinking or tool phase. Names,
arguments, results and thinking texts stay hidden. A product profile can preset this mode without
expanding or switching. No technical rights are added. Chapters: `docs/spec/plugins.md`,
`docs/spec/profiles.md`; operation and homepage adjusted.

## Open domain details on the right and browser recordings in the canvas (14.09.2026)

A domain mini-app uses compact issue rows in the style of common issue trackers. A click opens the
existing detail rendering in the right side panel, without already starting the task. The mini-app
keeps selection and progress, the chat stays visible. The reuse keeps description, comments and
activity consistent. Browser recordings open as a full image in a canvas-local dialog instead of a
new browser tab. Both paths use plugin operations and the existing host interfaces for tabs and
dialogs. Chapters: `docs/spec/plugins.md`; operation adjusted.

## Darken card headers subtly (14.09.2026)

Card header and content had the same surface. For headers, the shared material rendering mixes
four percent black into the respective card color. Mini-apps, LLM and script cards use the same
rule on the free canvas and in tiles. The header stays full-surface; the reserved space for mini-app
buttons lies within its surface.
Chapters: `docs/spec/plugins.md`; homepage adjusted.

## 90 percent mini-app scaling (14.09.2026)

Mini-app contents use the same factor 0.9 on the free canvas, in tiles and in the full view; the
inner frame compensates for the scaling and still fills the available space.
Chapters: `docs/spec/actor-programs.md`; operation and homepage adjusted.

## Show run preparation on the empty canvas (14.09.2026)

Between an accepted start and visible actors, the surface stayed without feedback. The chat session
therefore reports the actual preparation state, also on reconnect. The canvas shows a loading bar
in the center; after activation, inputs and turns determine whether work is still going on.
Errors, questions and stop replace the loading indicator. Free surface and tiles use the same
rendering without depending on the canvas zoom.
Chapters: `docs/spec/typescript-platform.md`, `docs/spec/plugins.md`; operation and homepage
extended.

## Shared SVG connections and author example (14.09.2026)

Canvas and a domain mini-app each drew arrows themselves. `SvgEdge` unifies this shared part
including state colors, markers and animation. The mini-app SDK exports the same building block. A
neutral example and the author instructions give models a concrete design template; layout and
domain nodes stay with the respective case.
Chapters: `docs/spec/actor-programs.md`; public building block reference and homepage extended.

## Uniform card headers for mini-apps and actors (14.09.2026)

Mini-app headers had smaller titles and no icon. They now share typography, icon frame and spacing
with actor headers. The grid icon comes from the same building block as in the actor bar. Tile
headers also use this rendering; the drag handle stays separate from it. The collapsed app reserves
the new header height.
Chapters: `docs/spec/plugins.md`; homepage adjusted.

## Canvas resizing without saving per mouse movement (13.09.2026)

Tile separators used to save the whole tree on every pointer event and thereby also triggered new
render passes for the contents. The preview now stays local and is updated at most once per screen
frame; only releasing saves. Cancellation, Escape, focus loss and external layout changes discard
the preview. On the free canvas, size measurement and style changes are also batched per frame.
Unchanged chat contents and material bodies are not re-rendered on pure geometry changes. The
docking preview only updates when the target changes.

At the owner's request, tiles now have zero depth levels. The shared box look stays, the space for
the depth body is dropped. Flat material bodies need no size observation.
Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Shared chat spacing and rights for tile arrangement (13.09.2026)

The material rule set the bottom composer spacing to zero and overrode the spacing for tiles. Three
special padding rules are dropped; actor chats use the existing ChatPanel default in both modes.
Material and tiles get their styles via a single plugin entry point. Without actors access, users
could remove tiles without finding them again. Removing and rearranging therefore require the same
right as the actors view; X, drag handle and drag-and-drop are dropped without this right. Size
ratios stay adjustable via the separators. When dragging an existing tile, its newly created
docking guard immediately covered the source header and aborted the native browser drag. An outer
docking target could also lie directly above the starting point. The docking indicator now only
begins after the native dragstart, and only target tiles get the guard. The actual SVG handles are
checked in the browser, including dragging already rearranged tiles again.
Chapters: `docs/spec/plugins.md`; operation and homepage extended.

## Shared card size and material in both modes (13.09.2026)

At the owner's request, chat actors start with double width and height, 720 by 520 CSS pixels.
Mini-apps use the same central default regardless of their placement information. Tiles take over
the layered-work box look of the free canvas with exactly one depth level; the reserved material
overhang keeps outline and body visible. Mini-app contents use factor 0.8 in both modes, so that
their controls do not grow when switching.
Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Start a prepared workflow with two tiles of equal width (13.09.2026)

A prepared workflow uses the new tile contract in the run script: mini-app on the left, agent on
the right, equal weights. This way the whole available canvas surface is ready for the workflow.
LLM tiles get the host's existing card contributions, so that questions in particular can also be
answered there. Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Triple maximum size for actor cards (13.09.2026)

At the owner's request, LLM cards on the free canvas can be enlarged up to 2880 by 2700 CSS pixels.
Size check, settings and CSS use the tripled upper limits. The default and minimum size are
preserved; tiles still follow their split.
Chapters: `docs/spec/plugins.md`; operation and homepage adjusted.

## Fixed tiles next to the free canvas (13.09.2026)

Full-screen apps and chats need a split relative to the available surface. The free canvas stays
the default; a tile mode of its own divides the same contents recursively into weighted areas and
switches off the camera control. Docking targets with a preview and movable separators allow the
same structure directly in the surface. Stable leaf positions in the DOM preserve contents when
rearranging. Personal layouts take precedence over later program changes and can be explicitly
reset to the run default. `canvas_layout_replace` carries both modes; recursive schema types
preserve the nested contracts also in snippets, actor programs and the public SDK reference.
Coordinator and setup instructions describe the modes without replacing the free default unasked.
Chapters: `docs/spec/plugins.md` and `docs/spec/typescript-platform.md`; operation and homepage
extended.

## One depth level as the default (13.09.2026)

At the owner's request, the layered-work cards use one depth level by default. The default also
applies on reset; explicitly stored browser values stay valid.
Chapters: `docs/spec/plugins.md`; operation and product homepage adjusted.

## Mini-app padding centrally in the host (13.09.2026)

Outer spacing used to lie in the individual app styles and could be missing in generated views.
Real mini-app frames now get a shared padding on the scrolling mount point. The scrollbar stays at
the right frame edge, `AppLayout` does not double the spacing and its `fill` layout remains
possible. The bundled apps do without their own outer padding; the author instructions explicitly
leave page layout and spacing to the host. Standalone previews keep their document flow.
Chapters: `docs/spec/actor-programs.md`; product homepage extended accordingly.

## Restore the padding of the mini-app status line (13.09.2026)

The embedded host status line set its side and bottom padding to zero. Messages like "Action
running" therefore stuck to the card edge. They now use the shared side workspace spacing and eight
pixels at the top and bottom.
Chapters: `docs/spec/plugins.md`; product homepage extended accordingly.

## Visible start (13.09.2026)

A local start waited without a message for an unreachable service; at the same time a preferred
port was already occupied by a foreign process. At the owner's request, `scripts/start.sh` remains
the only user entry point for all profiles: occupied preferred ports are skipped with a visible
message. An early port check comes before plugin initialization. A profile preparation logs its
steps and checks network access with a short time limit before its calls.
The dev start additionally chooses a separate Vite port and points its proxy to the chosen backend
port. Both ports then stay fixed, so that a second port choice does not connect the surface to a
different running service.

The browser test also uncovered a technical URL when querying running app actions. The query now
uses the app route and also works without technical inspection rights. Run indicators use domain
action labels and hide technical ids in restricted access.
Chapters: `docs/spec/profiles.md`, `docs/spec/plugins.md`, `docs/spec/actor-programs.md`;
operation in `docs/operations.md`.

## End-user access and guided setups (13.09.2026)

End users start released setups; full access remains. General rights separate operation, free
starts and technical inspection. The same check applies in UI and server, including redacted
snapshots. Sign-in is configurable and independent of the restriction. User passwords may
explicitly be configured in plain text.

A loose shell skill and a tab of its own are replaced by a prepared setup. The mini-app shows the
selection, the progress, conflicts and the completion. A fixed service and a TypeScript control
actor carry out the work steps; a single limited LLM helper discusses conflicts. Separate app and
control actors keep the app usable during long runs. The completion checks the actually built state
server-side. After a cancellation the steps can be resumed based on stored evidence. No silent
fallbacks and no unselected inputs.
Chapters: `docs/spec/profiles.md`, `plugins.md`, `typescript-platform.md`.
Operation in `docs/operations.md`, product overview and public rights description adjusted.

## Choose demos by use case instead of UI control (13.09.2026)

The bundled neutral examples demonstrate RAgents concepts and serve as starting points for
high-level test cases. The previous requirement of two skill examples per UI control produced
unnecessary cards and overloaded tasks. The control quota, its test and the individual UI controls
in the demo concept catalog including tags are dropped. Demos combine the controls that fit their
use case; full control coverage is not a goal. The generated technical UI reference stays
independent of this. The minimum number for product concepts still applies. The descriptions of
all demo entries name their demonstration purpose in the existing `description` field and
distinguish similar cases. Start selection and public reference take over the same text. Chapters:
`docs/spec/overview.md`, `plugins.md`.

## Separate the chat from programmed actor inputs (13.09.2026)

Free chat messages used to be accepted also for TypeScript actors and for runs with a TypeScript
primary. The word game ignored such messages; the acceptance confirmation also misled the global
coordinator into treating a task as delivered and executable. The chat host now rejects these
targets with a domain error before inputs and attachments. The surface and bound mini-app chats
show their history without a chat input. Model descriptions explain program inputs and the limit
of a queueing confirmation. Word game and learning afternoon reject unknown direct program inputs
as errors and preserve their state in the process. The general ActorInput channel remains for
programmed commands and events.
Chapters: `docs/spec/core.md`, `typescript-platform.md`, `actor-programs.md`, `plugins.md`.

## Move the mini-app scrollbar to the card edge (13.09.2026)

For mini-apps, the free space for the resize handle lies below the content. The scroll area thus
uses the full inner card width instead of leaving an unused strip on the right. The card header
keeps its side spacing and stays stable when collapsing.
Chapters: `docs/spec/plugins.md`; product homepage extended accordingly.

## Page through canvas entries and distinguish types (13.09.2026)

When space is short, the canvas bar adds arrow buttons and translates vertical mouse wheel
scrolling into horizontal movement. Scrollbars stay hidden, the fixed list and filter buttons
reachable. Different icons on the existing canvas type colors distinguish LLM actors, TypeScript
actors and mini-apps, even with identical display names.
Chapters: `docs/spec/plugins.md`; operation on the product homepage extended.

## Condense the actor list and keep the app header stable when collapsing (13.09.2026)

The actor list arranges handle and display name side by side, metadata compactly below and the
canvas selection on the right. Long names may wrap. Resizable mini-app cards keep the side space
for the resize handle even when collapsed; the card header thus does not shift when toggling.
Chapters: `docs/spec/plugins.md`.

## Explain concepts before examples (13.09.2026)

The feature sections of the homepage explain setups, agents and coordination, TypeScript as the
AI's way of working, and mini-apps independently of the samples. Headings name these concepts;
captions explicitly label the previews as examples. This way use cases do not appear as product
terms. The previews only change their state through interaction. Scrolling triggers no content or
height changes; the frames get no inner scrollbar during size matching. In the normal page flow,
text and example stand top-aligned with spacing to the next pair.
Chapters: `docs/spec/overview.md`.

## Show sample previews completely and in context (13.09.2026)

The homepage sizes embedded previews by their actual content instead of a fixed frame height. Even
with narrow or low windows the page flow remains the only scroll area. The agents section explains
the two helpers and the collecting TypeScript program of the learning afternoon shown; the
alternative AI coordination stands separately from it. Operating hints and technical digressions
are dropped from the main page; its four feature sections each explain the idea using the visible
example. Details stay in the guide and in the reference. Sample links below the previews start the
same sample as the start button in the embedded help. Chapters: `docs/spec/overview.md`,
`plugins.md`.

## Lead from core ideas to startable samples (13.09.2026)

The guide begins with the collaboration of AI and TypeScript, fixed workflows, actors, messages and
mini-apps. The navigation separates understanding, trying out, building yourself and looking up;
technical tool names only follow after their purpose has been explained.

Word game and learning afternoon are prepared run scripts with mini-apps of their own. Their
homepage previews use the same view components with marked example data. The real model work only
begins at the start in the app. The embedded help can open available samples via the existing run
creation; profile and user rights limit the selection. Visible native scrollbars and a limited
frame height make orientation in long reference pages easier.
Chapters: `docs/spec/overview.md`, `typescript-platform.md`, `plugins.md`; operation in
`docs/operations.md`, executable examples under `plugins/ragents.reference/run-scripts/`.

## Merge duplicate UI and server responsibilities (13.09.2026)

Floating positioning and visibility observation live together in the host UI core; menus,
tooltips, actor pop-outs, step details, journal and global coordinator use them. The X of the
coordinator's short answer stays under the mouse pointer when pressed; its centering no longer
overrides the shared press animation. File intake and local settings stores share their repeated
wiring. Dialogs of the domain plugins use the central dialog shell, both log views the same
component. Primary chat and actor histories share the journal event mapping; routing and the
different rendering rules stay with the two projections. Run stop and engine share error
aggregation; the host HTTP mapper gets domain DomainError status codes, four generic plugin
mappers are dropped. Duplicate route patterns and a duplicate code/path check are removed.

The source review distinguishes real copies from different contracts: flat prompt/run script
headers and YAML skills stay separate, as do actor guards for different data structures and domain
error translations of the domain plugins. Chapters: `docs/spec/plugins.md`, `docs/spec/core.md`,
`docs/spec/actor-programs.md`; the homepage describes the shared resizing of the pop-outs and step
details.

## Explain verified runtime limits in the public guide (13.09.2026)

The hints of the concept audit were checked against drivers, state takeover and existing tests.
The guide now explains an actor's own model context separately from actor state and journal, as
well as the meaning of ID, handle and spawning again. A stopped actor does not release its handle;
conversation memory does not only come into being through an actor program.

Existing spec sections on stops and lifecycle are made publicly accessible: the run stop keeps the
primary actor, but waits for the cleanup. After a server restart, waiting ActorInputs differ from
cancelled turns and mini-app calls. The state takeover of a successful function does not roll back
side effects that have already happened on later errors. These limits are meant to make repetitions
and continuations understandable, without promising exactly-once execution.
The access chapter explains capability, grant, scope and delegation as well as the difference from
user rights and mere function selection. The terms sign-in session, model context and user rights
avoid apparent contradictions between the chapters. The final consistency check also clarifies
updating the same program package as opposed to the rejected second package, as well as the roles
of `create` and `register` and the skill metadata item `disable-model-invocation`.
Chapters: `docs/spec/core.md`, `actor-programs.md`, `profiles.md` and `plugins.md`; the guide texts
are generated from the same sources.

## Check the final answers of the concept audit and correct them specifically (13.09.2026)

The audit takes over the last model answer instead of a concatenation with intermediate comments.
The synthesis gets a real JSON schema for findings and open questions; the report checks required
fields, types and source evidence. A reasoned assessment and the synthesis's own comparative reads
prevent two empty arrays from counting as a completed review.
Invalid answers can be corrected twice in the same session, so that sources already read are
preserved. The call and time limits include the corrections and the network exchange and do not
start again.

The defaults rise to 60 model calls and 900 seconds per agent with up to 16000 output tokens per
model request. Answers and usage data of every attempt are kept for review. A result that is still
invalid after the corrections fails explicitly; it produces no seemingly successful report.
Contiguous read excerpts are merged during the evidence check; real reading gaps stay errors.
`--resume` takes over reviewer reports only with an unchanged source state, focus and mode and
repeats the synthesis with a new budget in a new output folder.
Chapters: `docs/spec/overview.md`; operation: `docs/operations.md`.

## Investigate duplicate implementations with the existing F# audit (13.09.2026)

On request the scan uses the large `z-ai/glm-5.3`; `--reasoning-high` sets the reasoning intensity
explicitly in the HTTP request, checked by the local mock. The concept audit gets `--duplicates`,
so that source access, model connection, limits and evidence check keep using the same
implementation. Three GLM reviewers examine surface/CSS, runtime and plugin boundaries; a synthesis
bundles documented duplicates with consequences and a shared replacement. The code corpus also
includes product-specific plugins, but needs no guide. Chapters: `docs/spec/overview.md`; the call
and the transfer of read sources to the model provider are described in `docs/operations.md`.

## Actor type filter and shared pop-out control (13.09.2026)

Instead of `Coordinator only`, `Display` offers the type filters `LLM agents` and `TypeScript`;
`All` and `Active` are preserved. The fixed width prevents neighboring buttons from jumping. The
new storage format starts with `Active`, without taking over the removed mode. Chat and actor list
had separate positioning logic with different spacing. Together with the canvas view, both now use
`ActorPopout` for positioning, size limiting, header, focus and rendering. The surface attaches to
the button without a gap. Chapters: `docs/spec/plugins.md`; README, operation and homepage are
adjusted.

## Actor list in front of the canvas and configurable header entries (13.09.2026)

The collective button `Actors` opened its list, but its surface lay behind the canvas. An explicit
stacking position makes it visible and usable. The browser check uses the real
OrchestrationCenter with its header portal and canvas instead of only individual header entries.
The new left button `Display` switches the direct entries between all actors, active actors and
only the coordinator, independently of canvas visibility. The full actor list stays reachable. The
selection stays per run in the browser; hidden chats keep their drafts. Open toolbar buttons show a
recessed accent surface. Chapters: `docs/spec/plugins.md`; README, operation and homepage describe
the mode choice and the pressed state.

## Restore actor pop-outs in the canvas header row (13.09.2026)

The direct actor entries only opened the right panel anymore. They again open a surface below
their button: for LLM actors including the coordinator the chat with input, for TypeScript actors
the actor view. Both use the existing inspector, so that history, functions and detail tabs show
the same state. Visited views keep their input drafts on closing and switching. Floating UI
adjusts the position on scrolling and resizing. Chapters: `docs/spec/plugins.md`; README,
operation and homepage describe the direct entries.

## Replace the model connection with AI SDK Core (13.09.2026)

Vercel AI SDK Core (`ai` 7) and `@openrouter/ai-sdk-provider` 3 take over the model requests,
including streaming and image generation. The forked OpenAI provider path with its special cases
for providers that have already been removed and the direct `openai` dependency are dropped. An
adapter preserves the event contract, native attachments, reasoning metadata, cache markers, cost
calculation, and request and response hooks. Small translations for `reasoning_content`, older
reasoning field names, and tool cache markers close the gaps to the SDK interface. Image
generation rejects responses without usable image data; cache reads and cache writes count as
separate token amounts.

The own session and agent runtime remains: private contexts, tool execution, skills, extensions,
compaction, and the agent loop are a separate rework. Here the SDK executes exactly one model step
and does not start a second agent loop. The previous protocol identifier is kept for model
descriptions and stored sessions. Chapters: `docs/spec/core.md`; the package README describes the
integration boundary.

## Use standard libraries for streams, JSON-RPC, and positioning (13.09.2026)

`eventsource-parser` replaces the own SSE parsing in the chat and handles split UTF-8, different
line endings, and multi-line data fields. `vscode-jsonrpc` takes over the transport to language
servers, including framing, requests, and responses. The existing process management and the
domain LSP adapters remain the integration boundary.
The writer adapter redirects write errors into closing the connection, because `vscode-jsonrpc`
9.0.2 would otherwise additionally throw them from an asynchronous promise executor.

Floating UI replaces the own viewport calculation of select menus and header tooltips.
Positioning and size limits follow scrolling as well as size and layout changes; native popovers,
dialog assignment, and interaction logic are kept. This way the general protocol and browser
rules live in the libraries. Chapters: `docs/spec/core.md`, `docs/spec/plugins.md`; the homepage
describes the behavior of the select menus.
The local homepage demo blocks connections via Content Security Policy. Its check verifies this
block and missing run endpoints instead of counting unused network helpers in the library bundle
as actual access. Chapters: `docs/spec/overview.md`.

## Open the run coordinator via the actor bar by default (13.09.2026)

Canvas visibility hides the primary actor unless there is a personal individual decision. The
run coordinator thus stays reachable via the existing access in the actor bar and its inspector
chat without additionally taking up space on the workspace surface. An explicitly shown card
stays visible; Reset restores the default.
Chapters: `docs/spec/plugins.md`; README, operations, and homepage follow.

## Start the run after the go in the preparation chat (13.09.2026)

The tool-less preparation call gave way to a dedicated agent session with a shared base prompt of
the global coordinator and a targeted preparation role. This lets the user start the discussed
task with a go in their own words, without a fixed sentence or an additional click. The
parameterless start function takes over the complete task including skill and attachments via the
same start path as the button. It records the handover until the response completes successfully,
so that cancellation and errors do not trigger an execution.
Chapters: `docs/spec/plugins.md`, `docs/spec/core.md`; README, operations, and homepage follow.

## Align the card header with the chat content (13.09.2026)

Additional side margins on the role icon and size button were dropped so that the header row
uses the same content margins as the chat history. Chapters: `docs/spec/plugins.md`;
the homepage describes the flush alignment.

## Show only the current chat step by default (13.09.2026)

The new detail level "current" shows only "Thinking" or the box of the currently running tool
call while work is in progress. Earlier steps disappear from the display but remain reachable via
the previous detail levels. This reduces the history to the conversation and the current
activity. The mode is the default for run chats, agents, global coordination, and the shared chat
control; explicitly saved selections are kept.
Chapters: `docs/spec/plugins.md`; the homepage describes the new default.

## Fixed depth levels and more compact cards (13.09.2026)

The material setting determines the number of depth levels, from 0 to 5, with a fixed spacing;
the default is 3. Each visible level thus corresponds to a fixed depth. Old pixel values are not
migrated; invalid settings can be reset after an error message.
A single front outline, smaller header rows, and one-time side chat spacing give the content more
room. The resize handle needs less free space on the right. At least 32 pixels between depth
bodies are sufficient; larger layout and connection spacings remain.
Chapters: `docs/spec/plugins.md`, `docs/spec/actor-programs.md`; operations and homepage follow.

## Render Markdown in the chat with Streamdown (13.09.2026)

The line-based home-grown renderer did not recognize horizontal rules, among other things, and
could not reliably render nested formatting. Streamdown takes over Markdown and GFM as well as the
provisional completion of incomplete syntax during output. Completion of the message switches to
static rendering; host links and chat styling remain integrated.
The renderer receives the original text so that indentation is preserved during streaming.
Chapters: `docs/spec/plugins.md`; the homepage describes the rendering in the chat.

## Put apps and actors into a dedicated canvas bar (13.09.2026)

Apps and actor accesses sit in a dedicated bar at the top of the canvas. The accesses to the open
run thus belong directly to the workspace surface. The searchable actor list stays reachable on
the left; apps and direct accesses to active non-human actors scroll side by side. The shared
title bar becomes more compact with
45 instead of 56 pixels. The status bar stays 28 pixels high. A fine bottom
divider separates the canvas bar; its own shadow is dropped and the shadow of the
title bar lies on top of it.

The bar lies outside the canvas dialog area. App selection and switching to full view thus remain
usable while a mini-app is open. The existing plugin slot receives
`placement: "canvas"`; contributions without this setting stay in the title bar. Chapters:
`docs/spec/plugins.md`, `actor-programs.md`; the product homepage follows the new arrangement.

## Check guide and code with separate readers (13.09.2026)

An external F# script compares the public guide with neutral code and tests via Microsoft Agent
Framework and OpenRouter. Separate roles first read the description and the implementation
independently; the synthesis must then back findings with sources. This way the description is
not already treated as evidence of the code on first reading.

The report documents the actual read accesses and does not claim a full scan.
Model calls and runtime are limited per agent; a dry run checks the preparation without a model.
Understandable progress messages show which checker reads which sources or is waiting for a
model, so that longer runs also stay traceable. Results stay outside the repository; changes to
spec or code are
not part of the tool. It serves development and does not add a runtime capability to
RAgents. Chapters: `docs/spec/overview.md`; operations: `docs/operations.md`.

## Generate the public guide from the existing documentation (13.09.2026)

Besides the product overview and technical references, the homepage has a coherent guide for
getting started, runtime, TypeScript functions, actor programs, extensions, and permissions. The
explanations are generated from marked public sections of the spec and operations documentation.
The domain source thus stays in one place, while readers on the website get directly from the
explanation to code examples and contracts. Marked complements the existing static generator; a
dedicated documentation server is not required.

Chapters, Markdown versions, LLM index, static export, and embedded help are produced together.
The check detects missing source sections and invalid local page and anchor targets. Private
operational data and internal concepts are not taken over automatically.
Chapters: `docs/spec/overview.md`, `core.md`, `typescript-platform.md`, `actor-programs.md`,
`plugins.md`, `profiles.md`; operations: `docs/operations.md`.

## Show available TypeScript functions automatically (13.09.2026)

Equipped LLM actors receive all actually granted TypeScript functions with name and short
description. The overview follows the resolved function set and its changes in the running turn;
it applies to the coordinator, subagents, and the global coordinator.
Pure LLMs with an empty tool selection stay without an overview.

`description` remains the concise statement of purpose, `longDescription` adds detailed rules and
examples when needed. `typescript_api` delivers these details together with the types
specifically on request by name. The model thus knows its capabilities without constantly
carrying complete contracts in its context. Registration, overview, and lookup use the same
source. Chapters: `docs/spec/plugins.md`, `typescript-platform.md`, `core.md`, and
`overview.md`; operations and public references are adjusted accordingly.

## Read negative system UIDs in macOS process tables (13.09.2026)

The overall check of the skill merge found an existing parser bug:
`ps` returns the UID `-2` for the system process `dhcp6d`. This line blocked
process observation and cleanup. The macOS parser accepts signed UIDs;
process IDs stay non-negative. A regression test secures the observed line.
Chapters: `docs/spec/plugins.md`.

## Merge prompt cards into skills (13.09.2026)

Text-based entry points share `skills/<name>/SKILL.md`. A skill can bring an editable start task
and be loaded as a guide during work; supplementary files stay with the same entry. Concrete
example tasks can be selected explicitly but are not automatically recommended as work
instructions. `SKILLS_DIR`
replaces the separate card directory.

All skill entry points lead into the same preparation chat, even after a setup dialog.
The run takes over the worked-out task and the selected skill. This removes
the second text format and separate operating paths. Run scripts keep their programmed structure.
Chapters: `docs/spec/plugins.md`, `overview.md`, and `typescript-platform.md`.

## Unify the free space at the resize handle for all canvas cards (12.09.2026)

The spacing belongs to the shared card container with resize handle, not to the chat input.
All content, including mini-apps and document sections, gets eight pixels at the bottom and
30 pixels on the right. The additional composer rule is dropped; cards without a handle stay
unchanged.
Chapters: `docs/spec/actor-programs.md`.

## Put actors directly next to the global coordinator (12.09.2026)

The actors icon sits directly to the right of the global coordinator and before the run title.
A dedicated contribution in the header row keeps it reachable independently of the right panel.
Chapters: `docs/spec/plugins.md` and `actor-programs.md`.

## Trace TypeScript executions in the side panel (12.09.2026)

`Executions` collects the snippet calls of all actors of a run with status, time, source code,
result, logs, and errors. The read-only view belongs to the orchestration extension;
execution remains part of the server's base equipment. Search and status filter make it easier to
check a running or ended run. Only the active tab refreshes its data.

The host journals the source code actually read before type checking. After a change, a file path
alone no longer proves which code was checked or executed.
The state at that time is therefore kept even on compile errors. Older inline calls
show their stored input; if an old file call lacks the snapshot, this is shown openly.
There is neither a reload of today's file nor a path to execute again
in the tab. Changed: `docs/spec/plugins.md`, `typescript-platform.md`, `core.md`, and the
journal/TypeScript section of the homepage.

## Reconnect document displays in all actor conversations (12.09.2026)

The new actor chat had not taken over the registered tool presenters and therefore showed
`show_document` only as a tool chip. Standard chat, canvas, and inspector now obtain
the rendering from the same session context. The documents collection also takes worker
histories into account, so that their visible document buttons open an existing target;
identical calls appear only once. Chapters: `docs/spec/plugins.md`.

## Put the chat input closer to the card edge (12.09.2026)

The bottom padding of the canvas input is eight pixels. On the right, 30 pixels remain for the
inner resize handle; its height does not create a separate footer strip.
Chapters: `docs/spec/actor-programs.md`.

## Move actors into the upper workspace bar (12.09.2026)

The actor list now opens downward via an icon next to files and the language tools.
View, journal, and zoom stay in the bottom status bar. Search, inspector selection, and
personal canvas visibility are kept. Chapters: `docs/spec/plugins.md`.


Dated log, newest first. It says WHY something is the way it is. WHAT is, is in the chapters
under `docs/spec/`; a new entry names the chapter it changed and is written together
with the chapter change. Entries before 04.09.2026 name no chapter and have
not yet fully flowed back into the chapters (see TODO.md).

## 12.09.2026: One TypeScript API for snippets and actor programs

Domain functions are registered once with `defineRunFunction` and `host.functions` and are
available via `context.functions` in one-off snippets and persistent actor programs.
The small native model surface discovers contracts with `typescript_api` and executes code with
`typescript_eval`; native domain tools are an explicit option. The host uses
the same compiler, function resolver, and executor. Search and snippets belong to the
server's base equipment, so that the global coordinator and profiles without the actor program
plugin use the same interface. The global prompt also allows free domain starts.
A setup no longer needs a dedicated
setup actor. `agent_spawn` returns the created actor reference directly instead of an event list.

The previous path combined a mandatory setup actor, tool grants, and different
execution contexts. The simplification moves technical contracts into the discoverable API.
Domain prompt cards remain result tasks, without a prescribed technical structure.
Snippets act as the caller, actor inputs as the receiving actor; published functions
keep owner state and caller identity. Completed side effects are kept on a later
error. Guides therefore show resumption and actual result verification.
Type checking covers the declared backend entry point even outside `tsconfig.include`,
without overriding author configurations. Results and state are already checked as strict JSON
before IPC, so that e.g. `Infinity` does not silently arrive as `null`; TypeBox contracts
are explicitly exported as JSON without metadata for their description.
Changed: `overview.md`, `typescript-platform.md`, `actor-programs.md`, `plugins.md`, and `core.md`;
README, operations, public homepage, and generated reference examples follow the same approach.

## Remove the additional footer strip below canvas content (12.09.2026)

Chapters: actor-programs. The additional empty line below the single-line input is unwanted.
The blanket 32 pixels of padding for the resize handle are dropped for LLM cards and
mini-apps. The handle stays in the corner; the previous tight inner edge of the input suffices.

## Balcony as a prepared demo and spacing to the resize handle (12.09.2026)

Chapters: plugins, actor-programs. A balcony demo setup was explicitly requested.
The reference package sets up the advisor and its own app in TypeScript; questions and
recommendation stay with the model. It uses the existing actor and chat contracts.
A start button separates the setup from the first model call; a repeated request after
model errors does not count an additional answer. The prompt card remains a separate task
for the builder. No general domain wizard requirement follows from this.
Because the inner resize handle lay over error messages and inputs, resizable canvas apps and
LLM cards reserve space for it at the bottom.

## Explicitly limit run setup and tool selection (12.09.2026)

Chapters: core, typescript-platform, plugins, profiles. Despite the loaded instruction, the
balcony test showed a direct setup and a conversation advisor with an inherited question tool.
General platform corrections were requested, explicitly no domain wizard requirement.
The run builder prepares TypeScript and starts it; direct structural model tools
are dropped. Domain agents choose their tools explicitly at spawn, without silent inheritance.
The existing host creation command keeps the builder prompt and coordinator contributions with
the right actor even after a primary switch or fork. Canvas and view visibility share their
name resolution. Known views of stopped actors are removed from the scene so that a
stop does not produce orphaned error placeholders. At the owner's request, the run coordinator
gets high as its default thinking level. A repaired single run does not count as proof for the
builder.

## Remove additional shadow effects completely (12.09.2026)

Chapters: plugins, actor-programs, overview. The owner wants the effect removed after trailing
artifacts became visible again. WebGL contact shadows, iframe runtime, material port messages,
and the shadow sliders are dropped completely. The filter drop shadow of the cards is dropped as
well. Material depth remains adjustable independently of this. The previous offline drafts stay
in the shared overview as drafts.

## Simplify the card header and keep inner handles reachable (12.09.2026)

Chapters: plugins. In the LLM card header, the owner wants only icon, name, and size button;
role heading and input counter are dropped. After moving it inward, the handle lay
below the input bar. Its drawing layer now lies above it. Header row, right panel, and
status bar get their own opaque slate blue, so that the background does not mix warm
colors into these surfaces.

## Match the application to the canvas palette (12.09.2026)

Chapters: plugins. The rest of the application did not look like it belonged together in color.
Cool blue-gray base surfaces, lavender for selection and actions, and violet-gray outlines
replace the warm shell colors. Header row, panels, dialogs, and settings take them over
via the shared tokens. The previously hard-coded file, task, document,
and development status colors also use central colors with a matching dark variant.

## Liven up the canvas background and move handles inward (12.09.2026)

Chapters: plugins. The background was too flat, the cards still too cramped.
Several soft gradients bring back lavender, mint, blue, and a warm edge area;
the material texture becomes weaker. Between the depth bodies at least 72 instead of
40 CSS pixels remain. The resize handle again sits inside the card corner and uses
black at 70 percent opacity, also on hover.

## Mediate the balcony conversation through a standalone canvas app (12.09.2026)

Chapters: plugins, typescript-platform. The generated wizard asked five fixed questions and used
the advisor only for the evaluation. What is wanted instead is a bounded LLM conversation:
the app relays each answer, the LLM determines the next question. The prompt card therefore
explicitly requires a standalone app on the canvas, outside an LLM chat card.
The setup instruction belongs in the prompts of the global coordinator and run builder;
it is not additionally distributed to domain agents via the general tool quick guide.

## Resolve canvas views before saving (12.09.2026)

Chapters: plugins. The balcony run placed `app:balcony-wizard/wizard`, while the active
view had a different internal name. The layout stored this reference unchecked and only showed an
error on the surface. The tool now resolves self-chosen program or actor names with a
view key on the server and rejects unknown views before any state change.
Models thus do not have to transmit generated view IDs. Existing layouts are not
rewritten; a new layout call uses the check and resolution.

## Bind contact shadows to the actual drawing surface (12.09.2026)

Chapters: plugins. Enlarged, offset shadows appeared next to the inputs.
The renderer assumed that the GPU buffer takes over the requested browser resolution.
A large test viewport reproduces the deviation: instead of 24000 pixels of width, the GPU
provides only 8192. Shader and viewport therefore compute with the actual drawing buffer
and the measured screen area of the canvas. The mapping also follows zoom and panning.

## Correct card spacing and mini-app color (12.09.2026)

Chapters: plugins, actor-programs. The owner wants more space between the depth bodies and
no beige mini-app. The minimum spacing grows from 18 to 40 CSS pixels in addition to the
extrusion. Mini-app surface and shared controls switch to matte blue-gray. The single
resize handle stays outside but sits twelve pixels closer to the card corner.

## Single-line quassel input in LLM cards (12.09.2026)

Chapters: plugins. The owner wants more room for the conversation in the LLM actor cards.
The shared quassel composer gets an inline layout with text field, attachment,
detail level, and send side by side. Attachments, error handling, and draft restoration
stay in the same building block; in the right inspector the previous input height is kept.

## Adopt the Schichtwerk depth bodies as canvas material (12.09.2026)

Chapters: plugins, actor-programs, overview. The owner wants the elaborated material effect of the draft
layer-depth-style.html in the running interface. Straight matte fronts, round edges, and
bodies extruded to the upper right replace the glass cards. The side depth becomes lighter
toward the back in three levels; the wide corner shading only darkens. Divider lines
and mouse-dependent light are dropped. Lavender, clay, mustard yellow, and lime white
distinguish the actor kinds and mini-app hosts. The mini-app controls also take over matte lime
surfaces, lavender actions, and round corners. Size-dependent WebGL contact shadows complement
them.
Display contains browser-local sliders for material depth and shadow: depth 44, shadow on,
and strength 30 are the defaults. Changes take effect immediately in all runs and mini-apps.
The labeled canvas diagram of the homepage follows the material; the original offline draft
stays in the shared draft overview for comparison.

## Explicitly distinguish setup code from mini-app code (12.09.2026)

Chapters: core, typescript-platform. The current balcony wizard run had the new setup rule
in the coordinator prompt but built only the mini-app program in TypeScript. Agent, activation,
subscription, and canvas were still set up directly. The previous preference therefore
becomes an unambiguous work instruction for multi-part setups: even agent plus mini-app
requires a setup handler that executes the setup calls. The direct calls needed to prepare and
start this handler are named explicitly. The runtime still does not enforce
this prompt rule technically. The observed run is not rebuilt by this.

## Offer the balcony wizard as a mini-app prompt card (12.09.2026)

Chapters: plugins. The owner wants to be able to build the balcony wizard again from the start
selection. The neutral reference gets a short prompt card for this: five questions building on
each other in a dedicated interface, followed by a design recommendation. Shared layout
and form building blocks as well as visible loading and error states belong to the task. The card
registers a setup request, not a permanently installed program. The previously extended
text analysis and list prompts are also condensed back into short domain tasks.

## Remove mouse light from the draft (12.09.2026)

Chapters: overview. The owner does not want lighting that follows the mouse. The draft removes
the switch, mouse control, and the additional front gradient completely. Fixed matte fronts,
stepped depth bodies, and size-dependent contact shadows are kept.

## Make moving light visible in the draft (12.09.2026)

Chapters: overview. The earlier front gradient darkened by at most about 3.5 percent and
moved relative to the whole stage; the effect was not noticeable.
"Light follows mouse" now uses the coordinates of each box and a more pronounced matte
gradient without brightening. With reduced motion the effect starts off but can be
activated deliberately; previously the setting invisibly blocked the enabled switch.
Switching off and leaving the stage cancel updates that are still pending.

## Adjust contact shadows to the size of the control (12.09.2026)

Chapters: overview. The contact shadows in the Schichtwerk draft were too strong on checkboxes.
The shader therefore scales spread, offset, and opacity by the shorter
control edge. Small and narrow elements thus stay subtle, while larger surfaces keep the
previous depth. The strength slider still affects all controls but preserves
their size ratio. The existing draft and its two previews are updated.

## Deliver mini-app base layout and form structure together (12.09.2026)

Chapters: actor-programs. The balcony wizard showed the browser default font and an overlapping
text field. The library delivered domain controls but left base layout and typography to the
generated app sources. The host now delivers the base centrally; AppLayout, Stack, and Grid take
over frame, spacing, and columns based on the container width. Text analysis and shared
list use the same building blocks and Form for their inputs. The author guide also steers
wizards toward Form; field CSS now only affects real input elements. The existing demos
show textareas and a local interview step. Own app sources remain editable;
the change does not replace old programs automatically.

## Explain model choice at agent spawn directly on the tool (12.09.2026)

Chapters: core. The balcony wizard setup tried to create an LLM agent with only a handle and
prompt. Profile and model were individually optional in the schema and without an explanation
of their dependency. Tool and field descriptions now name the required explicit
model choice; the orchestration prompt requires it for every LLM spawn. The hard error is
kept instead of replacing the missing selection with a silent default profile. Whether the
model used reliably follows the clearer guidance needs another real run.

## Prefer executing multi-part run setups as TypeScript (12.09.2026)

Chapters: core, typescript-platform. The owner wants related setup steps as
checkable code instead of a long sequence of individual model tool calls. The global coordinator
should prefer existing run scripts or create its own packages; in an existing run
the coordinator uses the same actor program path with a setup handler. Simple starts and targeted
individual changes stay direct. The prompts require the setup before work tasks and
an inventory check before repetitions, because capability calls have no shared rollback.
The change uses existing contracts and introduces no new setup abstraction.

## Limit unreadable journals to their run (12.09.2026)

Chapters: core, overview. It is explicitly required that old or damaged journals
never block the server start or other runs. The switch to file format 4 had still ended the
start at the first v3 file. Recovery now takes over each run only
after a complete check; errors isolate its ID and report path and cause. Original files
are kept; automatic migration and re-creation under the same ID are dropped.
Direct accesses report a named run error. An error during a running journal append also
locks only its run. The explicit global conversation reset can release a locked
coordinator ID. An empty overall data set is not necessary for the server start.

## Evolve Schichtwerk into matte depth bodies (12.09.2026)

Chapters: overview. The new offline draft layer-depth-style.html evolves Schichtwerk
with bodies clearly extruded to the upper right, round bevels, and matte shading.
Material depth defaults to 56 instead of 22 and can be set between 24 and 80.
Outlines on the front and the outer silhouette give the bodies a drawn character.
The side surfaces do without additional strokes. Three flat shadow levels structure
the depth; the small drop shadows on the controls stay soft.
The depth runs darker at the front and lighter toward the back up to the unchanged side color.
The matte surfaces, round edges, and straight fronts are kept. The shading of the
upper right rounding extends over a wider area onto the adjacent sides.
It is darkest in the middle of the arc and decreases outward in clearly separated levels.
All material shading only darkens. A soft drop shadow follows the entire silhouette instead of an offset shadow plate.
A transparent WebGL layer per card adds soft contact shadows to real HTML controls.
Distance functions of the rounded controls model resting and indentation; when pressed,
the resting shadow becomes tighter. The stepped boxes are kept. A switch and a
strength slider make the effect comparable; missing WebGL is reported visibly.
The shader draws only on changes to size or interaction state. Straight fronts,
adjustable material depth, and moving light make the shape effect comparable. The page with desktop and mobile preview is first placed in the existing
draft overview; the running interface does not yet adopt this draft.

## Keep actor steps when switching the main chat (12.09.2026)

Chapters: plugins, actor-programs. After a switch, the previous main actor fell back to a
projection of inputs and answers. Thinking and tool steps were therefore invisible despite
an activated detail level. The host now delivers separate conversation histories per actor
from the journal and updates them via the existing run notifications. Cards,
inspector, and mini-app chat use the same histories. The compact run view still contains
no tool arguments or results.
The resize handles of the canvas cards lie as a single arc outside their bottom
right corner. A larger hit area keeps them usable without covering the input area.

## Keep individual styles visible in the draft overview (12.09.2026)

Chapters: overview. Merging the top tabs had also removed the individual previews from
the card grid; Poster, for example, was only reachable behind Farbwerk.
The grid again shows each style with its own preview and a direct variant link.
Only the top bar merges collections. Team grid, Conversation circle, and the synth interfaces
had been wrongly dated 11.09. when added later; their original 05.09. restores the
chronological order. Variants take over the draft date of their collection.

## Slim down the journal and store large content separately (12.09.2026)

Chapters: core, actor-programs, overview. The owner wants stronger file system storage and less
superfluous journal content. File format 4 keeps shared metadata once per command and
moves large payload fields out into immutable, verified JSON files in the respective run.
A subscription delivery stores only its source; on fork, its content is produced from the newly
assigned events. Actor and plugin states use smaller field changes, so that,
for example, status changes of mini-app calls do not copy previous results again.
The journal checks new events on an isolated current projection instead of replaying the complete
history before every append. Public events and state views
stay resolved; commit boundaries and idempotency are kept. A failed
journal append blocks further write attempts until reopening, so that bytes possibly already
written do not cause duplicate commands. Archiving and forks
include the content files. There is no migration of existing development journals.

## Use one persistent right-hand stage for the core features (12.09.2026)

Chapters: overview. The previous pinning failed with reduced motion, low windows,
or missing moveBefore. The diagrams then appeared stacked vertically again.
All visualizations now lie permanently in a shared frame; CSS keeps it fixed on the right,
ScrollTrigger only switches its content. The mobile order is also produced via
CSS, without re-parenting the mini-app. Frame and inputs are thus kept even on resize.
The previous box diagrams explained the benefit too little. The three new visualizations
therefore show traceable reference flows including the result: a run script produces a
shared list, parallel helpers produce a collection of ideas, fixed handovers produce a word game
that ends after twelve contributions. Schematic answers are marked accordingly.

## Use the quassel input on LLM cards too (12.09.2026)

Chapters: plugins. LLM actors can be written to directly on their canvas card. Card
and inspector share the quassel input including attachments, error handling, and detail level
selection. This avoids a second implementation of the same interaction. The existing run write
permissions and the actor lifecycle determine whether sending is allowed; model and thinking
level selection are not offered there. Cards now use the same selected detail level as the
inspector, so that the setting also takes effect directly on the conversation. Default and
minimum height of the LLM cards rise to 260 pixels, because at 182 pixels only one chat line was
readable next to the permanently visible input.

## Open enlarged mini-apps only over the canvas (12.09.2026)

Chapters: plugins, actor-programs. The mini-app dialog occupies only the workspace surface and
leaves the right panel as well as the header and status bar usable. The existing modal host gets
the area `canvas` for this; border, shadow, blurred background, and title make the
enlarged view recognizable as a dialog. The mini-app itself stays the same interface.

## Navigate to the next element on the canvas with the arrow keys (12.09.2026)

Chapters: plugins. The arrow keys center the spatially nearest visible element in the
chosen direction. This lets you explore the canvas deliberately via keyboard at a constant zoom,
without triggering the inspector selection or app actions. The smooth movement takes
300 milliseconds; holding the key continues it without queued repetitions. Focus in
controls and the target selection of the canvas overview keep their own interaction. Other
camera gestures take over immediately; reduced motion switches the animation off.

## Show setups as the entry point and mini-apps directly (12.09.2026)

Chapters: overview. Programmable setups were not visible enough between events and journal.
They now open the core features; clickable stickers highlight the five central capabilities
right in the introduction. At the owner's request, the mini-app explanation shows the
usable shared list instead of another technical diagram. Its original interface
and list function run locally in the browser for the homepage. Scrolling adds example notes
until the user intervenes themselves. When the visualization switches, their input is kept.
The local demo is built together with the homepage and shipped in the help.
A polishing pass removes the decorative tape strip on the setup sticker. Additional spacing
and a fading background avoid the hard bottom edge with the same element placement.

## Allow uppercase letters in mini-app function calls (12.09.2026)

Chapters: actor-programs. The actor contract allowed `addEntry`, the mini-app call route, however,
only lowercase names. A click was therefore rejected with 404 before the function was executed.
The route now accepts the same names as the direct actor function call;
an HTTP regression test checks the complete path up to the stored result.

## Actually bind existing mini-apps to the shared UI (12.09.2026)

Chapters: actor-programs. Switching the templates did not change existing program packages.
The note list shown still used its own blue HTML buttons and field rules instead of
the shared UI. Its existing interface is switched to the shared button and the
field class. The author guide explicitly requires this binding for standard controls,
so that central style changes also reach existing apps on load.

## Call functions directly in the detail panel (12.09.2026)

Chapters: actor-programs. The function details get a generic input form including
call status, return value, and error display. Installed functions can thus also be
used directly without their own mini-app. Detail panel and tool cards share the form building
block; the existing function contract and host determine inputs, call, and confirmations.
An additional model turn is not needed for this.

## List draft collections instead of individual variants, newest first (12.09.2026)

Chapters: overview. The grown draft overview now shows only one entry per draft page at the top
and in the card grid. Their own menu gives access to the individual variants; the
duplicate entries were dropped at the owner's request. Previous variant links stay reachable.
Tabs and cards are sorted by date descending, within the same day in the maintained
order. New collections are thus reachable before the older ones.
The grid gets an explicit available width and shrinkable columns and cards;
its previous minimum width led to horizontal overflow. The newest collections are at the
top left, and when opening the overview the tab bar returns to its left start.

## Carry Signal through to the mini-app templates (12.09.2026)

Chapters: actor-programs. The shared controls already used Signal, but the templates for
text analysis and shared list as well as the collection board still used their own blue buttons,
large round fields, and fixed light colors. They now use the shared controls and
theme tokens. The chat input also gets the Signal outline. The chosen
draft thus also arrives in the bundled mini-apps. Existing run sources are not rewritten.

## Call actor interfaces mini-apps for users (12.09.2026)

Chapters: overview, actor-programs, plugins. The owner wants the term mini-app for the
interfaces of an actor. Homepage, graphics, navigation, references, examples, and visible
app labels therefore use mini-app or mini-apps. The technical
view contracts and existing identifiers are kept.

## Orient the global coordinator by the location of the submitted question (11.09.2026)

Chapters: core, plugins. A question like "What does this actor do?" needs the reference to the
selection in the interface. The browser therefore sends a compact UI location with every global
message; the server adds the existing run references and names. User text and
orientation stay separate. Plugin journal state, input source events, and the dynamic
system prompt bind the snapshot to exactly this input, so that queues and later
run switches do not shift it. Missing information explicitly means no current
location. The orientation stays small and grants neither tasks nor permissions.

## Keep the personal canvas layout per run (11.09.2026)

Chapters: plugins. When a run was reopened, the viewport and manually
adjusted element sizes were lost. The browser therefore stores panning, zoom, card and
app sizes including compact and collapse choices per run in local storage. The temporary overview
is excluded from this; a stored camera prevents the initial fit from running again.
Camera movements are stored in batches and written a final time on leaving.

## Signal for compact mini-app controls (11.09.2026)

Chapters: plugins, actor-programs, overview. Signal from the control drafts has been chosen. The existing
mini-app controls therefore get strong outlines, asymmetric corners, and yellow
primary actions. The separation from the Aquaglass shell is kept. A standard height of 28 pixels,
more compact forms and tables, and dedicated light and dark control colors implement the
chosen direction. Shared React building blocks and interaction contracts remain;
the public building block demo shows the same implementation.

## Show only one indicator dot per workspace tab (11.09.2026)

Chapters: plugins. The indicator for new content and the content badge appeared simultaneously
as two dots next to the same icon. The shared host now shows only the indicator dot when there is
new content, otherwise the plugin's badge. Each tab thus has at most
one dot.

## Pop out select menus and clear inputs immediately for continued typing (11.09.2026)

Chapters: plugins, actor-programs. Select menus were clipped by bounded composer surfaces.
The shared SelectMenu therefore uses the native popover top layer and
adjusts its position to the available space; DOM membership and dialog context are
kept. The chat input now clears a valid task immediately on submission. On errors
the task returns automatically as long as no new text has been written; otherwise
it remains available separately for deliberate insertion. Both the new draft and
the failed task including attachments are thus kept.

## Make canvas light and round dialog actions more distinct (11.09.2026)

Chapters: plugins, actor-programs, overview. The Aquaglass canvas gets a continuous
light surface without a dot grid, with more distinct mint, ice blue, and a bright center. Slight
background blur and small light edges on the status icons reinforce the glass effect.
The existing round IconButton variant gets a visible surface and is used consistently for Close
and Back. These actions are thus clearly recognizable in dialogs and mobile details;
their names, tooltips, and interaction contracts are kept. The homepage diagram
adopts the light surface.
The mini-app title in the header row consistently uses font weight 700. Switching from
550 to 700 when opening the full view had changed its width and shifted neighboring entries;
an additional fixed width is not needed for this.

## Collect all UI drafts in the same tab overview (11.09.2026)

Chapters: overview. The owner wants to find previous and future UI drafts permanently in the
existing overview. The rule is stated explicitly in the project AGENTS.md and in the
global Codex work instructions: add new tabs, keep existing ones, and add missing older
drafts. Team grid, Conversation circle, and the synth interfaces are now also
listed in docs/ui-drafts/index.html.

## Keep preview actions visible at the bottom edge (11.09.2026)

Chapters: plugins, actor-programs. With long templates, the entire right detail area scrolled
together with "Apply to task". The shared ListDetail building block now fills the available
height and scrolls only its middle content; header and action area stay in place. The
start surface limits list and preview to the available space instead of scrolling the whole
dialog. Applying thus stays immediately reachable even with long prompts and in the mobile
detail view.

## Separate prompt selection from start readiness (11.09.2026)

Chapters: plugins. The start selection had disabled its list rows with the same lock as
run creation. Prompt cards were therefore not clickable while the chat connection or
model query was pending. Selection, preview, applying the prompt, and text input now stay
usable locally; only executing actions still wait for their prerequisites.
The browser check with an existing run and an open global chat additionally showed a
congestion caused by the parallel live connections. During the start dialog, the
stream of the hidden run list including periodic polling is therefore paused; afterwards the list
is reloaded immediately and subscribed again. Existing run and draft keep their live observation.
The draft also no longer opens a redundant chat stream. Its run stream still detects
the actual start; texts and start options only need their HTTP requests.

## Adopt Aquaglass as the shared interface style (11.09.2026)

Chapters: plugins, actor-programs, overview. After the canvas drafts, the choice falls on Aquaglass:
sculptural, translucent green-blue surfaces with light edges and small corner radii.
Straight cards keep their clear alignment; TypeScript actors use the same
rectangular CSS structure for this instead of the SVG outline with cut corners. Shared tokens
connect host, canvas, and actor view controls. Light, dark, and system remain the existing
display choice; an additional style selection is not needed. The homepage diagram follows the
new design. The old text analysis capture is removed until a new real core run,
so that the public page does not show an outdated interface.

For the mini-app controls, the choice subsequently falls on variant B, Fluss, from the control
draft. Open input fields and softer buttons take over the Aquaglass colors. The style applies
via a marker only inside the mini-apps and their reference demos; the shared
React implementation and its props are kept. The app contents thus connect to
the canvas without also switching the host's controls to Fluss.

## Start selection and task preparation with shared controls (11.09.2026)

Chapters: plugins, actor-programs. Variant C from the offline drafts has been chosen, because the
previous cards were hardly distinguishable. A grouped list with preview therefore uses
the new shared `ListDetail` building block, also for actor views and the public catalog.
The original quassel input uses the same bounded width as the chat. A prompt card
leads into a second modal step: there the user works out the task with the AI
and starts the run separately. The preparation call uses the same model choice but creates
no run and no working directory. Discussing thus remains an explicit preliminary stage to
execution. Ongoing model changes lock the send actions until the state is saved.

## Configure automatic titles separately and show them promptly (11.09.2026)

Chapters: profiles, plugins, core. The owner wants a small current Gemma for list titles.
The default is therefore Gemma 4 A4B (`google/gemma-4-26b-a4b-it`). The existing host service
has its own stored model choice, reasoning switched off, small input and
output budgets, and a limited runtime without client retries. After saving,
the server reports the finished title to open run lists; until then the task stays visible.
Titles already stored and explicitly set are kept. The selection allows
other suitable models and switching off, without changing agent models.

## Keep actors reachable, choose canvas visibility personally (11.09.2026)

Chapters: plugins, actor-programs. A mini-app previously appeared in addition to the canvas card of its
actor, although the interface often already contains all necessary interaction. The actor list in
the status bar therefore gives access to every participant independently of their card. Actors with
an installed view are hidden by default; their mini-apps stay visible. This also
applies to LLM actors and uses the generic anchoring of the canvas elements.
Individual visibility and connections belong to the personal browser view per run, not to the
journaled structure. Selection and inspector thus stay reachable without changing the workspace
surface of other users or the execution of the run.

## Arrange the full view button as a stable header section (11.09.2026)

Chapters: plugins. The absolutely centered icon button lost its centering when pressed due to the
general button transform. Its click area therefore moved away from under the mouse pointer.
The full view action now uses a regular header section across the full height, like the app name.
A short dashed divider makes the separate action visible.

## Group prompt cards by a free category (10.09.2026)

Chapters: overview, plugins. The undivided start list made small apps hard to find between
technical examples. Each prompt card therefore has exactly one mandatory
category as free text; loader, public contract, and interface use the same value.
Via the existing order, the first card also determines the position of its group.
The mini-apps begin with a greeting and a text analysis. Two further cases show
shared state in several views and automatically collected answers.
Titles and descriptions name the visible result. Tags stay available for search,
filter, and reference but no longer fill every single card.

## Separate editable models from the technical inventory (10.09.2026)

Chapters: profiles, plugins. Settings first open the actual model forms;
display, extension catalog, and runtime inventory get their own areas. The
product plugins store model and thinking level per existing agent profile atomically and check
the complete draft before writing. New actors and the defaults of runs not yet
started use this selection. Existing actors and explicitly chosen
start values are kept. The global coordinator stores its first selection independently
of the product defaults, so that later changes stay separate even after a restart.

## Compose reference generation with valid catalog models (10.09.2026)

Chapters: overview. The offline composition of the public reference used invented
model names, which the mandatory model check rejects, thereby blocking the web build.
Generator and reference tests therefore use existing public catalog models.
The composition stays isolated and performs neither network calls nor model runs.

## Canvas margin and stable mouse control, visible panel shadows (10.09.2026)

Chapters: plugins. Header row and status bar get directional shadows; the barely visible
panel shadow is strengthened in both themes so that the control surfaces stand out from the canvas.
The camera starts with a 32-pixel margin and also aligns the first measured scene with this
margin. The world coordinates stay unchanged. On mount, the world takes over the current
camera state. Run updates previously renewed the mouse binding via the canvas context and thereby
released pointer capture in the middle of panning. The binding now reads the current selection
function independently of its lifecycle; messages no longer end an ongoing mouse gesture.

## Derive thinking levels consistently from the respective model (10.09.2026)

Chapters: core, profiles. Through a manually maintained parallel configuration, the start
selection offered `off` and `medium` for GLM 5.3 Flash, although the runtime rejected both. At the
same time, valid extended levels such as `max` were missing from the RAgents contract. Product
catalog, selection, and validation therefore use the model capabilities; configuration lists may
only restrict them deliberately. The server checks all models and profiles before use. Inherited
thinking levels are also checked against the final model at spawn. The global host default
is dropped for agents without an explicit thinking level; their session uses a model-valid
default. Errors thus no longer reach the chat only at the first model call.

## Explain function diagrams step by step through scrolling (10.09.2026)

Chapters: overview. The owner wants animations that make the value of the functions visible.
The diagrams therefore show concrete flows: distributing tasks and returning results,
executing program steps, changing shared state, delivering events, and building a setup.
Moving messages follow the drawn connections; progress bars,
program lines, and list entries show the intermediate states. On the workspace surface,
task, processing, and result are connected to the journal.

The GSAP timelines are tied directly to the scroll progress, including reverse playback and
standstill. On mobile, the individual graphics use their own path through the viewport.
Reduced motion, print, and missing JavaScript show the complete static diagram.
MotionPathPlugin is bundled locally with GSAP; external runtime resources are unnecessary.

## Re-read process changes during the macOS marker query a limited number of times (10.09.2026)

Chapters: plugins. Between reading the command line and the environment, a process can
end or change its arguments. Explicit `<defunct>` entries are skipped as ended.
For live processes, the host compares the command line before and after `ps -E`
and queries only changed PIDs again, at most three times. A normal
process change thus does not interrupt the whole scan; new arguments are not mistaken for
environment markers. Permanently unstable processes and access, tool, or format errors
remain hard errors. A failed scan does not store seemingly missing markers.

## Update dynamic functions in the running model turn (10.09.2026)

Chapters: core, plugins, actor-programs. After an actor program was activated, the running
LLM turn previously kept its old tool set. New functions were also unknown to `tool_open`
and caused unnecessary repetitions. TurnToolset and AgentSession therefore re-resolve
the set before further calls and between model requests via the same registry.
New schemas, opened names, and the system overview change together; removed
functions disappear immediately. The normal native tool call remains the only path.

## Run the relay with the configured coordinator thinking level (10.09.2026)

Chapters: profiles. Besides the coordinator model, the relay profile also uses its
configured thinking level. The previously hard-coded `off` prevented even the first model call
under GLM 5.3 Flash. The setting stays explicitly configured; there is
no automatic model switch and no adjustment by the driver.

## Actor programs unite functions, state, and views (10.09.2026)

Chapters: overview, core, typescript-platform, actor-programs, plugins, profiles. TypeScript and
LLM actors have the same intrinsic state, callable functions, and optional
React views. The interface and agent tools call the same function on the same actor;
only an ordinary message to an LLM actor needs its model. Pure views bind
to existing actors, without an artificial app actor. There remains exactly one program package per actor.

`ragents.actor-programs` replaces the separate mini-app and script tool plugins as well as
the separate actor check/test/install path. Normal packages, TypeBox, React, relative imports,
pinned local dependencies, and native Node execution via IPC form a single path.
Results stay results; only `context.state.replace` changes actor state.
Run scripts use the same packages and domain tests. There is no interpreter, no
migration, and no compatibility with the removed tools or package forms.

The model flow consists of create, normal file changes, and activate. Automatic
diagnostic deltas and targeted retrieval of complete findings keep it short. Prompt cards,
reference packages, and the public website show the four cases: without an interface, shared
function with view and tool, LLM actor with view, and subscription input with state.
Redundant cards are dropped; every documented product concept stays represented multiple times.

The real text analysis run shows that suitable templates should be read first and reused.
The quick guide therefore prioritizes existing code and domain tests; individual
UI contracts are loaded only on concrete uncertainties. The homepage section adds to the
function graphic the actual core full view with count result and actor call counter.

## Explain event delivery as a function diagram (10.09.2026)

Chapters: overview. The subscription matrix form requires selection and explanation before
the function becomes visible. A compact HTML/SVG diagram now directly shows the path from the
agent result via matching subscriptions to the next participants. The associated
dropdown code is dropped; the real reference example stays linked.

## Name the benefit directly below the function headings (10.09.2026)

Chapters: overview. The concept names are kept as main headings. Instead of numbered
overlines, each is followed by a short punch line that names the benefit of the function.
Agents, programmed flows, mini-apps, events, journal, and setups can thus be placed
while skimming; the existing explanation follows on from it.

## Adjust the scroll section to the embedded help frame (10.09.2026)

Chapters: overview. The homepage was built correctly along with everything else but looked static
in the help at common notebook sizes: a window of 1366 by 768 pixels leaves the help iframe only
1316 by 718 pixels, below the previous minimum height of 740 pixels. The scroll section
therefore now starts at a height of 600 pixels and scales its graphics down proportionally in low
views. The captions and navigation keep their size. This
case is checked directly via the question mark of the running application, in addition to the
standalone page.

## Simplify prompt cards to one free task (10.09.2026)

Chapters: plugins, overview. The owner wants only the previous free task per prompt card.
The technical version and the choice between technical and free are dropped from cards,
plugin contract, settings, and public reference. A click on the card applies
the task to the input. The card files contain the prompt directly after the header;
the free texts stay unchanged. The same entry point thus needs only one content and one
action.

## Switch mini-apps and run programs to native TypeScript (10.09.2026)

Chapters: overview, core, typescript-platform, actor-programs, plugins. The previous mini-app
contracts, separate check calls, and own language rules produced long answers and many
correction loops. Mini-apps are therefore ordinary private TypeScript packages with a React
frontend, optional backend, and normal domain tests. A TypeBox contract provides the types
and the same function for browser action and agent tool. Pinned, locally prepared
dependencies make these projects directly readable for file tools and language servers.

The agents edit the packages via `@apps`, Bash via `RAGENTS_APPS_DIR`. Before every
model request, the host checks changed projects and adds a short difference from the
last error state. Complete diagnostics can be retrieved in a targeted way. `mini_app_activate`
combines type checking, build, domain tests, and activation; ordinary success responses stay
short. The model does not transmit file contents or build hashes again.

Actors, script tools, and mini-app backends use the same native Node execution with
a bound call context via IPC. The AST interpreter including its own language subset is dropped.
Host and run workspace manage process permissions, cancellation, and lifecycle. Calls to the same
app stay ordered; different apps can work in parallel. State changes reach the existing React
binding even while the chat is idle and keep local input drafts.
There is no compatibility layer or migration of old app and script states; the
existing runs were deleted on explicit request. The implemented TypeScript concept is dropped.

## Focus the homepage on the core features with GSAP ScrollTrigger (10.09.2026)

Chapters: overview. The owner wants a more animated homepage on which the most important features
become visible earlier. A text section with a changing graphic pinned on the right replaces the
previous full-area stage and the subsequent duplicate explanation of agents, TypeScript,
and mini-apps. The shorter introduction leads directly there; the interface and in-depth
features follow in the normal page flow. The existing HTML/SVG diagrams show the
relationships without new image resources. GSAP and ScrollTrigger are bundled as a pinned local
package version, so that the static export also works without a CDN. Small views,
reduced motion, and print assign the graphics to their texts; details stay expandable.

## Remove the dialog capability of mini-apps (10.09.2026)

Chapters: overview, typescript-platform, actor-programs, plugins. Mini-apps are meant to be small
applications on the canvas. The additional journaled dialog view brought its own
capabilities, placements, tests, and interaction states for the same interface. This
capability is dropped completely, including API, template, and prompt instructions. The local
full view operated by the user stays with the host. The hello world and approval list examples
use the canvas; the static hello world case needs no server action of its own.

## Integrate the full view icon into the app entry (10.09.2026)

Chapters: plugins. The inner divider made the full view button look like a separate
header section. Name and icon now sit closer together on a shared
hover and focus surface. The enlarge button sits as a small existing ghost icon button
inside the continuous app surface; it does not occupy a separate section across the full
bar height. The two actions stay independently usable.

## Delimit the status bar and keep panel shadows (09.09.2026)

Chapters: plugins. A fine top divider makes the 28-pixel-high status bar recognizable.
Its background lies below the shadow of the right panel ending above it, so that the
shadow edge is not clipped. Status groups and journal stay usable above the
work content; the division of the surface stays unchanged.

## Restore flat header elements (09.09.2026)

Chapters: plugins. The domed surfaces are not liked in the application. The header row again uses
the previous flat style; gloss gradient and additional inner edges of the segments as well as
the added inner relief of the global text input are dropped.

## Card chat without a time column and with step icons (09.09.2026)

Chapters: plugins. Timestamps and spelled-out tool names took up too much space in the small
inline history of the agent cards. The shared ActorChat now explicitly distinguishes
canvas and inspector: on the card, timestamps are dropped; visible
tool and thinking steps use the existing icon level with callable details.
Hidden steps stay hidden. The inspector keeps timestamps and the selected
detail level; message projection and scroll behavior stay shared.

## Canvas overview with direct target navigation (09.09.2026)

Chapters: plugins. Large workspace surfaces need a quick way from the overall picture to a
single card or app. A second square button between the run overview and the global
coordinator therefore fits all visible elements into the canvas area and activates
a target selection. Hover and keyboard focus mark the target; activating it centers it
at exactly 100 percent, without changing the previous selection or app contents. Escape or
pressing the button again restores the previous camera. The existing status button
`Fit` keeps its centering at 100 percent.

## Scale down mini-app content on the canvas (09.09.2026)

Chapters: actor-programs. Smaller app windows alone made the contained fonts and
controls look too large compared with the rest of the interface. The canvas host
therefore renders the entire frame content at 80 percent with a correspondingly larger inner
viewport. This also applies to installed apps with fixed pixel sizes;
a new app build is not required for this. Full view and app dialog keep their
original size; the window controls still follow the shared host sizes.

## Clarify dialog areas, short answers, and header controls (09.09.2026)

Chapters: plugins, core, actor-programs. Three regular dialog areas make the coverage
explicit: `page` covers the entire application, `run` the content without both bars, and
`workspace` everything below the header row including the status bar. The run overview uses
workspace; targeted local containers remain possible, for example for the coordinator reset
confirmation. Enlarged mini-apps also use workspace without additional host title and status rows.
A central full view connects the canvas and a separate enlarge button in the header row;
the active app stays recognizable there and can be switched directly.

Short answers contain the user question and the result, each briefly, so that a notification
can be assigned even outside the history. The entire surface opens the conversation;
only the X dismisses the notification. The tool contract requires both texts without silent
completion. The active run title needs no additional RUN label and is centered vertically and
left-aligned. Tooltips first appear after 50 milliseconds and then switch immediately;
110 milliseconds on leaving bridge the gaps between buttons.
The shared work frame pulses more distinctly and starts at the global input field already
during the send request, before the server reports its ongoing work.
A slight doming of the left header segments makes their boundaries clearer; the
shared surface and edge tokens leave settings and help in their ghost appearance.

## Journal and coordinator with a shared popout surface (09.09.2026)

Chapters: plugins. Journal and global coordinator history use the same outline,
panel and text color, and the same drop shadow. The shared class `ui-popout-surface`
replaces the local copies, so that both surfaces stay styled the same even when changed.
Opening direction and corner shape still belong to the respective view.

## Separate the tool overview from the technical detail reference (09.09.2026)

Chapters: plugins, core, actor-programs, typescript-platform. The same tool descriptions
appeared in the system context and again on the open tool; guides loaded later could
appear once more in the system prompt. The system context therefore contains the only overview.
Normal opening confirms names and result contracts; the native input schemas are not
repeated as response text. An explicit detail query delivers the complete
contracts and guides even after an earlier opening and for workers.

Prompt contributions separate short initial hints from guides on request. The script and
handler references are generated on read from the actor's current tool set.
Mini-app manifest, client, and handler API use the same sources as validator and compiler;
working approach and recommendations stay editorial. The remaining questions about the app set,
driver tools, profile rules, and skills stay in the shortened concept `prompt-context.md`.

## Merge status bar, header hints, and coordinator states (09.09.2026)

Chapters: plugins, core. The floating canvas zoom group moves into a half-height status bar
across the full application width. A dedicated journal contribution opens the actual
run events upward. The host provides ordered status groups for this; the canvas
uses the same area. The journal view loads only when open and follows existing
run changes instead of introducing another polling cycle.

Tab and panel button hints appear below the header row after 150 milliseconds, or immediately
on keyboard focus. The panel button uses the same large ghost appearance
as settings and help. The shared hint surface also styles short answers, which
now appear automatically whether the global chat is open or closed. The additional
unread indicator and its read cursor are dropped. Ongoing work pulses on the input frame
with the same animation as canvas agents. The reset confirmation lies as a highlighted
dialog over the entire global chat and starts with the focus on Cancel.

## More compact start input and open the global history directly (09.09.2026)

Chapters: plugins. Intro and section headings took up space in the start dialog before
the inputs. The task input now starts with three instead of six lines and grows up to
eight; tighter spacing keeps prompt cards and prepared flows closer together. Model
and thinking level sit as select menus in the same input bar as attachments and detail level.
The existing start option contract determines the placement in the composer or start surface.

For the global coordinator, the text field opens its history directly. The additional
dropdown arrow is dropped. Even with read-only access, the read-only input stays
focusable, while send functions and other write actions stay locked.

## Settings as a page-wide dialog (09.09.2026)

Chapters: plugins. The settings concern the entire application. Their modal explicitly uses
the page area, so that the title bar also lies behind the dialog and is locked.
The shared modal component takes over focus management and return to the opening button.

## Accept tool permissions in the settings response (09.09.2026)

Chapters: plugins. The server's tool descriptions now optionally contain
`requiredCapabilities`. The exact field check in the browser did not know this field and
therefore discarded the entire settings response. The client contract now explicitly accepts and
checks the list; the rest of the format check is kept. A regression test
uses the actual engine tool descriptions and also checks invalid values.

## Studio as the shared design with a selectable color scheme (09.09.2026)

Chapters: plugins, actor-programs. The owner chose Studio from the design study as the basis.
Fine outlines, calm surfaces, a dot grid, and tinted status fields replace
the bold card icons and color washes. Semantic tokens also bundle outlines,
status surfaces, and shadows, so that themes can be maintained in one place.

The choice of light, dark, or system belongs to the host and applies locally to the browser.
A theme switch recolors existing views without replacing camera, conversation, or input.
Mini-apps receive the same resolved appearance via their existing port;
a new frame would lose local input. Their own CSS keeps its freedom.
The current title bar and panel arrangement remains the basis of the design.

## Explain homepage concepts before their details (09.09.2026)

Chapters: overview. The homepage presupposed terms like coordinator, context, and run and
often began with operating rules. Each topic section now introduces its concept in one to
four sentences that are understandable even when jumping in directly from the navigation.
Headings name the thing; technical rules and longer operating details follow
collapsed or via reference links. Function diagrams, the two reading examples, and the
generated reference entry points also use explanations first instead of presupposed technical
terms. The structure of the system thus stays in the foreground without lengthening the
introduction by another glossary or documentation area.

## Show a short coordinator answer directly below the input (09.09.2026)

Chapters: plugins, core. `quick_answer` gives the global coordinator an explicit path
for a short answer of at most 240 characters. When the history is closed, it appears as a
toast directly below the toolbar input. A click opens the conversation and sets the focus there;
the X only removes the toast. Its appearance itself changes no focus and opens no history.
The normal complete answer stays in the chat; the short answer follows additionally as
journaled plugin state via the existing extension stream. Journal position and
replay boundary prevent old or duplicate toasts. The existing protection of the stored
tool selection is kept: existing global conversations need an explicit reset after the restart
for the new tool and its prompt instruction.

## Coordinator input without an additional heading (09.09.2026)

Chapters: plugins. The heading above the global chat input used an additional
line in the title bar. "Global coordinator" therefore appears as a placeholder in the field;
status and open button sit next to it. Attachment and detail level share one control row in the
dropdown with model, reasoning, and reset. The history keeps its accessible name.

## Connect the right panel to the title bar (09.09.2026)

Chapters: plugins. The additional tab row and the outer margins separated the workspace
from the title bar and shrank its content. Tabs and collapse button therefore sit
together with settings and help in the shared header row. Its right section
follows when the panel width is increased. The content connects directly below it as well as to
the right and bottom window edges; a straight left edge with a drop shadow separates it from the
canvas. Collapsing, stored width, and the state of visited tabs are kept. When space is short,
the tab icons scroll within the bar.

## Operate the global coordinator directly in the header row (09.09.2026)

Chapters: plugins, core. The global coordinator gets a permanent toolbar input with
a history below it. A task is thus reachable without opening the run overview.
The existing contribution contract gets a toolbar placement; the host coordinates opening
and closing, the plugin still owns conversation and draft. The overview no longer contains
a second coordinator chat; its unused width slider is dropped. Both
composer arrangements use the same input and attachment logic.

After the first use, exactly one stream for response notifications stays connected. A
read position in the browser tab acknowledges new visible response text only at the actually
visible end of the history. Conversation identity, journal position, and text offset as well as an
explicit replay boundary make reconnection and reset distinguishable. Focus, run switches, and
a closed history lose neither the draft nor an ongoing answer. The implemented
concept is removed; operations, homepage, and coordinator walkthroughs follow the new access.
A reset can remove the journal after stopping, before the scheduler reaches its final
scan. That scan then skips the removed journal; new work in a run with the same identifier
created later remains schedulable as usual.
When switching from the run overview to the toolbar input, the closing modal keeps the
intentionally new focus instead of resetting it to the overview corner.

## Control dialog steps in the shared modal (09.09.2026)

Chapters: plugins. Follow-up dialogs should use the same frame and get their way back from the
host. The typed modal controller therefore opens steps according to the host setting `push`
or `replace`. With `push`, the previous content stays mounted but hidden; with `replace`, it is
discarded. Focus management, Back, and Close stay in the shared modal; the host's `onClose`
is also respected on delayed or locked closing.

The start dialog lies below the session and plugin providers. Setup guides of skills
and run scripts open a follow-up step in it. Back and Cancel keep task,
attachments, filters, and scroll position. Completion returns and starts the selected flow
once; errors stay visible with the prepared flows.

## Start dialog with the task on the left and prepared flows on the right (09.09.2026)

Chapters: plugins. The start dialog begins directly with the start surface, so that title and
subtitle take up no additional space before the task input. The shared `Modal` keeps the
accessible name "New conversation", the page-wide area, and its focus management.
An overlaid close button at the top right closes it; on the start surface, Escape and a
background click close it as well.
On wide views, task input, start options, and the prompt templates below them
together take up the left two thirds. Prepared flows from skills and
run scripts sit on the right in the remaining third; in a narrow layout they follow below.

## Header row with full surfaces and without tool shortcuts (09.09.2026)

Chapters: plugins, actor-programs. Like the overview corner, the main entries of the header row use
the full height and a shared right divider. Small kind labels and up to two
title lines assign run, app, activity, process, start option, branch, and user. Longer
names thus also become readable in coherent surfaces. Settings and help keep their
large `ghost` icon buttons; process ports and quit stay compact sub-actions.

The app selection shows canvas apps switched to visible and still focuses their surface.
Installed tool shortcuts are dropped from the header row; the tools tab remains
their access. The display of running tool calls keeps its selection and delivery.
When space is short, the focusable middle run area scrolls horizontally instead of forming a second
toolbar row. Overview corner, settings, and help stay reachable. The
process dialog keeps its compact list view.

## Clarify working yourself and executable delegation (09.09.2026)

Chapters: plugins. The orchestration guide strongly emphasized roles and multi-phase flows
and assigned no tools to experts and critics across the board. It now requires
working yourself by default and a concrete benefit or user request for additional
actors. Several languages, files, or steps alone are not sufficient for this. Delegated phases
receive the actual work task and are checked against their result.
The necessary tools follow the task instead of the role name; a pure text context is sufficient
only for tasks without access to files, diagnostics, or other tools.

## Load the mini-app guide only when needed (09.09.2026)

Chapters: actor-programs. Binding the complete mini-app guide to the directly available
lookup tool also enlarged the initial context of unrelated tasks. A short
introduction therefore first describes the capability. The complete guide follows on
explicit retrieval with `mini_app_controls` and `topic: "guide"` from the rendered prompt file.
It is not a registered system prompt contribution. Subsequently opening the build tools with
`tool_open` delivers their contracts and does not embed the guide again. The sequence of lookup
and tool opening thus does not duplicate the long text, even in later turns.
The direct control catalog and the individual contracts obtained automatically from TypeScript are
kept; a control selection when retrieving the guide is an explicit input error.

## Input hints in the field and more compact controls (09.09.2026)

Chapters: actor-programs. Separate description lines took up a lot of height in tool cards.
Text, number, JSON, and string list inputs therefore show the parameter description as a
placeholder. Field names and the required marker stay visible for orientation. Checkboxes
share a line with their name; their description stays below.

The shared form controls use short input hints as placeholders and keep
explicit hints permanently. Editable select fields show the field name and
required marker directly in the select button, so that an empty selection also stays
recognizable; read-only values keep the separate field label. Multi-line fields start with
two resizable lines. Less padding and line spacing in
forms, file and task lists, and tables saves space without shrinking the font.
The table search also uses a placeholder and an accessible label instead of an
additional visible label row.
The public demos and the controls template show matching input hints.

## Wider coordinator column with an adjustable split (09.09.2026)

Chapters: plugins. The coordinator gets 30 percent more width by default. A middle
resize handle allows a custom split between conversation and run list and uses
the same handle design as the right workspace panel. The choice stays stored locally;
responsive stacking does not change it. Keyboard operation and canceling the drag gesture keep
the control usable and prevent unintentionally stored intermediate states.

## Separate overview surfaces without a shared title row (09.09.2026)

Chapters: plugins. Coordinator and run list each get their own surface above the
blurred dialog background. The shared shell and its overview title row are dropped,
so that both areas stand on their own. The shared run modal remains responsible for focus,
Escape, and background; the free space between the surfaces is also a close area.
The accessible dialog name and the kept conversation drafts remain.

## Switch clearly between overview, workspace, and inspector (09.09.2026)

Chapters: plugins. The overview of coordinator and runs uses the shared modal
with run scope, spacing, and backdrop. Header row, focus management, and nested dialogs thus follow
the same technique as other modals. Hidden contributions stay mounted.

The right workspace switches between expanded and fully collapsed instead of
between normal and maximized. The last chosen width is kept; explicit
tab navigation opens it again. In the actor inspector, a selected detail tab uses the full
height. Chat and composer stay mounted but hidden; the X tab leads back to the conversation
without losing the draft.

## Reliably close the start dialog on slow run responses (09.09.2026)

Chapters: plugins. Frequent live events could mark a slow run query as
outdated over and over again. The existing query now delivers its state and bundles further
events into a follow-up query. The start dialog thus detects the created run independently
of a still pending send response. After closing, it ignores late responses,
so that they do not close a later draft. Tests check slow and late responses
as well as errors without a created run.

## Canvas without an additional chat pop-out and with return to 100 percent (09.09.2026)

Chapters: plugins. The additional canvas chat duplicated the card chat and actor inspector.
The chat switch, the pop-out, and its stored width are dropped. The run stop moves into the
toolbar of the right primary actor inspector and keeps confirmation and permission check.
Fit remains as a deliberate return to 100 percent: the current scene bounds are
centered without shrinking them for this. Double-clicking on free space uses the same
step. Only the first automatic view still adjusts its zoom to scene and window.

## Calmer header row with larger helper actions (09.09.2026)

Chapters: plugins. On top of the shared header spacing, the run header added another
divider and its own left padding. This duplication is dropped; the normal spacing is
kept. Settings and help get larger, more recognizable icons via the new
shared button size large. Height, icon size, and font come from the same UI tokens
for Button and IconButton, without special formatting of individual header buttons.

## Adjust the sensitivity of the canvas pinch gesture (08.09.2026)

Chapters: plugins. Trackpad pinch should respond more strongly and be adjustable to one's own
handling. The orchestration extension therefore offers a locally stored factor
from 0.1 to 10, default 2, under canvas zoom. Factor 1 restores the earlier strength.
Only pinch or Ctrl+mouse wheel use the factor; the ordinary mouse wheel and
zoom buttons keep their behavior. Changes apply immediately to other open tabs as well and
require settings.write. The existing boundary between controls and the canvas camera remains.

## The same agent chat on the canvas and in the inspector (08.09.2026)

Chapters: plugins. The pinned card view previously formatted messages itself as a
shortened text history. Canvas and actor inspector now use the shared ActorChat
with ChatMessages, identical message projection, sender assignment, Markdown, attachments,
timestamps, and step setting. The card keeps only its size and canvas scroll boundary;
its own text and work display formats are dropped. Reading back, automatic
continuation at the end, and link navigation thus also follow the same behavior as in the right chat.

## Explain missing script grants and waiting orchestration (08.09.2026)

Chapters: typescript-platform, plugins. After the tools were filtered, the build check only knew
the valid call names when grants were missing. The actual resolution now internally reports
excluded tools to the diagnostics; existing availability contracts name
their required grants in structured form. script_actor_check thus names the call and the missing
grant without a separate mapping table, artificial permissions, or an additional tool grant.
Regression tests cover engine calls and the canvas plugin as well as unusable grants and the
corrected request.

The guide also presents script actors as persistent counters and state holders and refers
to two existing setup examples. After subscription and task, the coordinator turn ends
without a filler message; real phase changes remain worth reporting. The script tool guide now,
matching the shared contract, names both a missing expect.error and
null for successful tests; an empty string stays invalid.

## Tool activity of all actors from the run projection (08.09.2026)

Chapters: core, plugins. The activity display previously read tool calls from the primary chat
and turns from the run view. The tools of subagents were therefore missing. The existing
journal projection now keeps compact call states per turn; the header uses only
this shared source and, for subagents, names the actor at the tool.

The combination of turn and call ID prevents confusion over reused model IDs.
A running tool represents its turn chip, so that the same work step is not shown
twice. Completion, errors, and interruption clean up the activity. Chat events,
chat detail levels, and transport paths stay unchanged for this.

## Final cleanup belongs to the stop response (08.09.2026)

Chapters: core. The engine integration test showed that the stop request already responded
successfully before the final plugin contributions were finished. It now also waits for this
cleanup and reports its errors. An additional fixed response deadline prevents endless
waiting for external work; the quarantine persists independently of the response until the real end.

When a failed cleanup was retried, an already rejected
quarantine promise also caused the shared wait to abort prematurely. The scheduler now waits for all
follow-up runs. The HTTP input check also confirmed that primary inputs accepted during the lock
remained stuck after the release without a further journal event. The scheduler
now checks the open inputs again after a successful release; already claimed inputs
stay consumed. Six engine tests check late work, errors and retries, ignored
abort signals, the bounded response time, and this HTTP input without a product server or real
external processes.

## Distinguish document display from result publication (08.09.2026)

Chapters: plugins. The self-test counted an empty artifact list after `show_document` as a
possible error. The display, however, belongs to the documents extension and is built from the
logged tool call; `artifact_publish` creates immutable
core results. This existing separation is now explicitly documented, instead of unintentionally
introducing a second storage and additional artifact events when displaying.

## Missing model choice names matching profiles (08.09.2026)

Chapters: core. An agent start without profile and model previously only referred to `model_list`.
The error message now directly names the registered profiles of the selected driver.
The request can thus be corrected without an additional search step; profiles of other
drivers are not offered as a model choice. An empty catalog remains a hard error.

## Open hints also reach the real agent loop (08.09.2026)

Chapters: plugins. The TurnToolset already explained unopened indexed tools correctly,
but the upstream agent loop rejected such calls with a generic error.
An optional error formatter in AgentLoopConfig and Agent now already produces the
hint there from the permitted turn toolset. It changes only the error text, opens
no tool, and executes nothing. Forbidden and unknown names reveal no catalog data.
A faux model test with a real scheduler proves the error text in the follow-up request and journal,
the absent execution, and the subsequent resumption via tool_open.

## Canceled questions produce no user answer (08.09.2026)

Chapters: plugins. When an open question was canceled, the ask extension first removed
its waiting call and then closed the question in the journal. The synchronous journal listener
took this resolution for an answer without an active call and queued an additional
ActorInput with the text of a user dismissal. The extension now marks the
ongoing technical cancellation resolution and suppresses exactly its answer delivery. The question
still disappears, the call is aborted. Real user answers and delivery
after a restart are kept. A scheduler test confirms that the run stop produces no
artificial answer input and no further turn.

## Understandable mock errors and unambiguous error expectations (08.09.2026)

Chapters: actor-programs. With wrong mock responses, a complete result type previously obscured
the actual error. Mock checks now use the same compact field path formatter as
tool arguments. This names nested type errors and avoids large union outputs.

`expect.error: ""` looked like a request for error-free execution but was compared literally with
`null`. A shared contract for mini-app, script tool, and actor tests explicitly rejects
empty text. `null` means success, non-empty text the exact expected
error. Direct calls to the expectation check also get the same understandable error message.

## Secure runtime contracts and do not reinterpret thinking levels (08.09.2026)

Chapters: core. The generic agent session previously adjusted an unsupported thinking level
automatically. RAgents now checks before the model call, so that an explicitly chosen
level is not replaced by another with only a warning. A faux model regression
checks the rejection of `off` for a model with `low`/`high` and the successful next
turn with a valid selection.

The previously open safeguarding of our own fork interventions has been added: steering with a running
tool and later success or error including result capping, unambiguous edit anchors,
hash checking under concurrent access via a file alias, and lock release after an
aborted write call. System prompt preservation and tool validation already have
integration tests. Provider checks secure the explicit off payload and Unicode in
nested tool arguments with byte-wise split SSE. The earlier
umlaut loss could therefore not be reproduced in the streaming path; a new real
failure case is still needed to distinguish provider text from a platform error.

## Resolve tool requests individually and load guides only once (08.09.2026)

Chapters: plugins. A wrong or already directly available tool name must not discard the valid
entries of a mixed request. `tool_open` separates these results and
delivers the registered input and result contracts for each. The previously available
tool set also determines which bound chapters are already in the context.
Sequential unlocking avoids concurrent duplicate guides in one model call.
Prompt cards no longer adopt their own blanket visibility rule.

## Clean up marked processes until the end of a run (08.09.2026)

Chapters: core, plugins. A detached service is no longer a running agent turn and could therefore
survive the previous run stop. The process plugin now also uses its platform-dependent
mapping for terminating. The cleanup path considers all marked processes, not only
the visible services with ports. An early pass terminates existing services; the final
lifecycle pass catches children from actors still winding down before the run is released
again. Before deletion, it checks again.

The selection follows PID plus start identifier instead of a PID alone. Before signals, identity,
run marker, and, where applicable, the current HTTP permission are checked again. Individual positive
PIDs avoid a shared process group hitting the server or other runs. SIGTERM,
bounded waiting, and SIGKILL if necessary deliver a verified completion or an
explicit error. On macOS, the command is removed from `ps -E` before the marker check;
a marker as a mere argument must not produce a foreign process mapping.

## Targeted control contracts and mock results before the test (08.09.2026)

Chapters: actor-programs. A single control query previously delivered all UI type files.
The retrieval now follows the TypeScript symbol graph of the selected control and takes only its
transitive type dependencies along. Catalog, compiler, and the public overall reference keep
the same source, without a second hand-maintained props list.

Mini-app tests expect exact capability results, but the check previously only named the
bound surfaces. It now delivers their actually resolved input and result contracts
before the test: for direct operator actions, handler actions, and tools per target agent.
Authors can create matching mock responses from this without calling real operations or
deriving field names from failed attempts.

## Terminate processes directly from the interface (08.09.2026)

Chapters: plugins. Visible background processes and services should be terminable without another
chat task. The existing process pills get a
compact action for this; the previously purely informational remainder counter makes all further
processes reachable in a shared run dialog. In narrow windows, the header row stays limited to
one process and the access to the complete list.

Header row and dialog share the request state per stable process reference. A successful
HTTP call does not remove the entry prematurely; the live observer remains responsible for that.
Errors are retryable, read permissions are kept, and focus return also takes
the last disappearing process into account.

## Choose the sender as the display owner in the chat (08.09.2026)

Chapters: plugins, actor-programs. The inspector also showed the selected agent's own answers
in speech bubbles. The shared chat building block therefore gets an optional owner
that determines via the sender ID whose messages appear without a speech bubble. The
decision lies with the view; the same actor projection stays usable for conversation rounds with
speech bubbles.

The inspector and actor chats set the viewed actor automatically. Mini-apps can
choose the owner for chats and message lists themselves or switch the default off with `null`.
The public message list demo makes the switch directly visible. The display owner
is independent of the human run owner and changes no permissions.

## Preserve valid tool arguments before conversion (08.09.2026)

Chapters: core. A valid `null` in a string/null union became an empty string and
thereby triggered a false mini-app test error. The reproduction narrows the cause down to
our additional JSON Schema conversion; the TypeBox conversion in use already preserves
the union value correctly. The additional step, by contrast, chose the first branch that matched
after conversion, even if another branch already matched the original value.

Validation lets completely valid arguments through immediately and, during recursive
conversion, checks each partial value unchanged first. Valid union values are thus also kept
when neighboring fields need a conversion. Regression tests cover nested
objects, arrays, tuples, additional properties, JSON Schema unions, and still necessary
number/boolean conversion. The original call arguments stay unchanged.

## Scroll-driven feature stage on the homepage (08.09.2026)

Chapters: overview. The owner wants to stage the core capabilities more strongly visually and keep the
existing introductory text. Three large scenes therefore show agents, TypeScript,
and mini-apps with their own coloring, spatially arranged cards, and connections.
On sufficiently large views, the stage holds its position while scrolling leads through
the scenes. The remaining sections get short fade-ins and stronger graphics.

The scroll position drives the effects via local browser APIs; an additional library
or external resource is not needed for this. Scrolling remains a normal browser movement;
the scenes are also reachable via buttons and can be skipped. Small
views, reduced motion, and operation without JavaScript show the scenes stacked vertically.
The feature overview thus stays completely readable even without the spatial staging.

## Script actors as flat modules with a source dialog (08.09.2026)

Chapters: plugins. Script actors previously shared the design of conversation cards and were
therefore hard to distinguish from LLMs. A flat module with beveled corners, a small
TS label, and its own status line makes the kind recognizable independently of color. The
number of delivered inputs stays visible; ongoing work needs only a narrow bar.

The direct script button opens the existing source code in the shared run dialog. The
programmed rule is thus readable without searching in the inspector, while the canvas stays compact.
The view uses the existing syntax highlighting and offers no code editing.

## Unambiguous input responsibility on the canvas (08.09.2026)

Chapters: plugins, actor-programs. The camera previously recognized mainly vertically overflowing
DOM areas as scroll targets. Short controls, input fields, and horizontal content could
trigger the canvas zoom instead. The decision is now based on the entire
control boundary and takes already handled events into account. The responsibility thus stays the same
even with changing content and at the scroll edge. The existing iframe and MessageChannel
path needs no wheel forwarding for this; a second event channel would needlessly duplicate the same
interaction.
The same control boundary also protects against parallel canvas panning with the middle
mouse button and against fitting via double-click. Free surfaces keep these camera gestures.

## Generated capability overview for the global coordinator (08.09.2026)

Chapters: core. The global coordinator first had to search reference files to
discover existing capabilities like the canvas and mini-apps. Its system prompt now contains
a compact overview from the executable management routes and public
tool descriptors of the active plugin set. The late composition also takes into account
contributions registered after the overseer. Schemas and example code stay loadable on demand.

The orientation distinguishes HTTP actions from building blocks of regular runs and does not advertise
internal service operations. The global chat keeps its general file/shell tools;
the catalog grants no additional permissions or capabilities. This way, no second,
manually maintained tool list and no new special tool path is created.

## Existing participants and available tools in the start context (08.09.2026)

Chapters: core, plugins. A moderated run had already created its guests via setup; the
moderator nevertheless created two more actors and then addressed the original guests.
The previous standard flow began with creating an agent and contained no current
actor inventory. The prompt therefore first requires an inventory check and reuse of matching
participants. An overview generated per turn from the RunView makes existing actors visible
even when another actor created them. It appears only when `actor_list` is permitted.
Identical names still do not lead to automatic reuse: separate contexts are
a legitimate reason for several actors.

A second overview generated from the permitted toolset explains, before the first call,
which tools the actor has and which still have to be opened. Plugin descriptions
remain the source; detail contracts are still loaded on demand. The model thus does not have to
guess the capabilities of its working environment first. Both overviews leave isolated
LLMs without tools untouched.

## Set card size and read conversations back on the canvas (08.09.2026)

Chapters: plugins. Sizing the width by the handle gave short names little room for content.
LLM cards therefore use a shared default of 360 by 182 pixels. The responsible
extension offers this size as a local browser setting; individual sizes stay
unaffected by changes to the default.

A limited preview prevented reading back directly on the card. The existing history
now stays completely accessible and uses the same scroll logic as the chat. The
card surface also captures scrolling at the edge, so that it does not turn into an unexpected
canvas zoom. The header still opens the detail view.

In the global coordinator, model, reasoning, and reset sit together above the history.
The wider model selection and the confirmation directly below it replace no data path;
they keep the controls in one place and save the additional footer.

## One overview instead of run dialog, coordinator dropdown, and New run button (08.09.2026)

Chapters: plugins, actor-programs. The run list lay in a page-wide dialog, the higher-level
coordinator in its own dropdown, plus "New run" as a third button in the header row: three
paths for one question, namely what is running and what I continue with. Now there is a
single square corner of bar height at the top left, whose whole surface is the button. It unfolds the
overview above the run surface: coordinator chat on the left, run cards on the right, "New run" in the
run bar. The overview stays a dropdown with outside click, Escape, and `Cmd+I`, not a modal
dialog; it covers the surface below the header row, and the header row stays usable. The slot
`appHeaders` becomes `overviewPanels` with `readRight` and `onBusy`; the coordinator is its
first contribution and reports ongoing work to the corner. The fallback of opening the coordinator
as a second dialog over an open page-wide dialog is dropped together with its
portal switch; the shortcut does nothing while a dialog is open.

## Homepage as a product entry point with paths to development (08.09.2026)

Chapters: overview. Due to its density and the many technical
subsections, the homepage felt like an introduction to the runtime. The new structure begins with the product
and a large schematic workspace surface. Short feature sections with their own graphics,
more spacing, and clear typography make the core capabilities quicker to grasp.
Technical deep dives lead to matching reference points; a dedicated development area
gives access to plugins, profiles, and code examples. The local event and journal examples stay
usable. The shared navigation is still generated from the main page.

The schematic graphics explain existing features without claiming a real run.
Empty screenshot placeholders are dropped; application ideas stay at the end. The design still
uses the app's colors and font family and needs no external resources.

## Run cards, free agent sizes, and targeted activity display (08.09.2026)

Chapters: plugins. A growing run list needs more room than a narrow dropdown.
The selection therefore opens a page-wide dialog with responsive cards and keeps the
existing selection, deletion, and permission paths. The global coordinator stays a dropdown;
its conversation is not replaced by this navigation change.

Agent cards can be enlarged directly on the canvas and dragged by a small corner.
The shared sizing logic takes the zoom into account and keeps a chosen size when
switching to the compact view. The conversation preview can thus use more room without opening
another dialog. Removed cards lose their local size choice.

The work of the primary conversation partner is already recognizable in the chat. Its running turn
is therefore dropped from the activity chip, while tool calls and other actors stay visible.
Filtering before the display limit prevents the hidden turn from occupying a slot.

## Compact toolbars for workspace and agent details (08.09.2026)

Chapters: plugins. Labeled tabs and the permanent status line took up a lot of room before the
actual chat, especially in narrow views. The bars therefore show
icons in one row; names and counts stay in tooltips and accessible labels.
The info chip shows model and run details only when opened. Dots keep the hints
in the workspace, and the language plugins deliver their short labels themselves. Horizontal
scrolling keeps both bars reachable even with little space, without wrapping them onto several
rows.

## Work scenes indicate running agents (08.09.2026)

Chapters: plugins. During a running answer, the agent card should visibly stay active even without a new
message. The icon field therefore uses a compact selection
of the existing work scenes; below the chat preview, an additional row shows the normal
variant. The five history lines are kept completely. Both displays follow the
existing actor state and disappear on end, error, or stop.

The shared chat building block takes over both renderings. A reduced motion setting
pauses frame rate and scene changes, so that the newly used scenes also stay calm.

## Compact app windows and readable agent previews (07.09.2026)

Chapters: actor-programs, plugins. Large initial app windows took up a lot of room on the canvas,
while the agent headers gave hardly any insight into the ongoing work. Mini-apps therefore start
with at most 400 by 280 CSS pixels; smaller defaults are kept. Their content
keeps the normal font size; larger work views are still reachable via scaling
or the full view.

Agent cards get more width and, below their header, a five-line-high excerpt
of the most recent messages. The preview uses the existing actor conversation and leads
to its complete view when clicked. It stays limited to agents; the
existing layout takes the measured card sizes into account.

## The homepage explains concepts before their composition (07.09.2026)

Chapters: overview. A setup previously came before the explanation of its building blocks; the linking
via events was hidden in the TypeScript subsection. The homepage therefore leads from run and
actors via events and subscriptions to programmed rules, mini-apps, and journal. Setups
are then explained as a reusable composition of these parts. Benefits and existing
examples are placed directly with the respective concept. The subscription matrix gets a local
reading example for source, event type, and delivery. The shared header row gives access to these
chapters from the reference pages as well. Design and existing technical details are
kept; a mini-app is explicitly distinguished from a subscribing actor.

## The start dialog follows the created run (07.09.2026)

Chapters: plugins. Closing was bound exclusively to the successful HTTP response of
`send` or `start`. With a pending response, the run could already exist
while the dialog still showed the start surface. The draft therefore also observes the
existing run stream and reports the transition only once. Rejections without a run stay visible.
The isolated browser check covers chat and script with success, rejection, and a delayed response.

## Shared homepage header on all pages (07.09.2026)

Chapters: overview. The separately maintained navigation of the references had different entries,
spacing, and no sticky behavior. The generator therefore takes over the existing header row
from the main page. Styles and height measurement are shipped as shared assets;
the content width is identical as well. Topic links get the homepage target on subpages,
the current reference entry a marker. Menu changes thus stay in one place and
work both in the help dialog and in the static export.

## Simple message list as a mini-app control (07.09.2026)

Chapters: actor-programs. For editorial notes or review status, a mini-app often needs
several senders and readable messages, but neither an actor binding nor a chat input.
`UI.MessageList` therefore uses the shared message rendering with a small,
controlled data contract. Order and content come from the app; sender colors stay
stable. Two existing reference cases and local demos show the usage. Types and public
API are documented by the same export and contract collector as the other controls.
The delivery of external state changes remains a separate question of host reactivity.

## Optional profile sign-in with shared permissions (07.09.2026)

Chapters: profiles, plugins. An instance should stay simple without user management and
be able to distinguish readers and operators when needed. Therefore, only an explicit
user export of the profile file activates sign-in. Password references stay outside public
configuration; sessions are kept in memory and discarded on restart.

The permission query is a shared string contract for host and extensions. The interface
uses it for visibility and editability; HTTP routes check independently of that.
The global conversation has its own permissions. Profile access remains shared access to all
runs and, for write permissions, trusts the existing agent execution. A private local
service identity keeps the global coordinator's management API without distributing a browser
access. Permissions, contracts, and examples flow from the code into the developer reference.

## Small window shell for canvas mini-apps (07.09.2026)

Chapters: actor-programs, plugins. Without any frame, the canvas apps lacked recognizable boundaries
and a simple way to free up space. A flat title row offers collapse
and enlarge; it deliberately differs from the agent cards. The smaller
resize handle keeps the corner free. The local full view uses the existing dialog
inside the run, without a new manifest requirement. The canvas client stays mounted,
so that local inputs are kept; the additional view shares the journal state.
Tool forms on agents get no additional shell. Escape from sandbox iframes
is forwarded to the host unless the app handles it itself.

## The existing homepage header stays visible while scrolling (07.09.2026)

Chapters: overview. The additional topic bar repeated the navigation. It is dropped
together with the progress indicator and section marker. Instead, the existing
header row stays sticky; its measured height keeps anchor targets visible below the navigation.

## Help without an additional title row (07.09.2026)

Chapters: plugins. The homepage already has its own navigation. The additional
help header row is dropped so that the dialog uses the available height for the content.
A close button sits at the top right above the iframe. The shared modal building block
keeps background lock, Escape, and focus return; the dialog name stays available for screen
readers. The keyboard boundaries of the iframe lead directly back to the close button.

## Compact header in the coordinator chat (07.09.2026)

Chapters: plugins. Title, subtitle, and detailed model information took too much room from the
chat. The dropdown gets a single-line header and model controls grouped together,
with messages only in loading, saving, or error states. The normal settings page
keeps its explanatory text. A limited width and the shorter footer give the
conversation more weight without changing the existing dropdown, model selection, or reset logic.

## Mini-apps directly on the canvas (07.09.2026)

Chapters: actor-programs, plugins, overview. The additional app full view in the right tab
spread the same interface across several places and required an explicit placement for the
actual workspace surface. Every installed app therefore appears on the
canvas by default. The host fills in missing dimensions and placements; the layout arranges the elements.
Dialog apps also belong on the surface; the dialog remains an additional view.

Visibility is runtime state and not a new build: the agent can hide an app
without losing installation, tools, or data. Showing it again and restarting keep
this state. Dedicated app tabs and their navigation are dropped completely; the tools tab
stays for script tools. Two reference cards check automatic placement and
show/hide; the generated overview verifies their coverage.

## Shared HTTP management instead of special coordinator tools (07.09.2026)

Chapters: core, plugins, typescript-platform. The global coordinator works with the same general
file and shell tools as an external agent. Its six own tool adapters
are dropped. Their useful guarantees move into a jointly callable HTTP management:
reference resolution, server-side run creation, and confirmed start preparation. Local
run script packages go through the existing loader and check path, so that own setups
need no new package contract or plugin restart.

Executable HTTP contracts generate OpenAPI and Markdown; the same contracts check requests.
No manually maintained second API list is thus created. Journals stay JSONL and become
accessible for reading. Writing operations stay with the engine; the existing host shell
is not a new security boundary. Old global actor identities are not migrated
but require the already existing explicit conversation reset.

## One voice for all controls (07.09.2026)

Chapters: plugins, actor-programs. The interface had over thirty button styles of its own:
three different buttons side by side in the header row, pills in five sizes, ghost buttons
with four hover colors, focus rings sometimes opaque, sometimes transparent, sometimes absent. Every plugin
had its own Back button. Decided:

- There is ONE small UI library under `apps/web/src/ui/` with `Button`, `IconButton`,
  `Chip`, `Segmented`, `SelectMenu`, `Modal`, and `Dialog`; the classes in `ui.css` are
  the same contract for markup without a component. Host, plugins, and mini-apps (`UI.Button` etc.)
  use them; plugin CSS no longer builds buttons and does not select any `ui-*` class.
- Exactly two heights (30 px, 26 px in rows and cards), one radius, one focus ring, one
  hover color. The scale lives in `ui.css` itself, so that it also works in the mini-app frame.
- States never rely on color alone: a selected chip is filled AND outlined, an active
  toggle sits as a surface with a shadow in the frame, and anything that deletes says so in its text.
- List rows and tabs (`session-open`, `file-row`, `tree-row`, `workspace-tab`,
  `settings-navigation-item`) stay rows, not buttons; they are not part of the
  library.
- `host-widgets.css` keeps only what is not a control (spinner, counter, empty state,
  messages, source code colors); `chat/icons.tsx` and `lib/icons.tsx` are merged into
  `ui/icons.tsx`.

## Homepage with explanatory graphics and staged deep dives (07.09.2026)

Chapters: overview. The existing homepage gets a vivid overall explanation and
shorter paths to the features. Labeled function diagrams show the structure, separate
agent contexts, and the shared handler of a mini-app. Long operational details sit
behind expandable summaries; the journal reading example stays directly usable.
The request for explanatory illustrations complements the previous screenshot rule.
HTML and SVG keep labels, links, and icons precise, scalable, and in the static export.
The topic bar and short highlights support orientation while scrolling, without
taking over the scroll path or hiding content until an animation.
Progressive disclosure serves as the design principle; the matter-of-fact voice is kept.
The source release of the UI reference follows the building blocks moved to `apps/web/src/ui/`.
The icons for Back, Help, and Settings missing there have been added for the web build.

## Auto-scroll at the actual end of the history (07.09.2026)

Chapters: plugins. The previous end marker lay before the footer space of the input. `scrollIntoView`
therefore did not reliably reach the actual scroll boundary; the resize observer
could additionally switch off follow mode while an answer grew. The shared
chat now remembers the scroll intent independently of size changes and moves only its
own scroll container. Manually reaching the end and the end button activate
following; scrolling up pauses it. Tests also cover simultaneous scrolling and
content growth.

## More space before the chat input (07.09.2026)

Chapters: plugins. The last contribution sat too close to the input box above it.
When an input is present, the shared chat frame now reserves 32 instead of 16 pixels of
additional footer space next to its measured height. This also applies to the global coordinator
and mini-app chats; pure history views keep their previous spacing.

## Neutral examples by use case and concept (07.09.2026)

Chapters: overview, plugins, typescript-platform. The reference consisted mostly of technical
samples; for start guides there was only one customer case. The reference extension therefore delivers
two setup dialogs of its own, two skill flows, and additional use cases for the
existing capabilities and controls. Customer-specific scenarios do not count toward coverage.

Simple optional tags on the shared StartEntry contract connect search,
filter, and documentation. Domain assignment and concept catalog stay in the extension;
the host knows no reference categories. The generator produces the two perspectives
and a concept overview; the check requires at least two examples per concept.
Wording variants and the same scenario as script and prompt do not double the coverage.
The minimum number documents existing example tasks, not successfully executed model runs.

## Open help inside the application (07.09.2026)

Chapters: plugins. On request, the homepage appears in the modal dialog instead of in a new
browser tab. An iframe loads the same static export; subpages and UI examples stay
usable inside the help. The existing dialog takes over background lock and
focus return. Escape and the tab boundaries are also handled inside the iframe.
External source links still open separately; the standalone export stays unchanged.
Missing concept assignments for the existing script tool and tab app examples
have been added so that the strict reference check does not block the integrated web build.

## Homepage as bundled help and static export (07.09.2026)

Chapters: overview, plugins. The question mark next to settings opens the homepage in a
new tab, so that the ongoing conversation is kept. Every web build generates the
public references and ships the static export under `/help/`. The same export
lies under `docs/homepage/dist/` for independent hosting; there is no second help page.
Repository links become GitHub links in the export; pages and assets stay relative.
The reference check runs before the web build, so that its generation does not hide outdated
sources. Missing help files return 404 instead of opening the application again.

## Build entry points reduced to three tasks and scripts (07.09.2026)

Chapters: overview. Separate tasks and wrappers for every partial build and test made the selection
unnecessarily large. What remains is `build`, `check`, and `open: homepage` as well as three scripts
under `build/`. The homepage entry point bundles generating, checking, and opening via options. The
complete check order is kept; targeted pnpm commands call their tools directly.

## Build the homepage before opening it (07.09.2026)

Chapters: overview. The task `open: homepage` should show current references. Its script
therefore first runs the homepage build and opens the page only on success. The task file
still contains only the script call; `pnpm open:homepage` uses the same flow.

## Embedded interfaces without an additional window shell (06.09.2026)

Chapters: overview, plugins, actor-programs. Nested header rows and frames made small
interfaces unnecessarily heavy. The mini-app extension therefore shows canvas apps without a host frame
or background, and tool forms directly inside the agent card, without a second header row
or collapse button. Inputs, actions, resize handles, and necessary runtime messages are
kept. Successful actions leave no permanent status bar on the canvas.
The mini-app's own design as well as the full views in tabs and dialogs are kept.

## Startable reasoning default in the core profile (06.09.2026)

Chapters: profiles. The core profile set GLM 5.3 Flash to `off`, although the model catalog
only allows `low` and `high` for the offered RAgents levels. The initialization of the global
coordinator therefore aborted the server start. The profile default is now explicitly `low`;
the strict check is kept. A test with the shipped configuration and the
real model catalog reproduces the error and checks the valid initialization.

## Conversation reset and controls from the mini-app extension (06.09.2026)

Chapters: core, plugins, actor-programs, overview. The global coordinator should be able to start
with a fresh context after a completed task. An explicitly confirmed reset stops its
work and removes only its conversation. A persisted intent and the existing
stop boundary prevent a process abort or late runtime output from restoring the old
context. Model choice and managed runs remain; there is no automatic clearing.

Forms, tables, file selection, task progress, and document/diff views live with
types and styling in ragents.mini-apps. They complement the existing controls without introducing new
domain branches in the host. The shared type file collector supplies compiler, LLM tool,
and public reference; export and contract tests prevent a second, outdated API.
The local template and reference demos show the same code, including errors of asynchronous
actions and controlled inputs.

## Matter-of-fact language on the homepage (06.09.2026)

Chapters: overview. In its introduction, the homepage names RAgents a programmable AI harness.
Advertising slogans and direct address are dropped on the entire main page. The three focus areas
describe capabilities and benefits; introduction and compact arrangement are kept.

## Room for line labels and a calm global chat (06.09.2026)

Chapters: plugins. Labeled connections looked cramped between compact actor cards.
Their measured text size now increases the minimum spacing of the smallest shared layout group.
Room thus remains around the label, even after text changes and independently of the camera zoom.
The global coordinator starts with hidden tool and reasoning steps. Its own
stored detail selection makes them visible when needed, without switching run chats.

## Capture canvas sizes independently of the graph render (06.09.2026)

Chapters: plugins. Asynchronously loaded card contributions could widen their actor card
without triggering a render of the graph. Neighbors, lines, and frames therefore used old
dimensions. A shared observation of all actor and app boxes collects size changes per
frame and feeds the existing layout calculation. World dimensions stay independent of the camera zoom;
the plugins need no update signals of their own. Canvas apps keep their
requested size, while the layout uses their measured outer dimensions to avoid feedback
between measuring and setting.

The first camera fit waits for real dimensions and a visible surface. Later measurements
update the layout without changing the camera. App resize handles convert the
pointer movement with the zoom and trigger the shared measurement already while dragging.
Observers, pending frames, and pointer gestures are cleanly ended on removal.

## Homepage between introduction and fact overview (06.09.2026)

Chapters: overview. The condensed fact list was too dry and lacked an
introduction. The homepage therefore again combines a short introduction with three concrete
possibilities: assembling an agent team, collaborating in a shared mini-app, and
keeping the setup for the next task. The introduction puts one's own working environment
at the center. On the notebook, the focus areas stand side by side; on mobile they follow
one below the other. Model choice,
plugins, and journal are placed below as a supplement. Moderate font sizes and spacing keep the
capabilities within the first screen; the image placeholders stay collapsed.

## Generated text reference for external models (06.09.2026)

Chapters: overview, typescript-platform. External models should be able to write run setups and further
extensions without first having to work through the HTML reference or the repository.
The existing homepage generator therefore additionally generates a small
`llms.txt` index, individual Markdown references, and `run-api.d.ts`.
The API uses the real compiler declaration generator with the registered core contracts;
examples take over all files of the bundled run script packages. Tests
and embedded mini-apps are thus also traceable without maintaining a second API list. The normal
reference check checks for drift and compiles the example sources against the published API.

## Settings by extension or capability (06.09.2026)

Chapters: plugins. The owner wants to be able both to start from an extension and to see
which extensions deliver a specific capability. A toggle therefore flips the navigation
of the same inventory: owner or contribution kind on the left, the existing details on the right. The
capability view shows matching contributions by owner and links to its complete page.
Editable settings belong to the configuration. Shared detail components and the same
plugin state prevent diverging renderings or settings.

## Homepage introduction with directly visible facts (06.09.2026)

Chapters: overview. On the notebook, the previous title block took up almost the entire first
screen without adequately explaining the capabilities. The introduction now consists of
a short product definition and six compact lines on setups, mini-apps, TypeScript,
model choice, plugins, and journal, each with a concrete benefit and a link to the deep dive.
The repeated intermediate labels are dropped; section spacing becomes smaller. Image placeholders
sit collapsed in the respective details; the workspace surface follows after the setup chapter.
The visible space thus stays available for content and directly usable UI and code examples.

## Open the homepage from VS Code (06.09.2026)

Chapters: overview. Direct access to the finished page was missing for building. The task
`open: homepage` and the alias `pnpm open:homepage` use `build/open-homepage.sh`.
On macOS, the script opens the local file URL in the default browser; a rebuild is a
separate task. The URL is generated from the file path so that spaces also stay correct.

## Shared dropdowns and a configurable global coordinator (06.09.2026)

Chapters: core, plugins, profiles. The owner wants to change model and reasoning level of the higher-level
coordinator directly in the chat and in the settings. Both views use
the same plugin contribution and state. The selection is stored per profile and taken over
synchronously and journaled on every turn; running answers keep their model. The
long-lived conversation is thus kept. Model capabilities and existing media limit
the selection; failed changes keep the previous value.

Editable settings belong to their plugin as a generic web contribution. The overview
and the plugin page show the same interface; its inventory stays readable next to it. The
header row arranges run list, New run, and global contributions on the left; the gear stays on the right.
Run list and coordinator get a shared dropdown building block and the same design
with spacing to the header row. Select menus and step popovers also share the closing logic;
Escape closes only the topmost open layer; outside click and focus change close as well.

## Build and check entry points under build (06.09.2026)

Chapters: overview. The owner wants VS Code tasks without their own flow logic and a shared
folder `build` for the scripts they call. The tasks therefore start only Bash
scripts under `build/`; the previous pnpm commands also delegate there. Orders and
error handling thus live once in the script instead of being spread across editor and package
configuration. The standard build produces agent runtime, web, and homepage; the overall check keeps its
previous steps. Only `.vscode/tasks.json` is released from the ignored editor folder.

## Public building block and developer reference (06.09.2026)

Chapters: overview. The owner wants to make the existing neutral building blocks visible and to explain all
extension possibilities with small examples. The homepage therefore links two
generated subpages: a tool/UI catalog and a developer reference. Tool contracts,
UI props, template files, and reference entry points are read from their sources; the examples
arrange the extension points by their purpose. A contract check detects new, not yet
covered surfaces, and `pnpm check:homepage` detects outdated outputs.

The public capture executes no real profile configuration. It uses only
neutral plugins, an isolated test configuration, and temporary storage without a model or run start.
Private product names are also removed from the main page; the outputs are checked for private
names and local paths. Real UI components serve as local, explicitly labeled
demos without a backend. The rules for the homepage are accordingly in AGENTS.md, the rebuild in
operations.md.

## Canvas controls at the bottom and run chat as a pop-out (06.09.2026)

Chapters: plugins. The floating zoom bar covered actors placed at the top left at start.
It therefore sits at the bottom left. Its chat switch opens the run chat as a pop-out above it and
no longer changes the canvas geometry. The old chat column and the stored
open state are dropped; the adjustable width stays. A hidden chat stays
mounted, so that message draft and attachments are kept on closing. Focus on
opening, Escape, close button, and outside click follow the interaction of a pop-out. Homepage and
operating hints describe the new arrangement.

## Multimodal inputs in all chats (06.09.2026)

Chapters: core, plugins, actor-programs. The owner wants to use images from the clipboard and files
including videos directly in every chat. The shared composer takes over
file selection, pasting, drag and drop, preview, and keeping the draft on rejection. Its
send action carries attachments up to the chat API or through the mini-app bridge; bound
and controlled chat controls use the same contract.

The existing artifact storage holds the bytes, while the run journal stores only metadata and
deliveries. The model runtime receives real media content. Published
OpenRouter modalities determine whether images, videos, and native PDFs are permitted; the
check takes place both before sending in the web and before acceptance in the server and the driver.
PDFs explicitly activate native processing, so that no other processing service
steps in unnoticed. Text files become text input; other files require file tools.
The interface thus shows no successful delivery when attachments cannot reach the target
at all. Homepage and operating hints describe the shared inputs.

## Homepage: from skill to setup, and a technical journal explanation (06.09.2026)

Chapters: overview, core. The owner wants to explain the capabilities through their benefit and their construction:
prepared setups, programmed flow rules, and custom mini interfaces therefore come
before the other features. The homepage combines short explanations with expandable
technical details. The journal gets a local, interactive reading example and an explanation
of command records, events, projection, and restart boundaries. The wrong sentence in the README
that a journal line is always exactly one event is corrected together with its example.

Because development happens in parallel, no new runs are captured. The image spots therefore
hold explicitly labeled placeholders; the homepage rule allows this interim form.
Refactoring and company workflows stay marked as application ideas and are tracked in
`docs/concepts/homepage-use-cases.md`. The checks concern only the static
homepage. The application and its runtime data are neither started nor changed for this.

## Run list as a dropdown and direct access to the coordinator (06.09.2026)

Chapters: plugins. The owner wants to open the run list at the top left above the workspace surface without
changing its width. It therefore becomes an initially closed dropdown with a limited
width and its own scrollbar. The persisted sidebar width, the stored
open state, and the resize handle are dropped. Run selection and deletion stay available;
selection, creating a new run, Escape, and moving outside close the list.

When a prompt template is applied, the task area is additionally scrolled into view.
The replaced draft thus stays immediately editable even after a search further down in the
templates. The selection still sends nothing. Homepage and operating hints follow the new
arrangement.

The higher-level coordinator gets `Cmd+I` or `Ctrl+I` for opening, focusing, and
closing. Its dropdown sits centered below the header. If a page-wide dialog is already open,
the same chat switches into a dialog above it. It thus stays reachable while draft and
focus of the previous dialog are kept. The display switch creates neither a second
chat nor a second stream.

## Run details and navigation in a shared header row (06.09.2026)

Chapters: plugins. The owner wants to merge the two header areas and gain more room for the
workspace surface. Navigation, run title and status, plugin contributions, and the higher-level
coordinator therefore sit in a shared bar. The additional run title row and the
empty strip when the run list is collapsed are dropped. In narrow windows, the global
actions stay reachable via icons with accessible labels; additional run details can
wrap within the bar.

For the run-bound contributions, a portal keeps their existing providers and dialog boundary.
Run dialogs stay below the shared header row; page-wide dialogs overlay it. The
start draft does not change the header row of the previous run. The merge thus moves
the rendering without changing the context of the plugin contributions or the behavior of the dialogs.
The homepage describes the shared bar.

## Separate task input and templates on the start surface (06.09.2026)

Chapters: plugins. The owner wants a clearer start surface. The task input
now stands alone at the top, followed by the existing start options and separate areas
for searchable prompt templates and for prepared skills and run scripts. The standalone
input building block needs no message list or chat surface around it. A prompt version
replaces the draft and focuses it; it still does not start a run. The model choice uses
the shared select menu with a compact thinking level next to it.

The reorganization keeps the plugin contract: only selectable, not yet locked start options are
offered. Grants from the profile, guides, and the existing send and start paths remain
authoritative. The homepage and the operating hints describe the new arrangement.

## Prebuilt chat controls for mini-apps (06.09.2026)

Chapters: actor-programs, plugins. The owner wants to use more existing UI building blocks on the canvas
and offer both actor-bound and freely controlled chats. Mini-apps get the same
chat, input, Markdown, and select components as the host as a typed `UI` library.
The variant with an actor handle uses the existing run connection and the same history as the
inspector; the primary actor keeps its live stream. The free variant gets messages
and the send action from the app code. A canvas template makes the actor chat directly available.

The host bundles the existing components with esbuild and binds them to the React instance
already loaded in the iframe. Rendering and interaction thus stay maintained together. Chat inputs
go via the existing human actor input path; an app therefore needs no manifest action of its own.
Failed sends keep the draft; pure views show questions
without ineffective input fields. The homepage describes the new building blocks.

## Canvas mini-apps without a window header (06.09.2026)

Chapters: actor-programs, plugins. The owner wants to put the small control surfaces on the canvas more
in the foreground. The additional header row with app icon, title, and collapse button
is dropped; the app gets the entire surface. Runtime messages move compactly to the bottom
edge; resizing stays possible. With its only user gone, the collapse logic is also dropped from the
canvas contribution contract and the layout. The highlighting based on the tab selected on the right and
the hard drop shadow are dropped as well. The agent prompt prefers canvas placements
for new control surfaces. A later replacement of the right panel stays in TODO as a direction;
the existing tabs stay usable.

## Page-wide coordinator and separate dialog areas (06.09.2026)

Chapters: plugins, core, profiles, actor-programs. The owner wants a chat above all runs that is reachable at
any time, while run-specific dialogs leave the header row free. `ragents.overseer` delivers
the expandable chat in the new top bar and tools for reading the journals and
controlling further runs. Its history is a separate persistent run; the server resolves short references.
The normal coordinators do not get these tools. The host renders the
page-wide header contribution via a plugin slot, so that removing the plugin also removes the
interface.

"New run" opens the existing start surface as a large page-wide dialog without the right
workspace. Escape discards the draft and returns to the previous conversation; after
the entry is accepted, the new run opens. Run-specific dialogs, by contrast, inherit their workspace surface
as portal and input boundary. The header row and the higher-level chat thus stay visible
and usable. Nested dialogs handle Escape only once and return the focus.
The homepage describes both entry points; the outdated overall views have been taken out.

## The homepage explains the programmable harness (05.09.2026)

Chapters: overview. The homepage began with runtime terms and then described many
controls before it became clear what RAgents is. The introduction now names the programmable,
model-agnostic AI harness; canvas, agents, TypeScript, mini-apps, and plugins then explain
how it works. Shorter paragraphs, larger real core screenshots, and expandable details replace
the numbered interface tour. The model choice names the current OpenRouter connection;
run scripts are presented as an existing capability in the introduction. Run templates stay in the outlook;
the blanket confirmation requirement for app actions and an outdated inspector image are dropped.
The page stays a static file without external resources; nothing changes in the application.

## The coordinator chat leaves the surface (05.09.2026)

Chapters: plugins. Task: remove the coordinator chat view from the canvas.
This is the core of draft 1 (command bridge) from `docs/ui-drafts/bedienkonzept.html`: the
chat was an 820 by 1020 pixel world object that zoomed with the surface, the layout had to
route around it on the right, and a "Chat" button brought the camera back. Now the chat is a fixed
column to the left of the surface, at reading size, draggable (320 to 760 pixels), and collapsible
via the zoom bar; `CHAT_WORLD` and the return button are gone, the layout starts at the origin, and the
camera only fits the layout bounds. The contribution contract stays: the canvas owner
still renders the chat via `renderChat` and hangs the emergency stop in `toolbarLeft`. Still open from the
interaction concept are the variants for the run list (A selector in the header, B rail, C two compartments)
and the other drafts; the run list remains unchanged as a sidebar.

## Run scripts: one entry contract, start without a message, run_configure (05.09.2026)

Chapters: plugins, core, typescript-platform. The complete run script feature was requested, that is
steps 2 to 5 of the concept `run-start.md`, which is thereby deleted. Decided:

- ONE contract `host.startEntries` instead of `promptCards` and `starters`: the same card, three
  actions (`prompt`, `skill`, `script`), `guide` per entry. The web gets `startEntries` in the
  bootstrap; a script entry travels without its source. The wire contract lives shared in
  `apps/server/src/plugin-support/start-entries-contract.ts`; a type test keeps it congruent
  with the engine's `PublicStartEntry`.
- Run scripts are packages `run-scripts/<name>/` with RUN.md, setup.ts, tests.json, and optionally
  apps/; the folder name is the handle (package name instead of a fixed `@setup`, so that the surface says
  which script built the run). On click, the host checks, tests, and installs without a
  model via `setUpScriptActor`; `POST /chat/<id>/start` is the route without a message. First the
  script, then the coordinator: a failing script leaves an empty run and not a
  half-built one; an empty run accepts the next entry.
- `run_configure` (title, primary actor) under the tenth capability `run.configure`, plus the
  event `run.title-changed`. The owner configures by right; others need the
  grant. This makes `coordinator: false` possible: the host spawns no coordinator, the script chooses.
- `canvas_layout_replace` and `mini_app_*` apply to every actor except the human with the
  matching capabilities, no longer only to agents; otherwise no script could build the surface.
- An installed run script has `toolNames: null`, so that spawned agents inherit the full selection;
  the build's capability list remains the boundary for the script itself.
- A deliberately set title (package, `run_configure`) beats the heuristic from the first
  message in the run list; the title compaction then does not run at all.
- Three reference packages in `ragents.reference` next to the cards: conversation round, tool and
  mini-app (with `apps/`), moderated round without a coordinator. All three started live in the core
  profile: surface, mini-app, and moderator as primary actor were in place without any action by the model.
- Findings of the review from the same day fixed: `useChat.send` throws on a rejected response, the
  start surface comes back and shows the error; without skills and run scripts the width belongs to the
  chat; the prompt cards carry the plugin in small print on the card instead of the plugin ID as a heading;
  the homepage shows the start surface with run scripts instead of the old empty chat.

## Journal lock with a heartbeat instead of manual work (05.09.2026)

Chapters: core. A server start failed because of a lock whose process had been dead for hours;
the question was how such locks can be prevented. Finding: SIGINT and SIGTERM
cleaned up, but crash handlers and the shutdown timeout ended in `process.exit`
without `journal.close()`, SIGHUP had no handler, and a hard kill lets no
handler run anyway. On top of that, the journal rejected every existing lock, although it knew the process ID.
Decided, two layers:

- Release where possible: SIGHUP like SIGTERM, and an `exit` hook closes the journal synchronously,
  so that crashes and timeouts also return the lock.
- Detect an orphaned lock: the owner file carries process ID, hostname, and a heartbeat
  that the owner renews every five seconds. On open, the lock is taken over if the process on
  the same host is dead or the heartbeat is older than 30 seconds, with a warning in the log;
  the heartbeat covers reused process IDs and the container, which sees different IDs than
  the host. A live writer with a fresh heartbeat stays hard-rejected. A writer whose
  owner file disappears no longer writes and reports it. The earlier rule "never
  taken over automatically" protected against two writers, not against a dead process; the
  heartbeat keeps holding this boundary.

## Start surface entries without boxes (05.09.2026)

Chapters: plugins. Feedback on the first state of the start surface: skills and prebuilt runs should
not be grouped in boxes. The two framed areas Skills and Prebuilt runs with their
header rows and the grouping by plugin are gone. Next to the chat control there is now ONE surface
with the entries that start the run without a message, as cards directly on the background: today the
starters with the Skill badge and the plugin in small print on the card, later the run scripts as
further cards (`apps/web/src/StartSurface.tsx`, `start-layout`, `start-entries`, `entry-grid`).
The prompt cards stay unchanged as part of the chat control. Draft 5 of the mockups has been
updated to match.

## Product homepage under docs/homepage (05.09.2026)

Chapters: none; changed are AGENTS.md (documentation, work rule 6) and README (further reading).
In addition to spec and concepts, a homepage for users should be maintained: a product view instead of
technology, structured by what you can do. Three independently worked-out structures were
up for selection: tasks ("I want to ..."), a tour along the interface, capabilities as pillars.
The task structure was chosen because it answers the user's question and does not depend on
today's arrangement of the interface: the tour becomes outdated with the interaction concept rework, the
pillars describe what the system is, not what you do with it. Taken over from the other two:
every section names at least one prompt card from
`plugins/ragents.reference/prompt-cards` as evidence (if the card is dropped, the section stands out); the
page shows only what runs in the `core` profile, a product profile appears in exactly one section
as an example; a term strip with five words sits at the front, and the journal is told as a benefit
(restart, reading back), not as architecture.

Decided: ONE long page `docs/homepage/index.html` with a jump bar, without a build step;
screenshots from real runs of the `core` profile under `docs/homepage/screenshots/` (run of the
prompt card "Team as a tree, topics in a grid", start screen, inspector, settings). Where no
real run was available (mediator, question and to-do on the card, tool card, mini-app in three
places, documents tab), there are diagrams labeled as such; replacing them with screenshots
is listed in TODO.md. Excluded are architecture, event and tool names, plugin IDs,
counts, security promises (secondary according to the course), and concepts as features; concepts appear
only in the outlook as an idea. Meaning is never encoded by color alone on the page (shape,
stroke style, text, position; accents only blue and amber).

Addendum from the same day: the first version read like a generated brochure: slogan headings
following one pattern ("X instead of Y"), three claim tiles, seventeen identically built sections with
bullet grids and bold sentence openings, chips, invented examples in diagrams, 14000 pixels long.
Requirement: no advertising brochure, a sober description of what the thing is and what it can do, with
a sentence "RAgents is ..." at the beginning. Decided: the voice of the README, headings name the
thing, running text instead of bullets, only real screenshots (diagrams removed), prompt cards as a
plain sentence "Try it", a third of the length, one column with the tokens and the font
of the app, no cards, shadows, or external resources. The text was first approved as a raw draft,
then taken over into the HTML.

## New run and start surface instead of an empty chat (05.09.2026)

Chapters: plugins. First step of the concept `docs/concepts/run-start.md`. The owner's objection:
"New conversation" is a new run, and the composer is not the only entry point but
one among the cards that plugins bring along. Decided:

- Wording in the web: "New run", "Runs", "Delete run"; the default title `runTitle` of both
  product plugins is "New run". Conversation stays the explanatory word in prose and spec.
- The start surface is a separate state of the draft (`apps/web/src/StartSurface.tsx`), no
  longer the `emptyState` of the message list: the start options as a row at the top, below them three
  equal areas side by side (owner's decision, draft 5 of the mockups): the
  chat as today's chat control with prompt cards and composer, the skills (starters, grouped by
  plugin, with a text badge of the kind), and the prebuilt runs (run scripts and
  guides; until step 3 of the concept only a hint). None of the areas is the center,
  none a row at the edge. The center switches to canvas and chat with the first `send`; the
  switch is remembered locally, because `send` does not enter the message optimistically and the
  surface would otherwise stay until the SSE echo.
- The click paths are unchanged in effect: a prompt card fills the composer, a
  starter sends immediately or first opens its guide. No new server contract;
  `promptCards` and `starters` remain two registries; merging them is step 2 of the
  concept and open.
- The right workspace stays reachable on the start surface, because domain queries of a
  plugin with handover to the chat are needed before the first message.
- The CSS of the old card lists (`prompt-selection`, `prompt-cards`, `starter-cards`) is gone.

## Concept papers merged in, chapters reconciled with the decisions (04.09.2026)

Chapters: actor-programs, typescript-platform, core, plugins, profiles, overview. Step 2 of the
documentation rework: `docs/concepts/mini-apps.md` and `docs/concepts/typescript-platform.md` have been
absorbed into `actor-programs.md` and `typescript-platform.md` and deleted; the transitional sentences at the
beginning of the chapters are gone. Removed was what is history or proof (initial problem of the
migration, implemented migration, acceptance lists; tests are the proof) and what the code does not
support: `_generated/ragents.d.ts` exists nowhere, test proofs are kept on the server with 30
minutes of validity instead of being HMAC-signed, there is no `environmentHash`, the
example of a prepared flow is product history. Confirmed and taken over: placement limits (280 to 960 by 180
to 720, default 480 by 320, at most eight), dialog sizes, compiler options, worker limits,
regex bounds, React 18.3.1 as UMD, request ID dedup, 250 kB limit.

Reconciliation of the older entries: `core.md` now describes the three runtime packages with their own
behavior, steering in detail, validation errors as journal events, the redaction of
tool results, `outputs` per turn, and model choice at spawn; `plugins.md` gets the section
on sandbox tools, process bar, and file browser, the camera rule of the surface, and the
TypeScript special case of the language server; `profiles.md` the roles of a product profile, the prepared
flow, the Git token, and the domain environment; `overview.md` the four contract rules (flat schemas,
unrepresentable states, nothing retyped, rejections name names).

## Three removals from the TODO list (04.09.2026)

Chapters: none, pure cleanup without any externally visible behavior change. `unqueueSteering` of the
agent runtime had no caller and has been removed together with `removeQueuedSteering` and
`PendingMessageQueue.removeFirst`; steering queues are cleared on `reset` and abort
and otherwise intentionally delivered at the start of the next run. `env-api-keys.ts` in
packages/ai now only knows OpenRouter, the only provider of this fork (`KnownProvider`); the
thirty foreign provider variables, the Vertex and Bedrock special paths, and the dynamic
node: imports are gone. Plugin activation in the web has a discovery-free core in
`apps/web/src/plugin-bootstrap.ts` (checking the bootstrap response, loader from the bundle path pattern,
activation); `import.meta.glob` lives alone in `plugin-discovery.ts`, and the core is tested without Vite.
The self-test finding "ls with unexpanded $RAGENTS_FILES_DIR" is moot with the removal of the
ls tool and has been struck from the TODO line.

## Group frames on the surface only on request (04.09.2026)

Chapters: plugins. Every layout group automatically got a dashed frame; this is not wanted
as an automatism but as the model's decision per group. Decided: a group
always shows its label (`label`) as a heading, and it draws a frame only with
`frame: true` (default false). The automatic area "Not placed" carries only the
heading. Internally, `frame` is a required field with a value, not an optional one.

## Documentation: spec, concepts, decisions (04.09.2026)

Chapters: all. The documentation had three sources for "what is" without precedence: the
architecture document, the knowledge base, and two implemented concept papers whose summary was in the
architecture document. Decided:

- `docs/spec/` is the spec: what is, valid for HEAD, one chapter per topic (overview, core,
  typescript-platform, actor-programs, plugins, profiles). Every chapter ends with its open
  limits. The chapters were created from the architecture document and `packages/ragents/docs/`.
- `docs/concepts/` contains only what does not exist yet, with status Idea, In progress, or Rejected. An
  implemented concept is merged into the chapter and deleted; "implemented" is not a status.
  The two implemented papers `mini-apps.md` and `typescript-platform.md` are merged in as the next
  step and count as part of the spec until then.
- This file (previously `KNOWLEDGE-BASE.md`) is the why: dated, newest first, every entry
  names its chapter. It is not a second spec; the three course principles are now in
  `docs/spec/overview.md`.
- `TODO.md` is the inbox for work and ideas, `docs/operations.md` the operating manual,
  `AGENTS.md` the entry point for AI sessions including the rule for how work is documented.
  Claude memory is not used, because the owner works on several machines; everything important for new
  sessions is in the repo.
- `HANDOFF.md` is dissolved: the work rules are in `AGENTS.md`, the test path of the
  feature run in `docs/operations.md`, the rest in `TODO.md`.

## Processes and ports of a run appear in the header row (03.09.2026)

Owner's request: if an agent starts a process (Node, dotnet, vite, ...) during a run and
it opens a port, this should appear at the top in the bar by itself. Decided:

- Mapping via ONE marker: `sanitizedEnv` sets `RAGENTS_RUN_ID=<runId>` in the environment of every
  sandbox process (Bash children, language servers, everything via `processContextFor`). A process belongs
  to the run if it carries the marker, no matter how it was started or re-parented. No heuristics
  via process tree or working directory.
- The plugin `ragents.processes` reads the process table per platform: macOS via `ps` (marker via
  `ps -E`, visible only for processes of the same user; Apple system binaries like `/bin/sleep`
  or `/bin/bash` hide their environment, which is not critical) and `lsof` for listening
  TCP ports; Linux via `/proc` (`stat`, `status`, `cmdline`, `environ`, `fd`, `net/tcp{,6}`), without
  `ps` or `lsof` in the image. As root, reading foreign `environ`/`fd` requires CAP_SYS_PTRACE; the
  permission must be granted to the container (`cap_add: SYS_PTRACE`). If the permission or a
  tool is missing, that is a named error in the header row, not a silent nothing.
- Background processes are always shown, and children of a running tool call only with an
  open port. "In the tool call" means: the process group belongs to a child of the server (Bash
  children are group leaders); everything else is background. `bash`, `git`, and `dotnet build`
  thus stay invisible, `vite` in the foreground is visible via its port, a detached
  service even without a port.
- Runtime resource, not journal state: one observer per server scans all observed runs
  with ONE table scan every two seconds, but only as long as a browser holds the SSE stream
  (`.../processes/watch`); markers are read exactly once per (PID, start time).
  `GET .../runs/<id>/processes` delivers the same state for curl.
- Header row: one pill per process with kind (service/process), label (`node vite`,
  `dotnet Service.dll`), and port links to `http://<host of the interface>:<port>/`. Background
  is recognizable by the dashed frame and in the tooltip, never by a color.
- Deliberately not included: terminating by click and cleaning up marked processes when the
  run is stopped (the sandbox kills only its process groups; a detached service survives the run).
  Both are listed in TODO.md.

## Start options are a contribution, the working directory is empty per conversation (04.09.2026)

What the user sets before the first message is a generic extension point
(`host.startOptions`, web slot `startOptions`), no longer a hard-wired pair of model and
prompt selection. Decided:

- A start option names schema, default value, `selectable`, `accept`, and `describe`. The host
  holds the value per draft (`GET/PUT /chat/<id>/options[/<optionId>]`), checks every value against the
  schema, and lets the owner's `accept` decide; when the run is created, every value moves into the
  journal as initial plugin state under the option ID, after which it is locked (409). The value
  of a started run comes exclusively from the journal. Anyone who delivers no component in the web
  gets a select menu from `{ kind: "choice", label, options }`; anything else is a
  visible error, not a fallback.
- `ragents.model` and `ragents.system-prompt` are the start options of the product plugin
  (`plugin-support/product-start-options.ts`, web in `plugins/ragents.product/web`). The special routes `/model` and `/prompt`, the fields in
  `RunChatSession`, and the fixed pickers are gone. The engine core reads only the
  system prompt state for the prompt composition; the session reads the coordinator's model
  from the journal at spawn.
- `ragents.workspace` gives every conversation an empty directory under the session storage;
  `STATIC_WORKSPACE_DIR` is gone, because two conversations in the same directory get in each other's
  way. A plugin delivers content or a different `cwd` via `workspaceResolverToken`; if it names
  an `optionId`, the user's choice comes from the journal, and before the start there is no
  working directory (409 `run-not-started`). The host therefore resolves the working directory only
  after the run has been created (`prepareWorkspace` in `#startRun`); the lifecycle preparation
  still runs before every message. The resolver must deliver the same `cwd` for the same choice;
  the agent runtime hard-rejects a changed working directory.
- The file storage belongs to `ragents.documents` (`documentStoreToken`, `directoryFor(runId)`), no
  longer to the workspace contract: by default `sessions/<id>/plugins/ragents.documents/documents`,
  with `DOCUMENTS_DIR` a subfolder per conversation under an external path that the host does not touch on
  deletion. The earlier fixed file storage variable and `filesFor` in the workspace contract
  are gone; the sandbox optionally gets `RAGENTS_FILES_DIR` from the service, a product workspace
  only sets the ownership permissions, `ragents.mini-apps` requires `ragents.documents`. Side finding fixed: the old
  storage lay in the global plugin storage and survived the deletion of the conversation.
- `PluginRegistration.optionalService` complements `service` for services that may be missing.
  `WorkspaceRuntime.describe()` only knows `mode` and `directoryPattern`; the settings
  show workspace and file storage patterns per run.

## The coordinator designs the surface, the graph no longer draws lines (03.09.2026)

The force layout of the graph view has been replaced: cards, apps, and shapes lie in nested
layout groups (`h`, `v`, `wrap-h`, `wrap-v`, `grid`, `circle`, `tree`), which an agent sets with
`canvas_layout_replace` as run state of the orchestration plugin. Decided:

- The tool always replaces the WHOLE layout. Input schema flat according to the rule below:
  discriminator `group`, elements as `entity` in `@handle`, `shape:<id>`, or `app:<id>`, parents
  via `parent`, the root level stacks vertically. `wrap-h` requires `width`, `wrap-v` `height`,
  `grid` `columns`, `tree` `root`; foreign parameters are an error that names the matching group.
  The shared parser in `plugins/ragents.orchestration/contract.ts` checks this on server
  and web and internally delivers a discriminated union; the server additionally checks against the
  run (handle exists, no human, descendants of a tree not placed twice).
- Lines exist ONLY on request and only from entity to entity (`arrow`, `style`, `label`). The
  earlier automatic edges (descent, chat anchor, app anchor) are gone. Meaning is carried by
  arrow, line style, and text, never a color; groups carry frame and label.
- Shapes (`circle`, `diamond`) always carry a text and are placed like actors.
- Unplaced actors appear deterministically below the layout as descent trees
  (parent flush at the top, children on the right one below the other, anchored apps below their card), unplaced
  apps without a known anchor in a wrapping row. If there is a layout,
  this remainder carries the frame "Not placed". Unknown entities and unreadable layouts are
  reported visibly, never silently swallowed.
- The engine is a pure measure/arrange (`web/canvas-layout.ts`), the scene is built by
  `web/canvas-scene.ts`; both are tested without React. Card dimensions still come from the
  DOM measurement; the approximate default dimensions are in the tool description and in the prompt
  `canvas.hbs`, which appears only with the tool.

## Sandbox tools are read, edit, write, and bash (02.09.2026)

`ls`, `grep`, `find`, and `typescript_check` are struck: none of them could do anything that `bash`
cannot do as well (`typescript_check` was just `pnpm exec tsc --noEmit` in the working directory), and the
only reason to keep such tools separate would be a permission level below Bash,
which does not exist in the sandbox. What remains is `read` (line numbers, truncation), `edit` (unambiguous
match, diagnostics attachment), `write` (diagnostics attachment), and `bash`. The language server tools
(`<server>_open`, `<server>_diagnostics`) remain; they deliver diagnostics without a build. The
name mapping in `workspace-tool-naming.ts` only knows these four; `scriptTool` and
`WorkspaceOperation` had no callers and are gone.

## The TypeScript language server publishes only changed diagnostics (02.09.2026)

An `edit` to an error-free TypeScript file hung for 60 s: after `didChange`, the annotator waits
for `publishDiagnostics` for the new version, but typescript-language-server (6.0,
`FileDiagnostics.update`) sends nothing if the diagnostics per kind were empty before and stay
empty. After `didClose`, by contrast, it always publishes and discards the entry; a subsequent
`didOpen` is guaranteed to deliver fresh diagnostics. For this, the session knows the launch property
`publishesOnlyChangedDiagnostics` (only the TypeScript adapter sets it): if the last
published diagnostics of the file are empty and the text has changed, it closes the document, waits for
the confirmation, and reopens it instead of sending `didChange`. Roslyn uses pull diagnostics and is
not affected. The live test `TypeScript reports errors ...` checks the error-free to
error-free case with a time limit (`RAGENTS_LSP_TESTS=1`).

## Git is free in the sandbox (02.09.2026)

What Git and Bash can do anyway is no longer a tool. The Bash sandbox had a parser that
blocked push/fetch/pull/merge/rebase and switching to foreign branches, plus a Git policy registry on
which exactly one plugin depended. Both are removed: `git` runs without restriction in the
session working directory; the write token comes as `http.<Git URL>.extraheader` via
`gitHttpConfigPairs()` into the Git environment of Bash (`SessionWorkspace.gitConfig`) and into the
route Git environment (`gitSession`); the header is bound to the origin URL so that `git` does
not send it to foreign hosts. Push is thus an ordinary `git push`, not a capability, and
nothing is registered twice.

- A domain plugin that ran a sync has been boiled down: its own tools, operations,
  state file, log file, and a mini-app template are gone. What remains is the skill
  (everything via `git`/`bash`, full build as Bash steps), the starter, and the tab. The tab
  reads the branch state directly from Git of the session working directory (`GET .../branches`,
  `POST .../refresh` with fetch) and pushes per branch on the server via `git push`
  (`POST .../push`). There is only one Git identity left for fetch and push.
- A single retrieval as a tool is removed. The agent reads a single domain object via `curl`
  against the HTTP API. For this, the domain plugin passes origin, collection, and token to its prerequisite via
  `contributeSandboxEnv` into the Bash environment
  (`SessionWorkspace.extraEnv`). The operator client remains, because it feeds the tab view
  and is not a Bash replacement.
- The old branch lock of the changes view (`branchBasis` threw on every branch except
  `main`/`main-*`) is relaxed: the base is the merge base against `origin/main` for every
  checked-out branch; otherwise the distribution phase of a sync breaks the view.

## The source code of a run module is in the installed build (02.09.2026)

The tools tab shows the source code of a run tool and of a dialog mini-app. Shown
is exclusively the installed build, never the working state under `_apps/<appId>/`: the folder
may have been edited further after installation, and a view that mixes both
lies to the operator. Handler sources, `styles.css`, and `index.html` were already in the
module definition anyway; the installation stores `module.json` and `client.tsx` as a snapshot under
`host.storage.session(runId, "module-sources")/<app>/<compilationHash>/`, not in the journal:
otherwise the module state would share the 250 kB limit with the sources and travel into the web with every
run view query. If the snapshot is missing (app installed before this storage), that is a hard
error of the source code route; all other paths stay untouched.

## Validation errors are journal events (02.09.2026)

If the agent loop rejects a tool call before it runs (schema violation, unknown
name, blocked), until now only the model saw the error text: the driver remembered nothing for the
tools managed by RAgents, because they otherwise register themselves on actual execution.
The journal was therefore missing `tool.call.started` and `tool.call.failed` completely - a
subagent ran into eight validation errors in a row, and the operator saw only endless
thinking in the chat. Now the turn dispatcher remembers every managed call at `tool_execution_start`
with name and sent input, strikes it as soon as the tool is actually executed,
and, on an error completion without execution, writes the pair `tool.call.started` +
`tool.call.failed` with the full error text. The note applies only within one turn. Nothing changes for the
model; in the chat, the failed attempt appears like any other failed call.

## Input schemas for models are flat (02.09.2026)

`mini_app_test` and `show_document` offered the model a union at the root of their
input schema. Weaker models and several OpenRouter upstreams cannot cope with this:
on one upstream, `z-ai/glm-5.3-flash` sent `{}` as arguments eight times in a row; on
another, it sent the nested objects (`input`, `mockCapabilities`, `expect`) as
JSON strings 99 times; `deepseek-v4-pro` coped with the same schema. Rule: a model-facing
input schema is ONE flat `Type.Object`, the discriminator is a string enum, correlated
fields are `Type.Optional`, and the server checks the correlation directly after validation with
a named error that names both valid forms in one sentence (`targetActorId` belongs
exactly to `surfaceKind: "tool"`; `content` and `path` exclude each other). The rule is also
stated in the description of the correlated field, so that the model sees it in the schema. The
domain discriminating unions stay unchanged inside the server. Against regressions,
`profile-composition.test.ts` checks all tools of all profiles for `type: "object"` without `anyOf` or
`oneOf` at the root; there are no exceptions.

## Modal dialog as a placement plus two capabilities (02.09.2026)

The owner wanted a small dialog in the workshop and asked where the difference between
mini-app handlers and actor scripts lies. Decided:

- Besides `canvas`, the manifest placement gets the kind `dialog` with a mandatory `size`
  (`medium`, `large`, `wide`, no default value). An app with a dialog placement gets no
  tab of its own; it appears in the fixed tool list, and the host draws it with the
  `Dialog` building block above the workshop.
- `dialog_open` and `dialog_close` are registered TWICE in `ragents.mini-apps`: as an operation
  (`operator: "direct"`) and as an agent tool, with identical ID, input, and result. The
  same capability contract thus applies to the operator path and to agents, and an app action, a
  handler, a script actor, an agent, and the operator call the same two names.
- A run shows at most ONE dialog. Opening a different app a second time is a hard error that
  names the open app; opening the same app again only returns the state. The state
  (`ragents.run-modules.dialog`, `{kind:"closed"}` or `{kind:"open", appId, revision, openedBy}`)
  is journaled, survives the restart, and is closed when the app is removed or the run
  is stopped.
- Answer to the question: mini-app handlers and actor scripts share the same
  `runContextNamespace` - `context.state.read/replace` and `context.capabilities.call`. Only
  three things differ: `std` exists only in the script, a handler returns a result instead of a
  follow-up state, and on the operator path the capability supply comes from the registered
  operations instead of from the tools of the target agent.

## Profiles are roles, the spawn chooses the model (02.09.2026)

The owner's objection on looking at the profile list: pinning models to profiles is wrong. The
engine has long been able to do it differently: `agent_spawn` accepts `model` and `thinking` from the model list
in addition to the profile (`ExecutionRequest`); a profile only supplies driver, provider,
thinking level, timeout, and workspace default. There are therefore no longer any
`review-<model>` profiles and no separate model list per profile in a product plugin, but exactly three roles:
`coordinator`, a producer mandate (produce, read thoroughly), and `reviewer` (read mandate).
Which models are available is determined by `AGENT_MODELS` alone; the skill requires a
different model from this list per reviewer. Switching a model thus means changing a configuration list,
not rebuilding profiles.

## Starters with a guide, dialog and select menu as system building blocks (02.09.2026)

Owner's request: entry points are not only prompt cards but skills that a plugin brings as a
flow, and a small extension that gives guidance before the start may be attached to such a skill.
Decided:

- A STARTER (`host.starters`) names title, description, the skill (folder name), and optionally
  a GUIDE. It appears in the empty chat above the prompt cards; model and reasoning are
  already chosen there as before. Without a guide, the host sends a fixed task text
  (`starterMessage`); with a guide, it opens its component in the dialog, and the guide
  delivers the finished text of the first message.
- The guide is a web contribution (`guides`) of the plugin that knows the data; the starter may
  belong to another plugin (a flow plugin uses the guide of a domain plugin). The engine
  checks strictly at start that the skill exists; the web checks that the guide is active.
- `Dialog` and `SelectMenu` are host building blocks in `apps/web/src`, not registry slots. Native
  `<select>` elements are banned from the interface; selection runs via the listbox.
- A domain tab is controlled by the operator (queries, search, filter, detail page, handover to
  the chat); the agent's views from its operator clients remain as further sources.

## Illegal states are unrepresentable (02.09.2026)

Correlated optionals are a finding: what belongs together goes into a discriminated
union, not into independent nullable fields with runtime guards. Examples in the codebase:
ActorInput.lifecycle (pending/claimed/discarded), EventSubscription via status, Action via
kind, turn.finished via outcome, TurnRequest per driver kind, ModuleInvocation via status.
Validators (journal, TypeBox states) are exactly as strict as the domain types - a
validator that allows what the type forbids is a bug. Journals that have become invalid
fail loudly on load instead of silently lying (`.data` is disposable). Run modules are
exclusively platform 2: the legacy handler paths (callTool/state/remember) are removed;
handler and app contracts (resultSchema, capability hashes, styles/client) are required fields.
The only deliberate exception: subscription.removed.discardedInputIds stays optional, because old
removals with their own semantics (discard nothing, inputs stay startable) are tested and intended.

## The file browser is read-only (02.09.2026)

The "Files" tab (plugin ragents.workspace) shows the working directory and file storage of a run
as a tree with a text preview (syntax highlighting via the host component SourceCode) - deliberately WITHOUT
writing and deleting. Agents make changes via their tools; the browser is the operator's
window. It is kept live via one fs watcher per connection (SSE route browse/watch, debounced);
a 30-second poll remains only as a fallback.

## Mini-app clients are React (01.09.2026)

The client of a mini-app is called `src/client.tsx` and is a React interface instead of a
hand-written DOM script: models are picked up where they were trained. There is no longer a separate
DOM subset; the browser emit checks against TypeScript's real DOM lib and
against `@types/react`.

- `react` and `react-dom` are pinned to 18.3.1, because from React 19 on, UMD builds are no longer
  shipped. The host delivers the two production bundles from its own
  `node_modules` into the app frame; no CDN, no network connection, CSP and sandbox unchanged.
- `client.tsx` is a script file WITHOUT `import` and `export`. `React`, `ReactDOM`, `context`, and
  `useAppState` are globals that the platform loads before the client. An `export` turns the file
  into a module, and the UMD access to `React` becomes a named compiler error.
- `useAppState()` is the only bridge from the app state into the interface: a prelude binds
  `context.state.subscribe`/`read` via `React.useSyncExternalStore` to a stable snapshot.
  Actions still run via `context.capabilities.call`.
- Handlers stay deterministic TypeScript without React; React concerns only the
  presentation layer in the frame.

## One prompt card, one goal, two versions (01.09.2026)

Every prompt card carries ONE goal in TWO equally selectable versions: the TECHNICAL one
describes approach, tools, and order as before; the FREE one describes the same wish in one to three
sentences without tool names, without approach, and without runtime terms. The value lies in the second:

- The free version is the SELF-EXPLANATION TEST of the platform. It answers the only question
  that a technical card never asks: are prompts, tool index, and teaching errors enough for
  a model to find the way on its own? If it fails, that is a finding about the platform and not
  about the card - the technical version next to it immediately shows which step was missing.
- The technical version remains the reliable reference case for the self-test rounds.
- The card format is strict: one file per card, frontmatter unchanged, in the body the
  mandatory sections `## technical` and `## free` in exactly this order. If a version is missing,
  duplicated, swapped, or empty, that is a hard parser error; a single
  `prompt` field exists neither in the file nor in the contribution nor on the wire.

## Mediators are a library instead of a template (01.09.2026)

A mediator is not prescribed as example source code that every model copies anew, but
offered as ONE typed implementation in the engine: `std.mediators.route(config)` is the
only mediator function, and the script author only writes configuration. The basic form is the
routing table from a sender's actor ID to its targets - circle and star are two
tables, not two functions. The keys of the table are ALL known IDs; exactly the keys with
targets are subscribed. A silent listener is a key with the value `null`: it is
not subscribed and never routes, but may be a target. Instead of a list, targets may also be a FUNCTION:
it receives the taken-over contribution and returns targets, `null`, or the empty list - this
makes filters and content-dependent routing the same thing as a fixed row. Static targets and
`start.to` are checked strictly by the library at BUILD time against the keys, and the error names the known
IDs and the null form; return values of the target functions are checked by the runtime. Why:

- Behavior evolves with the platform. If the library improves, the
  improvement applies to all mediators; a template becomes outdated in every copy individually.
- Replay stays unaffected: state still comes exclusively from events, the library keeps
  its log via the same `context.state` port and calls via the same capability port. Permissions
  are exactly those of the actor - a factory grants no access.
- The "template" extension point stays open only for mini-apps. Recurring ACTOR logic belongs
  in the library, not in a prompt building block.
- For this, the interpreter now carries the general bridge between native and script code:
  a native std function accepts script closures, a function returned by std counts
  as a handler value, and execution limits count in the turn of the call instead of the turn of the build.
- Computed object keys (`{ [id]: ... }`) are permitted in the script policy: the key
  is evaluated and must be a non-empty text. Defining an actor ID once as a `const`
  and referencing it is more type-safe than typing the same literal twice.

## The actor detail view shows both sides (01.09.2026)

The RunView carries `outputs: [{ text, sequence, occurredAt }]` per turn from `model.output.completed`,
unabridged (measured: a 51-turn run brings ~13 KB of response text with 143 KB of total view - there is
therefore deliberately no capping limit). The detail view of any actor is thus
a real conversation: delivered inputs and its own answers in one stream, sorted via
the journal `sequence`. Reasoning is not part of it; the chat projection of the primary actor
stays untouched, it already had both sides.

## Tool index instead of all schemas (01.09.2026)

Not every tool schema is always in the context. Every tool contribution declares its
visibility itself (`visibility: "inline" | "indexed"`); indexed tools appear only as
one-liners in the built-in `tool_open`, which on request delivers the schema AND the
prompt chapters bound to it and unlocks the tool from the next model call on. Decided:

- Visibility is NOT permissions: resolution, capability, and grant checks are unchanged; an
  agent can only open what it would have anyway. Plain LLMs (`tools: []`) and scripts are
  exempt.
- Unlocking is the journal event `actor.tools.opened` and thus survives replay.
- Prompt chapters bind to tools via `requiresTools` and appear only with them;
  when opened via the index, the chapter is added from the following turn on (fifth fork intervention,
  see below). The productive surface stays inline (file tools, orchestration,
  installed run modules); the heavy build and special families are indexed.
- Measured on the coordinator's first turn in `core`: 64,631 -> 28,343 characters (56 percent less).

## Offered typed, checked compiled (01.09.2026)

Two principles of the owner for everything a model is supposed to build or call:

1. Everything offered to models is TYPED, and the API is in the prompts. A model
   that writes a script knows the complete TypeScript API - handler signature, `context`,
   every delegated capability with input AND result type - without having to guess.
2. What models build is ALWAYS compiled and type-checked. The compiler catches what would otherwise
   blow up at runtime.

What this enforces concretely:

- The script declarations are GENERATED, not written:
  `packages/ragents/src/typescript/script-declarations.ts` builds `Handler`, `ScriptInput`,
  `ScriptEvent`, and the capability map from the schemas of the respective contributors. The same text goes
  into the compiler and - via `PromptRenderContext.scriptApi` - verbatim into the plugin's prompt chapter.
  There is no longer a hand-maintained description of the API; `ScriptWord`/`ScriptGuidance`
  have been dropped without replacement.
- Prompts belong to the plugin. The engine delivers only the generated type text as a service; which
  chapter embeds it is decided by the plugin (here `ragents.orchestration/script.hbs`). No
  API prose in the core, no plugin knowledge in the engine.
- The typed capability view of a build arises from the tools that are resolved for THIS actor.
  A plugin that contributes a capability thus brings its types along itself;
  there is no central list into which something would have to be added.
- Delivery is typed instead of raw: a subscription match arrives as `input.event`, not as a
  JSON lump in `input.content`. The wire value in the journal stays unaffected by this.
- A tool contract never requires a model to retype source code, hashes, or proofs.
  All three build families follow ONE pattern: `script_actor_check`, `script_tool_check`, and
  `mini_app_check` store the checked state under a short reference (`build-1`); test and
  installation name only that plus the bare essentials (target agent, surface). The mechanism behind it is
  the product-neutral `BuildStore` in `packages/ragents/src/agents/build-store.ts`; each family
  only gives it identity, drift hashes, and its tool names. Before test and installation,
  the server builds again and rejects a diverged build by name - in build reference and plain text,
  without hex.
- The models' currency is the build reference; hashes are pure server bookkeeping. Journal,
  BuildStore, attestations, and the `module` definitions in the plugin state carry them in full,
  but no tool result, no error message, and no card shows a model a
  64-digit hex value anymore.
- A tool result never repeats what the model wrote itself - it delivers only the
  newly created identifiers and facts. The one redaction point for this is `toolResultEventOf` in
  `packages/ragents/src/agents/actor-input.ts`: on the way to the model, it recursively strikes from every
  event payload the hash keys and the verbatim input echoes (`prompt`, `source`,
  `execution`, `content`, `state`). `TurnToolset.eventsFor` and `enqueueActorInput` are its
  only callers; journal, `event_query`, and the RunView for the web stay complete.
- Tests check the REAL format. `script_actor_test` constructs subscription inputs on the server
  via the same delivery path as the runtime; the caller names only `eventType`, `sourceActorId`,
  and `text`. A test whose input the author invents themselves only confirms their assumption.
- Rejections name valid names. Capability names occur in TWO forms, and that stays so:
  dotted (`actor.input`) are the GRANTS - they are wire values in the journal and therefore
  cannot be renamed -, with an underscore (`actor_input`) are the CALL names of the tools that
  `capabilities.call` and a build's `capabilities` list expect. Every rejection names the call names
  valid in the build and adds that the dotted form is a grant.

## Plugins live at the repo root level, a plugin is a folder (01.09.2026)

`plugins/<plugin-id>/` lives at the root level of the repo, no longer in `apps/`. A plugin is
thus REALLY a folder: `server/index.ts` and, if present, `web/index.tsx` belong
together, plus a shared, import-free `contract.ts` (only `ragents.todo` has one) and all
assets at the plugin root level (`prompt.hbs`, `prompts/`, `prompt-cards/`, `skills/`, `install.sh`,
`preview-config/`). The folder form prepares for dropping in a plugin from outside as a folder;
loading at runtime, download, and registry stay explicitly excluded (see the
section below).

What the move entails and deliberately stays that way:

- `apps/server/src/plugin-support/` and the wire contracts `chat-events.ts` as well as
  `plugin-support/chat-display-contract.ts` stay in the server: host building blocks, not
  plugin property. Both halves import them relatively.
- The root comes from ONE source (`plugin-support/plugins-root.ts`, relative to
  `import.meta.url`), not from `process.cwd()`.
- The typecheck stays separate: `apps/server/tsconfig.json` sees `plugins/*/server` and
  `plugins/*/contract.ts`, `apps/web/tsconfig.json` sees `plugins/*/web` and the same
  `contract.ts` - no mixing, otherwise the server run fails on the JSX.
- Because `plugins/` lies next to `apps/`, Node no longer resolves dependencies of `apps/server` or
  `apps/web` there. The repository root therefore declares what plugin code is built against
  (`@aicontainer/agent`, `@aicontainer/ragents`, `react`, `typebox`, `typescript-language-server`,
  and the rest). Individual plugins nevertheless remain NOT npm packages: there is no
  `package.json` per plugin.
- For the same reason, ESLint moves to the root (`eslint.config.js`, `pnpm lint` in the root): only
  from there are `apps/web/src` and `plugins/*/web` reachable in ONE run.

## No migrations, no compatibility with old paths (01.09.2026)

We are in the development phase: there is no migration extension point and no
compatibility paths. The plugin storage is pure convention and no longer declarable -
global `plugins/<plugin-id>`, per conversation `sessions/<runId>/plugins/<plugin-id>`. If a
plugin needs subfolders, it takes the segment parameters of `root()`/`session()`. Existing
`.data` contents are disposable development data: anyone with old data deletes `.data` or moves it
by hand; the server no longer moves anything itself.

## No vendor construct anymore (01.09.2026)

`vendor/` is dissolved. The chat code is regular own code: the wire contract of the ChatEvents
lies as an import-free file in `apps/server/src/chat-events.ts` (the server is the authority,
the web imports it relatively), the HTTP/SSE adapter including the session contract in
`apps/server/src/chat-handler.ts`, the React building blocks with their CSS in `apps/web/src/chat/`,
and the design tokens next to them in `apps/web/src/`. A flow back into the standalone quassel repo
(~/repos/github/quassel) is NO longer planned; that repo stays untouched, the earlier
vendor states are in the Git history.

## Own behavior in the agent runtime (01.09.2026)

The agent runtime is forked third-party code (upstream was `@earendil-works/pi-*`, tag v0.80.10;
the scope `@ragents/*` is ours, until 23.09.2026 `@aicontainer/*`) in TWO packages: `ai` is
the LLM connection (only the openrouter provider, since 13.09.2026 via AI SDK Core), `agent` is
the agent loop (`src/loop/`, until 24.09.2026 the package `agent-core`), session, and tools.
The fourth package `tui` (terminal UI) is removed - a web product has no terminal interface.
These own interventions shape the behavior; the list is updated with every intervention.
Provenance and deviation documents have deliberately been dropped - what counts is here. In parentheses
is where an intervention is checked.

- Steering is a source, not a queue: `Agent.steeringSource` is queried before the first
  model request and after every response together with its tool results; what it delivers
  goes before the next request, even after a final answer; a rejection ends the run with
  its error. `steer`, `followUp`, the queues including `QueueMode`, `queue_update`,
  `streamingBehavior`, and letting tools continue running in the background are removed; a
  tool call runs until its result, and steering waits for it (entry of 24.09.2026 on
  steering, `packages/agent/tests/steering.test.ts`, via the engine in
  `packages/ragents/tests/steering.test.ts`).
- The system prompt of a long-lived agent is no longer immutable:
  `AgentSession.setSystemPrompt` (plus `ResourceLoader.setSystemPrompt`) sets it anew and keeps
  the conversation - necessary so that tool-bound prompt chapters are added after a `tool_open` from the
  following turn on (via the engine in `packages/ragents/tests/agent-runtime.test.ts`).
- With an ambiguous `oldText`, the edit tool names the matches with line numbers instead of just
  failing. Optional anchors: `occurrence` (n-th occurrence), `nearLine` (nearest one,
  a tie is an error), `replaceAll` (cannot be combined with an anchor).
- An edit overwrites nothing that was created after the last read: the read tool
  delivers a SHA-256 of the file content, the edit tool checks it as `expectedHash`
  within the file mutation lock and returns the new hash (both in
  `packages/agent/tests/edit-contract.test.ts`).
- A custom system prompt (`customPrompt`) stays as the caller gives it: `buildSystemPrompt`
  does not append a line `Current working directory: ...` to it; only the upstream's default prompt
  names the folder. RAgents always gives a custom system prompt, and there the working directory is named
  only by the description of the workspace (`packages/agent/tests/system-prompt.test.ts`,
  entry of 24.09.2026 on stop, handles, and tool calls). This one intervention replaces the
  earlier options `omitCwd` and `workingDirectory`; `cwd` is again only the runtime's folder.
- A response without text and without a tool call does not end the loop immediately: it nudges
  once with `EMPTY_RESPONSE_NUDGE`; a second empty response ends as an error
  (`packages/agent/src/loop/agent-loop.ts`, `packages/agent/tests/empty-response.test.ts`).
- The caller formulates the message for an unknown tool itself
  (`formatUnknownToolError` in `packages/agent/src/loop/types.ts`); the engine refers there to
  `typescript_api` and `context.functions`. The path is checked by `packages/ragents/tests/tool-validation.test.ts`,
  the wording itself by no test.
- The two `package.json` files load the TS sources at runtime (`main`/`import` on `src/*.ts`);
  the typecheck sees the generated `dist/*.d.ts` (`types`).
- Thinking level `off` explicitly sends `reasoning: { enabled: false }` to openrouter instead of
  nothing at all - otherwise the model default applies and the model thinks anyway
  (`packages/ai/src/api/ai-sdk.ts`, `packages/ai/tests/openrouter-streaming.test.ts`).
- The tool validation message NO longer repeats the received arguments (they are already
  in the tool call before it); it names only the field errors and asks for a correction, for
  enum errors including the received value and the allowed values, a path only once
  (`packages/ai/src/utils/validation.ts`, `packages/ai/tests/validation.test.ts`,
  `packages/ragents/tests/schema-errors.test.ts`).
- The runtime searches, loads, and installs nothing: an extension is only an inline factory;
  package management, extensions from files, prompt templates, and project files like `AGENTS.md`
  or `SYSTEM.md` do not exist. Structurally excluded, hence without a test of its own (entry of
  24.09.2026 on merging in the agent runtime).
- The extension API has exactly three events, `before_agent_start`, `context` before every
  model call, and `tool_result`, plus `registerTool`, `getAllTools`, `setActiveTools`, and
  `appendEntry`; a handler's context carries `signal`, `model`, and `sessionManager`. After the
  session has ended, every access by an extension throws (via the engine in
  `packages/ragents/tests/agent-runtime.test.ts`).
- Settings are a value, not a file: `AgentSettingsInput` with compaction, retry, and
  request time limits, otherwise fixed defaults; nothing is written back. Access comes only as an
  API key from a provider's registration, taken literally, or, for the built-in
  provider, from `OPENROUTER_API_KEY`; `auth.json`, `models.json`, `!command` and `$VARIABLE` values,
  OAuth, and sign-in do not exist. An invalid registration throws
  (`apps/server/tests/overseer-reset.test.ts` registers via the profile).
- The runtime does not read skills itself: the host checks every SKILL.md and passes on name,
  description, path, and `disable-model-invocation`; from this, the runtime only formats the
  catalog lines of the system prompt.
- A session without a model is an error; there is no model search from settings or
  default providers.

The vendored test suites were 60 percent red and ran in no `check`; they have been removed together with
Vitest, and the repo tests everywhere with `node --test`. The old tool suite (84 green
tests) is in the history under `vendor/pi/coding-agent/test/tools.test.ts` (bef8c23) and is
the template when the coverage of the tools is set up anew.

## A profile is a file, not a package (01.09.2026)

`ragents.config.<profile>.ts` names the product (`PRODUCT_ID`, `PRODUCT_TITLE`), the plugin list
(`PLUGINS`), and the configuration of all participating plugins. There is no preset and no
default anymore: if the value or the file is missing, the server does not start.

The earlier product profile package has been dropped without replacement. The owner's objection: profiles are
built FROM packages, they are not collected IN a package. In addition, it held a third,
hand-maintained copy of the plugin list - server and web know their plugins anyway, because they search their
folders. Since then, the web no longer checks the server's response against a list of its own;
the server is the authority.

## Plugins are probed, not wired in at compile time (31.08.2026)

Requirement: no static imports; plugins are really found dynamically at runtime, by
probing, like packages in Visual Studio Code.
This lifts the earlier limit "the plugin catalog is built in". Decided:

- One plugin = ONE folder under `plugins/`. The folder name is the identifier, `server/index.ts`
  exports `plugin: PluginModule = { requires?, create(host) }`, and it is loaded via
  `await import()`. The same in the web via `import.meta.glob` on `plugins/*/web/index.{ts,tsx}`,
  one chunk of its own per folder.
- Every plugin is self-contained: what it needs, it gets from the `PluginHost`. Special wiring
  in the composition code is the error, not the solution - if something is missing, a general
  host service is added.
- The same applies to everything else around a plugin: its assets (`skills/`, `prompt-cards/`,
  `prompts/`) and its installation (`install.sh`) lie at its folder root level, next to
  `server/` and `web/`, and are found, not enumerated.
- What lies in the repository is probed. Loading a plugin from a foreign source is deliberately
  NOT intended (no download, no registry, no signatures).

## The agent runtime is our package, no longer "Pi" (31.08.2026)

The vendored coding agent is forked and is now called `@aicontainer/agent` (plus
`@aicontainer/agent-core`, `@aicontainer/ai`) under `packages/`. The name
"Pi" no longer appears anywhere: identifiers, env keys (`AGENT_MODEL`, ...),
the driver value `"agent"`, the configuration directory `.agent`, and the wire values
`agent-builtin`/`agent-extension`. A rebase onto the upstream project has been given up with the fork;
the own interventions are listed as behavior in the section above.

IMPORTANT for fresh clones: `dist/` of these three packages is gitignored but delivers the
type declarations. `pnpm build:agent` builds them; `pnpm check` does it by itself.

## Graph view without an iframe, mini-apps never on actor cards (31.08.2026)

The flow view lives as a native React view in the host document; the earlier iframe boundary of the
embedded view has been deliberately removed. Camera, cards, edges, and inputs thus lie in
ONE document, and geometry crosses no `postMessage` boundary. Decided:

- Exactly ONE host camera. The first automatic fit happens once; after that the
  interface never moves the camera by itself.
- Actor cards are pure display: a card contribution (`cardSections`) never changes the identity,
  capabilities, or tool selection of an actor.
- A mini-app is NOT embedded on an actor card. The only additional
  placement kind is `canvas` with `anchorActorId`, `width`, and `height`; target IDs on agents
  belong only to tools and actions.
- Deliberate limits of the graph view: no dark mode, no `displayName` on the compact cards
  (the `@handle` suffices), and canvas elements of run modules are surfaces, not actors.

## Diagnostics via language servers instead of a build per turn (28.08.2026)

Coding agents do not build after every step: warm language servers deliver the errors of the
changed file, and the full `dotnet build` is the conclusion. Decided:

- THREE plugins (`ragents.lsp-roslyn`, `ragents.lsp-fsharp`, `ragents.lsp-typescript`), no
  collective plugin; the client is shared in `plugin-support/language-server/`.
- The agent requests the servers via `<id>_open`; nothing starts by itself. Which root applies
  (a solution, a source folder) is product knowledge in the prompt and in the skill of a
  domain plugin; the plugins stay neutral.
- The diagnostics are attached automatically to the `edit`/`write` result (slot in the sandbox host), errors
  always, warnings only counted.
- Servers are runtime resources like the agent session, not journal state.
- Each of the three plugins carries its own diagnostics tab in the right panel (`workspaceTabs`,
  shared web component, snapshot route without a tool and without a journal). The tab shows what
  the host knows: diagnostics appear only after `<id>_diagnostics` or an edit/write.
- Every plugin installs its own dependencies: `install.sh` in the plugin folder,
  collected by `scripts/install-plugin-dependencies.sh`, which knows no plugin by name
  (image and local identical). `ragents.lsp-typescript` brings none - the
  typescript-language-server is an npm dependency of the repository root.

## Security is currently secondary (27.08.2026)

Security, sandbox hardening, and conceptual permissions (capabilities, grants, delegation)
are CURRENTLY NOT an investment goal. No attack test suites, no permission differentiation,
no sandbox extensions, as long as the product does not demand them. The hard boundaries
remain the existing ones: file permissions and session UID in the container. Existing mechanisms without
a supporting purpose are dropped when boiling down (the Git lock and the Git policy of Bash are
removed, see the topmost entry); no targeted extension takes place.

## Course: merge in instead of expanding (27.08.2026)

The system has too many indirections and features. Guidelines:

- Removals are ALWAYS carried through to completion, no leftover old paths.
- NO redundancies: the same logic exists exactly once.
- Generalizations only when there are at least two real users.
- The mini-app/TypeScript platform vision STANDS; missing reference cases are due to the
  development state, not a reason for removal. But: do not expand further until the
  first real domain case runs on it.
