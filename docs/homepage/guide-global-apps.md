# Global mini-apps

Ask an agent to build a persistent backend and optional Start view, verify it, and enable interval or file triggers with explicit permissions.

## Global mini-apps on Start

Ask the global coordinator to build a mini-app for the Start dashboard. The agent writes a
small TypeScript backend with persistent state, an optional React view, and the permissions
it needs. It verifies the app before enabling automatic execution. Normal run agents can do
the same with `ragents.global-apps`, included in `core`, `showcase`, and `developer`. Execution
runs on the server without further model calls, an open chat, or a connected workstation.

Each app appears as its own Start widget. Its "..." menu changes size and order or hides it;
"Customize" can show it again. Hiding the widget leaves its backend triggers running. Apps with
views start wide and headless apps start narrow; your arrangement overrides these defaults.
A view displays the app's state and calls its state
functions; a headless app shows last run, next run, and last result. A view can have several
pages selected within the same widget. "Run now" starts a backend input even while automatic
execution is paused. "Pause" stops new automatic inputs; "Resume" enables the configured
triggers. Accepted work can finish, and an app never overlaps itself.

"Open details" shows the app's triggers, explicit permissions, persistent state, and recent
log and offers "Remove". Details name active process protection, explicitly disabled protection,
or a package that has not yet activated. Permissions name server folders for reading or writing,
HTTP hosts, and RAgents functions. An empty `permissions` object grants no external access.
Apps belong to the registering user; another user's apps do not appear in these widgets.
Read-only access omits the app-management controls.

An app may be manual only, use an interval, watch server folders, or combine interval and file
triggers. Intervals use fixed delay from the end of an input, with one overdue occurrence after
a restart. File changes coalesce while the app is busy and are observed only while its triggers
are enabled. A failure stays visible in the affected widget, with "Retry" and "Open details";
other apps remain usable. Successful inputs commit domain state, while completed external
file writes or HTTP calls cannot be rolled back by a later failure.

## Let an agent write and verify an app

The global coordinator has package, file/edit, TypeScript, and `global_app_*` tools in its own
run, just like a normal run agent. It calls `actor_program_create`, writes the package sources
through the normal file tools, and uses `global_app_register`. Registration copies, checks
types, builds the backend and any views, and runs package tests. Errors name the locations
to fix. Editing the source package afterwards requires registration again.

New and replaced apps are paused. The agent calls `global_app_run`, then `global_app_read`
after the input finishes to inspect the outcome, state, and log. If necessary it fixes the
source and registers the paused, idle app again. It resumes a verified app with
`global_app_pause({ name, paused: false })`. `global_app_list` discovers apps;
`global_app_remove` stops and removes one without discarding journal history.

For a headless counter, the agent creates `checks` with the `headless` template and writes
this complete `src/server.ts` in the returned `directory`, including any room prefix:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ checks: Type.Optional(Type.Integer({ minimum: 0 })) }),
  functions: {},
  input: { capabilities: ["global_app_trigger"] },
}, {
  functions: {},
  onInput: async (_input, context) => {
    const trigger = await context.functions.global_app_trigger({});
    const checks = (context.state.read().checks ?? 0) + 1;
    context.log(`Check ${checks} (${trigger.reason})`);
    context.state.replace({ checks });
  },
});
```

The agent writes `tests/program.test.ts` with an explicit trigger mock:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

test("retains the number of successful checks", async () => {
  const context = createTestContext<{ checks?: number }>({
    state: { checks: 2 },
    functions: {
      global_app_trigger: () => ({
        key: "manual:1",
        scheduledAt: "2026-10-09T10:00:00.000Z",
        reason: "manual",
      }),
    },
  });
  await program.onInput!({
    id: "check",
    content: "Check",
    artifactIds: [],
    sourceEventIds: [],
    subscriptionId: null,
    event: null,
  }, context);
  assert.deepEqual(context.state.read(), { checks: 3 });
});
```

It registers the copied package and starts manual verification:

```ts
await context.functions.global_app_register({
  name: "checks",
  description: "Count checks every five minutes.",
  program: "checks",
  triggers: { interval: { everySeconds: 300 } },
  permissions: {},
});
await context.functions.global_app_run({ name: "checks" });
```

`global_app_run` returns when the input is accepted. A later
`global_app_read({ name: "checks" })` shows its outcome, `{ checks: 1 }`, and "Check 1 (manual)"
in the log. If it failed, the agent fixes the sources, registers again, and repeats verification.
`global_app_pause({ name: "checks", paused: false })` then enables the interval. Omitting
`triggers` makes the same app manual only; `triggers.fileChange.folders` adds watched folders
covered by its file permissions.

For a widget with a view, the agent adds a normal React client and view metadata to the same
package, as described in [Build mini-apps](guide-programs.html). `useAppState()` reads
its shared actor state, and the view calls declared backend state functions. Those functions
publish no actor tools and request no external capabilities. External access belongs in the
input handler, which Start's "Run now" invokes with the app's explicit permissions.

An app that needs files or HTTP declares `global_app_file_read`, `global_app_file_write`, or
`global_app_http_request` in `input.capabilities` and requests only the necessary folders,
exact hosts, and additional function names in `permissions`. Registration rejects access the
user or agent cannot grant. A host without a port permits only default HTTP/HTTPS ports;
an explicit port permits only that effective request port, including 80 and 443.
`permissions.functions` excludes all `global_app_*` names and `bash`, `typescript_eval`,
`agent_spawn`, `actor_program_activate`, `actor_program_import`, `actor_program_ensure`, and
`plugin_state_write`. These capabilities are checked on the server; when process protection is
explicitly disabled, direct Node file and network access remains unrestricted.
