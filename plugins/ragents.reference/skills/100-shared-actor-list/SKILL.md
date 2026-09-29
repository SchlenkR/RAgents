---
name: 100-shared-actor-list
start: true
disable-model-invocation: true
title: "Maintain a list in the chat and in a window"
description: "Shows, while building a mini-app, how the interface and the coordinator use the same function of a TypeScript actor and change the same list."
category: "Mini-apps"
order: 100
tags: "Use case, Concept demo, TypeScript actors, Actor functions, Actor state, Mini-apps"
---

I would like a shared list on a TypeScript actor without an AI list helper. I add entries through its interface, you through the same function as a tool. Both ways immediately show the same state, even when the chat is idle. Actually add an entry and leave the interface in place. Use shared layout and form building blocks: multi-line input and list side by side, stacked when space is tight.
