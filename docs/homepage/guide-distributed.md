# Distributed work

Run the host locally or remotely, keep tools beside the project, and move runs between servers.

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

Only Node 22 is required: no Git, pnpm, `pnpm install`, or build. The subcommands are:

- `ragents run <folder> "<task>"`, `send`, `journal`, and `stop` let an agent work on a project.
- `ragents connect <server-url>` fetches a client profile with its plugin bundles, provisions
  tools, and starts a server. It supports `--port <n>`, `--clean`, and `--no-start`, like
  `pnpm connect`.
- `ragents start <profile|path>` starts an included profile (`core`, `developer`, or `showcase`),
  a custom `ragents.config.<profile>.ts` anywhere on disk, or a previously fetched version.
- `ragents provision [<profile>|--workspace]` installs only the required tools.
- `ragents workspace-client <server-url> [folders ...]` registers this machine as a workspace.
- `ragents plugin build <folder...>` builds plugin sources into bundles, with type checks; see
  [Build and ship a plugin](guide-extensions.html).

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

The VS Code extension starts the same profile from the same package. Set `ragents.hostPath` to
the package directory (`<npm-prefix>/lib/node_modules/@schlenkr/ragents`) rather than a checkout.
If the setting is empty and the extension is not running from a checkout, it fetches the package
itself as described under Run panel and VS Code extension.

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
`ragents.model-relay` with `RELAY_MODELS` for models. Plugins the client profile names by path
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

## Transfer a run

A run can move from one server to another and continue there, for example from a notebook to an
always-on machine or from a central server to a developer for local inspection.

```sh
RAGENTS_TOKEN=<token> pnpm run-transfer http://localhost:4723 http://server.example:4724 <runId>
RAGENTS_TOKEN=<token> pnpm run-transfer <source> <target> <runId> --workspace /path/to/project
```

The script exports the run from the source with `ragents.runs.export` and imports it on the target
with `ragents.runs.import`. If each side uses a different token, set `RAGENTS_SOURCE_TOKEN` and
`RAGENTS_TARGET_TOKEN`. The transfer includes the journal and payloads, model contexts under
`chat/`, actor programs, and all plugin storage for the run, including `ragents.documents` files
and the workspace of a run with a `fresh` binding. Running processes, language servers, and
browsers are not transferred; they are recreated on the target when next used.

The transfer enforces these prerequisites:

- Both servers use the same host version and workspace executor. There is no override.
- The run is stopped, with no active turn or waiting input.
- Its ID is unused on the target. An existing run, folder, or archive entry rejects the import.
- A run bound to a source project folder needs `--workspace <path>` pointing to an existing
  target folder, given as an absolute path on the target server. A workspace binding is retained; that workspace reconnects to the target with
  the same ID and as the run owner, or anonymously for an ownerless run.
- The archive must stay below 16 MiB because it travels as Base64 through the message layer.
  A workspace containing `node_modules` will exceed this; a `path` binding usually will not.

Export copies the run. It remains on the source and must be deleted there explicitly after a
real move, otherwise two journals with the same ID diverge. On the target, the run appears
stopped and continues with the next message. Its model context still contains absolute source
paths; reusing one fails at the workspace boundary, while a relative path reaches the target.
After transfer, inspect the journal with `pnpm driver journal <runId>` and plugin storage under
`${DATA_DIR}/sessions/<runId>/plugins/`.

## Work on Windows

The local host and workspace also run on Windows. Requirements are:

- **Git for Windows** for Git Bash. The executor checks `%ProgramFiles%\Git\bin\bash.exe`, then
  `%ProgramFiles(x86)%\Git\bin\bash.exe`, then `bash.exe` on `PATH` for Cygwin or MSYS2. If none
  is found, every `bash` call fails with installation instructions. PowerShell and `cmd.exe` are
  not used.
- **Node.js** is enough with `@schlenkr/ragents`. A checkout additionally needs **pnpm**, and
  `pnpm install`, `pnpm build:agent`, and `scripts/start.sh` run in Git Bash.
- The **.NET SDK** is required when the profile includes Roslyn or FSAC. Provisioning downloads
  the language servers; the TypeScript server comes from the host directory.

The data directory is `%LOCALAPPDATA%\ragents\<profile>` and server-provided profiles use
`%LOCALAPPDATA%\ragents\remote\<host>\<profile>\`. `DATA_DIR` overrides this. Startup fails when
`LOCALAPPDATA` is absent. Unix permissions 0700 and 0711 do not apply on Windows, where session
isolation depends on the user account.

Windows has no process group for command termination, so RAgents ends the process tree with
`taskkill /T /F`. This is forceful and has no grace period. There is also no process table: for
runs using a Windows workspace, the process rail explains this limitation. Stopping a run still
terminates Bash process trees, while a deliberately detached service continues. Workspace tools
do not depend on the process rail.

Windows support has not yet been exercised on a physical Windows machine. It is implemented and
covered by unit tests that simulate the platform. A first real run should verify `pnpm connect`,
`read`, `edit`, `bash` output and cancellation, diagnostics, and a workspace through
`pnpm workspace-client`.
