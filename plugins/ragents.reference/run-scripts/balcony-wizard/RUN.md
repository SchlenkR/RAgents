---
title: Set up balcony wizard
description: "A prepared AI interview shows adaptive questions in a mini-app of its own. The advisor is the primary actor from the start; the form counts five answers."
order: 140
coordinator: false
tags: Run scripts, Use case, Concept demo, Mini-apps, LLM actor with view, Controlled chat, Primary actor
---

The TypeScript setup creates a balcony advisor with the role `standard` and explicitly
without tools. The bundled program `actors/balcony-app/` binds a standalone mini-app to
this actor. The surface shows only its tile instead of a chat tile; no coordinator
is created for this run. The advisor becomes the primary actor and keeps its own
interview prompt.

In the app, "Start consultation" begins the conversation. The LLM asks one question at a time
based on the previous answers, without a fixed list of questions. The app counts five answers and
then shows the recommendation on style, plants, furniture, care, and next steps. The user writes
into a form, not into a chat widget. Progress and completed answers can be reconstructed from the
conversation after a reload; a failed model answer can be requested again without counting
another answer.

The template needs no start values. The setup runs once and does not start a model call yet.
Only an action in the app sends text to the advisor. Questions and recommendations
remain model answers; the app does not check their subject-matter quality automatically.

This is a prepared demo to start directly. The separate skill "Balcony wizard"
still asks the run builder to build an app for this task itself.
