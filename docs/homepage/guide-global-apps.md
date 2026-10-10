# Global mini-apps

Ask an agent to build an app beside the global coordinator, verify it, and enable interval, daily, weekday, or file triggers with explicit permissions.

## Global mini-apps on Start

Ask the global coordinator to build a mini-app for the Start dashboard. The agent writes a
small TypeScript backend with persistent state, an optional React view, and the permissions
it needs. It verifies the app before enabling automatic execution. Normal run agents can do
the same with `ragents.global-apps`, included in `core`, `showcase`, and `developer`. Execution
runs on the server without an open chat or a connected workstation. Only explicitly requested
capabilities such as coordinator notifications can start further model work.

Apps live in separate rooms beside the coordinator's `main` room in your hidden global run.
They use the same actor packages, persistent state, and views as mini-apps in normal runs.
"Reset conversation" starts a fresh coordinator conversation and keeps the apps and their
state, logs, and schedules.

Each app appears as its own Start widget. In Start's edit mode you move it, resize it, or remove it
like any other widget; "Add widget" lists a removed app with its description and brings it back.
Removing the widget leaves its backend triggers running. Apps with views start wide and headless
apps start narrow; your layout overrides these defaults.
A view displays the app's state and calls its functions; a headless app shows last run and next
run. Every widget shows its last output or result, including apps with views. A view can have
several pages selected within the same widget. "Run now" starts a backend input even while automatic
execution is paused. "Pause" stops new automatic inputs; "Resume" enables the configured
triggers. Accepted work can finish, and an app never overlaps itself.

"Open details" shows the app's triggers, explicit permissions, persistent state, and recent
log and offers "Remove". Details name active process protection, explicitly disabled protection,
or a package that has not yet activated. Permissions name server folders for reading or writing,
HTTP hosts, and RAgents functions. An empty `permissions` object grants no external access.
Apps belong to the registering user; another user's apps do not appear in these widgets.
Read-only access omits the app-management controls.

An app may be manual only or combine intervals, daily times, selected weekdays, and server file
changes. Intervals use fixed delay from the end of an input. Daily and weekly schedules use a
local `HH:MM` in an IANA time zone; omitting the zone chooses and stores the server's zone at
registration. A spring daylight-saving transition skips a local time that does not exist, and
an autumn transition uses the first occurrence of a repeated time. Restart runs one overdue
occurrence and continues with future deadlines. File changes coalesce while the app is busy
and are observed only while its triggers are enabled. A failure stays visible in the affected
widget, with "Retry" and "Open details"; other apps remain usable. Successful inputs commit
domain state, while completed external file writes or HTTP calls cannot be rolled back by a
later failure.

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

For a daily date recorder, the agent creates `daily-date` with the `headless` template and writes
this complete `src/server.ts` in the returned `directory`, including any room prefix:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ date: Type.Optional(Type.String()) }),
  functions: {},
  input: { capabilities: ["global_app_trigger"] },
}, {
  functions: {},
  onInput: async (_input, context) => {
    const trigger = await context.functions.global_app_trigger({});
    const date = new Intl.DateTimeFormat("en-CA", {
      timeZone: trigger.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).format(new Date(trigger.scheduledAt));
    context.log(`Date ${date} (${trigger.reason})`);
    context.state.replace({ date });
  },
});
```

The agent writes `tests/program.test.ts` with an explicit trigger mock:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

test("records the occurrence's date in its time zone", async () => {
  const context = createTestContext<{ readonly date?: string }>({
    state: { date: "2026-10-09" },
    functions: {
      global_app_trigger: () => ({
        key: "daily:1",
        scheduledAt: "2026-10-09T22:30:00.000Z",
        timeZone: "Europe/Berlin",
        reason: "daily",
      }),
    },
  });
  await program.onInput!({
    id: "date",
    content: "Record the date",
    artifactIds: [],
    sourceEventIds: [],
    subscriptionId: null,
    event: null,
  }, context);
  assert.deepEqual(context.state.read(), { date: "2026-10-10" });
});
```

It registers the copied package and starts manual verification:

```ts
await context.functions.global_app_register({
  name: "daily-date",
  description: "Record the local date every morning.",
  program: "daily-date",
  triggers: { daily: { at: "08:00" } },
  permissions: {},
});
await context.functions.global_app_run({ name: "daily-date" });
```

`global_app_run` returns when the input is accepted. A later
`global_app_read({ name: "daily-date" })` shows its outcome, stored date, and date log line. The
backend formats the occurrence in `global_app_trigger.timeZone`. Daily and weekly inputs carry
their stored schedule zone; other inputs carry the server's Intl zone at acceptance. If it
failed, the agent fixes the sources, registers again, and repeats verification.
`global_app_pause({ name: "daily-date", paused: false })` then enables
the daily schedule. Omitting `triggers` makes the same app manual only.

For selected weekdays, use `triggers.weekly: { at: "08:00", days: ["mon", "wed", "fri"],
timeZone: "Europe/Berlin" }`; days must be unique and the list must not be empty. A daily
schedule also accepts `timeZone`. `triggers.interval: { everySeconds: 300 }` adds a fixed-delay
interval; `triggers.fileChange.folders` adds watched folders covered by the file permissions.

For a widget with a view, the agent adds a normal React client and view metadata to the same
package, as described in [Build mini-apps](guide-programs.html). `useAppState()` reads
its shared actor state, and the view calls declared backend functions through the normal app
API. View actions can use registered operator operations permitted to the app actor; they do
not inherit the run owner's broader grants. Functions without external capabilities may be
published as tools. Another actor calling a capability-bearing tool receives "Trigger its input
instead." Start's "Run now" invokes the input handler, which can use the app's explicitly
permitted run functions.

An app that needs files or HTTP declares `global_app_file_read`, `global_app_file_write`, or
`global_app_http_request` in the input `capabilities` and requests only
the necessary folders, exact hosts, and additional function names in `permissions`. Registration rejects access the
user or agent cannot grant. A host without a port permits only default HTTP/HTTPS ports;
an explicit port permits only that effective request port, including 80 and 443.
`permissions.functions` excludes all `global_app_*` names and `read`, `write`, `edit`, `bash`,
`typescript_eval`, `agent_spawn`, `actor_program_activate`, `actor_program_import`, `actor_program_ensure`, and
`plugin_state_write`. These capabilities are checked on the server; when process protection is
explicitly disabled, direct Node file and network access remains unrestricted.

To notify the global coordinator, the agent explicitly grants
`permissions.functions: ["overseer_notify"]` and declares `overseer_notify` in the backend's
input capabilities. This helper delivers a short message to the current coordinator
through ordinary actor input and may cause a model response. It requires the user's `ragents.overseer.write`
and the agent's usable, delegable `actor.input`; an app without that grant cannot notify it.
