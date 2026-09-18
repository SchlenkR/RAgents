---
title: Moderierte Runde ohne Koordinator
description: "Ein vorbereiteter Aufbau zeigt einen Run, der von Anfang an ohne Koordinator arbeitet. Der Moderator wird Primary-Actor und direkter Ansprechpartner im Chat."
order: 130
coordinator: false
tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Primary-Actor, Agententeams
---

Referenzfall für `coordinator: false`: der Host spawnt keinen Koordinator, das Script wählt mit
`run_configure` den Moderator als Primary-Actor und setzt den Run-Titel. Der Chat bindet sich, sobald
der Primary-Actor feststeht. Der Moderator behält seinen eigenen Actor-Prompt auch als Primary-Actor; den konkreten Auftrag
erhält er über den ersten ActorInput. Ein Startwert `{ "topic": "..." }` setzt das Thema.
