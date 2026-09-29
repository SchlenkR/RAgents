---
start: true
title: "Learning goal in stages"
category: "Collaboration"
prompt: "I would like a short learning unit with a fitting exercise and a next learning step."
order: 30
tags: "Use case, Concept demo, Skills"
name: learning-sprint
description: "Shows how a reusable skill guide adapts a learning unit in the chat to actual answers without creating additional actors or scripts."
---

# Learning goal in stages

Use this flow for a short interactive learning unit. It is a work instruction for
the coordinator, not a prebuilt agent team and not an automatic assessment of a person.

1. Ask about the topic, a concrete learning goal, and the available time. With an empty
   start, first ask only about the topic and wait for the answer. If needed, offer
   everyday percentage calculations or explaining a technical term clearly as examples.
2. Set a small starter exercise that can be solved without aids. Do not reveal the solution
   before the answer. Skip this step if the user has already shown their level
   with an example of their own.
3. Derive exactly one next practice step from the actual answer. Explain the
   required principle with a new short example. Mark uncertainty about subject-matter questions;
   do not invent sources or learning results.
4. Set a second exercise in a changed context. Wait for the answer again. Give
   concrete feedback on the solution and, if needed, a hint before the complete solution.
5. Summarize what already worked in these answers and what still needs practice. Agree on
   a small next step. Briefly explain that the same flow can also be used for another
   learning goal.

End every turn after an open exercise. No invented user answers, no
grades or diagnoses from a single answer, and no automatic forwarding.
