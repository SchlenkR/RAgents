---
title: Set up collection board
description: "A prepared setup shows an LLM list helper with its own function, mini-app, and shared state. A start guide sets the title and the first entry."
order: 100
guide: ragents.reference.shared-actor-list
tags: Run scripts, Use case, Concept demo, Start guide, Actor functions, Actor state, Mini-apps, LLM actor with view
---

The setup creates a real LLM list helper and binds the bundled program
`actors/shared-list/` to it. Its function `append_to_list` and the React view share the
intrinsic state of this actor. `actor_program_activate` checks and activates the package
the host has already copied. No separate app actor or second list implementation is created.

The contract declares two optional parameters: `title` with 1 to 160 characters and `firstEntry`
with 1 to 2000 characters. The guide passes both; without them the board is called "Shared list"
and its first entry is "Hello from the run script". The host rejects other values before the run
changes. After the setup, the list helper receives the explicit task to create the first entry
through its function. The package tests check configuration, state, and the actual call order.
