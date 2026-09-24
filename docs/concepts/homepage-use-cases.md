# Anwendungsideen für vorbereitete Setups

Status: Idee

Die Homepage erklärt den Nutzen vorbereiteter Setups an zwei möglichen Einsatzfeldern. Beide
sind Anwendungsideen und keine mitgelieferten Referenzabläufe. Ihre Darstellung im letzten
Abschnitt ist ausdrücklich so beschriftet; es gibt dafür noch keine Abbildungen echter Runs.

## Refactoring

Ein Run-Script könnte Analyse-, Umsetzungs- und Prüfagenten samt Werkzeugen und Kachelaufteilung anlegen.
Eine Actor-View würde Vorschläge und Bearbeitungsstände zeigen und den Benutzer den Umfang der
Änderung auswählen lassen. TypeScript-Actors würden Ergebnisse sammeln und die nächsten Inputs
nach festgelegten Bedingungen zustellen. Die Modelle blieben für Analyse, Codeänderungen und
Bewertung verantwortlich.

Vor einem Demonstrator müssen ein kleines echtes Projekt, eine konkrete Refactoring-Aufgabe und
prüfbare Erwartungen feststehen. Erst ein ausgeführter und geprüfter core-Run darf als vorhandenes
Beispiel auf der Homepage erscheinen. Aktuell sollen weder Runs noch die Anwendung dafür
gestartet werden, weil parallel entwickelt wird.

## DevOps und betriebliche Abläufe

Ein weiteres Setup könnte Daten aus angebundenen Systemen zusammentragen, Agenten mit deren
Bewertung beauftragen und Ergebnisse in einer gemeinsamen Oberfläche zur Bearbeitung anbieten.
Die Integrationen, verbindlichen Übergaben und menschlichen Entscheidungen wären für den
konkreten Fachfall als Plugins und Setup festzulegen. Es gibt noch keinen allgemeinen
Unternehmensworkflow als Referenz im Profil core.

## Übernahme nach Umsetzung

Nach einem fertigen Demonstrator werden dessen Fähigkeiten in der passenden Spec beschrieben,
der Homepage-Abschnitt von der Idee zum vorhandenen Beispiel geändert und echte Screenshots
eingesetzt. Das umgesetzte Szenario wird hier entfernt; nach Umsetzung beider entfällt diese Datei.
