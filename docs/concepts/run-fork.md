# Run fork: new runs from a built-up run

Status: Idea

## Goal

An operator should be able to use a built-up run as the starting point of further runs: start
options, actors, functions, state, views, and subscriptions. A run fork takes over
this setup without having the coordinator carry it out again.

Prepared workflows as TypeScript packages are already available as script templates; their
current contract is described in `docs/spec/typescript-platform.md`. This concept concerns only
taking over a run that has actually been built up.

## Foundation and missing steps

The engine has `Orchestration.forkRun` for a fork at a command boundary. An operator interface
and a method of the messaging layer that connects the fork with the remaining data of the run
are missing. The fork of the journal already brings along the agents' model contexts; it is still
not enough for a usable copy: working files as well as sources and builds of the actor programs
additionally live in the run's storage.

An implementation must take over journal and storage together and keep all run and actor
references bound in them consistent. Sources and the installed program state belong together; a
source text alone must not become an unverified replacement for an activated program. Native
processes are not cloned. A new run starts its instances from the verified state it took over and
its journaled actor state.

One possible way is an explicit fork method that creates a new run ID, takes over an idle run,
and lets the responsible plugins copy their data of the run. That would require a new lifecycle
step per run. Its exact form should only be decided with two real data owners: actor programs
and file storage.

The source run remains a run. A marker should prevent it from being confused with a freshly
started fork. With an exact fork, the setup history belongs to the copy; a new clean history can
instead be built with the existing path through a script template. A second declarative seed
contract is not planned for this.

## Open decisions

- Take over model contexts from the journal or restart with an explicit setup summary.
- Take over the file storage completely or copy a clearly selected subset.
- Take over sources, builds, and private working files without references to the original run.
- Leave the source run editable or protect it against unintended use.
- Clearly reject schema or capability changes; migrations are not planned.

## Acceptance

Two forks of the same run must work independently. Changes to actor state, views, and files must
change neither the source run nor the other fork. After a restart, both forks must restore their
own state. An incomplete or no longer compatible package state must abort the fork with a
concrete error message.
