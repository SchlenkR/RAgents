---
title: Balkon-Wizard einrichten
description: "Ein vorbereitetes KI-Interview zeigt adaptive Fragen in einer eigenen Mini-App. Der Berater ist von Anfang an Primary-Actor; das Formular zählt fünf Antworten."
order: 140
coordinator: false
tags: Run-Scripts, Anwendungsfall, Konzeptdemo, Mini-Apps, LLM-Actor mit View, Frei gesteuerter Chat, Primary-Actor
---

Das TypeScript-Setup legt einen Balkon-Berater mit dem Modellprofil `standard` und ausdrücklich
ohne Werkzeuge an. Das mitgelieferte Programm `actors/balcony-app/` bindet eine eigenständige
Mini-App an diesen Actor. Die Fläche zeigt allein deren Kachel statt einer Chatkachel; ein Koordinator
wird für diesen Run nicht angelegt. Der Berater wird zum Primary-Actor und behält seinen eigenen
Interview-Prompt.

In der App beginnt "Beratung starten" das Gespräch. Das LLM stellt jeweils eine Frage anhand
der bisherigen Antworten, ohne feste Fragenliste. Die App zählt fünf Antworten und zeigt danach
die Empfehlung zu Stil, Pflanzen, Möbeln, Pflege und nächsten Schritten. Der Benutzer schreibt in
ein Formular, nicht in ein Chat-Widget. Fortschritt und abgeschlossene Antworten lassen sich nach
dem Neuladen aus dem Gespräch rekonstruieren; eine fehlgeschlagene Modellantwort kann erneut
angefordert werden, ohne eine weitere Antwort zu zählen.

Der Einstieg benötigt keine Startwerte. Das Setup wird einmal ausgeführt und startet noch keinen
Modellaufruf. Erst eine Aktion in der App schickt Text an den Berater. Fragen und Empfehlungen
bleiben Modellantworten; die App prüft ihre fachliche Qualität nicht automatisch.

Dies ist ein vorbereitetes Demo zum direkten Starten. Die separate Skill "Balkon-Wizard"
beauftragt weiterhin den Run-Builder, selbst eine App für diese Aufgabe zu bauen.
