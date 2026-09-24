---
title: Wortspiel starten
description: "Ein vorbereitetes Wortspiel zeigt, wie ein TypeScript-Actor Reihenfolge und Ende festlegt, während vier LLMs die Wörter liefern. Die Mini-App macht den Fortschritt sichtbar."
order: 150
coordinator: false
tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Mini-Apps, TypeScript-Actors, Agententeams, Subscriptions
---

Rot, Gelb, Blau und Grün sind vier LLM-Actors ohne Werkzeuge mit der Rolle `standard`.
Der TypeScript-Actor besitzt die Mini-App, legt die Teilnehmer an und wird Primary-Actor.
Erst "Wortspiel starten" in der App beauftragt das erste Modell. Das Ausgangswort ist "Sonne".

Der Steueractor abonniert die Abschlüsse und Unterbrechungen der Teilnehmer. Jeder erfolgreiche
Turn liefert genau ein Wort. Erst danach erhält der nächste Teilnehmer die bisherige Wortfolge.
Die Reihenfolge Rot, Gelb, Blau, Grün wiederholt sich dreimal; nach zwölf Beiträgen endet die
Weitergabe. Die App zeigt Fortschritt, Wortfolge und das fertige Dokument in `UI.DocumentViewer`.
Wörter entstehen ausschließlich durch echte Modellantworten. Das Format wird geprüft,
die Qualität der Assoziation bleibt Sache des Modells.

Fehlgeschlagene oder unterbrochene Modell-Turns und ungültige Antworten stoppen das Spiel
mit sichtbarer Ursache. Ein begonnenes Spiel lässt sich nicht erneut starten; für einen neuen
Versuch wird ein neuer Run angelegt. Neuladen der App erhält den journalisierten Fortschritt.
Ein Serverneustart kann laufende Turns unterbrechen; das Spiel setzt sie nicht automatisch neu auf.
Unbekannte direkte Programmeingaben werden als Fehler abgewiesen und verändern den Spielstand nicht.
Der Steueractor hat keine freie Chat-Eingabe; Chatnachrichten an ihn weist der Host ab.
