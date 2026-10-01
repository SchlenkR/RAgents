# Get started

Install RAgents, start a profile, and create your first run.

## Install a standalone release

[GitHub Releases](https://github.com/SchlenkR/RAgents/releases) provides standalone archives for
Windows, macOS, and Linux, each for x64 and ARM64. They include Node.js, npm, the host's installed
dependencies, the finished web interface, plugins, and platform tools. No existing Node.js, npm,
pnpm, or source checkout is needed. Linux builds target glibc systems, not Alpine/musl.

On macOS or Linux:

```sh
curl -fsSL https://github.com/SchlenkR/RAgents/releases/latest/download/install.sh | sh
```

The command is installed at `~/.local/bin/ragents`. Add `~/.local/bin` to your `PATH` if needed,
or use that full path. On Windows, run this in PowerShell:

```powershell
& ([scriptblock]::Create((Invoke-RestMethod https://github.com/SchlenkR/RAgents/releases/latest/download/install.ps1)))
```

The Windows installer uses `%LOCALAPPDATA%/Programs/RAgents` and adds its `bin` folder to the
user PATH. Open a new terminal afterwards. Neither installer needs administrator access. Both
select the current machine's archive, verify it against the release's `SHA256SUMS`, and check
the command before switching the active version. Repeat the command to update; older versions
remain installed. Stop your running hosts before switching versions and restart them afterwards.
Settings and runs remain in the existing user data directory.

For a fixed release or another installation folder, download the script and pass
`--version 0.1.21 --prefix /absolute/install/path` on Unix, or
`-Version 0.1.21 -Prefix C:\Apps\RAgents` on Windows. Windows also accepts `-NoPathUpdate`.
Use the same prefix and an older `--version` / `-Version` to switch back. Alternatively, unpack
the matching archive yourself and run `bin/ragents` or `bin/ragents.cmd` from it.

Run `ragents --help` for commands. After configuring model access as described below,
`ragents start core` provisions that profile's tools and starts its web interface at
`http://localhost:4710`. The bundle does not include model credentials, Chromium, language servers,
or development SDKs. Provisioning downloads the profile's supported tools; the included profiles
use C# and F# diagnostics and require an installed .NET 10 SDK. These requirements are the same
as for the npm package. An own profile can omit those plugins.

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

Configure model access as described below before starting. Startup provisions the profile's
tools; external prerequisites such as .NET must already be available. Then open
`http://localhost:4710`. Other subcommands work the same way, for example
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

Start shows recent runs and the same templates in the browser and VS Code: "New chat" or the server's default
template first, then skill templates with a prepared task and script templates with programmed
setups. "New chat" opens an empty run whose task you write in its chat; a template starts with one
click. Some templates collect values in a setup dialog first ("Set up"); a skill template then
continues in the preparation chat. There you can discuss the task, give a clear go-ahead such as
"Start", or choose "Create run". Merely confirming a detail does not start
anything. In the browser a new run always works on the server; only VS Code and `ragents run`
bind a run to a workstation.

While a template starts, the panel shows its progress in the chat area and reserves the
bottom status bar, keeping the notice in place when the run connects.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear on
the surface when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Use chat and mini-apps

Activated visible mini-apps become available automatically, including those from an embedded setup.
Programs cannot arrange the host interface. Runs saved with removed layout functions or placements
are locked with an explanation; their original files are kept. Start a new run with updated programs.

Browser runs have tabs: Chat, then each available mini-app. Only one view is visible. Chat
and visited apps keep their input when you switch tabs. New apps appear without interrupting
your current view. If a selected app becomes unavailable, the panel returns to Chat.

In VS Code, clicking an app opens or focuses its editor tab. VS Code controls where that tab
appears. Questions and news stay in chat. The selector below the input chooses the addressee;
the run coordinator is selected by default.
