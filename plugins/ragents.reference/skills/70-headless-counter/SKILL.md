---
name: 70-headless-counter
start: true
disable-model-invocation: true
title: "Nachrichten ohne KI mitzählen"
description: "Zeigt einen dauerhaften TypeScript-Actor ohne Oberfläche: Er verarbeitet Nachrichten getrennt und behält Liste und Zähler zwischen Aufträgen."
category: "TypeScript ohne Oberfläche"
order: 70
tags: "Anwendungsfall, Konzeptdemo, TypeScript-Actors, Actor-Funktionen, Actor-Zustand, Journalprüfung"
---

Ich hätte gern einen kleinen TypeScript-Zähler ohne Oberfläche und ohne KI-Aufrufe. Schicke ihm nacheinander die Texte "eins", "zwei" und "drei". Er soll jeden Text in seiner eigenen Liste behalten und mitzählen. Danach lies seinen Stand aus und belege, dass drei getrennte Eingaben verarbeitet wurden. Der Zähler soll für weitere Texte bereitbleiben.
