# Operations

Installation, startup, access, the npm package, distributed work with server, workstation, and run
transfer, Windows, and data storage. What a user sees and does is in `docs/usage.md`, build,
checks, and publishing in `docs/development.md`, the structure of the system in `docs/spec/`, and
the why in `docs/decisions.md`.

<!-- guide:getting-started -->
## Install a standalone release

[GitHub Releases](https://github.com/SchlenkR/RAgents/releases) provides standalone archives for
Windows, macOS, and Linux, each for x64 and ARM64. They include Node.js, npm, the host's installed
dependencies, the finished web interface, plugins, and platform tools. No existing Node.js, npm,
pnpm, or source checkout is needed. Linux builds target glibc systems, not Alpine/musl.

### Install for you or for all users

An installer script installs the archive for this machine. You choose the scope: the current user
(the default) or all users of the machine.

| Scope        | macOS and Linux                                | Windows                                                   |
| ------------ | ---------------------------------------------- | --------------------------------------------------------- |
| Current user | `~/.local`, no administrator access            | `%LOCALAPPDATA%\Programs\RAgents`, user `PATH`            |
| All users    | `/usr/local`, sudo only if it is not writable  | `%ProgramFiles%\RAgents`, machine `PATH`, administrator   |

The versions go to `lib/ragents` (Windows: `versions`) below that folder, the command to `bin`.
On macOS or Linux, for the current user:

```sh
curl -fsSL https://github.com/SchlenkR/RAgents/releases/latest/download/install.sh | sh
```

For all users:

```sh
curl -fsSL https://github.com/SchlenkR/RAgents/releases/latest/download/install.sh | sh -s -- --global
```

The shell installer does not edit your startup files. `~/.local/bin` is often not on the `PATH`,
on macOS by default; the installer then prints the line to add for your shell, for zsh this line
in `~/.zshrc`:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

Open a new terminal afterwards, or run the command by its full path. `/usr/local/bin` is on the
default `PATH` of macOS and common Linux distributions.

On Windows, in PowerShell, for the current user:

```powershell
& ([scriptblock]::Create((irm https://github.com/SchlenkR/RAgents/releases/latest/download/install.ps1)))
```

For all users, in a PowerShell started with "Run as administrator":

```powershell
& ([scriptblock]::Create((irm https://github.com/SchlenkR/RAgents/releases/latest/download/install.ps1))) -Global
```

The Windows installer adds its `bin` folder to the user or machine `PATH`; open a new terminal
afterwards. Without an elevated PowerShell, `-Global` stops with a message instead of installing
for the current user. Use this script block form rather than `irm ... | iex`: only it passes
parameters to the script.

Further options follow `sh -s --` in the shell and the closing parenthesis in PowerShell:

- `--version 0.1.21` or `-Version 0.1.21` installs that release instead of the latest.
- `--prefix /absolute/folder` or `-Prefix C:\Apps\RAgents` installs into another folder. The scope
  still decides about administrator access and, on Windows, which `PATH` changes.
- `-NoPathUpdate` leaves the Windows `PATH` unchanged.
- `--help` or `-Help` lists all options.

Both installers verify the archive against the release's `SHA256SUMS`, check that the command
starts, and prepare the installation completely before they switch the active version, so a
running host never writes into the installation folder. They refuse to replace a `ragents` command
they did not create, for example one from npm. If another `ragents` command comes first on your
`PATH`, or the other scope still holds an installation, the installer warns and prints the command
that removes it; it never removes another installation itself. `ragents --version` shows the
active version.

Alternatively, unpack the matching archive yourself and run `bin/ragents` or `bin/ragents.cmd`
from it. Its first command then writes links into that folder, so the folder must be writable.

### Update and uninstall

Run the install command of your scope again to update. The new release is installed next to the
previous ones, which remain installed; the command switches only after the new version has
passed its checks. To switch back, pass the older version with `--version` or `-Version`. Stop
running hosts before switching versions and restart them afterwards.

To uninstall, add `--uninstall` or `-Uninstall` to the command of your scope, for example:

```sh
curl -fsSL https://github.com/SchlenkR/RAgents/releases/latest/download/install.sh | sh -s -- --uninstall
```

```powershell
& ([scriptblock]::Create((irm https://github.com/SchlenkR/RAgents/releases/latest/download/install.ps1))) -Uninstall
```

This removes the command and every installed version, on Windows also the `PATH` entry. A `PATH`
line you added to a startup file stays. Settings and runs stay in each user's data directory,
`~/.local/share/ragents` or `%LOCALAPPDATA%\ragents`; delete it to remove them as well.

### First start

The included profiles read the OpenRouter key from the environment variable `OPENROUTER_API_KEY`;
no `.env` file is loaded. Set it in the shell that starts RAgents or in its startup file, then
start the `core` profile:

```sh
export OPENROUTER_API_KEY=<your-key>
ragents start core
```

In PowerShell, set it with `$env:OPENROUTER_API_KEY = "<your-key>"`. The start provisions the
profile's tools into the user's data directory, for example `~/.local/share/ragents/core`, and
then serves the interface at `http://localhost:4710`. Without the variable, it stops before the
server starts:

```text
.../ragents.config.core.ts: ragents.product.OPENROUTER_API_KEY refers with env("OPENROUTER_API_KEY") to an environment variable that is not set in this shell. ...
Provisioning ended with code 1
```

The C# and F# diagnostics of `core` (`ragents.lsp-roslyn` and `ragents.lsp-fsharp`) need the
.NET 10 SDK with `dotnet` on the `PATH`. Without it, the start stops after provisioning:

```text
ragents.lsp-fsharp: missing: dotnet is missing on this machine; install the .NET SDK from https://dotnet.microsoft.com/download and make sure dotnet is on the PATH
ragents.lsp-roslyn: missing: dotnet is missing on this machine; install the .NET SDK from https://dotnet.microsoft.com/download and make sure dotnet is on the PATH
Provisioning ended with code 1
```

Install the SDK and start again, or start an own profile without these two plugins, see
[Custom profiles and plugins](homepage/guide-distributed.html#custom-profiles-and-plugins). The
archive includes no model credentials, Chromium, language servers, or development SDKs.
Provisioning fetches Chromium and the language servers; on Linux it installs Chromium's system
libraries with sudo. These requirements are the same for the npm package. `ragents --help` lists
the other commands, and [Configure model access and start](#configure-model-access-and-start)
describes the model settings.

The process sandbox has platform prerequisites too: Linux needs `bubblewrap`, `socat`, and
working user namespaces; the standalone starter exposes its bundled ripgrep automatically.
On Windows, explicitly set `PROCESS_SANDBOX: "off"` in the profile's `ragents.workspace` section.
See [Server process sandbox](https://github.com/SchlenkR/RAgents/blob/main/docs/operations.md#server-process-sandbox)
for setup and configuration.

## Install from npm

With Node.js 22.19 or newer, install the command globally:

```sh
npm install -g @schlenkr/ragents
ragents start core
```

Or run it through npx without a global installation:

```sh
npx --yes @schlenkr/ragents start core
```

The first start is the same as for a standalone release, see [First start](#first-start):
`OPENROUTER_API_KEY` must be set, and the C# and F# diagnostics of `core` need the .NET 10 SDK.
Then open `http://localhost:4710`. Other subcommands work the same way, for example
`npx --yes @schlenkr/ragents connect <server-url>`.

## Install from the repository

The application is built from the repository with Node.js and pnpm. Run these commands from
the repository root:

```sh
pnpm install
pnpm build:agent
pnpm provision core
```

The second command generates type declarations for the agent runtime and is required after a
fresh clone. The third downloads the tools required by the profile's plugins, such as language
servers and the browser, to `<data-directory>/tools/<plugin-id>/`. For each plugin it reports
`ready`, `installed`, or `missing: <reason>`; a missing prerequisite explains what must be done
manually, such as installing `dotnet`. Running it again downloads nothing unnecessarily. The
`core` profile contains the neutral workspace with chat, agents, TypeScript functions, and
mini-apps. Its settings are in `ragents.config.core.ts`. A profile selects plugins, models, and
configuration; it is not a single agent task. `showcase` (`ragents.config.showcase.ts`) is the
same profile plus the included examples. `pnpm provision showcase` installs its tools in its
own data directory.

## Configure model access and start

The model integration uses OpenRouter. In the profile file's `ragents.product` section,
configure `OPENROUTER_API_KEY` as a reference to your own environment variable, for example
`env("RAGENTS_MODEL_API_KEY")`, and provide its value in your shell or service environment. The
included `core`, `showcase`, and `developer` profiles use `env("OPENROUTER_API_KEY")` and expect
that exact environment variable. Startup fails if it is missing. Existing environment variables
take precedence over profile values; no `.env` file is loaded. Startup reports a missing
referenced variable as an error. Configured models and reasoning levels must be valid in the
available model catalog.

A profile can also name its models by alias: `MODEL_ALIASES` in the `host` section lists objects
with `alias`, `model` as `provider/model`, an optional default `thinking` level, optional
`thinkingLevels` that map the levels the alias offers onto levels of its model (for example
`{ off: "low", low: "low", medium: "high" }` for a model that always reasons and has no `medium`),
and the model's `compaction` values: the context size in tokens at which an agent compacts
(`threshold`), how much recent context stays verbatim (`keepRecentTokens`), and the summary budget
(`summaryTokens`).
`AGENT_PROVIDER: "alias"` makes the product use them. The interface, the chat, and the journal then
show only the alias names.

An alias can also point to a self-hosted OpenAI-compatible server. `MODEL_PROVIDERS` in the `host`
section lists such servers with `id`, `baseUrl` (up to `/v1`), `apiKey: env("...")`, optional
`compat`, and their `models` (`id`, `contextWindow`, `maxTokens`, `reasoning`, `input`, optional
`thinkingLevelMap`); an alias then names `<id>/<model>`. For a Qwen chat template, as served by
oMLX, set `compat: { thinkingFormat: "qwen-chat-template" }`, so the alias's thinking levels reach
the server. Details and an example in `docs/spec/profiles.md`.

Alternatively, a profile can obtain its models from another RAgents server running the
`ragents.model-relay` plugin, which offers that server's `MODEL_ALIASES` with their thinking levels
and compaction values: set `AGENT_PROVIDER: "relay"`, point `RELAY_URL` to that server, use
`RELAY_TOKEN: env("...")` with a user's personal token there, and use relay aliases for every model
key. Only the relay server can see which model is behind an alias. Its log at
`plugins/ragents.model-relay/relay.log` records the user, alias, target, and token count for each
request.

Then start the neutral profile:

```sh
scripts/start.sh core
```

The script builds the plugins, builds the web application and help if they are missing or
outdated, then starts the server. The interface is
available at `http://localhost:4710`; runtime data is stored in
`~/.local/share/ragents/core`. `PORT` and `DATA_DIR` can override these defaults.
`scripts/start.sh showcase` starts the same profile with examples on port 4713 and stores data
in `~/.local/share/ragents/showcase`; both can run side by side. Without a user list, sign-in is
disabled. [Users and permissions](homepage/guide-access.html) explains how to configure access.
Additional language servers must be installed separately for their diagnostic functions; the
first chat message does not start them.

The fixed server port is configured as `host.PORT` in the profile file. If it is occupied,
startup fails. The address stays fixed and a running instance is not terminated. An explicitly
set `PORT` must be between 1 and 65535; 0 is invalid. The final server message displays the URL.
A warning about JavaScript bundle size does not prevent startup.

## Connect MCP servers

The neutral profiles include `ragents.mcp` with an empty `MCP_SERVERS` map. In your profile,
paste the entries of an `mcpServers` map into the plugin section:

```ts
"ragents.mcp": {
  MCP_SERVERS: {
    files: { command: "npx", args: ["-y", "@modelcontextprotocol/server-filesystem", "."] },
    docs: {
      url: "https://mcp.example.com/mcp",
      headers: { Authorization: env("DOCS_MCP_AUTHORIZATION") },
    },
    legacy: { type: "sse", url: "http://localhost:8931/sse" },
  },
},
```

Server names use letters, digits, `_`, and `-`. A local server takes `command`, optional
`args`, `env`, and `cwd`; `cwd` is relative to the run's workspace and must stay below it.
A remote server takes `url` and optional `headers`. Without `type`, commands use stdio and
URLs try Streamable HTTP with compatibility fallback to legacy HTTP+SSE. Set `type: "http"`
or `type: "sse"` to require one remote transport. Unknown fields or incompatible definitions
stop profile startup. An empty or missing map adds no MCP tools.

Use `env("NAME")` for secrets, also inside `env` and `headers`; the loader resolves nested
references and rejects missing variables and plain-text secret keys. Non-secret environment
values and headers may be literal strings. Remote authentication currently uses static
headers. Profiles remain the configuration source; project `.mcp.json` files are not read.

Restart after editing the profile. Connections open when agents first resolve their tools,
on the machine that holds the run's workspace. Commands and packages must be installed there;
`localhost` URLs also reach that machine. Stdio servers follow its process sandbox and receive
its safe process environment plus the configured `env`. Workstations must have the matching
executor contribution from the same plugin build. The run's "MCP servers" tab shows connection
state and errors; agents receive the same causes and the connected servers' instructions.
Stopping or deleting the run closes its connections and local processes.

## Configure external ACP agents

The neutral profiles include `ragents.acp` with an empty `ACP_AGENTS` map. Configure the
adapters you want actors to use, with the same entry shape as an editor's `agent_servers` map.
For a sandboxed server run, provide credentials through nested `env("NAME")` references:

```ts
"ragents.acp": {
  ACP_AGENTS: {
    claude: {
      title: "Claude",
      command: "npx",
      args: ["-y", "@agentclientprotocol/claude-agent-acp"],
      env: { CLAUDE_CODE_OAUTH_TOKEN: env("CLAUDE_CODE_OAUTH_TOKEN") },
    },
    codex: {
      title: "Codex",
      command: "npx",
      args: ["-y", "@agentclientprotocol/codex-acp"],
      env: { CODEX_API_KEY: env("CODEX_API_KEY"), DEFAULT_AUTH_REQUEST: '{"methodId":"api-key"}' },
    },
    gemini: {
      title: "Gemini CLI",
      command: "gemini",
      args: ["--experimental-acp"],
      env: { GEMINI_API_KEY: env("GEMINI_API_KEY") },
    },
  },
},
```

Entries take `command`, optional `title`, `args`, and `env`. Use nested `env("NAME")` references
for credentials. Missing environment variables, invalid entries, and unknown runtime choices
are hard errors. Restart after editing the profile; `claude`, `codex`, and `gemini` above become
`acp.claude`, `acp.codex`, and `acp.gemini`. An empty map starts no adapters and adds no choices.

Install adapters yourself on every machine that will hold a run's workspace; sign in there for
workstation runs. RAgents does not install them or perform interactive sign-in. The npm adapters
can also run through the `npx` commands above; a global install provides these setup commands:

| Adapter | Install                                               | Sign in before use                    |
| ------- | ----------------------------------------------------- | ------------------------------------- |
| Claude  | `npm install -g @agentclientprotocol/claude-agent-acp`  | `claude-agent-acp --cli auth login`     |
| Codex   | `npm install -g @agentclientprotocol/codex-acp`         | `codex-acp cli login`                  |
| Gemini  | `npm install -g @google/gemini-cli`                     | `gemini`, then choose a sign-in method |

Claude accepts `CLAUDE_CODE_OAUTH_TOKEN` from `claude setup-token` (uses the Claude subscription),
or `ANTHROPIC_API_KEY` for API access. Codex accepts `CODEX_API_KEY` or `OPENAI_API_KEY`;
`DEFAULT_AUTH_REQUEST` above selects its non-interactive API-key method when authentication is
required. Gemini CLI accepts `GEMINI_API_KEY`. Set the chosen secret in the server's environment
and reference it in `ACP_AGENTS.<name>.env`; do not put its value in the profile. See the
[Claude adapter](https://github.com/agentclientprotocol/claude-agent-acp) and
[CLI authentication commands](https://code.claude.com/docs/en/cli-reference#cli-commands),
[Codex adapter CLI forwarding](https://github.com/agentclientprotocol/codex-acp/blob/main/src/index.ts), and
[Gemini authentication](https://geminicli.com/docs/get-started/authentication/) for their setup.
An adapter requiring an interactive authentication method fails with that method's cause;
provide non-interactive credentials for a server run or complete sign-in on the workstation.

Each actor starts its process on the run's workspace machine with that machine's safe process
environment plus its configured `env`. The run's process sandbox also applies to the adapter,
and file and terminal callbacks stay inside its workspace. On the server the sandbox gives the
adapter the run's own `HOME`, so it sees neither the sign-in nor the settings of the server
account. `CLAUDE_CODE_TMPDIR` points Claude Code to the run's writable temporary folder, including
when started from `bash`; Claude Code ignores `TMPDIR`. On a workstation the adapter uses the
developer's own sign-in; omit the server credential entries there when using that sign-in.
ACP actors require `workspace.use` and the shared run workspace; explicit `isolateWorkspace: true`
is rejected. Workstations need the
matching plugin bundle and executor version. Profile and run-scoped MCP servers are passed to
supported transports; unsupported HTTP/SSE transports produce an exclusion notice. A per-server `cwd`
is rejected because ACP cannot express it. The ACP client contract is in
[plugins.md](spec/plugins.md#external-acp-actors); actor creation is in
[Run external ACP actors](homepage/guide-clients.html#run-external-acp-actors).

## Build after changes

Server changes take effect after a restart. There is one web interface for every profile, built
with the host into `apps/web/dist`; plugin interfaces are loaded at runtime from the plugin bundles
of the running profile. `scripts/start.sh` rebuilds outdated plugins before every start and the web
interface only when it is missing or no longer matches its sources, so restarting is enough after
changes. `pnpm build:web` builds it directly. Started any other way from a checkout (`pnpm start`,
`ragents run`, `ragents start`, the VS Code extension), the server refuses outdated built-in
bundles or an outdated interface and names `pnpm build:plugins` or `pnpm build:web`.
`pnpm check` runs the project checks, including tests, type checking, and the web build.
`pnpm build:package` creates the host as an npm package for machines without a checkout, and
`pnpm release` publishes it together with the extension and standalone archives (see `development.md`). The question mark next to
Settings opens the included help. For separate static hosting, `pnpm generate:homepage` creates
the same website under `docs/homepage/dist`.
<!-- /guide:getting-started -->

## Sign-in and profile permissions

For an optional sign-in mode, your own `ragents.config.<profile>.ts` adds a `users` export with
`readonly ProfileUser[]` next to `config`. It holds the user ID, an optional display name, and
the permissions; the password is plain text or refers with `env(...)` to a locally provided
environment variable. An example is in [profiles.md](spec/profiles.md) under "Sign-in and
permissions", complete examples in the internally generated
[developer reference](homepage/developer.md#grant-reading-and-prepared-setups). The valid built-in permission names and the host route mapping are in the
[automatically generated developer reference](homepage/developer.md).

Restart after a change. Without `users` there is no user sign-in; an empty list or a missing
password variable is a startup error. With sign-in active, enter user ID and password; the user
button offers Sign out. Users and passwords are maintained in the profile file or the
environment, not through an administration page. `ACCESS_TOKEN` stays effective only for
profiles without `users` and does not replace a password when user sign-in is enabled. Session
duration, sign-out, and tokens are in [profiles.md](spec/profiles.md) under "Sign-in and tokens
in detail", the permissions under "Permissions in detail", ownership of runs and workspaces under
"Run ownership" and "Ownership in detail".

Besides the password, a user can have a personal token (`token: env("...")`): a permanent bearer
without expiry for clients without a sign-in dialog, such as `pnpm connect` and the model access
of a local server through the relay. The permissions needed for this are `models.use` (relay) and
`profile.fetch` (client profile); such a user does not need to see the server's runs.
Revocation: remove the token from the profile and restart.

## Provide a browser for browser checks

`ragents.browser` uses `playwright-core` and an executable Chrome or Chromium on the machine
where the run's workspace is located: on the server or on the workstation, whether in the new
folder per run or in an existing one. There
the browser reaches the application the agent started, also under `localhost`.

On the server, you enter `BROWSER_EXECUTABLE_PATH` in the profile's `ragents.browser` section or
leave the browser to provisioning. For Google Chrome on macOS the path is
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. `pnpm provision <profile>` fetches,
through `plugins/ragents.browser/provision.ts`, the Chromium version matching the pinned
Playwright version and, on Linux, its system libraries; it ends up in Playwright's normal browser
cache, not in the tools folder. If `BROWSER_EXECUTABLE_PATH` points nowhere, provisioning reports
this as a gap it must not close.

A workstation gets none of this from the server's profile: it takes `BROWSER_EXECUTABLE_PATH`
from its own environment, otherwise the Chromium that `pnpm provision --workspace` fetches when
`pnpm workspace-client` and the VS Code extension start. What the agent does with the browser,
where recordings are stored, and how long a check stays valid is in
[plugins.md](spec/plugins.md) under "Browser checks".

<!-- guide:distributed -->
## Work without a checkout

Using RAgents does not require a repository. `pnpm build:package` creates the npm package
`@schlenkr/ragents` from this checkout in `dist/ragents`; with `--pack`, it also creates
`dist/schlenkr-ragents-<version>.tgz`. The package contains the server, engine, executor, all
plugins, and the scripts behind its subcommands. From the documentation it includes only
`LICENSE` and a separate English `README.md` for the npm listing, sourced from
`scripts/package/README.md`. It carries the finished web interface and every built-in plugin as a
bundle, so nothing is built on the user's machine. Its `package.json` records the source commit as
`ragents.hostVersion`. Install it like any other npm package:

```sh
npm install -g @schlenkr/ragents
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com
```

For an npx invocation without a global install, see [Install from npm](homepage/guide-getting-started.html#install-from-npm).

Node.js 22.19 or newer is required, without Git, pnpm, or a source build. The subcommands are:

- `ragents run <folder> "<task>"`, `send`, `journal`, and `stop` let an agent work on a project.
- `ragents acp` serves stable Agent Client Protocol v1 over stdio for editors; see
  [Connect an editor over ACP](homepage/guide-clients.html#connect-an-editor-over-acp).
- `ragents connect <server-url>` fetches a client profile with its plugin bundles, provisions
  tools, and starts a server. It supports `--port <n>`, `--clean`, and `--no-start`, like
  `pnpm connect`.
- `ragents start <profile|path>` starts an included profile (`core`, `developer`, or `showcase`),
  a custom `ragents.config.<profile>.ts` anywhere on disk, or a previously fetched version.
- `ragents provision [<profile>|--workspace]` installs only the required tools.
- `ragents workspace-client <server-url> [folders ...]` registers this machine as a workspace.
- `ragents plugin build <folder...>` builds plugin sources into bundles, with type checks; see
  [Build and ship a plugin](homepage/guide-plugins.html).
- `ragents --version` (or `-v`) prints the version of the package or standalone installation.

The package runs like the checkout, with the same files in the same places and TypeScript loaded
at runtime through `tsx`. On first use, the command creates the `node_modules/@ragents/*`
links that pnpm supplies in a checkout. This is idempotent and requires no elevated privileges.

### Custom profiles and plugins

A developer will usually keep a custom profile and plugins somewhere on disk. `ragents start
<path>` starts it from the package, while `ragents run --profile <path>` runs it without an
interface for an agent. Both resolve the path in the same way:

```sh
ragents start ~/projects/mine/ragents.config.mine.ts
ragents run ~/projects/mine "Build this" --profile ~/projects/mine/ragents.config.mine.ts
```

The file must be named `ragents.config.<profile>.ts`; that name becomes the profile name. Startup
provisions the plugin tools and then starts the server. Nothing is built: the package carries the
finished web interface, which is the same for every profile, and the server loads the web halves
of the profile's plugins from their bundles at runtime.

The server loads plugins only as bundles. The package carries its built-in plugins as bundles
under `bundles/`; a custom plugin is built first with `ragents plugin build <source-folder...>`,
which writes `./dist/plugins/<custom-plugin-id>` by default. The package brings everything this
build needs, including the type checks against the host API. The profile names that bundle by a
path relative to the profile file, such as `"./dist/plugins/<custom-plugin-id>"`; a source folder
in the profile stops the start and names the build command. A bundle imports from the host only
the modules of the host API list, resolved by `apps/server/src/host-resolution-hooks.mjs`, and
must be rebuilt when the host API changes. Its `web/` half is served under `/plugins/<id>/web/`
and loaded by the browser; its Tailwind classes join the one stylesheet the server compiles at
startup. The build tool bundles libraries such as `lucide-react` from the host, so the package
also includes the dependencies declared by `apps/web/package.json`. The host does not check
whether such a bundle still matches its sources; rebuild it before starting.

An external plugin project can use a `host` symlink to access host tools. With a package
installation, that link points to the package instead of a checkout. Set `RAGENTS_HOST` to the
appropriate location:

```sh
export RAGENTS_HOST="$(npm root -g)/@schlenkr/ragents"
```

A script in the external repository can create the `host` symlink from that value. If that script
identifies a checkout by `pnpm-workspace.yaml`, it should test for something the package shares
instead, such as `apps/server/src/main.ts` beside `package.json`. Start with `ragents start <path-to-profile>`;
the symlink is used only by scripts and tsconfig files in the external repository.

The VS Code extension starts the same profile from the same package. To override automatic host
selection, set `ragents.hostPath` to a checkout or the package directory
(`<npm-prefix>/lib/node_modules/@schlenkr/ragents`). For workstation registration without this
override, it fetches the package in the server's version as described under Run panel and VS Code
extension in [usage.md](usage.md).

## Connect to a server

A developer can run RAgents locally with the profile and models of a central server. This
requires a local host with the same host API as that server: either the `@schlenkr/ragents`
package, which needs only Node, or this checkout with Git, Node, pnpm, `pnpm install`,
`pnpm build:agent`, `pnpm build:plugins`, and `pnpm build:web`. It also requires a personal token
for a user in the server profile with `profile.fetch` and `models.use` permissions:

```sh
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com --port 4720 --clean
RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com --no-start
```

In a checkout, the same command is `pnpm connect <server-url>` and uses the same implementation.

`connect` fetches the client-profile description and checks the local host before it downloads
anything. The host must offer the host API number the server's bundles were built against, and it
must have a built-in bundle for every plugin the profile names by ID. The same commit is not
required. On a mismatch, `connect` stops and names the fix: `npm install -g
@schlenkr/ragents@<version>` for the package, where the server supplies the version, or the
server's commit plus `pnpm build:plugins` and `pnpm build:web` in a checkout. It then downloads
the archive, which holds only the profile file and the finished bundles it names by path,
verifies its SHA-256, stores the version under
`~/.local/share/ragents/remote/<host>/<profile>/profiles/<version>/`, and starts the server with
that profile. Data goes to `~/.local/share/ragents/remote/<host>/<profile>/data/`, and the web
interface is the local host's own; nothing is built or installed on the developer machine.
Existing versions are not downloaded again. `--clean` removes older ones, `--no-start` stops after
fetching and reports the profile and data paths, and `--port <n>` overrides the profile port.
`ragents start <profile>` can restart an included profile or the latest fetched version without
contacting the server. Personal `env(...)` values from the client profile, such as the relay
token, must exist in the shell. Between download and startup, `connect` provisions language
servers and the browser; a prerequisite it cannot install, such as `dotnet` or a separate Chrome,
stops with instructions.

The server needs `ragents.profile-distribution` with `CLIENT_PROFILE_FILE`, plus
`ragents.model-relay` with `MODEL_ALIASES` in its `host` section for models. Plugins the client profile names by path
must be bundles built with `ragents plugin build`; the server checks them at startup. Users
receive `token: env("...")` and the two permissions. Relay responses and all client-profile
content, including prompts, skills, run scripts, bundles, and configuration, are present on the
developer machine. Only the provider, actual model, and key remain secret. The relay replaces
`model` with the alias and removes `provider`, so model context, journal, catalog, and interface
expose only the alias.

### Common first-run pitfalls

- Two environment variables, often with the same value, are needed: `connect` reads
  `RAGENTS_TOKEN`, while the name used by `RELAY_TOKEN: env("...")` must also be set.
- `COMPACTION_PROVIDER: "relay"` with an empty `COMPACTION_MODEL` can start without a text model
  at reasoning level `off`; automatic titles stay disabled and Settings explains why. An
  explicitly named alias must be such a model or startup fails.
- The relay must be reachable when the local server starts because it fetches the alias catalog
  once. Alias changes require restarting the local server.
- Revoking access affects the next model request immediately, not the running server process.
  The run then ends as failed and records the relay response in the journal.
- Rejected requests appear in the relay server's `logs/server.log`, not `relay.log`. The latter
  records only forwarded calls with user, alias, target, status, and token count.
- The archive carries no web interface. After updating the host package, a fetched version
  starts with the new web interface as long as the host API stays the same. Otherwise the start
  refuses the fetched bundles, and `connect` names the version to install.

## Run a CLI workstation

`ragents workspace-client <server-url> [folders ...]` registers this machine with the same tools
and executor as the VS Code extension. No folder means the current directory; `--id` and `--label`
set its stable identity and display name. The npm installation includes ripgrep on every supported
platform and the curated Bash on Windows. Plugin tools are provisioned before registration.
The client uses contributions from its own host package. If the server rejects its executor
version or contribution states, registration names both package versions and the fix: install
`@schlenkr/ragents@<server-version>`, for example with `npm install -g @schlenkr/ragents@<server-version>`.

Set `RAGENTS_TOKEN` for a personal or existing session token. For automatic sign-in and renewal,
configure `RAGENTS_USER` and `RAGENTS_PASSWORD` in the process environment. Neither is a command-line
option. Invalid or absent credentials when sign-in is required produce a visible failure and a
nonzero exit. A temporary connection loss reconnects and registers the workstation again.

Closing the terminal or SSH session, closing stdin, or ending the owning process unregisters the
workstation and stops its children. SIGINT, SIGTERM, and SIGHUP also stop it. For an intentional
background service, pass `--detached` and let a service manager own it, or run:

```sh
nohup ragents workspace-client https://ragents.example.com /home/user/project --detached >workspace.log 2>&1 </dev/null &
```

The flag ignores terminal closure, parent loss, and SIGHUP; it does not daemonize. SIGINT and
SIGTERM still unregister and shut down. Use the service manager's stop command to end a service.

When someone opens a service of a run on this workstation through the VS Code extension, the
workstation dials back to the server for every connection: it opens a WebSocket to
`/api/plugins/ragents.processes/tunnel` under the address it was started with, and the server joins
it with the extension's. The VS Code extension as a workstation does the same. A reverse proxy or
tunnel in front of the server must pass WebSocket upgrades on that path, with the request's query;
a Cloudflare tunnel does by default, nginx needs `proxy_http_version 1.1` and the `Upgrade` and
`Connection` headers. Both ends ping every 30 seconds, so idle streams survive proxies that close
quiet connections after a minute or more.

## Transfer a run

A run can move from one server to another and continue there, for example from a notebook to an
always-on machine or from a central server to a developer for local inspection.

```sh
RAGENTS_TOKEN=<token> pnpm run-transfer http://localhost:4723 http://server.example:4724 <runId>
RAGENTS_TOKEN=<token> pnpm run-transfer <source> <target> <runId> --workspace /path/to/project
```

The script exports the run from the source with `ragents.runs.export` and imports it on the target
with `ragents.runs.import`. If each side uses a different token, set `RAGENTS_SOURCE_TOKEN` and
`RAGENTS_TARGET_TOKEN`. The transfer includes the journal and payloads, which also hold the model
contexts of the run's agents, the stored contents the run refers to (attachments and the media of
the model contexts), actor programs, and all plugin storage for the run, including
`ragents.documents` files and the new folder of a run that works on the server. A folder on a workstation stays there, and the
run keeps its binding to that workstation. Running processes, language servers, and
browsers are not transferred; they are recreated on the target when next used.

The transfer enforces these prerequisites:

- Both servers use the same host version and workspace executor. There is no override.
- The run is stopped, with no active turn or waiting input.
- Its ID is unused on the target. An existing run, folder, or archive entry rejects the import.
- A run bound to a source project folder needs `--workspace <path>` pointing to an existing
  target folder, given as an absolute path on the target server. A workspace binding is retained; that workspace reconnects to the target with
  the same ID and as the run owner, or anonymously for an ownerless run.
- The archive must stay below 16 MiB because it travels as Base64 through the message layer.
  A workspace containing `node_modules` will exceed this; an existing folder on the server usually will not.
- Symbolic links travel only when they are relative and stay inside the run's storage. Links under
  `node_modules` that point elsewhere, such as a package manager's absolute links, are left out
  and come back with the next install in the workspace. Any other link pointing outside stops the
  export with `run-transfer-link` and names the links; replace them with files or relative links.

Export copies the run. It remains on the source and must be deleted there explicitly after a
real move, otherwise two journals with the same ID diverge. On the target, the run appears
stopped and continues with the next message. Its model context still contains absolute source
paths; reusing one fails at the workspace boundary, while a relative path reaches the target.
After transfer, inspect the journal with `pnpm driver journal <runId>` and plugin storage under
`${DATA_DIR}/sessions/<runId>/plugins/`.

## Work on Windows

The local host and workspace also run on Windows. Requirements are:

- **The VS Code extension for Windows** brings its own bash. The Marketplace delivers a
  `win32-x64` or `win32-arm64` build that contains a slim bash with the GNU tools (coreutils,
  `grep`, `sed`, `awk`, `find`, `diff`, `patch`, `tar`, `unzip`, `cygpath` and more), taken from
  a fixed Git for Windows release, plus `rg.exe` (ripgrep) from a fixed ripgrep release. The
  `bash` tool uses only this bash, for the workspace and for the local host; an installed Git
  Bash or a `bash.exe` on `PATH` is never used. PowerShell and `cmd.exe` are not used either.
- **Code search** runs through `rg`, which skips `node_modules`, `bin`, `obj` and everything else
  `.gitignore` excludes. The extension builds for macOS and Linux carry `rg` as well and put it at
  the front of the `bash` tool's `PATH`, on the workstation and for the local host. The system
  prompt tells the model to search with `rg` only when the machine running `bash` has one;
  otherwise it tells the model to exclude dependency and build folders from `grep -r`.
- **Git** is your own `git.exe` on `PATH`, for example from Git for Windows. The bundled bash
  contains no git, so your login works as usual: Git Credential Manager, `~/.gitconfig` and
  `~/.ssh`. On your own machine the bash inherits your whole environment, except the variables of
  VS Code itself and `BASH_ENV`/`ENV`.
- **CLI workstation** (`ragents workspace-client`) carries the same Bash and ripgrep as the
  extension. npm installs only the optional tools package for this machine; keep optional
  dependencies enabled. A checkout uses the extension build from `pnpm bundle:rg` and
  `pnpm bundle:bash`. A standalone server (`ragents start`) still takes `RAGENTS_BASH` and
  `RAGENTS_RG` from its environment; these variables do not override workstation bundles.
- **Node.js** is enough with `@schlenkr/ragents`. A checkout additionally needs **pnpm**, and
  `pnpm install`, `pnpm build:agent`, and `scripts/start.sh` need a bash of your own, such as
  Git Bash.
- The **.NET SDK** is required when the profile includes Roslyn or FSAC. Provisioning downloads
  the language servers; the TypeScript server comes from the host directory.
- A **server** on Windows has no process sandbox. Its profile file must switch it off explicitly
  with `PROCESS_SANDBOX: "off"` in the `ragents.workspace` section, otherwise startup fails. A
  Windows workstation connected to a server needs nothing, because the sandbox applies only to
  the server.

The data directory is `%LOCALAPPDATA%\ragents\<profile>` and server-provided profiles use
`%LOCALAPPDATA%\ragents\remote\<host>\<profile>\`. `DATA_DIR` overrides this. Startup fails when
`LOCALAPPDATA` is absent. Unix permissions 0700 and 0711 do not apply on Windows, where isolation
per run depends on the user account.

Windows has no process group for command termination, and the bundled MSYS bash does not hang its
children into the Windows process tree, so `taskkill /T` on the bash alone misses them. Every `bash`
call therefore carries a marker in its environment; on timeout, stop, and after the call, a short
helper bash lists the MSYS process groups of that call and RAgents ends them and their native trees
with `taskkill /T /F`. A process that survives this is an error. This is forceful and has no grace
period. There is also no process table: for
runs using a Windows workspace, the process rail explains this limitation. Stopping a run still
terminates Bash process trees, while a deliberately detached service continues. Workspace tools
do not depend on the process rail.

Windows support was exercised on a physical Windows 11 machine on 29.09.2026: the bundled bash and
`rg`, the default timeout, stop, and the cleanup of background jobs. Beyond that it is covered by
unit tests that simulate the platform. A first real run should verify `pnpm connect`,
`read`, `edit`, `bash` output and cancellation, diagnostics, and a workspace through
`pnpm workspace-client`, and with the bundled bash `git fetch` and `git push` over HTTPS with Git
Credential Manager and over SSH.
## Server process sandbox

What a run starts on the server (Bash, commands, language servers, TypeScript snippets, actor
programs) runs in a process sandbox: it reads and writes only the folders of its run, sees
neither other runs nor the home of the server account, and can reach public web domains by
default. Rules and limits are in [plugins.md](spec/plugins.md) under "Server process sandbox". It
does not apply on a workstation; there the run works with the developer's Bash and credentials.
Only what such a run starts on the server, such as a Bash in `@actors`, runs inside it.

Prerequisites that startup checks:

- **macOS**: nothing extra, `sandbox-exec` is part of the system.
- **Linux**: `bubblewrap`, `socat`, and `ripgrep` (Debian and Ubuntu:
  `apt-get install bubblewrap socat ripgrep`), plus user namespaces. On Ubuntu 24.04 and later
  this requires `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` or an AppArmor profile.
  If the server runs as root, it needs `CAP_SETFCAP`; it is better to run it under its own account.
- **Linux in a container**: Docker's default profile forbids the namespaces. Startup has been
  verified with `--security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt
  systempaths=unconfined` (in Compose `security_opt`) and a non-root user in the container;
  `--privileged` works too, but grants more than necessary.
- **Windows**: no sandbox. Startup aborts as long as the profile file does not explicitly switch
  it off.

The profile file controls it in the `ragents.workspace` section:

```ts
"ragents.workspace": {
  PROCESS_SANDBOX: "on",
  PROCESS_SANDBOX_NETWORK: ["*"], // public web domains on ports 80 and 443 (the default)
},
```

`curl`, package downloads and API requests no longer need a domain entry for each public
website. IP literals, localhost and internal services need explicit entries, for example
`["*", "127.0.0.1:8080"]`; for an internal hostname in public mode, allow its IP and port too.
The server's own address is always allowed. A list such as `["registry.npmjs.org", "*.example.com"]`
restricts access to those targets; `[]` leaves only the own server reachable. Network permission
does not distinguish downloads from uploads or destructive API calls. File isolation remains
active. `PROCESS_SANDBOX: "off"` explicitly disables the whole sandbox, for example on Windows.
On macOS, pnpm through corepack needs a `packageManager` in the workspace's
`package.json`, because corepack otherwise aborts at a blocked folder above it.

<!-- /guide:distributed -->

## Time limit of `bash`

A command of the `bash` tool ends after 120 seconds if the call names no `timeout`; a call may
request up to 60 minutes. Like the common agent harnesses, the tool takes `timeout` in
milliseconds (default 120000, at most 3600000; Claude Code stops at 600000, long builds need more
here). Both are in the tool's description, together with
the sentence that builds, test runs, and installations need a larger `timeout`. When the time runs
out, the model gets the output so far, the milliseconds, and the hint to narrow the command, for
example with `rg` instead of `grep -r`, or to pass a larger `timeout`. The server inserts the time
limit into every call; it therefore also applies on a workstation. A background command
(`run_in_background`) has no time limit: it runs until it exits, the agent stops it with `task_stop`,
someone ends it in the process rail, or the run stops.

`RAGENTS_BASH_TIMEOUT_SECONDS` in the `ragents.workspace` section or in the server's environment
changes the default, in seconds:

```ts
"ragents.workspace": {
  RAGENTS_BASH_TIMEOUT_SECONDS: 300, // default for calls without timeout, at most 3600
},
```

The upper limit is 3600 seconds: a larger, a non-positive, or a non-numeric value aborts
startup. A workstation (VS Code extension, `ragents workspace-client`) does not read the
variable; the server's default applies to its runs. Anything that takes longer than an hour
does not go through `bash`, but through a plugin workflow with its own time limit
([plugins.md](spec/plugins.md), Open limits).

## Compaction of the model context

An agent's model context is stored in the journal (`docs/spec/core.md`, Model context and agent
runtime). When it grows too large, the agent runtime compacts it: after a response whose context
is above the model's threshold, and after an overflow error from the provider. Roughly
`keepRecentTokens` of the most recent entries are kept; the rest becomes a summary of at most
`summaryTokens`. Every compaction is recorded as `context.compacted` in the journal, with the
threshold that applied and its origin (`model` or `catalog`); the chat shows a system line,
`pnpm driver journal <runId>` shows both.

The three values belong to the model; there is no host-wide setting. A profile sets them per
alias in `MODEL_ALIASES` in the `host` section (rules in `docs/spec/profiles.md`); a relay client
takes them over from the server. A catalog model without an alias compacts according to the
catalog default: from `contextWindow - 16384` tokens, with `keepRecentTokens` 20000 and a summary
of up to 13107 tokens. Because the catalog names the largest context window across all providers
of a model, this threshold is often beyond what most providers can handle; anyone holding long
conversations with a model therefore gives it an alias with a threshold below the window of the
usual providers.

To trigger a compaction deliberately, for example for a demo, an alias gets small values; then a
context above 4000 tokens already compacts:

```typescript
{ alias: "demo-compact", model: "openrouter/z-ai/glm-5.3-flash",
  compaction: { threshold: 4_000, keepRecentTokens: 1_000, summaryTokens: 1_000 } },
```

## Data storage and logs

By default, each profile is stored under `~/.local/share/ragents/<profile>`, on Windows under
`%LOCALAPPDATA%\ragents\<profile>`. The order
is `DATA_DIR` from the environment, `host.DATA_DIR` from the profile file, then this default.
This applies to `scripts/start.sh` and to starting the server directly. Before the build or the
server initialization, existing path ancestors including symlink targets are checked:
`.git`, `pnpm-workspace.yaml`, and `package.json` are not permitted there. That way build tools
do not pick up configuration of the RAgents source tree. An explicit external path remains a
valid setting. Below the data folder, next to the runtime data, lies `tools/<plugin-id>/`: the
tools that `pnpm provision` fetches for the plugins of this profile.

For a deliberate move, first stop the server and its run processes. Move the entire profile
folder including journals, payloads, working directories, and plugin states. If stored runs
contain absolute old
paths, an explicitly created symlink from the old to the new profile folder can preserve these
references. Startup does not create this link itself and does not rewrite any journals. The
physical new storage must be outside a Git/package project.

A run's storage is spread over a few fixed directories and fully mapped in the journal.
`apps/server/src/layout.ts` owns the product-neutral run, `sessions/`, archive, and log paths.
Plugin storage is pure convention and cannot be declared: `host.storage` provides
`plugins/<pluginId>/` globally and `sessions/<runId>/plugins/<pluginId>/` per run.

```
${DATA_DIR}/
  runs/<runId>/journal.jsonl      compact engine journal v7 with commands and events, including
                                  the agents' model contexts
  runs/<runId>/payloads/          immutable large JSON contents, one file per SHA-256
  artifacts/<sha256>              immutable artifact contents, including the media of the model contexts
  sessions/                       0711 root: traversable, but not listable
    <runId>/                      0711 root
      plugins/                    0711 root - exactly one subfolder per plugin
        ragents.documents/
          documents/              the run's document store (`@documents`), without DOCUMENTS_DIR
        ragents.workspace/
          workspace/              empty working directory with binding fresh, filled by a resolver plugin;
                                  if the contribution brings its own kind, its folder lives in that plugin's storage
          server/                 only when needed: with a binding to a workstation the folder for
                                  typescript_eval, actor programs, and calls on roots
                                  of the server that run on the server; on the server
                                  for calls on those roots while the run's own folder is gone
          home/                   HOME of the sandbox
      tmp/                        the run's temp folder in the process sandbox (TMPDIR)
  delete-intents/                 0700 root - recorded deletion intents
    <runId>.json                  0600 root - a deletion interrupted by a crash is
                                  recognized by it on the next start and completed
  recovery/                       0700 root - recovery data per run; moves into the
                                  archive on deletion (nothing stores anything there yet)
  archive/<runId>/                recovery data and journal of deleted runs, for
                                  journals before format 7 also their sessions under chat/
  transfer/                       working folder of the run transfer: manifest.json during an
                                  export, import/ during an import; both are removed
                                  afterwards
  plugins/<pluginId>/             global storage per plugin, where needed
  logs/server.log                 server run, HTTP access, errors, crashes (rotation 32 MB x3)
```

Server-provided profiles (`pnpm connect`) are stored alongside under
`~/.local/share/ragents/remote/<host>/<profile>/`: `profiles/<version>/` per fetched version and
`data/` as the `DATA_DIR` of the local server with the same structure as above.

A single run does not change servers by hand, but with `pnpm run-transfer` (see
"Transfer a run"). A journal backup or manual move always covers the entire `runs/<runId>/` folder,
that is, also `payloads/`. The single JSONL file is not enough when contents are stored externally.
Archiving deleted runs takes over this folder completely. Other run data such as
working files and the contents under `artifacts/` remain required in addition. Journals of earlier file formats
are rejected for the affected run; the server starts anyway. Damaged or incomplete journals and
missing content files also affect only their run. The server log names the run ID, file path,
and cause. Blocked runs appear in the run list as locked with this cause (`locked`); Web and
VS Code do not open them, but offer to delete them. A journal that could not be loaded names no
owner; with sign-in, only someone with `runs.read.all` therefore sees and deletes the run. Every
other access reports the error `journal-unavailable` (status 409). The files are kept and are not
automatically migrated, moved, or deleted; only an explicit deletion moves them unchanged into
the archive. Pending delete intents are retried at startup and shutdown. A failed deletion keeps
its intent and remaining files, logs the cause, and shows the run as locked; it does not prevent
server start or shutdown. The run's delete action can retry the cleanup.
An old journal of the global coordinator does not prevent the server start either;
its explicitly confirmed conversation reset then starts a new conversation. For other runs, a
deliberate repair followed by a restart can make the existing storage usable again.
A completely fresh data set is not required.

There are no automatic migrations and no search for old data paths. Existing data is only moved
on explicit request while the server is stopped; the server moves nothing itself and deletes no
old data.

Reading: `tail -200 ${DATA_DIR}/logs/server.log`, `pnpm driver journal <runId>` for a run's journal including model inputs and compactions.

The permissions are set so that a run reaches its own working directory, but can neither list the
neighboring runs nor read their chat and plugin logs. The plugin logs survive a stop; a plugin
log is continued per start with a `=== Start: ... ===` line instead of being overwritten. Only
paths go into the log, never query strings, so that no access token ends up on disk.

The run ID connects these directories.

## Isolation per run

Every run works in its own working directory and its own file storage.
Which folder that is, the "Workspace" start option determines at startup with two settings:
"Machine" is the server or a connected workstation (such as the VS Code extension), "Folder" is a
new one per run or an existing one whose absolute path you enter or take from the offered folders
of the workstation. On the server, the new folder lives under the runtime data, on a workstation
in its data folder under `workspace/runs/<run-id>` (on macOS and Linux
`~/.local/share/ragents`); a profile can replace it with its own, such as a worktree per run,
and then offers it only where it can provide it. An existing folder is never touched when the run
is deleted, a new one disappears with it; if the workstation is not connected at deletion, its
folder stays. With a workstation, everything that touches the folder runs where it is located:
tools, language servers, the Files tab, the process rail, and the browser of the browser check.
The server's roots, `@actors` of the actor programs and `@skills/<name>` of the skills, are still
reached by file tools and language servers through their alias, and a Bash with such an alias as
`cwd` runs on the server in the run's process sandbox.
Path checks, ownership of a workstation, sign-in over the network, and the errors on a
disconnected connection are in [plugins.md](spec/plugins.md) under "Workspace, sandbox tools, and
processes".

Without VS Code, `pnpm workspace-client <server-url> [folders ...]` registers the same workstation
from the command line. Credentials and process ownership are described under
[Run a CLI workstation](#run-a-cli-workstation).
Workstation and server need the same executor version; if a workstation brings a different one,
the server rejects the registration with both versions and names what to update: for an older
workstation the RAgents extension or `@schlenkr/ragents` there, for a newer one the server.
Likewise, both need the same plugin contributions to the executor, such as the language servers
and the browser: the server names them before registration. The VS Code extension loads them from
the host package in the exact RAgents version reported by `ragents.plugins.bootstrap`, fetched
with its configured environment, including npm registry settings, into
`<globalStorage>/hosts/<server-version>/`. Each server selects its own version; servers with the
same version share the cached package, which survives extension restarts. A machine that connects
only to remote servers needs no local profile or distributing server. An explicit
`ragents.hostPath` overrides fetching; a different package version or contribution state fails
registration with its cause, without falling back to another host. A missing bundle also fails.
The headless workstation uses its own host package and names both package versions and the
matching version to install on a mismatch. The VS Code extension shows such a
rejection as the error "RAgents version mismatch" with its own version, the server's version, and
the side to update, and a differing version with an accepted workstation as a warning
([usage.md](usage.md), Run panel and VS Code extension); the server names the version in the
bootstrap (`version` in `ragents.plugins.bootstrap`).
The workstation reads the tools of these contributions from its own process environment, not from
the server's profile: startup calls `pnpm provision --workspace`, stores Roslyn and fsautocomplete
under `~/.local/share/ragents/workspace/tools/<plugin-id>/`, and fetches Chromium into
Playwright's browser cache; TypeScript and `playwright-core` come from the host folder.
`ROSLYN_LANGUAGE_SERVER`, `FSHARP_LANGUAGE_SERVER`, and `BROWSER_EXECUTABLE_PATH` override this.
The VS Code extension provisions once per selected host during an activation, before registration,
and writes the report to its `RAgents` output channel. The Server entry shows fetching and
provisioning progress; a fetch failure, such as an offline registry or unpublished version, stays
there with its cause. If the server requests no contributions, no host fetch or workspace
provisioning is needed. `HOME` stays the developer's home, so that Git, SSH, and NuGet work with their
credentials; language server logs end up under `os.tmpdir()`. Every tool call of the model
appears as one line on stdout (run ID, tool, duration, `ok` or error text); the VS Code extension
writes the same line to its `RAgents` output channel. Queries from the interface, such as the
Files tab or the process rail every two seconds, do not appear there.
