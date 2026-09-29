---
start: true
title: "Clarify a decision"
category: "Collaboration"
prompt: "I would like help clarifying an open decision and recording the next step."
order: 20
tags: "Use case, Concept demo, Skills"
name: decision-brief
description: "Shows how a reusable skill guide leads a decision in the chat from criteria to a choice without creating additional actors or scripts."
---

# Clarify a decision

Use this flow for a concrete everyday or project decision. It is a work instruction
for the coordinator and does not create additional agents or scripts.

1. Ask about the decision, the known alternatives, and the most important constraint.
   If the subject is still missing, begin only with this question and end the turn until the answer.
   Do not invent personal priorities. A suitable optional example is the question
   whether a neighborhood event should take place indoors or outdoors.
2. State the decision in one sentence. Suggest at most three verifiable criteria
   that fit the answer. Let the user add missing criteria or change priorities.
3. Compare the alternatives in a short table. Separate known facts and
   assumptions; do not treat unknown costs or properties as facts. You research external information
   only with tools that are actually available and mark their sources.
4. Ask for exactly the open piece of information that would most likely change the result.
   If the user wants to decide without this information, record the uncertainty.
5. After their choice, write a short decision note: question, criteria, chosen
   option, remaining uncertainty, and a concrete next step. The decision stays
   with the user. Then briefly explain which steps this reusable flow guided.

The conclusion is the note in the chat. Nothing is booked, sent, or changed outside the
conversation. Do not claim a conclusion while the choice is still open.
