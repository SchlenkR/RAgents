---
title: Set up conversation circle
description: "A prepared setup shows parameterization through a start guide and the participants of a conversation circle. The coordinator then leads the rounds."
order: 120
guide: ragents.reference.conversation-circle
tags: Run scripts, Use case, Concept demo, Start guide, Agent teams
---

A deterministic setup: the script sets up mira, jon, and ada as ordinary LLMs and hands
the briefing to the coordinator.
The card tests the model, this script tests the platform.

The contract declares two optional parameters: `topic` with 1 to 160 characters and `rounds`, an integer from 1 to 5. The guide passes both; without them the circle discusses "Should city centers become car-free?" in two rounds. The host rejects other values before the run changes. Topic and number of rounds control the display and the task, and the topic also controls the run title.
