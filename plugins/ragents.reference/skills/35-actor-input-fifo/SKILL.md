---
name: 35-actor-input-fifo
start: true
disable-model-invocation: true
title: "Complete three tasks in order"
description: "Shows whether tasks queued during a running turn are processed separately and in order of arrival. The journal provides the evidence."
category: "Events and flows"
order: 35
tags: "Journal inspection, Concept demo, Input queue"
---

I would like a helper that answers every text I give it with "DONE: " and the unchanged text, and thinks extensively beforehand on the word "one". While it is still working on "one", I send it "two" and "three" right after. Afterwards, show me with evidence that it handled all three cleanly separated and in exactly this order and that nothing got mixed up.
