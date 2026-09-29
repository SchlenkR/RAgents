---
title: Add a quick note
description: "A prepared one-step script shows a shared actor package: it adds a note to the notebook it shares with the roster check, in a new or a running run."
order: 180
coordinator: false
embeddable: true
shared-programs: notebook
tags: Run scripts, Concept demo, TypeScript actors
---

The start value `{ "text": "..." }` is the note; without one, the script notes when it was
started. The script makes the shared notebook active with `actor_program_ensure`, sends it the
note, places the notebook's view with `canvas_layout_place`, and ends the start with
`context.finish`. Whether the roster check or this script comes first, the run has one notebook.
