# Änderungen

## 0.1.0

- Erste Fassung: Explorer und RAgents-Panel für beliebig viele Ziele gleichzeitig, Server wie lokale Profile.
- Arbeitsspalte, Mini-Apps in der Mitte, Anmeldung je Server in der SecretStorage.
- Arbeitsplatz: `read`, `write`, `edit`, `bash` und die Sprachserver eines Runs laufen in den Ordnern des Fensters.
- Die eingebettete Run-Ansicht heißt Run-Panel: View `ragents.runPanel`, Seite `run-panel.html` des Servers; die gespeicherte Ansicht je Run beginnt neu.
- Rechts im Run-Panel eine Leiste mit den Reitern des Arbeitsbereichs (Dateien, Dokumente, Funktionen, Executions, Diagnostik der Sprachserver); ein Klick öffnet den Reiter unter dem Chat, ein zweiter oder das X schließt ihn, der Griff ändert die Höhe; Reiter und Höhe bleiben je Run erhalten.
- Die Erweiterung ist eine App aus vier Seiten: Start, Runs, Run-Panel und Umgebungen; der Explorer-Baum in der Aktivitätsleiste entfällt, weil Start und Runs dasselbe flacher zeigen.
- Ein Vokabular für alle Seiten: je Zustand ein farbiges Symbol, das Wort nur im Tooltip; die Zeit ist kompakt (jetzt, 5 min, 3 h, 2 d, danach das Datum). Kein Werkzeugbegriff steht mehr als Zustand.
- Die Kopfzeile des Run-Panels hat links einen Zurück-Pfeil auf die Start-Seite statt des Aufklapp-Pfeils mit der Run-Liste; rechts stehen Umgebung, Zustand und Stopp.
- Ein lokales Profil startet die Erweiterung beim Aktivieren still im Hintergrund; die Zustände sind startet und bereit, die Knöpfe Starten und Stoppen entfallen.
- Die Seite Runs löscht mehrere Runs nach einer Rückfrage im Dialog; das Entfernen einer Umgebung fragt ebenfalls im Dialog zurück.
- Start, Runs, Umgebungen, Neuer Run und Aktualisieren stehen nur noch in der Titelzeile der Ansicht; Start hat keine Kopfzeile mehr, Runs und Umgebungen nur Zurück-Pfeil und Titel.
- Die Umgebungen auf Start sind geteilte Chips: links Zustand, Name, Aktionswort (Runs, Anmelden, Erneut versuchen, Starten, Verbinden) und die Zielzeile (lokales Profil, Host des Servers oder Host mit lokalem Client-Profil), rechts das Plus für einen neuen Chat; der Chip einer verbundenen Umgebung öffnet die Seite Runs gefiltert auf sie.
- Die Run-Liste ist ein Raster mit festen Spalten; Zustand, Titel, Zeit und Umgebung stehen in allen Zeilen untereinander, auch im Auswahlmodus.
- Stopp ist überall dasselbe rote, gefüllte Quadrat und heißt "Run stoppen"; kein Zustandssymbol sieht mehr wie ein Stopp-Knopf aus.
- Ein Profil kann mit `defaultStartEntry` einen Default-Einstieg nennen: das Plus am Chip und die erste Kachel unter Neu nehmen ihn, `Neuer Run` schlägt ihn je Umgebung zuerst vor; ohne Default steht je erreichbarer Umgebung die Kachel "Neuer Chat".
- Das Zustandssymbol einer gescheiterten, nicht erreichbaren oder abgewiesenen Umgebung öffnet auf Start die vollständige Meldung mit "Ausgabe öffnen" und "Erneut versuchen"; das Schloss öffnet den Anmeldedialog.
- Ein lokal gestarteter Host bekommt Werte aus der SecretStorage: `ragents.hostEnvironment` nennt nur die Namen, die Befehle "Secret setzen" und "Secret löschen" pflegen die Werte; in den Einstellungen steht nie ein Wert, und ein fehlender erscheint im Kanal `RAgents` nur mit seinem Namen.
- Die Seite Umgebungen nennt die Namen aus `ragents.hostEnvironment`, zu denen kein Wert gespeichert ist, und setzt den Wert direkt aus dem Hinweis heraus; ist nichts offen, bleibt die Seite unverändert.
- Ein vom Server verteiltes Profil bekommt `RAGENTS_RELAY_URL` und `RAGENTS_RELAY_TOKEN` aus seiner Sitzung; wer sich angemeldet hat, braucht dafür kein Secret, ein gespeicherter Wert gewinnt weiterhin.
- Scheitert der Start oder die Übernahme eines Profils an einer Umgebungsvariablen, die die Konfiguration mit `env("NAME")` nennt, steht an der Umgebung statt der Zeile aus dem Kanal, welche Variable fehlt und wofür; "Wert setzen" trägt den Namen bei Bedarf in `ragents.hostEnvironment` ein, fragt den Wert ab und startet die Umgebung danach erneut, bei mehreren fehlenden Namen einen nach dem anderen.
- Ein vom Server verteiltes Profil bringt nur Profildatei und Bundles mit; der lokale Host startet es mit seinem eigenen Web und muss dieselbe Host-API haben wie der Server, nicht mehr denselben Commit.
- Eine Vorlage mit Leitfaden heißt auf Start "Einrichten" und fragt nach dem Klick zuerst ihren Leitfaden, wie in der Web-App; ein zweiter Klick während eines Starts startet die neue Vorlage, der erste Start springt danach nicht mehr dazwischen.
- Kann die Erweiterung die Laufansicht eines Runs nicht lesen, steht er mit dem Grund in der Liste; die übrigen Runs, das Abzeichen und die Statusleiste arbeiten weiter.
