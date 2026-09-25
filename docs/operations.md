# Betrieb

Installation, Start, Zugang, das npm-Paket, verteiltes Arbeiten mit Server, Arbeitsplatz und
Run-Umzug, Windows und die Datenablage. Was ein Benutzer sieht und tut, steht in `docs/usage.md`,
Build, Prüfläufe und Veröffentlichung in `docs/development.md`, der Aufbau des Systems in
`docs/spec/` und das Warum in `docs/decisions.md`.

<!-- guide:getting-started -->
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
disabled. [Users and permissions](homepage/guide-access.html) explains how to configure access.
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
<!-- /guide:getting-started -->

## Anmeldung und Profilrechte

Für einen optionalen Anmeldemodus ergänzt die eigene `ragents.config.<profil>.ts` neben
`config` einen `users`-Export mit `readonly ProfileUser[]`. Benutzerkennung, optionaler
Anzeigename und Rechte stehen dort; das Passwort steht als Klartext oder verweist mit
`env(...)` auf eine lokal bereitgestellte Umgebungsvariable. Ein Beispiel steht in
[profiles.md](spec/profiles.md) unter "Sign-in and permissions", vollständige Beispiele in der
intern erzeugten [Entwicklerreferenz](homepage/developer.md#lesen-und-vorbereitete-setups-freigeben). Die gültigen eingebauten Rechtenamen und die Host-Routenzuordnung stehen in der
[automatisch erzeugten Entwicklerreferenz](homepage/developer.md).

Nach einer Änderung neu starten. Ohne `users` gibt es keine Benutzeranmeldung; eine leere
Liste oder fehlende Passwortvariable ist ein Startfehler. Bei aktiver Anmeldung Benutzerkennung
und Passwort eingeben; der Benutzerknopf bietet Abmelden. Benutzer und Passwörter werden in der
Profildatei beziehungsweise Umgebung gepflegt, nicht über eine Verwaltungsseite. `ACCESS_TOKEN`
bleibt nur für Profile ohne `users` wirksam und ersetzt bei aktivierter Benutzeranmeldung kein
Passwort. Sitzungsdauer, Abmelden und Token stehen in [profiles.md](spec/profiles.md) unter
"Anmeldung und Token im Einzelnen", die Rechte unter "Rechte im Einzelnen", Eigentum an Runs und
Arbeitsbereichen unter "Run ownership" und "Eigentum im Einzelnen".

Ein Benutzer kann neben dem Passwort einen persönlichen Token haben (`token: env("...")`):
ein dauerhafter Bearer ohne Ablauf für Clients ohne Anmeldedialog, etwa `pnpm connect` und den
Modellzugang eines lokalen Servers über das Relay. Die dafür nötigen Rechte sind `models.use`
(Relay) und `profile.fetch` (Client-Profil); Runs des Servers braucht ein solcher Benutzer
nicht zu sehen. Entzug: Token aus dem Profil nehmen und neu starten.

## Browser für Browserprüfungen bereitstellen

`ragents.browser` verwendet `playwright-core` und einen ausführbaren Chrome oder Chromium auf dem
Rechner, auf dem der Arbeitsbereich des Runs liegt: auf dem Server oder auf dem Arbeitsplatz, gleich
ob im neuen Ordner je Run oder in einem vorhandenen. Dort
erreicht der Browser die Anwendung, die der Agent gestartet hat, auch unter `localhost`.

Auf dem Server trägst Du in der Sektion `ragents.browser` des Profils `BROWSER_EXECUTABLE_PATH`
ein oder überlässt den Browser der Provisionierung. Für Google Chrome auf macOS lautet der Pfad
`/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`. `pnpm provision <profil>` holt
über `plugins/ragents.browser/provision.ts` die zur gepinnten Playwright-Fassung passende
Chromium-Version und unter Linux deren Systembibliotheken; sie landet im normalen Browsercache
von Playwright, nicht im Werkzeugordner. Zeigt `BROWSER_EXECUTABLE_PATH` ins Leere, meldet die
Provisionierung das als Lücke, die sie nicht schließen darf.

Ein Arbeitsplatz bekommt nichts davon aus dem Profil des Servers: Er nimmt
`BROWSER_EXECUTABLE_PATH` aus seiner eigenen Umgebung, sonst das Chromium, das
`pnpm provision --workspace` beim Start von `pnpm workspace-client` und der VS-Code-Erweiterung
holt. Was der Agent mit dem Browser tut, wo Aufnahmen liegen und wie lange eine Prüfung gilt,
steht in [plugins.md](spec/plugins.md) unter "Browserprüfungen".

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
  [Build and ship a plugin](homepage/guide-plugins.html).

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
and the new folder of a run that works on the server. A folder on a workstation stays there, and the
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
  a fixed Git for Windows release. The `bash` tool uses only this bash, for the workspace and for
  the local host; an installed Git Bash or a `bash.exe` on `PATH` is never used. PowerShell and
  `cmd.exe` are not used either.
- **Git** is your own `git.exe` on `PATH`, for example from Git for Windows. The bundled bash
  contains no git, so your login works as usual: Git Credential Manager, `~/.gitconfig` and
  `~/.ssh`. On your own machine the bash inherits your whole environment, except the variables of
  VS Code itself and `BASH_ENV`/`ENV`.
- **Without the extension** (`ragents start` or `ragents workspace-client` from the npm package)
  set `RAGENTS_BASH` to the `bash.exe` of such a bundle, for example
  `<extension folder>\dist\bash\win32-x64\usr\bin\bash.exe`. Without it every `bash` call fails
  and names what is missing.
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

Windows has no process group for command termination, so RAgents ends the process tree with
`taskkill /T /F`. This is forceful and has no grace period. There is also no process table: for
runs using a Windows workspace, the process rail explains this limitation. Stopping a run still
terminates Bash process trees, while a deliberately detached service continues. Workspace tools
do not depend on the process rail.

Windows support has not yet been exercised on a physical Windows machine. It is implemented and
covered by unit tests that simulate the platform. A first real run should verify `pnpm connect`,
`read`, `edit`, `bash` output and cancellation, diagnostics, and a workspace through
`pnpm workspace-client`, and with the bundled bash `git fetch` and `git push` over HTTPS with Git
Credential Manager and over SSH.
<!-- /guide:distributed -->

## Prozess-Sandbox des Servers

Was ein Run auf dem Server startet (Bash, Befehle, Sprachserver, TypeScript-Snippets,
Actor-Programme), läuft in einer Prozess-Sandbox: es liest und schreibt nur die Ordner seines Runs,
sieht weder andere Runs noch das Home des Serverkontos und erreicht im Netz nur die Allowlist.
Regeln und Grenzen stehen in [plugins.md](spec/plugins.md) unter "Prozess-Sandbox des Servers". Auf
einem Arbeitsplatz gilt sie nicht; dort arbeitet der Run mit der Bash und den Zugangsdaten des
Entwicklers. Nur was ein solcher Run auf dem Server startet, etwa eine Bash in `@actors`, läuft in
ihr.

Voraussetzungen, die der Start prüft:

- **macOS**: nichts zusätzlich, `sandbox-exec` gehört zum System.
- **Linux**: `bubblewrap`, `socat` und `ripgrep` (Debian und Ubuntu:
  `apt-get install bubblewrap socat ripgrep`), dazu Benutzer-Namensräume. Unter Ubuntu ab 24.04
  verlangt das `sysctl -w kernel.apparmor_restrict_unprivileged_userns=0` oder ein AppArmor-Profil.
  Läuft der Server als root, braucht er `CAP_SETFCAP`; besser läuft er unter einem eigenen Konto.
- **Linux im Container**: das Standardprofil von Docker verbietet die Namensräume. Geprüft ist der
  Start mit `--security-opt seccomp=unconfined --security-opt apparmor=unconfined --security-opt
  systempaths=unconfined` (in Compose `security_opt`) und einem Benutzer ohne root im Container;
  `--privileged` geht auch, gibt aber mehr frei als nötig.
- **Windows**: keine Sandbox. Der Start bricht ab, solange die Profildatei sie nicht ausdrücklich
  abschaltet.

Die Profildatei steuert sie in der Sektion `ragents.workspace`:

```ts
"ragents.workspace": {
  PROCESS_SANDBOX: "off",                                   // bewusst ohne Sandbox, etwa unter Windows
  PROCESS_SANDBOX_NETWORK: ["registry.npmjs.org", "*.example.com"], // ersetzt die Vorgabe
},
```

Ohne `PROCESS_SANDBOX_NETWORK` gelten npm, NuGet und GitHub; die eigene Adresse des Servers ist
immer erlaubt. Ein Werkzeug, das ins Netz will, bekommt außerhalb der Liste die Antwort 403 des
Proxys. Unter macOS braucht pnpm über corepack ein `packageManager` in der `package.json` des
Arbeitsbereichs, weil corepack sonst an einem gesperrten Ordner oberhalb abbricht.

## Datenablage und Protokolle

Standardmäßig liegt jedes Profil unter `~/.local/share/ragents/<profil>`, unter Windows unter
`%LOCALAPPDATA%\ragents\<profil>`. Die Reihenfolge
ist `DATA_DIR` aus der Umgebung, `host.DATA_DIR` aus der Profildatei, dann dieser Standard.
Das gilt für `scripts/start.sh` und den direkten Serverstart. Vor dem Build beziehungsweise der
Serverinitialisierung werden vorhandene Pfadvorfahren einschließlich Symlinkzielen geprüft:
`.git`, `pnpm-workspace.yaml` und `package.json` sind dort nicht zulässig. So übernehmen
Buildwerkzeuge keine Konfiguration des RAgents-Quellbaums. Ein ausdrücklicher externer Pfad
bleibt eine gültige Einstellung. Unterhalb des Datenordners liegt neben den Laufzeitdaten
`tools/<plugin-id>/`: die Werkzeuge, die `pnpm provision` für die Plugins dieses Profils holt.

Für einen bewussten Umzug zuerst den Server und seine Run-Prozesse beenden. Den gesamten
Profilordner einschließlich Journale, Payloads, Arbeitsverzeichnisse und Pluginzustände
verschieben. Enthalten gespeicherte Runs absolute alte
Pfade, kann ein ausdrücklich angelegter Symlink vom alten zum neuen Profilordner diese
Referenzen erhalten. Der Start erstellt diesen Link nicht selbst und schreibt keine Journale
um. Die physische neue Ablage muss außerhalb eines Git-/Paketprojekts liegen.

Die Ablage eines Runs ist über wenige feste Verzeichnisse verteilt und im Journal vollständig
zugeordnet. `apps/server/src/layout.ts` besitzt die produktneutralen Run-, `sessions/`-, Archiv- und
Logpfade. Die Plugin-Ablage ist reine Konvention und nicht deklarierbar: `host.storage` liefert
global `plugins/<pluginId>/` und je Run `sessions/<runId>/plugins/<pluginId>/`.

```
${DATA_DIR}/
  runs/<runId>/journal.jsonl      kompaktes Engine-Journal v4 mit Commands und Events
  runs/<runId>/payloads/          unveränderliche große JSON-Inhalte, je SHA-256 eine Datei
  artifacts/<sha256>              unveränderliche Artefaktinhalte
  sessions/                       0711 root: durchquerbar, aber nicht auflistbar
    <runId>/                      0711 root
      chat/<agentId>/             0700 root - Agent-Sitzung je Agent (Modellkontext über Turns hinweg)
      plugins/                    0711 root - je Plugin genau ein Unterordner
        ragents.documents/
          documents/              Dateiablage des Runs (document_write), ohne DOCUMENTS_DIR
        ragents.workspace/
          workspace/              leeres Arbeitsverzeichnis bei Bindung fresh, befüllt ein Resolver-Plugin;
                                  bringt der Beitrag eine eigene Art mit, liegt sein Ordner in dessen Ablage
          server/                 nur bei Bindung an einen Arbeitsplatz und erst bei Bedarf: Ordner für
                                  typescript_eval, Actor-Programme und Aufrufe auf Wurzeln
                                  des Servers, die auf dem Server laufen
          home/                   HOME der Sandbox
      tmp/                        Temp-Ordner des Runs in der Prozess-Sandbox (TMPDIR)
  delete-intents/                 0700 root - vermerkte Löschabsichten
    <runId>.json                  0600 root - ein beim Absturz unterbrochenes Löschen wird
                                  beim nächsten Start daran erkannt und zu Ende geführt
  recovery/                       0700 root - Wiederherstellungsdaten je Run; wandern beim
                                  Löschen mit ins Archiv (heute legt noch nichts darin ab)
  archive/<runId>/                Chat, Wiederherstellungsdaten und Journal gelöschter Runs
  transfer/                       Arbeitsordner des Run-Umzugs: manifest.json während eines
                                  Exports, import/ während eines Imports; beides wird danach
                                  wieder entfernt
  plugins/<pluginId>/             globale Ablage je Plugin, soweit benötigt
  logs/server.log                 Serverlauf, HTTP-Zugriffe, Fehler, Abstürze (Rotation 32 MB x3)
```

Servergelieferte Profile (`pnpm connect`) liegen daneben unter
`~/.local/share/ragents/remote/<host>/<profil>/`: `profiles/<stand>/` je geholtem Stand und
`data/` als `DATA_DIR` des lokalen Servers mit derselben Struktur wie oben.

Ein einzelner Run wechselt den Server nicht von Hand, sondern mit `pnpm run-transfer` (siehe
"Transfer a run"). Ein Journal-Backup oder manueller Umzug umfasst immer den gesamten `runs/<runId>/`-Ordner,
also auch `payloads/`. Die einzelne JSONL-Datei reicht bei ausgelagerten Inhalten nicht.
Die Archivierung gelöschter Runs übernimmt diesen Ordner vollständig. Andere Run-Daten wie
Modellkontexte und Arbeitsdateien bleiben zusätzlich erforderlich. Journale früherer Dateiformate
werden für den betroffenen Run abgewiesen; der Server startet trotzdem. Auch beschädigte oder
unvollständige Journale und fehlende Inhaltsdateien betreffen nur ihren Run. Das Serverprotokoll
nennt Run-ID, Dateipfad und Ursache. Gesperrte Runs erscheinen nicht in der Liste nutzbarer
Runs; ein direkter Zugriff meldet den Fehler `journal-unavailable` (Status 409). Die Dateien
bleiben erhalten und werden nicht automatisch migriert, verschoben oder gelöscht. Auch ein
altes Journal des globalen Koordinators verhindert den Serverstart nicht; sein ausdrücklich
bestätigter Gesprächsreset beginnt danach wieder ein neues Gespräch. Für andere Runs kann eine
bewusste Reparatur mit anschließendem Neustart die vorhandene Ablage wieder nutzbar machen.
Ein frischer gesamter Datenbestand ist nicht erforderlich.

Es gibt keine automatischen Migrationen und keine Suche nach alten Datenpfaden. Bestehende
Bestände werden nur auf ausdrücklichen Auftrag bei gestopptem Server umgezogen; der Server
zieht nichts selbst um und löscht keinen alten Bestand.

Lesen: `tail -200 ${DATA_DIR}/logs/server.log`, `ls ${DATA_DIR}/sessions/<id>/chat/`.

Die Rechte sind so gesetzt, dass ein Run sein eigenes Arbeitsverzeichnis erreicht, aber weder
die Nachbar-Runs auflisten noch deren Chat und Plugin-Protokolle lesen kann. Die
Plugin-Protokolle überleben einen Stopp; ein Plugin-Log wird pro Start mit einer
`=== Start: ... ===`-Zeile fortgeschrieben statt überschrieben. In den Log kommen nur
Pfade, nie Query-Strings, damit kein Zugangstoken auf Platte landet.

Die Run-ID verbindet diese Verzeichnisse.

## Isolation je Run

Jeder Run arbeitet in seinem eigenen Arbeitsverzeichnis und seiner eigenen Dateiablage.
Welcher Ordner das ist, legt die Startoption "Arbeitsbereich" beim Start mit zwei Angaben fest:
"Rechner" ist der Server oder ein verbundener Arbeitsplatz (etwa die VS-Code-Erweiterung), "Ordner"
ein neuer je Run oder ein vorhandener, dessen absoluten Pfad Du eingibst oder aus den angebotenen
Ordnern des Arbeitsplatzes übernimmst. Der neue Ordner liegt auf dem Server unter den Laufzeitdaten,
auf einem Arbeitsplatz in dessen Datenordner unter `workspace/runs/<run-id>` (unter macOS und Linux
`~/.local/share/ragents`); ein Profil kann ihn durch einen eigenen ersetzen, etwa einen Worktree je
Run, und bietet ihn dann nur dort an, wo es ihn stellen kann. Ein vorhandener Ordner wird beim
Löschen des Runs nie angefasst, ein neuer verschwindet mit ihm; ist der Arbeitsplatz beim Löschen
nicht verbunden, bleibt sein Ordner liegen. Bei einem Arbeitsplatz läuft alles, was den Ordner anfasst, dort,
wo er liegt: Werkzeuge, Sprachserver, der Reiter Dateien, die Prozessleiste und der Browser der
Browserprüfung. Die Wurzeln des Servers, `@actors` der Actor-Programme und `@skills/<name>` der
Skills, erreichen Dateiwerkzeuge und Sprachserver auch dann über ihren Alias, und eine Bash mit
einem solchen Alias als `cwd` läuft auf dem Server in der Prozess-Sandbox des Runs.
Pfadprüfung, Eigentum eines Arbeitsplatzes, Anmeldung über das Netz und die
Fehler bei getrennter Verbindung stehen in [plugins.md](spec/plugins.md) unter "Arbeitsbereich,
Sandbox-Werkzeuge und Prozesse".

Ohne VS Code meldet `pnpm workspace-client <server-url> [ordner ...]` denselben Arbeitsplatz von
der Kommandozeile an; `RAGENTS_TOKEN` setzt den persönlichen Token, wenn der Server eine Anmeldung
verlangt. Der Arbeitsplatz liest seine Sprachserver und seinen Browser aus seiner eigenen
Prozessumgebung, nicht aus dem Profil des Servers: der Start ruft `pnpm provision --workspace`,
legt Roslyn und fsautocomplete unter `~/.local/share/ragents/workspace/tools/<plugin-id>/` ab und
holt Chromium in den Browsercache von Playwright; TypeScript und `playwright-core` kommen aus dem
Host-Ordner. `ROSLYN_LANGUAGE_SERVER`, `FSHARP_LANGUAGE_SERVER` und `BROWSER_EXECUTABLE_PATH`
übersteuern das. Die VS-Code-Erweiterung provisioniert dasselbe beim Start und schreibt den Bericht
in ihren Ausgabekanal `RAgents`. `HOME` bleibt das Home des Entwicklers, damit Git, SSH und NuGet mit seinen Zugangsdaten
arbeiten; Sprachserver-Protokolle landen unter `os.tmpdir()`. Jeder Werkzeugaufruf des Modells
erscheint als eine Zeile auf stdout (Run-Kennung, Werkzeug, Dauer, `ok` oder Fehlertext); die
VS-Code-Erweiterung schreibt dieselbe Zeile in ihren Ausgabekanal `RAgents`. Abfragen der
Oberfläche, etwa der Reiter Dateien oder die Prozessleiste im Zwei-Sekunden-Takt, erscheinen dort
nicht.
