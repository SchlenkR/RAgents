# Assign permissions

Distinguish user permissions, actor grants, and the capabilities given to a subagent.

## Sign-in and permissions

User permissions control a person's access to the application. An actor's function selection
and technical grants control execution inside a run. Profiles provide plugins; user permissions
do not create additional plugins or functions.

A profile can export `users` as `readonly ProfileUser[]`. Each user has an ID, label, password,
and exact permission strings. Passwords can be non-empty values or `env(...)` references. When
the export is absent, the profile runs without sign-in. An empty list, duplicate IDs, invalid
permissions, or missing required password variables prevent startup.

```ts
import { env, type ProfileUser } from "./apps/server/src/config-definition.js";

export const users = [{
  id: "reader",
  label: "Read-only access",
  password: env("RAGENTS_READER_PASSWORD"),
  rights: ["runs.read", "ragents.overseer.read"],
}] as const satisfies readonly ProfileUser[];
```

A user can also have a personal token through `token: env("RAGENTS_TOKEN")`. It acts as a bearer
token with the same identity and permissions as that user, but has no session expiry. It is
intended for clients without a sign-in dialog. The server stores only its SHA-256 hash. Removing
the token from the profile and restarting the server revokes it.

Permission names are exact strings; `*` grants all permissions. Without `users` or
`anonymousUser`, access is unrestricted. An optional `anonymousUser` applies the same permissions
and allowed templates without a password. It cannot be combined with `users`. With sign-in
enabled and no valid session, all permissions are denied.

## Run ownership

A run belongs to the user who created it. Users normally see and operate only their own runs;
`runs.read.all` adds visibility across owners. Ownership is recorded once in the journal and is
never rewritten. Runs created without authentication have no owner and are visible only with
`runs.read.all` when authentication is later enabled.

The server enforces ownership on lists, methods, event channels, and file routes before opening a
run. An inaccessible run responds like a missing one. Each signed-in user has a global coordinator
of their own, reachable by nobody else, not even with `runs.read.all`; its tools act with that
user's access and rights, and runs it creates belong to that user. Without sign-in there is exactly
one coordinator. A start option can additionally mark a run
as `ownerOnly`, as the workspace binding does for tools running on the owner's machine. Other
users with visibility may still read its journal and stop it, but only its owner can send messages,
answer actions, restart actors, or invoke operations requiring `runs.write`. Its workspace is the
owner's alone even for reading: the workspace files in the Dateien tab, the process rail, and
language-server state are refused to everyone else, including `runs.read.all`
(`run-workspace-owner-only`). The run list asks nothing from such a
workspace on their behalf, and web and VS Code hide what needs it; the Dateien tab then shows only
the server's file store.

Only a signed-in user of a profile with `users` can register a workstation over the network. A
server without users (open, `ACCESS_TOKEN`, or `anonymousUser`) has one owner for every client, so it
accepts a workstation only over a loopback connection and otherwise refuses with
`workspace-client-login-required`. The VS Code extension then does not register and shows the reason
on the server.

`runs.write` permits messages and app actions in existing owned runs. Free-form runs,
preparation chats, and start options additionally require `runs.create`. Without it, a user can
start only explicitly allowed run scripts. `runs.inspect` protects models, journals, source code,
tools, and general technical views. Language-server views use their own plugin read permission.
`runs.trace` separately reveals reasoning and function-call content in chat. Without it, those
phases appear only as empty progress markers while arguments, source, results, and reasoning are
removed on the server.

## Function selection and actor grants

An engine capability is a technical permission such as `workspace.use`. A grant assigns it to
an actor for the run or a workspace path and records whether the actor may use or delegate it.
User permissions such as `runs.write` instead control access to application routes.

The `tools` value on spawn selects the actor's function API: `[]` for a plain LLM, a list of
names for an exact selection, or `null` for the dynamic full set. The selection is not inherited
from the coordinator. Delegable engine capabilities are inherited as grants and can be reduced
with `withoutCapabilities`. Prompt instructions describe a role but grant no technical access.
Actor programs also declare required functions under `capabilities`; this limits calls but does
not supply missing grants. The [runtime guide](guide-runtime.html#equipping-subagents)
shows selections for conversation and coding agents.
