---
title: Sammelboard einrichten
description: "Ein vorbereitetes Setup zeigt einen LLM-Listenhelfer mit eigener Funktion, Mini-App und gemeinsamem Zustand. Ein Startleitfaden legt Titel und ersten Eintrag fest."
order: 100
guide: ragents.reference.shared-actor-list
tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Startleitfaden, Actor-Funktionen, Actor-Zustand, Mini-Apps, LLM-Actor mit View
---

Das Setup legt einen echten LLM-Listenhelfer an und bindet das mitgelieferte Programm
`actors/shared-list/` an ihn. Seine Funktion `append_to_list` und die React-View teilen den
intrinsischen Zustand dieses Actors. `actor_program_activate` prüft und aktiviert das bereits
vom Host kopierte Paket. Ein eigener App-Actor oder eine zweite Listenimplementierung entsteht nicht.

Der Leitfaden übergibt `{ "title": "...", "firstEntry": "..." }`. Der Titel hat 1 bis 160 Zeichen,
der erste Eintrag 1 bis 2000 Zeichen. `null` startet mit "Gemeinsame Liste" und
"Hallo aus dem Run-Script". Ungültige Werte werden vor dem Aufbau abgelehnt. Nach dem Aufbau
bekommt der Listenhelfer den ausdrücklichen Auftrag, den ersten Eintrag über seine Funktion
anzulegen. Die Pakettests prüfen Konfiguration, Zustand und die tatsächliche Aufrufreihenfolge.
