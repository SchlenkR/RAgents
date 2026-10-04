# Get started

Install RAgents, start a profile, and create your first run.

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
[Custom profiles and plugins](guide-distributed.html#custom-profiles-and-plugins). The
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
disabled. [Users and permissions](guide-access.html) explains how to configure access.
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
[plugins.md](../spec/plugins.md#external-acp-actors); actor creation is in
[Run external ACP actors](guide-clients.html#run-external-acp-actors).

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

## Create your first run

Start shows one server's permitted templates under "New", then its five recent runs under
"Continue", then any plugin sections, in both the browser and VS Code. Templates begin with
"New chat" or the server's default template, then skill templates with a prepared task and script
templates with programmed setups. "New chat" opens an empty run whose task you write in its chat;
a template starts with one click. Some templates collect values in a setup dialog first ("Set up"); a skill template then
continues in the preparation chat. There you can discuss the task, give a clear go-ahead such as
"Start", or choose "Create run". Merely confirming a detail does not start
anything. In the browser a new run always works on the server; only VS Code and `ragents run`
bind a run to a workstation.

A click shows its effect at once: either the run's progress appears, or the chosen entry shows
a spinner and "Starting ..." while the other entries stay locked until the run opens or the start
fails; a run script in the run header's "Run script" list does the same. While a template starts,
the panel shows its progress in the chat area and reserves the bottom status bar, keeping the
notice in place when the run connects.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear on
the surface when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Use chat and mini-apps

Activated visible mini-apps become available automatically, including those from an embedded setup.
Programs cannot arrange the host interface. Runs saved with removed layout functions or placements
are locked with an explanation; their original files are kept. Start a new run with updated programs.

Wide browser runs start with Chat beside the mini-apps; narrow ones use one tab group. Drag tabs
onto the docking guides to arrange areas or merge them. Chat and visited apps keep their input
through switches and moves. New apps appear without taking focus; unavailable apps disappear.
Close windows with X. The run header keeps a button for every window; a pressed button is
visible, and clicking another one shows that window. Drag a header button by its grip to
reorder the buttons, or onto the docking guides to place that window. "Empty space" in the
header adds an empty pane that holds a place until you drop a window onto it. When the header is
too narrow for the buttons, they all move into one "All windows" menu.

In VS Code, clicking an app opens or focuses its editor tab. VS Code controls where that tab
appears. Questions and news stay in chat. The selector below the input chooses the addressee;
the run coordinator is selected by default.
