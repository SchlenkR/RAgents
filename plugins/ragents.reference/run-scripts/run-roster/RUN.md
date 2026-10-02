---
title: Take stock of the run
description: "A prepared check shows a run script that also joins a running run. It lists the other participants, notes them in the shared notebook, and reports them back as its result."
order: 170
coordinator: false
embeddable: true
shared-programs: notebook
tags: Run scripts, Concept demo, TypeScript actors
---

The TypeScript program reads the participants with `actor_list` and ends each start with
`context.finish`. The owner reads the summary in the chat; a coordinator that starts it through
`run_script_start` receives summary and list as a message. Started inside a running run through the
run menu, `ragents script`, or the coordinator, it preserves the primary actor, and every start
opens a room of its own with its own roster. Started as a new run, it is the run's only participant.

It shares the notebook with the quick note script: `shared-programs: notebook` copies the plugin's
shared package into the main room of the run, `actor_program_ensure` makes it active once for
every room, and its visible view enters the app catalog automatically.
