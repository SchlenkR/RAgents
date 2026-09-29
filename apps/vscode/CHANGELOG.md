# Changelog

## 0.1.10

- The extension warns when the server runs a different RAgents version and reports a rejected
  workspace as an error.
- Open questions appear above the chat input instead of as cards in the chat (quassel 0.3.0).
- On Windows, a `bash` call ends its whole MSYS process group on timeout, on stop, and after the
  call; the timeout can be up to 3600 seconds.

## 0.1.9

- A chat message to the asking actor ends a blocking question.
- Language servers and the browser come from their plugins; the workspace loads the same plugin
  contributions as the server.
- The profile's default solution loads without asking; `bash` stops after 120 seconds.
- A workspace running a different version gets an understandable message.
- The extension builds bring ripgrep (`rg`) for fast code search.

## 0.1.8

- The npm package and the VS Code extension always carry the same version (0.1.7 was not
  released for the extension).
- Start tiles fill their cell in full width.
- Plugins can bind prompts, skills, functions, and hooks to a condition per run.

## 0.1.6

- New setting `ragents.zoom` (50 to 200 percent) scales the entire RAgents interface live without
  reloading; an invalid value shows its message in the view.
- The model context is a projection of the journal; locked runs appear in the run list.

## 0.1.5

- Global coordinator per user, steering, and binding by machine and folder.
- Runs on the server run in a process sandbox; the extension's local host runs without one.
- Server roots and skills are available in workspace runs as well; `bash` accepts a working
  directory.
- Model and thinking level can be chosen in the chat input of every run; the change applies from
  the next turn.
- Model aliases in the profile; providers and real model names appear nowhere.
- Detail level and timestamps are shared toggles in every chat; the recipient picker is a tree of
  actors.
- Windows: the extension brings its own bash; the workspace inherits the environment;
  platform-specific VSIX packages.
- Leaner tool results for `bash`, `read`, `edit`, and `write`.
- Chat building blocks come from the quassel library.

## 0.1.0

- First version: explorer and RAgents panel for any number of targets at the same time, servers
  as well as local profiles.
- Work column, mini-apps in the center, sign-in per server in the SecretStorage.
- Workspace: `read`, `write`, `edit`, `bash`, and the language servers of a run operate in the
  folders of the window.
- The embedded run view is called run panel: view `ragents.runPanel`, page `run-panel.html` of the
  server; the saved view per run starts fresh.
- On the right of the run panel, a bar with the tabs of the workspace (files, documents,
  functions, executions, language server diagnostics); a click opens the tab below the chat, a
  second click or the X closes it, the handle changes the height; tab and height are kept per run.
- The extension is an app made of four pages: Start, Runs, run panel, and servers; the explorer
  tree in the activity bar is gone, because Start and Runs show the same thing flatter.
- One vocabulary for all pages: one colored symbol per state, the word only in the tooltip; the
  time is compact (now, 5 min, 3 h, 2 d, then the date). No tool term appears as a state anymore.
- The header of the run panel has a back arrow to the Start page on the left instead of the
  expand arrow with the run list; server, state, and stop are on the right.
- The extension starts a local profile silently in the background on activation; the states are
  starting and ready, the Start and Stop buttons are gone.
- The Runs page deletes several runs after a confirmation in a dialog; removing a server also
  asks for confirmation in a dialog.
- Start, Runs, servers, New run, and Refresh are only in the title bar of the view; Start has no
  header anymore, Runs and servers only a back arrow and title.
- The servers on Start are split chips: on the left state, name, action word (Runs, Sign in,
  Retry, Start, Connect) and the target line (local profile, host of the server, or host with a
  local client profile), on the right the plus for a new chat; the chip of a connected server
  opens the Runs page filtered to it.
- The run list is a grid with fixed columns; state, title, time, and server line up in all rows,
  also in selection mode.
- Stop is the same red, filled square everywhere and is called "Stop run"; no state symbol looks
  like a stop button anymore.
- A profile can name a default entry with `defaultStartEntry`: the plus on the chip and the first
  tile under New use it, `New run` suggests it first per server; without a default, each
  reachable server gets the tile "New chat".
- On Start, the state symbol of a failed, unreachable, or rejected server opens the full message
  with "Open output" and "Retry"; the lock opens the sign-in dialog.
- A locally started host gets values from the SecretStorage: `ragents.hostEnvironment` only names
  them, the commands "Set secret" and "Delete secret" maintain the values; a settings file never
  contains a value, and a missing one appears in the `RAgents` channel only with its name.
- The servers page names the entries of `ragents.hostEnvironment` that have no stored value and
  sets the value directly from the notice; if nothing is missing, the page stays unchanged.
- A profile distributed by the server gets `RAGENTS_RELAY_URL` and `RAGENTS_RELAY_TOKEN` from its
  session; after signing in, no secret is needed for them, and a stored value still wins.
- If starting or applying a profile fails on an environment variable that the configuration
  names with `env("NAME")`, the server shows which variable is missing and what for, instead of
  the line from the channel; "Set value" adds the name to `ragents.hostEnvironment` if needed,
  asks for the value, and then restarts the server, one name after the other if several are
  missing.
- A profile distributed by the server only brings the profile file and bundles; the local host
  starts it with its own web app and must have the same host API as the server, no longer the
  same commit.
- A template with a guide is called "Set up" on Start and asks its guide first after the click,
  as in the web app; a second click during a start starts the new template, and the first start
  no longer jumps in afterwards.
- If the extension cannot read the run view of a run, the run appears in the list with the
  reason; the other runs, the badge, and the status bar keep working.
