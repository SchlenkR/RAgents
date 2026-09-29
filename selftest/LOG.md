# Self-test log

Logs before 20.09.2026 describe the old file storage via `$RAGENTS_FILES_DIR`;
this variable no longer exists, today only the tool `document_write` leads into the
storage (`docs/decisions.md`, 20.09.2026).

## General builder limits and tool contracts, 12.09.2026

After the failed balcony test, general platform limits were checked. No
domain flows or new wizard templates; no further repair of individual test runs.

- The real scheduler does not offer the run builder the four direct structural tools
  and also rejects opening them later. Native program activation allows
  it a TypeScript program with onInput, but no direct participant view.
- Builder and domain prompts stay correctly assigned on primary switch, fork, and journal
  replay. Script actors keep their setup tools.
- agent_spawn requires tools explicitly; a missing or unknown selection creates no
  actor. An explicit null supports dynamic actor functions activated afterwards.
- Canvas and visibility resolve the same package and actor references. Stopped views
  disappear with their lines; views that are actually unknown remain errors.
- 279 engine tests, 330 server tests, 278 web tests, and 44 homepage tests passed.
  Three optional language server live tests were skipped. Typechecks, lint,
  homepage generation, and web build are green. Server HTTP tests needed an approved run
  outside the sandbox because of sandbox port restrictions.
- The stored default thinking depth of the core run coordinator was set to high via the settings API;
  relay and default profile kept their selection. Source defaults are high.

The code changes require a server restart. A new unchanged model test run
is still pending; these regressions are no evidence that a model solves every task correctly.
The earlier test report had not checked the state after stopping: there the
apps disappeared while their explicit canvas references produced error slots. This lifecycle error
is now covered by its own regression.

## Balcony wizard with a real model, 12.09.2026

Checked after the expressly permitted core restart against port 3000 with
a production web build and an isolated headless Chrome. Real model run, no simulated
answers. Run `85530558-c195-47bd-b1b1-644779a2f1d6`, title
"Self-test balcony wizard 12.09.2026" (run 7). The start task is unchanged the text of the
corrected balcony prompt card. Result: failed, already before the first user answer.

- The coordinator prompt actually loaded contains the tightened TypeScript setup rule.
  GLM 5.3 Flash with thinking depth low ignores it anyway: direct `agent_spawn` in sequence 46,
  direct activation in sequence 89, direct canvas calls from sequence 92. Only
  `balcony-wizard` with a React view is created, no setup handler. The setup takes about 3 minutes 51 seconds,
  42 tool calls, and six failed calls. Several faulty source drafts
  are corrected along the way; the activation finally passes the type and build check.
- The advisor is created with a valid model profile. The earlier problem of the missing
  model does not occur here. Its tool selection stays `null`, however, so it inherits the
  general selection. Its domain prompt asks for next questions as text; the description of the
  available tool `ask_user`, on the other hand, requires a tool call for user decisions.
  The unbound prompt contribution `ask.hbs` is not automatically delivered to the secondary actor.
- The canvas check rejects an unknown group, the wrong view reference, and a line
  to the human owner before saving. The coordinator corrects the calls;
  at the end `app:@balcony-advisor/main` is placed as a real app. No error box for a
  nonexistent app. The own advisor card is hidden by default.
- The app appears as a separate canvas window and uses AppLayout, Stack, and Form.
  On clicking "Start consultation", the task reaches the advisor. It calls
  `ask_user` in sequence 113, whereupon sequence 114 creates a pending action. The question appears in the
  coordinator inspector, while the app considers its model turn to be running. In the real DOM
  the textarea and "Send answer" stay disabled. The flow exclusively via the form
  is blocked; five answers and the final evaluation could therefore not be checked.
- In addition, the progress shows two internal tasks instead of five questions. Even the
  start task is displayed as a conversation message in the app. The default size requires
  scrolling down to the form. These observations do not replace a completed interview check.

The failure case was checked without correcting messages or changes to its program.
The own test run was then stopped and kept for re-examination; core keeps running.
Screenshots of the check are temporarily under `/private/tmp/ragents-balcony-qa/`.
The mere tightening of the prompt is not sufficient with this model in this run.

## UI context for the global coordinator, 11.09.2026

Checked with the production web build, an isolated core server on port 4317, and a
separate headless Chrome on port 4318. A logging model driver captured the requests actually
assembled by the scheduler; this check uses no external model call.

- The browser message on the empty start view transmits home without a run or selection.
  After opening Context check Alpha and selecting the coordinator via the actor list,
  run reference, title, the Network area, and actor @coordinator reach the model context.
- After switching to Context check Beta, the next message transmits the second
  run and no old actor selection. Network request, server-side name resolution, and
  actual system prompt match. The visible chat text stays unchanged.
- The check captures no browser errors. Navigation produces no coordinator message;
  the location is only recorded with the explicitly sent input.
- Six server regressions check several waiting inputs, later title changes,
  journal reloading, messages without context, normal runs, invalid or overlong data,
  targets that are no longer available, and the actual HTTP handover. Six web regressions
  check run switching, deselection, overview, collapsed areas, and separate request data.
- Prompt, spec, operations, homepage, and the existing coordinator walkthrough are adjusted.
  An additional prompt card is not needed for the automatic orientation.

Conclusion: `PRODUCT_PROFILE=core pnpm check` with exit code 0. 883 tests passed
(AI 13, Agent 7, Engine 247, Server 318, Web 256, Homepage 42); three optional
language server live tests skipped. Typechecks, lint, homepage check, and web build are green.
The own test instances were ended; regular profile servers and data stayed untouched.

## Small Gemma titles and own model choice, 11.09.2026

Checked with an isolated core server on port 4317, data under `/private/tmp`, and a separate
headless Chrome on port 4318. The titles ran via the real ModelRuntime and OpenRouter
with Gemma 4 A4B; only the conversation driver was replaced for this check.

- Three German tasks produced fitting titles with 3 to 8 words and under 80 characters.
  From triggering the title generation to the browser display, 718, 593, and 617 ms passed.
  Every stored title triggered an SSE list change. The completed run journals
  stayed byte-identical. The times are single measurements, not a guaranteed response time.
- The short title prompt keeps the terms of the task. The real results name
  shopping list, CSV import with German decimal commas, and family trip to Hamburg.
  An earlier measurement had shown the unfitting abbreviation family planning.
- The browser check confirms Gemma as the default, model search, unsaved selection,
  discarding, deactivating, saving again, and restoring after reloading.
  The actual settings file contains the chosen selection or null, respectively.
  Visually checked at 1500 x 1050 and 390 x 844; selection and saving stay reachable.
- The targeted regressions check dynamic model choice, unchanged existing titles,
  parallel requests without duplicate generation, reasoning off, token and time budget,
  no client retries, cancellation on deletion and shutdown, SSE unsubscription,
  access rights, invalid settings, and write errors without changing the active state.

Conclusion: `pnpm check` with exit code 0. 844 tests passed
(AI 13, Agent 7, Engine 247, Server 301, Web 234, Homepage 42); three optional
language server live tests skipped. After the final Gemma default and prompt adjustment,
the 19 targeted server checks and the 42 homepage checks passed again.
Typechecks, lint, generated homepage references, and the final web build are green.
The own test instances were ended; regular profile servers and data stayed untouched.

## Actor list and personal canvas view, 11.09.2026

Checked against the production build with an isolated core server on port 4317 and a separate
headless Chrome on port 4318. The native collection board start uses real TypeScript processes,
HTTP, and the iframe bridge; its model driver is replaced for this UI check. The regular
profile servers and their data stayed untouched.

- All four participants are in the searchable actor list. The LLM list helper with
  its own mini-app starts without an additional canvas card. Its name opens the inspector
  without showing the card. Single and group selection show or hide it selectively.
- The app iframe stays the same DOM element when toggling. A real call adds
  a list entry; a subsequent unsaved draft is kept when showing and
  hiding. The three original turns stay completed, without new turns.
- Connections and actor visibility stay stored after reloading and reopening the run.
  Reset restores the default view. The journal is byte-identical before and
  after the pure view check; the app function journals its work separately.
- Search, mutual replacement of the pop-outs, Escape with focus return, leaving via Tab, and
  closing when opening the settings are checked. No browser errors. Visual check
  at 1500 x 1050 and 390 x 844: list, search, and toggles stay reachable.
- 18 new regressions check default and single visibility, storage per run, search,
  list content, hidden ancestors, preserved descendants and apps, explicit placement,
  reused handles, missing references, and removed connections including labels.

Conclusion: `pnpm check` with exit code 0. 826 tests passed
(AI 13, Agent 7, Engine 247, Server 288, Web 229, Homepage 42); three optional
language server live tests skipped. Typechecks, lint, generated homepage references,
and web build are green. The own test instances were ended.

## Model settings and prompt categories, 10.09.2026

Checked against the production build with an isolated core server on port 4317, separate
temporary data directories, and a separate headless Chrome on port 4318. The regular
profile servers and their data stayed untouched. This check needs no model calls.

- The browser selection stores run coordinator GLM 5.3 with thinking depth high via the real
  product API in the settings file. Mediator and global coordinator keep
  GLM 5.3 Flash with low. A newly opened run draft shows the stored selection.
- A simulated connection error when saving shows an error, keeps the local
  draft, and allows a retry. Discarding restores the stored selection.
- A fresh instance already persists the first global selection. After changing the
  product default and a real process restart, both settings are kept separately.
  The test had previously found the unwanted re-derivation of the global selection from the
  product profile; first persistence and a regression fix this error.
- Engine integration tests check actual actor creation and turns with a replaced model driver:
  new actors use new defaults, existing actors and explicitly
  chosen start options keep their execution. Incomplete, invalid, and unauthorized
  save requests are rejected; write errors do not change the stored state.
- The start surface shows 27 reference cards in six groups, first twelve mini-apps.
  Searching for mini-apps leaves exactly these twelve cards. The new card for a
  list with two views puts its complete source prompt unchanged into the
  input field and does not send it. The example tasks newly added here were not
  additionally run with a real model; the actor live checks are below.
- Visual check at 1500 x 1050 and 390 x 844: model fields stay operable,
  the narrow view is scrollable. Titles and descriptions of the prompt cards are shorter;
  keywords stay searchable and filterable without filling the individual cards.

Conclusion: `pnpm check` with exit code 0. 808 tests passed
(AI 13, Agent 7, Engine 247, Server 288, Web 211, Homepage 42); three optional
language server live tests skipped. Typechecks, lint, deterministic
homepage references, and web build are green. The own test instances were ended.

## Actor programs, 10.09.2026

Checked with an isolated core instance on port 4317 and a separate data directory under
`/private/tmp`; the regular profile servers were not restarted. Real model calls
used the models Qwen 3.8 Max and GLM 5.3 Flash available in the profile. The browser check
ran in a separate Chrome instance against the real web build, including iframe and IPC.

- Text analysis, run `8f1e480b-389d-4217-83bb-60e089cb4689`: The free prompt card created
  an actor package with one successful activation. Two browser calls with
  `The world is big.\nAnd beautiful.` each returned 32 characters, 6 words, and 2 lines.
  Canvas and full view showed the same call counter 2. The journal still contained
  exactly the one coordinator turn; the operation produced no further model turn.
  The full view was checked visually.
- Counter, run `adaf5d01-84a9-4ef5-8555-6a9774f6979a`: The unchanged free card created
  an actor without a view, activated it once, and sent three separate ActorInputs.
  Three completed native turns with zero model tokens each resulted in
  `{texts: ["one", "two", "three"], count: 3}`. `read_counter` returned this state still
  in the same coordinator turn as the activation. Ten tool calls, no error, and
  no unknown tool name. The previous run with the same card and the same
  model needed 22 calls and failed repeatedly because of the frozen tool set.
  This is a single before/after run, not a general performance statistic.
- Collection board, run `fdfe706b-e213-4778-b192-a2be83bb2395`: The native run script set up
  an LLM actor with a function and a view. Its model wrote the first list entry
  via `append_to_list`; then the real iframe view and the function card
  each added another entry. All three were in the intrinsic state of the same LLM actor.
  Both UI calls were successful and produced no further turns. Setup, list helper,
  and coordinator completed their three original turns successfully.
  The subsequent emergency stop via the UI stopped the created actors and removed
  their view and function card from the surface.

The live runs found three concrete integration errors: workspace preparation before creating
the run, new functions only visible in the next turn, and a fixed `thinking: off`
in the relay profile despite a configured thinking depth. All three were corrected and secured with
regressions. The repeated counter and collection board run confirms the fixes.
Automatic diagnostics also reported, in the text analysis run, the TypeScript errors produced by the model
before activation; they were fixed with normal file changes.

The overall check also found a macOS process race: a process ended between the
`ps` queries or changed by exec made the whole scan fail.
Unambiguous `<defunct>` entries are skipped. For live processes the
command line must be identical before and after the environment query; only changed PIDs are
read again with fresh data, at most three times in total. Permanently unstable processes,
access and parser errors remain hard errors. The zombie case was reproduced with a separate
process; injected ps answers check changes, the retry limit, and errors.
The stop regression uses the confirmed process ID from the successful function call;
a marker file that was created but is still empty must not be read as PID 0.

A first text analysis attempt with GLM 5.3 Flash ended with badly formatted
tool text and without an app. This model error is not counted as a successful setup;
there is no silent model switch for it. The subsequent Qwen run was explicitly
started as a separate test. Prompts now prioritize the matching template and existing
domain tests, so that unnecessary reimplementations and contract queries are dropped.

All previously existing regular runs were deleted on the explicit instruction of the owner.
The final check found no run journals under `.data/*/runs`; the active
write lock of the regular server was kept.
The isolated test instances were ended and their run and session data then
deleted. The results remain documented here and in the checked homepage screenshot.

Conclusion: `pnpm check` completely with exit code 0. 783 tests passed
(AI 13, Agent 7, Engine 244, Server 274, Web 204, Homepage 41); the three expressly
optional language server live tests stayed skipped. Package typechecks, lint,
generated homepage references, and web production build are also green.

Autonomous self-improvement loop, started 27.08.2026 at 20:51, running at least
until 22:51. Procedure per round: 12 test cases from CATALOG.md with two prompts each, run in parallel
by subagents (medium) against the local server
(coordinator deepseek/deepseek-v4-flash-0731). Then final analysis, fixes, restart of the
server, next round.

## Round 1 (20:52 to 21:13, 12 agents, 24 runs)

Verdicts: 12x fulfilled, 6x partial, 2x missed (T02-B, T11-B), 2x aborted (T01-B
deadlock, T09-A race). Most important clusters:

1. ask_user reproducibly broken (10 failures, "Canonical values cannot contain
   undefined") - regression of today's strict canonicalJson.
2. event_subscribe did not accept handles (5 failures, in T09-A the cause of the deadlock),
   while actor_input/actor_stop can handle them.
3. Script tools: array parameters arrive from the model as a JSON string (T07, 5
   failed calls each).
4. Copying the compilationHash remains the biggest model annoyance (T06/T07: mangled hashes
   and paths).
5. Model behavior of deepseek-v4-flash: invents no tools, but (a) reports steps
   as done that never ran (T01-B), (b) waits for events without a subscription (deadlocks),
   (c) spawns conversation roles with the full tool profile, which then search the repo
   for minutes, (d) mediocre format fidelity (T11-B), (e) internal names in the chat.
6. The prompt thesis is confirmed in a nuanced way: not the length decides, but whether
   roles, number of rounds, and end condition are named (T01-A vs. T01-B).

Fixes after round 1 (all verified, engine 166 + server 60 tests green):
- canonicalJson: undefined object fields are omitted as with JSON.stringify
  (ask_user works again); undefined in arrays remains a hard error.
- event_subscribe resolves handles like actor_input.
- JSON string coercion at the handler boundary (coercedHandlerInput): arrays/objects/numbers
  as strings are unpacked if they match the contract.
- compilationHash COMPLETELY removed from the model contracts (logic_test/install,
  script_tool_test/install, run_module_test/install) - the attestation store binds the
  build on the server side; prompts and docs updated.
- Orchestration prompt: conversation roles always with tools: []; subscribe first, then
  commission; report only steps evidenced in the journal; no internal names in the chat.

Server restarted at 21:4x with the fixes.

## Round 2 (started 21:4x)

Same catalog, same cast. Expectation: T02-B/T04 (ask_user), T07 (arrays),
T06/T07 (no more hash copying), T01-B/T09-A (subscription order) should improve
significantly.

Result of round 2 (21:22 to 21:37): 17x fulfilled, 6x partial, 1x missed (T11-B
format fidelity). ALL round 1 fixes confirmed: ask_user 0 failures, no deadlocks,
no hash copying, arrays arrive, T09 clean. New root causes:

1. The logic interpreter did not know optional chaining (?. threw instead of short-circuiting) -
   T08 cascade including a seemingly false test green (the model tested with state {} instead of
   null to work around the ?. error).
2. No number[] parameter type for script tools - four compile detours in T07.
3. Models still copy IDs/paths and mangle them (subscription ID in T01-B,
   a typo folder in the workspace root because of a copied relative path).
4. Smaller points noted: a chat answer does not resolve an open question card (T02-B),
   the edit tool can break up JSON with ambiguous blocks (T06-B), the coordinator can
   list the file storage of other runs (T04-A).

Fixes after round 2 (verified, engine 167 + server 60 tests green):
- Optional chaining (?.) in the logic interpreter, sync and async, with chain short-circuit.
- Parameter type number[] for run module/script tools.
- Prompts: never copy IDs/paths (use $RAGENTS_FILES_DIR literally); exact
  format requirements are binding; logic_test with a real start state (a fresh actor reads
  null); target agents must exist before script_tool_check; stateSchema requirements
  explicit.
- The typo folder removed from the workspace root.

Server restarted at 22:0x.

## Round 3 (started 22:0x)

Same catalog. Focus: T08 (optional chaining), T07 (number[]), T11 (format fidelity),
T01-B (ID copying).

Result of round 3 (22:03 to 22:14): 17x fulfilled, 6x partial, 1x missed - same
rate as round 2, but the errors have moved: T06/T07/T08 now clean (optional
chaining and number[] take effect, no more hash/token issue), T09-A and T04 stable.
New root causes:

1. write/read/edit do not resolve $RAGENTS_FILES_DIR (bash does): write created a
   folder with a literal dollar sign in the working directory and reported success; the
   model's self-healing ended up in a risky rm -rf (T01-B).
2. show_document requires the content as a parameter - the model copies documents from
   memory and produces deviations up to errors of meaning (T05).
3. Remaining failures are model behavior of deepseek-v4-flash: format requirements
   are broken despite an explicit prompt rule (T11), short tasks are
   reinterpreted (T02-B), check marks set in advance (T03-B), agents stopped too early (T09-B).

Fixes after round 3 (verified, server 60 tests green):
- File tools expand $RAGENTS_FILES_DIR (also the ${...} and ./ notation) to
  the real run storage before the path is checked.
- show_document description: take over the content literally from read/write, never retype it.
- todo_replace description: check marks only AFTER the work is done, at most one active.

Server restarted at 22:2x, round 4 started as a verification round.

## Round 4 (started 22:2x)

Verification round for the path expansion and the description nudges.

Result of round 4: 19x fulfilled, 4x partial, 1x missed - best round so far.
Verified: $RAGENTS_FILES_DIR expansion takes effect (T01-B/T05 without path errors), the
format rule works (T11-A now fulfilled), to-do tracking better. New hard finding
(T07-B): agent_spawn without a profile creates a permanently inoperable agent -
the turn fails quietly, the coordinator waits for an answer that never comes,
and reports success anyway.

Fix after round 4 (verified, engine 167 + server 60 tests green):
- agent_spawn without profile/driver/model is rejected hard, with the list of
  known profiles in the error message (self-correction in the next move).

Noted for upcoming rounds (no longer in this session):
- Failed turns of created agents are invisible to the creator; a
  default subscription to turn.finished/failed of its own children would be the structural fix.
- show_document should get a path parameter (read the file on the server side),
  so that contents are never copied again; needs a web presenter adjustment.
- A chat answer does not resolve an open question card (T02-B, round 2).
- The tools selection of the actors cannot be read in the run view (T02-A, round 3).
- event_query polling next to an active subscription costs turns (prompt topic).
- Remaining failures are model behavior of deepseek-v4-flash (format fidelity,
  reinterpretation of short tasks, profile 'relay' guessed for normal roles).

## Round 5 (verification round for the spawn guard)

Result of round 5: 20x fulfilled, 3x partial, 1x missed - best round. The spawn guard
is verified (no more inoperable agent), the path expansion holds, T09 both
variants clean. Most stubborn remainder: show_document still forced copying (T05-A,
sixfold loop with self-accusation).

Fix after round 5 (verified, server 60 tests + web tsc/lint/build green):
- show_document now has a path parameter (relative to the run storage, a $RAGENTS_FILES_DIR
  prefix is tolerated): the viewer loads the content directly from the file (contentUrl),
  nothing is copied anymore. content remains for unsaved content. The tool
  enforces exactly one of the two.

Server restarted. End of the self-improvement loop after five rounds.

## Overall result

History of the verdicts (24 runs per round):
  Round 1: 12 fulfilled, 6 partial, 2 missed, 2 aborted/deadlocks
  Round 2: 17 fulfilled, 6 partial, 1 missed
  Round 3: 17 fulfilled, 6 partial, 1 missed
  Round 4: 19 fulfilled, 4 partial, 1 missed
  Round 5: 20 fulfilled, 3 partial, 1 missed

Fixed root causes (all with green suites):
  1. canonicalJson regression (ask_user completely broken)
  2. event_subscribe without handle resolution (source of deadlocks)
  3. JSON string coercion at the handler boundary (arrays as strings)
  4. compilationHash removed from all model contracts
  5. Optional chaining in the logic interpreter
  6. number[] parameter type
  7. $RAGENTS_FILES_DIR expansion in the file tools
  8. agent_spawn without a profile is rejected hard
  9. show_document with path instead of copying
  plus prompt hardening (conversation roles tools: [], subscribe first then commission,
  report nothing unevidenced, format requirements binding, check marks only after work).

Remaining failures are mostly model behavior of deepseek-v4-flash:
format fidelity for small tasks (T11-B missed in all rounds), reinterpretation of very short
tasks (T02-B), event_query polling next to an active subscription, occasional
word mangling in German. Prompt insight across all rounds: not the length
decides, but whether roles, quantities, and end condition are named - a short
prompt with exactly these three details beats long prose.

Open points for the next session are in the section of round 4.

## Round 6 (02.09.2026, 14:15 to 14:26, 13 agents, 26 runs plus 4 repetitions)

Frame deviating from the guide: profile core on a throwaway instance (port 3999, data in the
scratchpad), working directory a copy of the documents via STATIC_WORKSPACE_DIR,
coordinator z-ai/glm-5.3-flash (profile default). New: every missed or aborted variant
was repeated once with deepseek/deepseek-v4-pro-0813 to separate model weakness from platform errors.
New catalog case T13 (hello world in a dialog) from the failed run of the same day.
Built in beforehand: journaled validation errors and flat input schemas.

Verdicts glm-5.3-flash: 19 fulfilled, 4 partial (T02-A, T08-A, T08-B, T13-B), 3 missed
(T02-B, T06-B, T11-B), 0 aborted. Repetitions with deepseek: T06-B, T08-A, T11-B fulfilled,
T02-B partial. Cost per run between 0.0001 and 0.03 USD, deepseek up to 0.08 USD.

The two fixes of the day hold: T13 ran without a subagent, without empty arguments, without
a loop; the flat mini_app_test schema was hit by both models on the
first attempt in T06, T07, and T13; rejected calls now appear as started+failed in the journal (T07,
T13, T02 evidenced).

Platform findings (category bug/ux), by frequency:

1. agent_spawn without profile or model fails on the first attempt in seven runs (T01-B,
   T02-A/B, T08-A, T09-A/B), always with the same message, always with self-healing via
   model_list. The message should name the profiles directly, then the detour is dropped.
2. expect.error "" is compared against null as the expected error text in script_tool_test and mini_app_test
   (T07-A/B, T13-A/B), costing one attempt per run. Treat an empty string like
   omitted or reject it in the schema.
3. Mock validation never names the wrong field, but repeats the whole union type
   (T02-A: seven identical failures on the event_subscribe mock, then abandonment of the
   script mediator; T13: dialog_close contract guessed). The error text must name the path and expected
   type of the first deviating field.
4. script_actor_check reports a list of call names instead of the grant when a grant is missing
   (T02-A); the model then removes the capability and runs into the follow-up error.
5. "Tool script_tool_check not found" for an indexed tool that is not yet opened
   (T07-A); the message must point to tool_open.
6. tool_open discards the correct names too when one name is wrong (T13-B), two rounds lost.
7. ls with an unexpanded $RAGENTS_FILES_DIR reports "(empty directory)" instead of an error
   (T04-B).
8. Umlauts in streamed tool arguments are occasionally lost (German words arrived without their
   umlaut or sharp s), the prose text of the same message is intact (T04-A). Check the streaming path of the
   arguments.
9. thinking "off" is written into the agent session as thinkingLevel "low" for glm,
   correctly "off" for deepseek (T11); matching this, reasoning events despite "off" (T03, T10, T12).
10. POST /stop on an open question first queues the discarded answer as input
    and then cancels (T06-B); the answer text stays.
11. To check: artifacts in the RunView stays empty after show_document (T05); the subscription did not wake
    the coordinator, event_query was needed (T02 repetition); the conversation title stays
    "New conversation" with quick follow-up messages (T11, T12).

Prompt findings: the script actor is described almost only as a mediator, the case "own
state" (counter) is missing as an example, so glm falls back to an LLM agent (T08);
grant versus call name is not anticipated in the capability list (T02, T08);
waiting states produce filler messages and idle turns instead of ending the turn (T01, T09);
mini_app_test starts every test with a fresh state, which is not stated anywhere (T06-A).

Model behavior glm-5.3-flash: role collapse with a short prompt (T02-B: three roles in
one agent), searched for the template name in the file system and then asked a question instead of building (T06-B),
missed format requirement and domain (T11-B), stub file and ASCII umlauts via bash instead of
write (T05-B), template leftovers (T13-B). With deepseek-v4-pro fixed or improved in all repetitions;
deepseek, however, switches to English in the middle of the run (T02, T06).

Prompt thesis: in this round the detailed variant A wins in 9 of 13 cases; with the
same result, B is cheaper. What remains decisive is whether roles, purpose, and format are named,
not the length.

Procedure: an open ask_user question is not silence, the test agent must answer it via the
ask route (T02 repetition, T06-B); test agents need their own subfolders in the
scratchpad (T05). Both updated in the guide.
