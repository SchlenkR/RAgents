# Selbsttest-Runde fahren

Anleitung für eine KI-Session (Claude Code), eine komplette Runde der
Selbstverbesserungs-Schleife zu fahren. Eine Runde dauert 10 bis 20 Minuten und kostet
grob 1 Million Subagenten-Tokens plus wenige Cent DeepSeek über OpenRouter.

## Voraussetzungen

- Ronald hat den lokalen Server auf http://localhost:4710 gestartet (Profil core,
  `scripts/start.sh core` mit den Dienstzugängen aus der Shell). Verlangt das Profil eine
  Anmeldung, über `POST /api/access/login` anmelden und das Sitzungscookie bei den
  folgenden HTTP-Aufrufen mitsenden. Wenn der Server des Besitzers nicht angefasst werden
  darf: Wegwerf-Instanz des Profils core mit einem ausdrücklich festgelegten freien `PORT`
  und `DATA_DIR` im Scratchpad; ein belegter Port bricht den Start ab, eine bestehende
  Instanz wird nicht beendet. Das Arbeitsverzeichnis ist je
  Unterhaltung leer (`sessions/<id>/plugins/ragents.workspace/workspace`); eine Kopie der
  gewünschten Unterlagen legt der Testagent vor der ersten Nachricht hinein oder ein
  Resolver-Plugin liefert sie (Runde 6 lief noch mit dem alten STATIC_WORKSPACE_DIR).
- README.md gelesen, Abschnitt "Für KI-Assistenten".

## Ablauf

1. Je Testfall T01 bis T12 aus CATALOG.md einen Opus-Subagenten (medium) starten, alle
   parallel. Jeder Agent fährt BEIDE Promptvarianten als getrennte Unterhaltungen:
   Session-ID per uuidgen, `POST /chat/<id>/send {"text":...}`, Beobachtung über
   `${DATA_DIR}/runs/<id>/journal.jsonl` und `GET /chat/<id>/run`. Grenzen: 10 Minuten je
   Variante, bei 4 Minuten Event-Stille `POST /chat/<id>/stop` und als Abbruch werten. Eine
   offene Rückfrage (`action.proposed` mit status pending in der RunView) ist KEINE Stille:
   der Agent beantwortet sie über `POST /api/plugins/ragents.ask/runs/<id>/questions/<actionId>/answer`
   mit `{"answer": ...}` und bewertet die Rückfrage im Bericht. Jeder Agent arbeitet in einem
   eigenen Unterordner des Scratchpads. Verfehlte oder abgebrochene Varianten einmal mit einem
   stärkeren Modell wiederholen (`PUT /chat/<id>/model`), um Modell- von Plattformfehlern zu
   trennen.
2. Jeder Agent liefert strukturiert: verdict je Variante (erfüllt/teilweise/verfehlt/
   abbruch), Beobachtungen, Findings mit Journal-Beleg (Kategorien bug, modellverhalten,
   prompt, ux, performance), Prompt-A-gegen-B-Vergleich, Modellverhalten.
3. End-Analyse: Findings clustern, Wurzelursachen identifizieren. Fixes umsetzen (Suiten
   müssen grün bleiben: Engine, Server mit PRODUCT_PROFILE=core, Web tsc+lint+build),
   Ronald den nötigen Serverneustart melden, danach nächste Runde als Verifikation.
4. Ergebnisse in LOG.md fortschreiben (Urteilsverlauf, Wurzelursachen, Fixes); offen
   Gebliebenes in TODO.md, Erkenntnisse mit Bestand ins Spec-Kapitel plus Eintrag in docs/decisions.md. NICHT committen
   ohne Freigabe.
5. Katalog lebendig halten: jeder echte Fehllauf aus dem Alltag wird ein neuer
   Katalogfall; erledigte Dauerläufer dürfen durch schärfere Fälle ersetzt werden.

Referenzlauf: fünf Runden am 27.08.2026, Urteilsverlauf 12 -> 17 -> 17 -> 19 -> 20 von
24, neun behobene Wurzelursachen (siehe LOG.md).
