---
name: browser-testing
description: Prüfe eine laufende Webanwendung mit echten Browseraktionen, sichtbaren Ergebnissen und Screenshots.
---

# Webanwendung prüfen

Verwende die TypeScript-Funktionen `browser_open`, `browser_snapshot`, `browser_click`,
`browser_fill`, `browser_select`, `browser_press`, `browser_check`, `browser_viewport`,
`browser_screenshot` und `browser_close`. Lade deren genaue Verträge mit `typescript_api`.

1. Starte die Anwendung mit ihren tatsächlichen Diensten und warte auf deren Bereitschaft.
2. Öffne ihre HTTP-Adresse mit `browser_open`. Jeder Run hat einen eigenen Browser ohne
   übernommene Anmeldung. Melde fehlende Dienste und Browser-Voraussetzungen ausdrücklich.
3. Lies den Snapshot und bediene den tatsächlichen Nutzerweg. Wähle Ziele über sichtbare
   Rollen/Namen oder Feldbeschriftungen, beispielsweise `{ role: "button", name: "Speichern" }`.
   Die Auflösung erfolgt im Browser. Snapshot-IDs werden nicht abgeschrieben.
4. Prüfe Erfolg und relevante Fehlerfälle mit `browser_check`: sichtbares Ergebnis, Zieladresse
   und Browserfehler. Ein Typecheck oder Screenshot allein belegt keinen erfolgreichen Nutzerweg.
   Nach jeder Aktion ist eine neue Prüfung nötig. Erfinde keine Ergebnisse bei fehlendem Netz.
5. Erzeuge mit `browser_screenshot` echte Aufnahmen. Übernimm `url` oder `markdown`
   programmatisch in den Ergebnisbericht oder die Mini-App. Das Bild liegt in der Dateiablage
   dieses Runs. Das native Werkzeug `browser_view_screenshot` zeigt Dir die letzte Aufnahme
   ohne Pfadangabe; dafür benötigt Dein Modell Bildunterstützung. Der Viewport ist standardmäßig
   1920 x 1080 (16:9); für schmale Layouts oder kleine Bildschirme stellst Du ihn mit
   `browser_viewport` um und prüfst danach erneut.
6. Benenne geprüfte Schritte und verbleibende Grenzen. Schließe den Browser nach Abschluss;
   Aufnahmen bleiben erhalten. Run-Stopp und Serverende schließen ihn ebenfalls.

Die Browseraktionen verwenden Playwright-Locators mit automatischem Warten. Mehrdeutige Ziele
sind Fehler, die die Kandidaten nennen; wähle dann mit `nth` (0-basiert) oder `first: true` im
Ziel einen Treffer, oder prüfe die Anzahl sichtbarer Treffer mit `count` in `browser_check`.
Sichtbarkeitsprüfungen warten höchstens 5 Sekunden, Aktionen länger; ein fehlendes Element
kostet also keine lange Wartezeit. Native Selects verwenden `browser_select`; eigene Auswahlmenüs werden geklickt.
Mit `target.frame` wählst Du ein Iframe per CSS. Neue Fenster werden ausdrücklich gemeldet;
dieser Ablauf bedient eine Seite. Verdeckte Elemente werden nicht per JavaScript angeklickt.
