# @schlenkr/ragents

RAgents is a web workshop for AI agents: you chat with a coordinator that starts further agents and
equips actors with TypeScript functions and their own views. Everything that happens goes into an
append-only journal, and the state of a run is always rebuilt by replaying that journal.

This package is the RAgents host - server, engine, plugins and the scripts behind the subcommands -
so the host runs without a source checkout. Installing it gives you one command, `ragents`.

## Install

```sh
npm install -g @schlenkr/ragents
```

## Commands

- `connect <server-url>` - fetch the client profile of a RAgents server together with the plugin
  bundles it names and start the local server with it; the models come over the server's relay.
  The local host needs the same host API as the server; nothing is built or installed.

  ```sh
  RAGENTS_TOKEN=<token> ragents connect https://ragents.example.com
  ```

- `start <profile|path>` - start a profile shipped with the package (`core`, `developer`,
  `showcase`), your own `ragents.config.<name>.ts` anywhere on disk, or a stand that `connect`
  already fetched, without asking the server. The web interface comes finished with the package,
  the same for every profile; the web halves of the plugins load from their bundles.

  ```sh
  ragents start developer
  ragents start ~/projects/mine/ragents.config.mine.ts
  ```

- `provision [<profile>|--workspace]` - fetch the tools the plugins of that profile need, such as
  the language servers; a second call downloads nothing.

  ```sh
  ragents provision developer
  ```

- `workspace-client <server-url> [folder ...]` - register this machine and its folders as a
  workspace for a server, so a run on that server works in these folders.

  ```sh
  ragents workspace-client https://ragents.example.com ~/projects/demo
  ```

- `plugin build <folder...>` - build your own plugin sources into bundles, with type checks
  against the host API; the result goes to `./dist/plugins/<id>`, and a profile names that folder.
  `--out <folder>` changes the target, `--watch` rebuilds on every change.

  ```sh
  ragents plugin build ./acme.tickets
  ```

- `run <folder> "<task>"` - start the host if none answers, bind a new run to the folder and wait
  until the turn is finished; the last line is always `run: <id>`. This host serves no web
  interface - an agent does not need one; use `start` for that.

  ```sh
  ragents run ~/projects/demo "Fix the type error in src/broken.ts"
  ```

- `send <run> "<text>"` - continue in the same run and wait the same way.

  ```sh
  ragents send 7f3c1e64-9a2b-4d11-8c30-1f5e9a77c001 "Now add a test for it"
  ```

- `journal <run> [--tools]` - read the history of a run without a server; `--tools` shows the tool
  calls instead of the conversation.

  ```sh
  ragents journal 7f3c1e64-9a2b-4d11-8c30-1f5e9a77c001 --tools
  ```

- `stop <run>` - cancel the running turn, `stop --host` stops the remembered host process.

  ```sh
  ragents stop 7f3c1e64-9a2b-4d11-8c30-1f5e9a77c001
  ```

## Requirements

- Node 22 (>= 22.19.0). No git, no pnpm, no source checkout; the package carries its finished web
  interface, the same for every profile, and loads the web halves of plugins from their bundles.
- `dotnet` (.NET 10 SDK) for the C# diagnostics through Roslyn and the F# diagnostics through FSAC;
  without it TypeScript diagnostics still work.
- Model access: either `OPENROUTER_API_KEY` in the environment, or `ragents connect <server-url>`
  against a RAgents server that relays the models.

## Documentation

The specification, the usage and operations guides, the profile and plugin reference and the
homepage live in the repository: https://github.com/SchlenkR/RAgents

## License

Licensed under the PolyForm Shield License 1.0.0: use, including commercial use, is permitted;
offering it as a competing product or service is not. See LICENSE.
