---
title: Start word game
description: "A prepared word game shows how a TypeScript actor determines order and end while four LLMs supply the words. The mini-app makes the progress visible."
order: 150
coordinator: false
tags: Run scripts, Use case, Concept demo, Mini-apps, TypeScript actors, Agent teams, Subscriptions
---

Red, Yellow, Blue, and Green are four LLM actors without tools with the role `standard`.
The TypeScript actor owns the mini-app, creates the participants, and becomes the primary actor.
Only "Start word game" in the app assigns the first model. The starting word is "sun".

The control actor subscribes to the participants' completions and interruptions. Each successful
turn delivers exactly one word. Only then does the next participant receive the word sequence so far.
The order Red, Yellow, Blue, Green repeats three times; after twelve contributions the
handover ends. The app shows progress, the word sequence, and the finished document in `UI.DocumentViewer`.
Words come exclusively from real model answers. The format is checked;
the quality of the association is up to the model.

Failed or interrupted model turns and invalid answers stop the game
with a visible cause. A game that has started cannot be started again; for a new
attempt, create a new run. Reloading the app keeps the journaled progress.
A server restart can interrupt running turns; the game does not set them up again automatically.
Unknown direct program inputs are rejected as errors and do not change the game state.
The control actor has no free chat input; the host rejects chat messages to it.
