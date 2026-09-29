# Running a self-test round

Instructions for an AI session (Claude Code) to run a complete round of the
self-improvement loop. A round takes 10 to 20 minutes and costs
roughly 1 million subagent tokens plus a few cents of DeepSeek via OpenRouter.

## Prerequisites

- The owner has started the local server at http://localhost:4710 (profile core,
  `scripts/start.sh core` with the service credentials from the shell). If the profile requires
  sign-in, sign in via `POST /api/access/login` and send the session cookie with the
  following HTTP calls. If the owner's server must not be touched:
  a throwaway instance of the profile core with an explicitly set free `PORT`
  and `DATA_DIR` in the scratchpad; an occupied port aborts the start, an existing
  instance is not ended. The working directory is empty per
  conversation (`sessions/<id>/plugins/ragents.workspace/workspace`); the test agent puts a copy of the
  desired documents into it before the first message, or a
  resolver plugin provides them (round 6 still ran with the old STATIC_WORKSPACE_DIR).
- `docs/development.md` read, section "For AI assistants".

## Procedure

1. For each test case T01 to T12 from CATALOG.md start one Opus subagent (medium), all
   in parallel. Each agent runs BOTH prompt variants as separate conversations:
   session ID via uuidgen, calls as JSON-RPC to `POST /rpc` (`{"jsonrpc":"2.0","id":1,
   "method":"ragents.chat.send","params":{"runId":"<id>","text":...}}`), observation via
   `${DATA_DIR}/runs/<id>/journal.jsonl` and `ragents.runs.view`. Limits: 10 minutes per
   variant; after 4 minutes of event silence, `ragents.chat.stop` and count it as aborted. An
   open question (`action.proposed` with status pending in the RunView) is NOT silence:
   the agent answers it via `ragents.ask.answer` with `{"runId", "actionId", "answer"}`
   and assesses the question in the report. Each agent works in its
   own subfolder of the scratchpad. Repeat missed or aborted variants once with a
   stronger model (start option `ragents.model` before the start via
   `ragents.startOptions.select`) to separate model errors from platform errors.
2. Each agent delivers in structured form: verdict per variant (fulfilled/partial/missed/
   aborted), observations, findings with journal evidence (categories bug, model behavior,
   prompt, ux, performance), prompt A versus B comparison, model behavior.
3. Final analysis: cluster findings, identify root causes. Implement fixes (suites
   must stay green: engine, server with PRODUCT_PROFILE=core, web tsc+lint+build),
   report the necessary server restart to the owner, then the next round as verification.
4. Update LOG.md with the results (verdict history, root causes, fixes); what remained
   open goes into TODO.md, lasting insights into the spec chapter plus an entry in docs/decisions.md. Do NOT commit
   without approval.
5. Keep the catalog alive: every real failed run from everyday use becomes a new
   catalog case; settled long-runners may be replaced by sharper cases.

Reference run: five rounds on 27.08.2026, verdict history 12 -> 17 -> 17 -> 19 -> 20 of
24, nine fixed root causes (see LOG.md).
