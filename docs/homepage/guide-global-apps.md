# Global mini-apps

Ask an agent to build a mini-app in your global space, with its own triggers and explicit permissions, and verify it with a manual run.

## Global mini-apps on Start

Ask the global coordinator to build a mini-app for the Start dashboard. The agent writes a
small TypeScript backend with persistent state, an optional React view, the triggers that start
it, and the permissions it needs, and verifies it with a manual run. A global app is an ordinary
mini-app that lives in your global space: its triggers and permissions work exactly as in a run,
and it keeps running on the server without an open chat or a connected workstation. Normal run
agents can publish a package of their run the same way with `ragents.global-apps`, included in
`core`, `showcase`, and `developer`. Only explicitly declared functions such as coordinator
notifications can start further model work.

Apps live in separate rooms beside the coordinator's `main` room in your hidden global run.
"Reset conversation" starts a fresh coordinator conversation and keeps the apps and their
state, logs, and triggers.

Each app appears as its own Start widget, and "Show app..." in any of your runs shows it there as a
read-only window. In Start's edit mode you move it, resize it, or remove it like any other widget; "Add widget" lists a removed app with its description and brings it back.
Removing the widget leaves its triggers running. Apps with views start four columns wide
and headless apps two; your layout overrides these defaults.
A view displays the app's state and calls its functions; a headless app shows last run and next
run. Every widget shows its last output or result, including apps with views. A view can have
several pages selected within the same widget. "Run now" starts a manual trigger even while the
triggers are paused. "Pause" stops new automatic inputs; "Resume" enables the triggers again.
Accepted work can finish, and an app never overlaps itself.

"Open details" shows the app's triggers, permissions, process protection, persistent state, and
recent log and offers "Remove". Permissions name server folders for reading or writing and HTTP
hosts; an app without them gets no external access. Apps belong to the creating user; another
user's apps do not appear in these widgets. Read-only access omits the app-management controls.
A damaged app or one whose program is no longer active stays visible as its own widget with
"Retry" and "Remove"; other apps remain usable.

An app may be manual only or combine intervals, daily times, selected weekdays, and server file
changes, as described for every mini-app under [Triggers](guide-programs.html#triggers). Restart
runs one overdue occurrence and continues with future times. Failures delay the next automatic run,
and "Resume" clears that delay. Successful inputs commit domain state, while completed external
file writes or HTTP calls cannot be rolled back by a later failure.

An app that waits, such as a daily draft that waits for your approval, is a
[state-aware program](guide-programs.html#state-aware-programs). Its widget shows the next
wake as next run, and its view offers the answer while the program waits for it, for example
"Approve" and "Reject"; an answer while nothing waits is refused. Every completed step runs only
once, also across restarts. If a changed app no longer fits what it recorded, its widget shows it
blocked with the position and cause; the agent restores the code or creates the app under a new
name.

## Let an agent write and verify an app

The global coordinator has package, file/edit, TypeScript, `global_app_*`, and the trigger tools
`actor_program_trigger`, `actor_program_pause`, and `actor_program_status` in its own run, and reads
the authoring guide with `actor_program_controls`. `run_list` gives it, and every app that declares
it, your runs as the run list shows them, with title, status, and last activity, so "a mini-app
that always shows my latest run" is an app with an interval trigger. It calls
`actor_program_create`, writes the package sources through the normal file tools, and calls
`global_app_create`, which copies the package into the app's room, checks types, builds the
backend and any views, runs package tests, and activates it with its triggers. Errors name the
locations to fix; the same name replaces the package and keeps the app's state.

For a daily date recorder, the agent creates `daily-date` with the `headless` template, adds
`"triggers": { "daily": { "at": "08:00" } }` to the `ragents` section of its `package.json`, and
writes this complete `src/server.ts` in the returned `directory`, including any room prefix:

```ts
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ date: Type.Optional(Type.String()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: async (input, context) => {
    const trigger = input.trigger;
    if (!trigger) return;
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

The agent writes `tests/program.test.ts` with an explicit trigger input:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

test("records the occurrence's date in its time zone", async () => {
  const context = createTestContext<{ readonly date?: string }>({ state: { date: "2026-10-09" } });
  await program.onInput!({
    id: "date",
    content: "Trigger: daily.",
    artifactIds: [],
    sourceEventIds: [],
    subscriptionId: null,
    event: null,
    trigger: { reason: "daily", key: "daily:1", scheduledAt: "2026-10-09T22:30:00.000Z", timeZone: "Europe/Berlin" },
  }, context);
  assert.deepEqual(context.state.read(), { date: "2026-10-10" });
});
```

It creates the app and verifies it with a manual trigger:

```ts
const { program } = await context.functions.global_app_create({ name: "daily-date", program: "daily-date" });
await context.functions.actor_program_trigger({ name: program });
```

`actor_program_trigger` returns when the input is queued. A later
`actor_program_status({ name: "daily-date.daily-date" })` shows its outcome, stored date, and date
log line. If it failed, the agent fixes the sources, creates the app again with the same name, and
repeats the verification. The daily trigger is active from creation on; `actor_program_pause`
pauses and resumes it, and `global_app_list` and `global_app_remove` find and remove apps by name.

An app that needs files or HTTP names the folders and exact hosts under `ragents.permissions` and
declares `program_file_read`, `program_file_write`, or `program_http_request` in its capabilities.
Creation rejects access the user or agent cannot grant, and an app cannot declare file, shell,
TypeScript evaluation, or package tools. A host without a port permits only default HTTP/HTTPS
ports; an explicit port permits only that effective request port, including 80 and 443. These
permissions are checked on the server; when process protection is explicitly disabled, direct
Node file and network access remains unrestricted.

To notify the global coordinator, the agent declares `overseer_notify` in the backend's input
capabilities. This function delivers a short message to the current coordinator through ordinary
actor input and may cause a model response. It requires the user's `ragents.overseer.write` and
the agent's usable, delegable `actor.input`; an app without that grant cannot be created with it.
