# Simplifying the client entry point of reactive actor views

Status: Idea

## Starting point

The shared delivery is implemented and described in `docs/spec/actor-programs.md`:
`useAppState()` binds React to the host bridge, and the provider applies changed actor states
even while the chat is idle. Successful actor functions from views and agent tools thereby update
the same state; local form drafts are preserved.

## Still to be decided

A possible further simplification would be a stable React component `App({ state })` whose
mounting and state binding the host takes over. The app author would then call neither
`createRoot` nor `useAppState`. That would be a change to the client contract and is not an
available API yet.

Before an implementation, check with the shared list and the task overview whether this new
entry point helps at all compared to normal React imports and the existing hook.
Both examples must show external state changes and preserve local drafts, focus, and filters. If
the existing binding is already simple enough, the concept is dropped without further
abstraction.

An additional data binding language, file watching, and live state adoption inside handlers that
are still running are not part of this idea. Intermediate states of long functions may need a
separate decision.
