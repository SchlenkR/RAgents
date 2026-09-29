# @ragents/host

The Node backend. Finds the plugins at runtime and composes the profile from them.

- The plugins themselves live at the repo root under `plugins/<id>/server/`; a profile can
  additionally name plugins by path. `profile/` finds them and puts them together.
- `plugin-support/` holds the building blocks a plugin gets from the host: sandbox tools,
  language server, prompts, model choice.
- `ragents/` wires the engine to the server: runs, journal projection,
  host services.
- The plugins declare the configuration keys themselves; `config-definition.ts` only provides
  the file type, the values live in `ragents.config.<profile>.ts` in the root directory.

Start locally: `scripts/start.sh <profile>`. Tests: `PRODUCT_PROFILE=core pnpm test`.
