# Client-Einstieg reaktiver Actor-Views vereinfachen

Status: Idee

## Ausgangspunkt

Die gemeinsame Zustellung ist implementiert und in `docs/spec/run-modules.md` beschrieben:
`useAppState()` bindet React an die Host-Bridge, der Provider übernimmt geänderte Actor-Zustände
auch bei ruhendem Chat. Erfolgreiche Actor-Funktionen aus Views und Agentenwerkzeugen aktualisieren damit
denselben Zustand; lokale Formularentwürfe bleiben erhalten.

## Noch zu entscheiden

Eine mögliche weitere Vereinfachung wäre eine stabile React-Komponente `App({ state })`,
deren Mounten und Zustandsanbindung der Host übernimmt. Der App-Autor müsste dann weder
`createRoot` noch `useAppState` aufrufen. Das wäre eine Änderung des Client-Vertrags und ist
noch kein verfügbares API.

Vor einer Umsetzung an gemeinsamer Liste und Aufgabenübersicht prüfen, ob dieser neue
Einstieg gegenüber normalen React-Imports und dem vorhandenen Hook überhaupt hilft.
Beide Beispiele müssen externe Zustandsänderungen anzeigen und lokale Entwürfe, Fokus sowie
Filter erhalten. Falls die vorhandene Anbindung bereits hinreichend einfach ist, entfällt
das Konzept ohne weitere Abstraktion.

Eine zusätzliche Datenbindungssprache, Dateibeobachtung und Live-Zustandsübernahme innerhalb
noch laufender Handler gehören nicht zu dieser Idee. Zwischenstände langer Funktionen
benötigen gegebenenfalls eine gesonderte Entscheidung.
