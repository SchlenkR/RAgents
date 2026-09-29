---
title: Learning afternoon
description: "A prepared parallel round shows two independently working AI helpers and a TypeScript collector. The mini-app takes over one answer from each exactly once."
order: 150
coordinator: false
tags: Run scripts, Use case, Concept demo, Mini-apps, TypeScript actors, Agent teams, Subscriptions, Primary actor
---

The prepared TypeScript program sets up two AI helpers without tools and shows its
own mini-app. Both use the role `standard`. A coordinator is not needed;
the TypeScript actor controls the flow and is the primary actor.

Only "Collect ideas" assigns the two helpers: Helper A suggests a simple experiment,
Helper B a small learning quiz. Each delivers exactly one idea for a learning afternoon with
primary school children. The tasks are independent and are sent at the same time. The app
shows the status of each helper and takes its completed answer into the shared
result list. The ideas are real model answers and are not checked for subject-matter accuracy.

An error in one helper leaves the result of the other in place. Empty answers and
interrupted model turns appear as errors. The flow starts once and repeats
neither tasks nor failed answers automatically. For new ideas, start a new run.
The template needs no start values and triggers no model call before the button.

The homepage uses the same React view with explicitly marked preview data.
