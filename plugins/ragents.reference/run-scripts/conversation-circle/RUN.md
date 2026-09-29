---
title: Set up conversation circle
description: "A prepared setup shows parameterization through a start guide and the arrangement of a conversation circle. The coordinator then leads the rounds."
order: 120
guide: ragents.reference.conversation-circle
tags: Run scripts, Use case, Concept demo, Start guide, Agent teams
---

A deterministic setup: the script sets up mira, jon, and ada as ordinary LLMs, splits
the surface among them, and hands the briefing to the coordinator.
The card tests the model, this script tests the platform.

The guide passes `{ "topic": "...", "rounds": 2 }`. `topic` contains 1 to 160 characters, `rounds` is an integer from 1 to 5. The start value `null` explicitly chooses the topic "Should city centers become car-free?" and two rounds. Other incomplete or invalid values are rejected before the setup. Topic and number of rounds control the display and the task, and the topic also controls the run title.
