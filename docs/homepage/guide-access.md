# Rechte vergeben

Benutzerrechte, Actor-Grants und die Ausstattung eines Subagenten unterscheiden.

## Optionale Anmeldung und Rechte

Benutzerrechte steuern den Zugang eines Menschen zur Anwendung. Die Auswahl der Funktionen
eines Actors und dessen technische Grants regeln die Ausführung innerhalb eines Runs.
Ein Profil stellt die Plugins bereit; Benutzerrechte erzeugen keine zusätzlichen Plugins
oder Werkzeuge.

Eine Profildatei kann neben `config` einen `users`-Export mit dem Typ
`readonly ProfileUser[]` anbieten. Der Vertrag steht in `config-definition.ts`; Passwörter
sind nicht leere Klartextwerte oder `env(...)`-Referenzen. Ohne Export bleibt der bisherige Betrieb ohne
Benutzeranmeldung erhalten. Ein vorhandener Export schaltet die Anmeldung ein und muss deshalb
mindestens einen Benutzer enthalten. Eine ausdrücklich leere Liste, doppelte Kennungen, ungültige
Rechte oder fehlende Passwortvariablen brechen den Start ab. Die Benutzerliste wird getrennt
von der Plugin-Konfiguration geladen und erscheint nicht in öffentlichen Umgebungsdeskriptoren.

Zum Beispiel ergänzt dieser Export eine Profildatei um einen gemeinsamen Lesezugang:

```ts
import { env, type ProfileUser } from "./apps/server/src/config-definition.js";

export const users = [{
  id: "reader",
  label: "Lesezugang",
  password: env("RAGENTS_READER_PASSWORD"),
  rights: ["runs.read", "ragents.overseer.read"],
}] as const satisfies readonly ProfileUser[];
```

Der Passwortwert kann aus der Serverumgebung kommen oder direkt in `password` stehen. Eine vorhandene `env`-Importzeile wird dafür
ergänzt; derselbe Import wird nicht ein zweites Mal angelegt. Die
[Entwicklerreferenz](developer.html#access-rights) nennt die aktuellen Rechte für
Runs, Einstellungen und globalen Koordinator direkt aus den ausführbaren Verträgen.

Rechte sind exakte Strings; `*` gibt alle Rechte frei. Die verbindlichen Namen und ihre
Bedeutungen stehen in `packages/ragents/src/access.ts` und bei den beitragenden Plugins.
`AccessContext.can`, `hasRight` und `accessMode` verwenden dieselbe Prüfung. Ohne Anmeldemodus und ohne `anonymousUser` sind die Rechte freigegeben. Ein optionaler
`anonymousUser`-Export verwendet dieselben Rechte und `startEntries` ohne Passwort; er begrenzt
den Zugang auch ohne Anmeldung. `users` und `anonymousUser` gleichzeitig sind ein Startfehler.
Mit Anmeldung und ohne Sitzung sind die Rechte gesperrt. Der öffentliche
Snapshot enthält nur Anmeldemodus und Benutzer mit Kennung, Anzeigename und Rechten.
Die Entwicklerreferenz erzeugt Namen, Host-Routenzuordnung und Verträge aus diesem Code und
enthält geprüfte Beispiele für Leser, Bediener und eine eigene Extension.

Die Anmeldung verwendet Benutzerkennung und Passwort. Der Server hält eine undurchsichtige
Anmeldesitzung zwölf Stunden im Speicher; das profilbezogene Cookie ist HttpOnly und SameSite=Lax.
Abmelden, Ablauf und Neustart machen die Sitzung ungültig; zugehörige offene HTTP-Antworten
einschließlich Ereignisströmen und laufenden Abrufen werden beim Abmelden oder Ablauf abgebrochen.
Bereits gestartete Agenten-Runs werden dadurch nicht automatisch gestoppt. Der Browser kehrt bei verlorener Sitzung zur
Anmeldung zurück. Benutzeränderungen werden mit dem nächsten Serverstart wirksam.
Die Anmeldung gilt je Browser, nicht je Tab: Eine neue Anmeldung in einem zweiten Tab ersetzt
das Cookie für alle Tabs, und deren Anfragen laufen ab dann unter dem neuen Benutzer. Ein Tab
lädt deshalb bei jedem Fokus den angemeldeten Benutzer nach und übernimmt einen Wechsel sofort.
Zwei Benutzer gleichzeitig brauchen zwei Browser oder ein privates Fenster. Prompts, Skills und
Tests nennen keinen echten Benutzer; der Eigentümer eines Runs kommt allein aus der Anmeldung.
Clients ohne Cookie-Speicher (die VS-Code-Erweiterung und ihre iframes) lesen den Sitzungstoken
aus dem `Set-Cookie`-Header der Anmeldeantwort und senden ihn als `Authorization: Bearer`; für
GET-Abrufe, die keinen Header setzen können (Ereignisstrom, Mini-App-Frames), gilt er auch als
Abfrageparameter `access` (`ACCESS_TOKEN_QUERY` in `packages/ragents/src/access.ts`). Ein
Bearer-Header hat Vorrang vor Cookie und Abfrageparameter; Abmelden mit Bearer widerruft die
Sitzung genauso.

Benutzerrechte steuern sowohl sichtbare beziehungsweise nur lesbare UI als auch HTTP-Routen.
Der Zugriff wird nicht pro Run und angemeldetem Benutzer getrennt: Leseberechtigte sehen
die gemeinsamen Runs des Profils.
`runs.write` erlaubt Nachrichten an vorhandene Runs und ihre App-Aktionen. Freie Runs,
Vorbereitungsgespräche und Startoptionen benötigen zusätzlich `runs.create`. Ohne dieses Recht
startet `POST /chat/<id>/start` nur ein Run-Script aus `user.startEntries`; beliebige Texte,
andere Einstiegkennungen und technische Startparameter sind gesperrt. Der Katalog enthält
für diese Benutzer nur die freigegebenen Scripts. Die Auswahl gilt für neue Starts; bestehende
Runs bleiben im gemeinsamen Profil zugänglich.

`runs.inspect` schützt Modelle, Journal, Quellen, Werkzeuge und allgemeine technische Einsicht.
Language-Server-Ansichten verwenden ihr eigenes `<pluginId>.read`. Damit lassen sich Diagnosen
unabhängig von Modell- und Werkzeugdetails freigeben. Tabs und lesende HTTP-Routen prüfen
dasselbe Recht.

`runs.trace` gibt ohne die übrige technische Einsicht die Denk- und Werkzeugschritte des Chats
mit Inhalt frei und erlaubt dem Benutzer, ihren Detailgrad selbst zu wählen. Ohne dieses Recht
sieht der Chat die Schritte nur als leere Marker.
Ohne dieses Recht enthalten Chatstream und Actor-Verlauf für Denk- und Werkzeugphasen nur
leere Statusmarker mit Start-/Abschlussinformation. Namen, Argumente, Quelltext, Ergebnisse
und Denktexte werden serverseitig entfernt. So bleibt die aktuelle Arbeitsphase sichtbar,
ohne technische Details freizugeben.
Ohne dieses Recht fehlen freie Startfelder, Modellwahl, Detailstufen, allgemeine technische Reiter und
Inspektoren. Der Canvas zeigt Mini-Apps und LLM-Gespräche; TypeScript-Steueractors bleiben
verborgen. Der Server redigiert Modelle, Prompts, Grants, Werkzeugausgaben und technische
Startzustände in den Run- und Chat-Snapshots. Fachliche Zustände und Mini-App-Aktionen bleiben
verfügbar, einschließlich der Ergebnisabfrage laufender App-Aktionen ohne technische Einsicht.
Einstellungen und globaler Koordinator behalten ihre eigenen Rechte.
Diese Rechte ersetzen keine Ausführungssandbox für selbst geschriebenen nativen Code. Der globale Koordinator hat
eigene Lese- und Schreibrechte; Änderungen seiner Modellwahl brauchen zusätzlich das Recht
zum Schreiben von Einstellungen. Sein Arbeitsbereich verwendet eine private lokale
Dienstidentität ausschließlich für die Verwaltungs-API und Hilfe. Sie darf Runs lesen,
schreiben, frei starten und technisch einsehen; Einstellungen und globaler Reset sind darüber nicht erreichbar. Diese
Identität ist kein Benutzerzugang und wird nicht an den Browser weitergegeben.

## Funktionsauswahl und Actor-Rechte

Eine Engine-Capability bezeichnet eine technische Erlaubnis, etwa `workspace.use` für
Workspace-Werkzeuge. Ein Grant weist diese Erlaubnis einem Actor mit einem Geltungsbereich zu:
dem Run oder einem Workspace-Pfad. Er hält außerdem fest, ob der Actor die Erlaubnis selbst
nutzen und an neu angelegte Actors weitergeben darf. Eine Workspace-Grenze deckt den angegebenen
Pfad und seine Unterverzeichnisse ab. Beim Vererben delegierbarer Grants bleibt dieser Bereich
erhalten; ein neuer Actor bekommt dadurch nicht automatisch ein eigenes engeres Verzeichnis.
Benutzerrechte wie `runs.write` steuern dagegen den Zugang zur Anwendung und ihren Routen.

Die `tools`-Auswahl beim Spawn bestimmt die verfügbare Funktionen-API: `[]` für ein reines LLM,
eine Namensliste für eine genaue Auswahl, `null` für den dynamischen Bestand. Die Auswahl wird
nicht vom Koordinator geerbt. Delegierbare Engine-Rechte werden als Grants übernommen;
`withoutCapabilities` kann sie weiter einschränken. Rollenregeln im Prompt beschreiben den
Auftrag, erteilen aber keine technischen Rechte.
Beispielsweise ersetzt die Auswahl von `read` keinen fehlenden Grant für `workspace.use`.

Ein Actor-Programm deklariert zusätzlich seine benötigten Funktionen unter `capabilities`.
Diese Deklaration begrenzt den Aufruf, verleiht dem handelnden Actor aber keine fehlenden
Grants. Auch ein erfolgreich typgeprüftes Snippet bleibt an seine Aufrufidentität gebunden.
Übersicht, Nachschlagen und Ausführung verwenden den für diesen Actor freigegebenen Bestand.
Die [Laufzeitanleitung](guide-runtime.html#subagenten-ausstatten) erklärt die
Auswahl für reine Gesprächsagenten und Coding-Agenten.

## Offene Grenzen

- Benutzer werden in der Profildatei gepflegt; es gibt weder OAuth noch eine Benutzerverwaltung
  oder Passwortänderung in der Oberfläche. Anmeldesitzungen überleben keinen Serverneustart.
- Benutzerrechte gelten für das gesamte Profil, nicht je Run oder Agentenwerkzeug.
