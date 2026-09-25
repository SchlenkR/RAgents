# Get started

Install RAgents, start a profile, and create your first run.

## Install locally

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

A profile can also name its models by alias: `MODEL_ALIASES` in the `host` section lists
`alias=provider/model` or `alias=provider/model@thinking`, and `AGENT_PROVIDER: "alias"` makes the
product use them. The interface, the chat, and the journal then show only the alias names.

Alternatively, a profile can obtain its models from another RAgents server running the
`ragents.model-relay` plugin, which offers that server's `MODEL_ALIASES`: set
`AGENT_PROVIDER: "relay"`, point `RELAY_URL` to that server, use `RELAY_TOKEN: env("...")` with a
user's personal token there, and use relay aliases for every model key. Only the relay server can
see which model is behind an alias. Its log at `plugins/ragents.model-relay/relay.log` records the
user, alias, target, and token count for each request.

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
`pnpm publish:package` publishes it (see Work without a checkout). The question mark next to
Settings opens the included help. For separate static hosting, `pnpm generate:homepage` creates
the same website under `docs/homepage/dist`.

## Create your first run

The top-left corner opens the run overview. Choose "Neuer Run" to open the start selection. It
shows the same tiles as the start page in VS Code: "Neuer Chat" (new chat) or the server's default
template first, then skill templates with a prepared task and script templates with programmed
setups. "Neuer Chat" opens an empty run whose task you write in its chat; a template starts with one
click. Some templates collect values in a setup dialog first ("Einrichten"); a skill template then
continues in the preparation chat. There you can discuss the task, give a clear go-ahead such as
"Start", or choose "Run erstellen" (create run). Merely confirming a detail does not start
anything. In the browser a new run always works on the server; only VS Code and `ragents run`
bind a run to a workstation.

Inside the run, the coordinator processes the task. Additional agents and mini-apps appear on
the surface when the workflow creates them. The global coordinator in the header has its own
conversation and can oversee several runs. The journal and "Executions" tab make events and
TypeScript calls traceable.

## Use the surface

A run's surface consists of tiles. Each tile shows an actor or mini-app, and together they
fill the available space. There is no panning or zooming. Tiles use flat surfaces, outlines,
and rounded corners without depth. Mini-app content appears at its original size both in the
tile and in full view.

Drag an actor or mini-app from the header onto one of a tile's docking targets. Left and right
create a side-by-side split; top and bottom create a vertical split. Targets at the outer edge
split the entire surface. Before you release, a preview shows the resulting area. Drag an
existing tile by its title bar; the X removes it from the layout. Its content remains available
through the header. Without access to the actors view, removal and reordering are disabled: the
X and drag handle are hidden. Dividers for adjusting size ratios remain available.

Drag a divider to the desired ratio; releasing it saves the value. Escape cancels the active
resize. With keyboard focus on a divider, arrow keys change its size while Home and End set the
allowed limits. When space is tight, the "Sichtbare Kachel" (visible tile) selector displays one item at a time
without discarding the layout. You can also ask the coordinator: "App on the left, chat on the
right, 50:50" or "One tile on top, two below at a 2:1 ratio." Until a layout is specified, the
surface arranges visible participants itself. Your changes remain saved until the program
changes its layout. A new program layout is applied automatically so added tiles appear at
once. "Programmvorgabe übernehmen" (apply program layout) in the status bar can reset your own layout earlier.
