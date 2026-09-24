---
title: Lernnachmittag
description: "Eine vorbereitete Parallelrunde zeigt zwei unabhängig arbeitende KI-Helfer und einen TypeScript-Sammler. Die Mini-App übernimmt einmalig je eine Antwort."
order: 150
coordinator: false
tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Mini-Apps, TypeScript-Actors, Agententeams, Subscriptions, Primary-Actor
---

Das vorbereitete TypeScript-Programm richtet zwei KI-Helfer ohne Werkzeuge ein und zeigt seine
eigene Mini-App. Beide verwenden die Rolle `standard`. Ein Koordinator ist nicht nötig;
der TypeScript-Actor steuert den Ablauf und ist der Primary-Actor.

Erst "Ideen sammeln" beauftragt die beiden Helfer: Helfer A schlägt ein einfaches Experiment
vor, Helfer B ein kleines Lernquiz. Jeder liefert genau eine Idee für einen Lernnachmittag mit
Grundschulkindern. Die Aufträge sind unabhängig und werden gleichzeitig abgeschickt. Die App
zeigt den Stand jedes Helfers und übernimmt seine abgeschlossene Antwort in die gemeinsame
Ergebnisliste. Die Ideen sind echte Modellantworten und werden nicht fachlich geprüft.

Ein Fehler bei einem Helfer lässt das Ergebnis des anderen stehen. Leere Antworten und
unterbrochene Modell-Turns erscheinen als Fehler. Der Ablauf startet einmal und wiederholt
weder Aufträge noch fehlgeschlagene Antworten automatisch. Für neue Ideen beginnt ein neuer Run.
Die Vorlage benötigt keine Startwerte und löst vor dem Button keinen Modellaufruf aus.

Die Homepage verwendet dieselbe React-Ansicht mit ausdrücklich markierten Vorschaudaten.
