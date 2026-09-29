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
run menu, `ragents script`, or the coordinator, it changes neither the primary actor nor the tiles,
and a repeated start reuses the same actor. Started as a new run, it is the run's only participant.

It shares the notebook with the quick note script: `shared-programs: notebook` copies the plugin's
shared package into the run, `actor_program_ensure` makes it active once, and
`canvas_layout_place` puts its view next to what is arranged.
