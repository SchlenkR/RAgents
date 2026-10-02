# RAgents for VS Code

Build and run programmable AI workspaces without leaving your editor.

RAgents combines AI agents, deterministic TypeScript workflows, and interactive mini-apps in a
shared workspace. Agents can work independently or in parallel, hand results to one another, and
use the same data and functions as the UI. Every run is recorded in an append-only journal, so its
state remains inspectable and can be reconstructed after a restart.

[Website](https://schlenkr.github.io/RAgents/) | [Marketplace](https://marketplace.visualstudio.com/items?itemName=purestate.ragents-vscode) | [Guide](https://schlenkr.github.io/RAgents/guide.html) | [Plugin guide](https://schlenkr.github.io/RAgents/guide-plugins.html)

![RAgents overview with multiple runs and reusable setups](https://raw.githubusercontent.com/SchlenkR/RAgents/main/apps/vscode/media/screenshots/overview.png)

## Highlights

- Work with several RAgents servers and local profiles at the same time.
- Watch agents talk to agents, start helpers, and hand results to one another.
- Use four focused pages: start, runs, run panel, and servers.
- Chat and work with mini-apps in the secondary sidebar or an editor tab.
- Let a run read, edit, and execute code in the current VS Code workspace.
- Start a prepared setup with one click.

## Getting started

Open the RAgents panel in the secondary sidebar. Select **Server**, then
**New server**, and add a server or local profile.

```json
{
  "ragents.connections": [
    { "name": "Workshop", "url": "https://workshop.example.com" },
    { "name": "Local", "profileFile": "/path/to/ragents.config.core.ts" }
  ]
}
```

Servers connect automatically. Local profiles are started in the background. Credentials are
stored in VS Code's SecretStorage. One unavailable server does not block the others.

## Inside the extension

**Start** shows your servers, recent runs, and every available template. **Runs** adds search,
filtering, and batch deletion. **Server** manages connections, profiles, and sign-in.

The **run panel** keeps the chat visible and opens tabs in the tab bar beside it for files, documents,
functions, executions, and diagnostics. The open tab and its height are remembered per run.

![A run with its chat, mini-app, and tab bar](https://raw.githubusercontent.com/SchlenkR/RAgents/main/apps/vscode/media/screenshots/run-with-explorer.png)

## Local workspaces

When a folder is open, the extension registers the current VS Code window as a RAgents workspace.
Runs can use its file, shell, and language-server tools, restricted to the folders offered by the
window.

Node.js 22 and npm are required. A source checkout also requires Git, pnpm, and installed
dependencies. The extension builds for Windows, macOS, and Linux bring ripgrep (`rg`) for fast
code search. Windows is implemented but has only been tested with unit tests that
simulate the platform; the Windows build of the extension brings its own bash with the GNU tools
and uses your own Git.

Source, documentation, and issue tracking are in this repository. The host is also published as
[`@schlenkr/ragents`](https://www.npmjs.com/package/@schlenkr/ragents).

## Standalone host

[GitHub Releases](https://github.com/SchlenkR/RAgents/releases) offers Windows, macOS, and Linux
archives with Node.js included, for x64 and ARM64. The installer installs for the current user by
default, without administrator access, or for all users of the machine.

macOS or Linux, for the current user in `~/.local`:

```sh
curl -fsSL https://github.com/SchlenkR/RAgents/releases/latest/download/install.sh | sh
```

For all users in `/usr/local` (uses sudo if that folder is not writable):

```sh
curl -fsSL https://github.com/SchlenkR/RAgents/releases/latest/download/install.sh | sh -s -- --global
```

Windows PowerShell, for the current user in `%LOCALAPPDATA%\Programs\RAgents`:

```powershell
& ([scriptblock]::Create((irm https://github.com/SchlenkR/RAgents/releases/latest/download/install.ps1)))
```

For all users in `%ProgramFiles%\RAgents`, add `-Global` and run it in a PowerShell started as
administrator.

`~/.local/bin` is often not on the `PATH`, on macOS by default; the installer then prints the line
to add for your shell. Run the same command again to update, add `--uninstall` or `-Uninstall` to
remove RAgents, and check the active version with `ragents --version`.

First start: set `OPENROUTER_API_KEY` in your environment and run `ragents start core`; the
interface opens at `http://localhost:4710`. The C# and F# diagnostics of `core` need the .NET 10
SDK; without `dotnet` the start stops with `Provisioning ended with code 1`. The
[installation guide](https://schlenkr.github.io/RAgents/guide-getting-started.html#install-a-standalone-release)
covers options, updates, uninstalling, and the first start.

License: [PolyForm Shield 1.0.0](https://github.com/SchlenkR/RAgents/blob/main/LICENSE).
