---
name: 70-headless-counter
start: true
disable-model-invocation: true
title: "Count messages without AI"
description: "Shows a persistent TypeScript actor without an interface: It processes messages separately and keeps its list and counter between tasks."
category: "TypeScript without UI"
order: 70
tags: "Use case, Concept demo, TypeScript actors, Actor functions, Actor state, Journal inspection"
---

I would like a small TypeScript counter without an interface and without AI calls. Send it the texts "one", "two", and "three" one after another. It should keep each text in its own list and count along. Then read out its state and prove that three separate inputs were processed. The counter should stay ready for further texts.
