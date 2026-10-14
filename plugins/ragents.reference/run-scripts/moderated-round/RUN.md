---
title: Moderated round without coordinator
description: "A prepared setup shows a run that works without a coordinator from the start. The moderator becomes the primary actor and your direct contact in the chat."
order: 130
coordinator: false
tags: Run scripts, Use case, Concept demo, Primary actor, Agent teams
---

Reference case for `coordinator: false`: the host spawns no coordinator, the script uses
`run_configure` to choose the moderator as primary actor and sets the run title. The chat binds as soon as
the primary actor is determined. The moderator keeps its own actor prompt even as primary actor; it receives the concrete task
through the first ActorInput. The contract declares one optional parameter, `topic` with 1 to 160
characters, which sets the topic; without it the round is about "What makes a good team?".
