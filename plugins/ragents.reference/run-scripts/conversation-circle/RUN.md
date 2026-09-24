---
title: Gesprächsrunde einrichten
description: "Ein vorbereitetes Setup zeigt die Parametrisierung durch einen Startleitfaden und die Anordnung einer Gesprächsrunde. Der Koordinator führt anschließend die Runden."
order: 120
guide: ragents.reference.conversation-circle
tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Startleitfaden, Agententeams
---

Ein deterministisches Setup: das Script stellt mira, jon und ada als gewöhnliche LLMs auf, teilt
die Fläche unter ihnen auf und übergibt dem Koordinator das Briefing.
Die Karte prüft das Modell, dieses Script prüft die Plattform.

Der Leitfaden übergibt `{ "topic": "...", "rounds": 2 }`. `topic` enthält 1 bis 160 Zeichen, `rounds` ist eine ganze Zahl von 1 bis 5. Der Startwert `null` wählt ausdrücklich das Thema "Sollten Innenstädte autofrei werden?" und zwei Runden. Andere unvollständige oder ungültige Werte werden vor dem Aufbau abgelehnt. Thema und Rundenzahl steuern die Darstellung und den Auftrag, das Thema auch den Run-Titel.
