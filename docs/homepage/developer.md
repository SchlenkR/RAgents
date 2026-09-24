# RAgents: Entwicklerreferenz

> Erweiterungspunkte, Beispiele und aktuelle Vertragsflächen aus dem Code.

[Werkzeugverträge](reference.md) | [Run-Script-Pakete und API](run-setup.md) | [JSON-RPC-API](rpc-api.md) | [LLM-Index](llms.txt)

Die Beispiele sind Ausschnitte für den jeweils benannten Einsatzort. Run-lokale Scripts sind native TypeScript-Module mit explizitem Kontext; Plugin-Servercode und Web-Module werden mit der Anwendung gebaut.

## Plugin und Profil

### Ein Plugin anlegen

Ein Plugin bündelt eine zusätzliche Fähigkeit von RAgents, etwa Werkzeuge und die zugehörige Oberfläche. Es liegt in einem eigenen Ordner mit einem Server-Einstieg und bei Bedarf einer Web-Hälfte. Beim Start meldet es der Anwendung, welche Funktionen es bereitstellt.

Einsatzort: plugins/ragents.example/server/index.ts

```typescript
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";

export const plugin: PluginModule = {
  create: () => ({
    manifest: { id: "ragents.example" },
    register: (host) => {
      host.prompts({
        id: "ragents.example.instructions",
        order: 100,
        render: () => "Beschreibe kurz, worauf dein Ergebnis beruht.",
      });
    },
  }),
};
```

Abhängigkeiten stehen als requires am exportierten PluginModule. Der Composer prüft ihre Reihenfolge und übernimmt sie in das Manifest.

web im Manifest setzt ebenfalls der Composer: true, wenn der Plugin-Ordner eine Web-Hälfte web/index.tsx enthält. Die Oberfläche verlangt dann, dass das Bundle sie enthält.

Host-Bausteine importiert ein Plugin über die Pakete @ragents/host, @ragents/web und @ragents/engine, andere Plugins über @ragents/plugins/<id>. Damit darf der Plugin-Ordner an beliebiger Stelle liegen; das Profil nennt ihn per Kennung oder Pfad.

create erhält den gesamten PluginHost. register erhält dagegen die auf dieses Plugin gebundene PluginRegistration. Die beiden host-Parameter sind verschiedene Verträge.

client.config im Manifest und host.clientConfig tragen öffentliche Browserkonfiguration. Geheime Werte gehören dort nicht hinein.

Der Plugin-Ordner allein aktiviert nichts. Die Instanz muss die Plugin-ID oder den Ordnerpfad in ihrer Profilkonfiguration aufnehmen; benötigte Produkt- und Workspace-Dienste bleiben Pflicht.

Vertragsfelder: module.create, module.requires, plugin.manifest, plugin.register, manifest.id, manifest.requires, manifest.client, manifest.web.

### Ein Profil zusammenstellen

Ein Profil legt fest, welche Plugins und Einstellungen eine RAgents-Installation verwendet. Es stellt damit die verfügbaren Fähigkeiten zusammen. Das Beispiel ergänzt die Grundausstattung core um ein eigenes Plugin.

Einsatzort: ragents.config.example.ts; erweitert die lokal konfigurierte neutrale Basis.

```typescript
import { config as core } from "./ragents.config.core.js";
import type { RAgentsConfig } from "@ragents/host/config-definition.js";

export const config = {
  ...core,
  host: {
    ...core.host,
    PRODUCT_PROFILE: "example",
    PRODUCT_ID: "example",
    PRODUCT_TITLE: "Beispielwerkstatt",
    PLUGINS: [...core.host.PLUGINS, "ragents.example"],
  },
} as const satisfies RAgentsConfig;
```

Die Basiskonfiguration liefert die vorhandenen Pflichtplugins und Modellwerte. Der Einstieg scripts/start.sh example wählt die neue Datei; benötigte Zugangswerte werden lokal konfiguriert.

Ohne gültige Profilwahl startet der Server nicht. Plugins können registrieren, solange der Host noch nicht versiegelt ist; doppelte Kennungen und fehlende Pflichtdienste sind Fehler.

Vertragsfelder: .

### Lesen und vorbereitete Setups freigeben

Ein Profil kann festlegen, wer sich anmelden und welche Funktionen verwenden darf. Dafür nennt sein users-Export die Benutzer und ihre Rechte. Das Beispiel gibt einer Person Leserechte und einer zweiten das vorbereitete Wortspiel samt Chat und Mini-App.

Einsatzort: Neben dem config-Export einer eigenen Profildatei mit ragents.reference; die benannten Passwortvariablen werden lokal gesetzt.

```typescript
import { env, type ProfileUser } from "@ragents/host/config-definition.js";

export const users = [
  { id: "reader", label: "Lesen", password: env("EXAMPLE_READER_PASSWORD"),
    rights: ["runs.read"] },
  { id: "operator", label: "Bearbeiten", password: env("EXAMPLE_OPERATOR_PASSWORD"),
    rights: ["runs.read", "runs.write"],
    startEntries: ["ragents.reference.word-game"] },
  { id: "developer", label: "Lokaler Host", password: env("EXAMPLE_DEVELOPER_PASSWORD"),
    token: env("EXAMPLE_DEVELOPER_TOKEN"),
    rights: ["models.use", "profile.fetch"] },
] satisfies readonly ProfileUser[];
```

Ohne users-Export gibt es keine Anmeldung. Ein optionaler anonymousUser kann den Zugang trotzdem einschränken. Eine leere users-Liste ist ein Startfehler. Passwörter dürfen Klartext oder env-Referenzen sein und werden niemals im Browser veröffentlicht. Ein persönlicher token (nur als env-Referenz) gilt als Bearer ohne Ablauf für Clients ohne Anmeldedialog, etwa pnpm connect und das Modell-Relay.

Rechte sind exakte Strings. Nur der einzelne Wert * bedeutet alle Rechte; Teilmuster und Vererbung gibt es nicht. Ein Run gehört dem Benutzer, der ihn angelegt hat; ein Bedienerzugang erreicht nur seine eigenen Runs, runs.read.all zeigt die aller Benutzer. Einen Run, den eine Startoption mit ownerOnly seinem Eigentümer vorbehält, etwa durch die Bindung an einen Arbeitsplatz, kann runs.read.all nur im Journal lesen und stoppen; seinen Arbeitsbereich (Dateien, Prozesse, Sprachserver) sieht nur der Eigentümer. Ein Run ohne Eigentümer, etwa aus einem Profil ohne Anmeldung, bleibt runs.read.all vorbehalten. runs.write erlaubt Chat und App-Aktionen in bestehenden eigenen Runs. runs.create ergänzt freie Runs und Startoptionen. Ohne dieses Recht begrenzt startEntries die freigegebenen Run-Scripts; runs.inspect schützt technische Ansichten. Diese Rechte ersetzen keine Sandbox für nativen Code.

Die Liste der eingebauten Rechte unten wird aus builtinPermissions erzeugt. Plugins wählen ihre eigenen Namen und prüfen sie auf Server und Oberfläche.

Vertragsfelder: profileUser.id, profileUser.label, profileUser.password, profileUser.token, profileUser.rights, profileUser.startEntries, environmentReference.kind, environmentReference.name.

### Ein vorbereitetes Setup ohne Anmeldung anbieten

Ein eingeschränkter Zugang kann auch ohne Anmeldung gelten. Der anonymousUser-Export legt seine Rechte und freigegebenen Setups fest. In diesem Beispiel kann jeder Besucher das vorbereitete Wortspiel starten und dessen Mini-App bedienen.

Einsatzort: Neben dem config-Export einer eigenen Profildatei mit ragents.reference; dieses Profil exportiert keine users-Liste.

```typescript
import type { ProfileAnonymousUser } from "@ragents/host/config-definition.js";

export const anonymousUser = {
  id: "visitor",
  label: "Gast",
  rights: ["runs.read", "runs.write"],
  startEntries: ["ragents.reference.word-game"],
} satisfies ProfileAnonymousUser;
```

users und anonymousUser schließen einander aus. Ohne beide Exporte ist das Profil uneingeschränkt. anonymousUser enthält kein Passwort; enabled bleibt im AccessSnapshot false und user beschreibt den eingeschränkten Zugang.

canStartEntry verlangt runs.write und entweder runs.create oder den ausdrücklich freigegebenen Eintrag in startEntries. Ohne runs.create sind nur registrierte Run-Scripts zulässig. Freie Aufträge und Skills mit Vorbereitung sind gesperrt; vorhandene Runs bleiben nach ihren normalen Leserechten zugänglich.

runs.inspect und settings.read fehlen hier: Modellnamen, technische Details und Einstellungen werden nicht angeboten. Der Server prüft die Rechte auch bei direkten HTTP-Aufrufen.

Vertragsfelder: profileAnonymousUser.id, profileAnonymousUser.label, profileAnonymousUser.rights, profileAnonymousUser.startEntries, accessUser.startEntries.

## Serverbeiträge

### Eine Plugin-Route mit eigenen Rechten

Eine HTTP-Route macht eine Pluginfunktion für den Browser oder andere Clients erreichbar. Für Lesen und Ändern kann sie unterschiedliche Rechte verlangen. Der Server prüft diese Rechte, bevor er die Funktion ausführt.

Einsatzort: Innerhalb von register(host); die Nutzdatenverarbeitung ist hier bewusst nur ein kleines bestätigtes Echo.

```typescript
const pathname = "/api/plugins/ragents.example/board";
host.http({
  id: "ragents.example.board",
  isApiPath: (value) => value === pathname,
  matches: (request, url) => ["GET", "POST"].includes(request.method ?? "") && url.pathname === pathname,
  requiredRights: (request) => request.method === "GET"
    ? ["ragents.example.read"] : ["ragents.example.read", "ragents.example.write"],
  handle: ({ response, access }) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ editable: access.can("ragents.example.write") }));
  },
});
```

requiredRights ersetzt die Standardanforderung der Route. Ohne ausdrückliche Liste verlangen GET/HEAD/OPTIONS runs.read, andere Methoden runs.read und runs.write. Weitere fachliche Prüfungen gehören weiterhin in die Operation.

access enthält den angemeldeten Benutzer ohne Passwort und can prüft denselben Rechtevertrag wie die Oberfläche. UI-Ausblenden allein schützt keine HTTP-Route.

Vertragsfelder: httpRoute.requiredRights, httpContext.access, accessContext.can, accessContext.enabled, accessContext.user.

### Pluginidentität und Dateiablage

Plugins können Daten für die ganze Anwendung oder für einen einzelnen Run speichern. Die Anwendung stellt jedem Plugin dafür eigene Ablagepfade bereit und ordnet sie seiner Kennung zu.

Einsatzort: Innerhalb von register(host); Dateien werden hier noch nicht erzeugt.

```typescript
const pluginId = host.manifest.id;
const globalFile = host.storage.root("settings.json");
const runFile = host.storage.session(runId, "notes.json");
const directoryModes = host.storage.modes;
const sessionsRoot = host.storage.sessionsRoot;
```

runId stammt aus dem jeweiligen Host-Aufruf, nicht aus einem fest einkopierten Beispielwert. Pfadsegmente sind einzelne Namen; keine Absolutpfade, Schrägstriche oder übergeordneten Verzeichnisse.

Plugin-Dateien ersetzen keinen journalisierten fachlichen Zustand. Bereinigung gehört in den Plugin-Lebenszyklus.

Vertragsfelder: host.manifest, host.storage, storage.sessionsRoot, storage.modes, storage.root, storage.session.

### Konfiguration und Browserwerte

Plugins können eigene Einstellungen besitzen. Eine Konfigurationsbeschreibung nennt deren Bedeutung und Standardwerte. Über clientConfig veröffentlicht das Plugin die Werte, die seine Oberfläche im Browser benötigt.

Einsatzort: Innerhalb von register(host).

```typescript
host.config(
  { key: "EXAMPLE_LABEL", source: "environment" },
  { key: "EXAMPLE_API_KEY", source: "environment", secret: true },
);
host.clientConfig({ label: "Beispiel", routePrefix: "/api/plugins/ragents.example" });
```

config liest keine Umgebungsvariable und erzeugt keinen Wert. Die Implementierung muss benötigte Werte selbst prüfen; die Host-Hilfen für deklarierte Konfiguration unterstützen das.

Ein secret-Deskriptor macht einen später über clientConfig veröffentlichten Wert nicht geheim.

Vertragsfelder: host.config, host.clientConfig.

### Dienste zwischen Plugins teilen

Ein Dienst ist eine Funktion oder ein Objekt, das mehrere Plugins gemeinsam verwenden können. Ein Plugin stellt den Dienst unter einem typisierten Namen bereit, andere beziehen ihn über diesen Namen. So bleibt die gemeinsame Funktion an einer Stelle implementiert.

Einsatzort: Gemeinsamer Vertrag plus Registrierung; serviceToken kommt aus @ragents/engine.

```typescript
const formatterToken = serviceToken<(text: string) => string>("ragents.example.formatter");
host.provide(formatterToken, (text) => text.trim());
const format = host.service(formatterToken);
const optionalFormat = host.optionalService(formatterToken);
const result = format(" Beispiel ");
```

Der Token gehört in einen serverseitigen gemeinsamen Dienstvertrag, damit Anbieter und Verbraucher denselben Vertrag verwenden. Der Anbieter muss vor dem Verbraucher registrieren.

optionalService ist nur für eine bewusst optionale Fähigkeit bestimmt. Eine erforderliche Integration verwendet service und scheitert beim Fehlen.

Vertragsfelder: host.provide, host.service, host.optionalService.

### HTTP-Routen bereitstellen

Eine HTTP-Route verbindet einen URL-Pfad mit einer Serverfunktion. Plugins können solche Routen selbst anmelden und die passenden Anfragen bearbeiten. Der zentrale Server übernimmt ihre Einbindung.

Einsatzort: Innerhalb von register(host); Beispiel einer zustandslosen GET-Route.

```typescript
const pathname = "/api/plugins/ragents.example/status";
host.http({
  id: "ragents.example.status",
  isApiPath: (value) => value === pathname,
  matches: (request, url) => request.method === "GET" && url.pathname === pathname,
  handle: ({ response }) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ready: true }));
  },
});
```

Runbezogene Routen prüfen den Run über die vorhandenen Hostdienste. Schreiboperationen bleiben an ihre fachlichen Prüfungen und das Journal gebunden.

isApiPath und matches sind verschiedene Prüfungen: zur Erkennung einer API gehört auch ein Pfad mit gerade nicht erlaubter HTTP-Methode.

Vertragsfelder: host.http, httpRoute.id, httpRoute.isApiPath, httpRoute.matches, httpRoute.handle, httpContext.request, httpContext.response, httpContext.url.

### Methoden und Kanäle der API

Ein Plugin ergänzt die JSON-RPC-API um eigene Methoden und Ereigniskanäle. Der Vertrag beschreibt Kennung, Beschreibung, Rechte sowie Eingabe und Ergebnis; Server und Oberfläche verwenden denselben Vertrag.

Einsatzort: Verträge im contract.ts des Plugins, Implementierung innerhalb von register(host).

```typescript
const status = defineOperation({
  id: "ragents.example.status",
  description: "Meldet, ob der Dienst bereit ist.",
  rights: ["runs.read"],
  input: Type.Object({}, { additionalProperties: false }),
  result: Type.Object({ ready: Type.Boolean() }),
});
const heartbeat = defineChannel({
  id: "ragents.example.heartbeat",
  description: "Meldet jeden Herzschlag des Dienstes.",
  rights: ["runs.read"],
  params: Type.Object({}, { additionalProperties: false }),
  message: Type.Object({ at: Type.String() }),
});

host.methods(implement(status, () => ({ ready: service.ready() })));
host.channels(implementChannel(heartbeat, (_params, emit) => service.onBeat((at) => emit({ at }))));
```

Der Dispatcher prüft vor der Ausführung die Rechte und die Eingabe und danach das Ergebnis gegen den Vertrag. Ein DomainError trägt Code und Status in die Antwort.

Die Web-Hälfte ruft denselben Vertrag mit rpc.call auf und abonniert Kanäle mit rpc.subscribe; ein Kanal liefert beim Öffnen seine Abmeldefunktion zurück.

context nennt access, signal, progress, die aufrufende Verbindung und ob die Anfrage lokal ist. Eine Operation mit implementedBy client führt der verbundene Client aus; der Server ruft sie über context.connection.call auf.

Vertragsfelder: host.methods, host.channels.

### Start, Run-Ende und Shutdown

Ein Plugin kann bei Anwendungsstart, beim Stoppen oder Löschen eines Runs und beim Herunterfahren eigene Funktionen ausführen. So lassen sich seine Hintergrunddienste und Ressourcen passend starten und aufräumen.

Einsatzort: register(host); service ist ein zuvor erzeugter Dienst mit den hier gezeigten Methoden.

```typescript
host.lifecycle({
  id: "ragents.example.lifecycle",
  initialize: () => service.initialize(),
  prepareSession: ({ runId }) => service.prepare(runId),
  stopSession: ({ runId, signal }) => service.stop(runId, signal),
  afterStopSession: ({ runId, signal }) => service.stop(runId, signal),
  deleteSession: ({ runId }) => service.remove(runId),
  shutdown: () => service.shutdown(),
});
```

Die Rückgabewerte dürfen void oder Promise<void> sein. Ein Stop-Handler beachtet sein AbortSignal und wartet auf das Ende seiner Arbeit.

afterStopSession läuft nach dem Stillstand der Ausführung und räumt auch spät entstandene Ressourcen auf. Der Run bleibt während dieses zeitlich begrenzten Nachlaufs gesperrt; beide Stop-Phasen müssen wiederholbar sein.

Initialisierung und Vorbereitung folgen der Pluginreihenfolge. Abbau berücksichtigt die umgekehrte Reihenfolge; Stop und Löschen sind unterschiedliche Vorgänge.

Vertragsfelder: host.lifecycle, lifecycle.id, lifecycle.initialize, lifecycle.prepareSession, lifecycle.stopSession, lifecycle.afterStopSession, lifecycle.deleteSession, lifecycle.shutdown.

### Eine typisierte Run-Funktion

Ein Plugin stellt eine Funktion einmal mit Beschreibung, Eingabe, Ergebnis und Implementierung bereit. Ein LLM verwendet sie in einem TypeScript-Snippet; ein dauerhafter Actor ruft dieselbe Funktion mit derselben API auf.

Einsatzort: register(host); Type aus typebox, Helfer aus @ragents/engine.

```typescript
const available = defineToolAvailability({
  availability: "always", availabilityDetail: "In jedem Turn verfügbar.",
}, () => true);
const trim = defineRunFunction({
  name: "example_trim",
  label: "Text kürzen",
  description: "Entfernt äußere Leerzeichen.",
  longDescription: "Leerzeichen innerhalb des Textes bleiben erhalten. Ein reiner Leertext ergibt einen leeren String.",
  schema: Type.Object({ text: Type.String() }),
  resultSchema: Type.Object({ text: Type.String() }),
  available,
  run: (_scope, _callId, input) => ({ text: input.text.trim() }),
});
host.functions(trim);
```

description ist die Kurzbeschreibung der automatischen Funktionsübersicht, label die lesbare Bezeichnung. longDescription ergänzt optional ausführliche Hinweise und Beispiele, die typescript_api gezielt mit den Typverträgen liefert.

Snippets und Actor-Programme rufen context.functions.example_trim({ text }) auf; Eingabe- und Ergebnistypen entstehen aus derselben Registrierung.

nativeTool: true bietet dieselbe Funktion zusätzlich als natives Modellwerkzeug an. Das bleibt die Ausnahme: Standardmäßig genügt die gemeinsame TypeScript-API, und nur wenn der Umweg über TypeScript etwas verliert (Dateiwerkzeuge, native Bild-Eingabe), ist die Option gerechtfertigt.

host.functions nimmt auch Beiträge mit zur Laufzeit aufgelösten Funktionen und Deskriptoren an. Statische Deskriptoren stimmen mit dem Bestand überein; dynamic: true kennzeichnet eine variable Funktionsliste mit leeren statischen descriptors.

availability begrenzt die Verwendung. executionMode: parallel ist nur für dafür geeignete Wirkungen vorgesehen. Modellzugewandte Eingabeschemata haben eine Objektwurzel.

Vertragsfelder: host.functions.

### Eine Fachoperation als Capability

Eine Operation ist eine Serverfunktion, die Actor-Programme und Views verwenden können. Sie wird ihnen als benannte Fähigkeit, eine Capability, mit festgelegten Ein- und Ausgaben angeboten. Ihre Bedienerregel legt fest, ob ein Aufruf direkt, nach Bestätigung oder gar nicht erlaubt ist.

Einsatzort: Innerhalb von register(host); Type kommt aus typebox.

```typescript
host.operations({
  id: "example_trim", label: "Text kürzen",
  description: "Entfernt äußere Leerzeichen.",
  schema: Type.Object({ text: Type.String() }),
  resultSchema: Type.Object({ text: Type.String() }),
  operator: "direct",
  execute: (context, input) => {
    context.signal.throwIfAborted();
    return { text: (input as { text: string }).text.trim() };
  },
});
```

direct erlaubt die Bedieneraktion unmittelbar. confirm verlangt eine bestätigte Frage. unavailable sperrt die Fähigkeit für den Bedienerpfad.

Eine Operation wird dadurch nicht automatisch zum Agentenwerkzeug. Wenn beide Zugänge gebraucht werden, registrieren sie dieselbe Fachfunktion über getrennte Beiträge.

Die Laufzeit prüft Eingabe und Ergebnis erneut; die Typbehauptung im Beispiel ersetzt diese Prüfung nicht.

Vertragsfelder: host.operations.

### Registrierte Operationen aufrufen

Plugins können eine bereits registrierte Operation verwenden, also eine gemeinsame Serverfunktion mit festgelegten Ein- und Ausgaben. Sie schlagen ihren Vertrag nach und rufen sie über dieselbe Prüfung auf, die auch für andere Aufrufer gilt.

Einsatzort: Eine asynchrone Plugin-Funktion erhält operationContext vom Host-Aufruf.

```typescript
const descriptor = host.operation("example_trim");
if (!descriptor) throw new Error("Die Textoperation fehlt.");
const result = await host.invokeOperation(
  descriptor.id,
  operationContext,
  { text: " Beispiel " },
);
```

operationContext trägt runId, invocationId, signal und einen Agenten- oder Bediener-Principal. Die Implementierung darf keine fremde Identität aus Browsereingaben übernehmen.

Die Bestätigung eines Bedieneraufrufs muss aus dem vorgesehenen Bestätigungspfad stammen; ein selbst erfundener Nachweis ist kein Ersatz.

Vertragsfelder: host.operation, host.invokeOperation.

### In die Modellaufrufe eines Agenten eingreifen

Jeder KI-Agent ruft sein Modell in einem Turn mehrmals auf, dazwischen laufen seine Werkzeuge. Ein Agent-Beitrag hängt sich mit zwei Hooks dazwischen: vor jedem Modellaufruf kann er dem Modell einen verborgenen Hinweis mitgeben, nach jedem Werkzeugaufruf dessen Ergebnis ersetzen. Die Agentenlaufzeit dahinter sieht das Plugin nie.

Einsatzort: register(host); der Hinweis erscheint nicht im Chat.

```typescript
host.agentRuntime({
  id: "ragents.example.reminder",
  beforeModelCall: (agent, call) => {
    const count = typeof call.kept === "number" ? call.kept + 1 : 1;
    call.keep(count);
    return agent.audience === "agent" && count % 10 === 0
      ? "Melde dem Koordinator kurz deinen Stand, bevor du weiterarbeitest."
      : undefined;
  },
  afterToolCall: (_agent, outcome) => outcome.toolName === "example_probe" && outcome.isError
    ? { content: [{ type: "text", text: "Die Probe ist gescheitert; nicht wiederholen." }], isError: true }
    : undefined,
});
```

Beide Hooks laufen je Agent; der erste Parameter nennt Run, Agent, Audience und Arbeitsverzeichnis. call.kept und call.keep halten einen JSON-Wert im Gesprächsverlauf des Agenten, auch über einen Neustart; das Modell sieht ihn nie.

Ein Beitrag registriert keine Werkzeuge; Werkzeuge kommen über host.functions. Ein zurückgegebener Hinweis gilt nur für den nächsten Modellaufruf und landet nicht im Journal.

Vertragsfelder: host.agentRuntime.

### Modelle und Rollen

Der Modellkatalog nennt die KI-Modelle, die für Agenten auswählbar sind. Eine Rolle kombiniert ein Modell mit Einstellungen wie Denktiefe und Ausführungsgrenzen. Solche Rollen beschreiben einzelne Agenten; das Profil stellt die gesamte Installation zusammen.

Einsatzort: register(host); modelId ist eine zuvor geprüfte, konfigurierte OpenRouter-Modellkennung.

```typescript
host.profiles({
  id: "ragents.example.models",
  models: () => [{ driver: "agent", provider: "openrouter", model: modelId,
    label: "Konfiguriertes Modell", thinking: ["off", "low", "high"] }],
  profiles: () => [{ name: "example-reviewer", description: "Prüft einen Auftrag.",
    driver: "agent", provider: "openrouter", model: modelId, thinking: "low",
    turnTimeoutMs: null, isolateWorkspace: false }],
});
```

Die Denktiefen müssen vom ausgewählten Modell unterstützt werden. Katalogeinträge liefern keine neue Providerimplementierung; die aktuelle Produktanbindung verwendet OpenRouter.

Das Agentenmodell wird beim Spawn aus dem angebotenen Katalog gewählt. Eine Dokumentation sollte keine wechselnden konkreten Modellkennungen festschreiben.

Vertragsfelder: host.profiles.

### Promptteile und Skills

Ein Prompt gibt einem Agenten Anweisungen für seine Arbeit. Plugins können Textteile beitragen, die die Anwendung in festgelegter Reihenfolge zusammenfügt. Ein Skill ist eine ausführlichere Arbeitsanleitung, die für bestimmte Agenten oder Aufgaben bereitgestellt wird.

Einsatzort: Innerhalb von register(host); skillDirectory ist der absolute Pfad des mitgelieferten Skill-Ordners.

```typescript
host.prompts({
  id: "ragents.example.prompt", order: 200,
  requiresTools: ["example_trim"],
  render: () => "Nutze example_trim für äußere Leerzeichen.",
});
host.skills({
  id: "ragents.example.skills", audiences: ["coordinator", "agent"],
  paths: () => [skillDirectory],
});
```

requiresTools bindet einen Promptteil an die tatsächlich verfügbaren Funktionen. Ein Skill ist kein ausführbarer Actor und kein Plugin.

Alternativ wird skills/<name>/SKILL.md aus dem Plugin-Ordner eingelesen. start: true mit title und category ergänzt eine Vorlage; prompt kann einen eigenen Startauftrag vorgeben, sonst wird der Body verwendet. Explizite Beiträge und automatisch geladene Ordner-Assets dürfen sich nicht unbeabsichtigt doppeln.

Vertragsfelder: host.prompts, host.skills.

### Skills und Run-Scripts als Vorlage

Die Startseite bietet Vorlagen für einen neuen Run an. Ein Skill verbindet einen bearbeitbaren Startauftrag mit einer Arbeitsanleitung und optionalen Dateien. Ein Run-Script liefert einen programmierten Aufbau. Plugins melden beide Arten über denselben Vertrag an.

Einsatzort: Innerhalb von register(host); text-review ist ein registrierter Skill.

```typescript
host.startEntries({
  id: "ragents.example.start", title: "Text prüfen",
  description: "Beginnt mit einem Prüfauftrag.", order: 100,
  tags: ["Anwendungsfall", "Textprüfung"],
  action: "skill", skill: "text-review", category: "Zusammenarbeit",
  prompt: "Bitte prüfe meinen Text auf Widersprüche.",
});
```

category ist für Skill-Vorlagen genau ein freier, nicht leerer Text und bestimmt ihre Gruppe auf der Startseite. tags ist davon unabhängig eine optionale Liste von Schlagworten für Suche, Filter und Referenz. Nur die Tags werden in SKILL.md- und RUN.md-Frontmatter kommagetrennt angegeben. Das Referenz-Plugin liefert Demos und mögliche High-Level-Testfälle. Ihre description erklärt den Demonstrationszweck; Anwendungsfall, Konzeptdemo und Produktkonzepte stehen in tags. Die öffentliche Generierung prüft mindestens zwei unterschiedliche Beispiele pro Produktkonzept. UI-Controls haben keine Beispielquote und müssen nicht vollständig in den Demos vorkommen. Reine Bedienkonzepte verwenden getrennte Anleitungen aus walkthroughs.ts des Referenz-Plugins. Diese erzeugen keine Vorlagen und erweitern den StartEntry-Vertrag nicht.

action: skill verwendet den registrierten Skillnamen. action: script enthält ein RunScriptPackage. guide verweist auf einen gleichnamigen Web-Leitfaden.

fixedStartOptions legt Startoptionen für jeden Run über die Vorlage fest, etwa { "ragents.workspace.binding": { machine: "server", folder: "fresh" } }; in RUN.md heißt die Kopfzeile fixed-start-options. Eine vorher abweichende Wahl ist beim Start ein Fehler, die Startseite zeigt die Option fest.

In Auftrag übernehmen öffnet für jeden Skill den Vorbereitungschat mit dem bearbeitbaren Startauftrag, auch nach einem Leitfaden. Erst Run erstellen sendet den Auftrag mit dem Skillbezug; beim Script wird der Startwert an den vorbereiteten Actor übergeben.

Vertragsfelder: host.startEntries, start.id, start.title, start.description, start.order, start.guide, start.tags, start.fixedStartOptions.

### Startwerte prüfen und einfrieren

Startoptionen sind Werte, die vor einem neuen Run gewählt werden, etwa das Modell. Das Plugin legt erlaubte Werte, einen Standardwert und die Prüfung der Auswahl fest. Beim Start wird der gewählte Wert für den Run gespeichert und fixiert.

Einsatzort: Innerhalb von register(host); Type kommt aus typebox.

```typescript
host.startOptions({
  id: "ragents.example.mode",
  schema: Type.String({ enum: ["brief", "detailed"] }),
  selectable: () => true,
  defaultValue: () => "brief",
  accept: (value) => {
    if (value !== "brief" && value !== "detailed") throw new Error("Ungültiger Modus.");
    return value;
  },
  describe: () => ({
    kind: "choice", label: "Ausführlichkeit",
    options: [{ value: "brief", label: "Kurz" }, { value: "detailed", label: "Ausführlich" }],
  }),
});
```

Die choice-Darstellung funktioniert mit dem vorhandenen Auswahlmenü. Eine eigene Bedienkomponente kann auf der Web-Seite unter derselben Option-ID registriert werden; describe enthält keine Prüfregeln.

Ein voreingestellter Wert muss ebenfalls gültig sein; eine fehlende Voraussetzung wird nicht still ersetzt.

defaultValue, accept und describe bekommen neben runId den handelnden Benutzer als userId, ohne Anmeldung null. Das optionale ownerOnly(value) behält einen Run mit diesem Wert zum Bedienen seinem Eigentümer vor; lesen und stoppen bleiben allen, die ihn sehen.

Vertragsfelder: host.startOptions.

### Run-Metadaten bereitstellen

Ein Plugin kann kurze Zusatzangaben zu einem Run liefern, etwa einen Bearbeitungsstatus. Solche Metadaten stehen der Oberfläche zur Anzeige zur Verfügung. Die zugrunde liegenden Fachdaten bleiben beim Plugin.

Einsatzort: Innerhalb von register(host); Beispiel ohne eigene Datenablage.

```typescript
host.sessionMetadata({
  id: "ragents.example.metadata",
  describe: ({ runId }) => ({ run: runId, label: "Beispiel" }),
});
```

Die passende Anzeige wird getrennt als sessionMetadata- oder Header-Beitrag in der Web-Hälfte registriert.

Vertragsfelder: host.sessionMetadata.

### Die TypeScript-Laufzeit einbinden

Die TypeScript-Laufzeit führt die programmierten Abläufe eines Runs aus. Der Server bindet sie über den Beitrag script ein. Dieser stellt die Ausführung und die verfügbaren Programmierfunktionen bereit.

Einsatzort: Verdrahtungsbeispiel; createRuntime erfüllt ScriptContribution['create'].

```typescript
function registerRuntime(host: PluginRegistration, createRuntime: ScriptContribution["create"]) {
  host.script({ id: "ragents.example.script", create: createRuntime });
}
```

Der Host akzeptiert höchstens einen ScriptRuntime-Beitrag. Actor-Inputs und Actor-Funktionen verwenden gemeinsam diese Plattform.

Normale Fachplugins benötigen diesen Slot nicht; sie ergänzen Werkzeuge oder Operationen mit typisierten Verträgen.

Vertragsfelder: host.script.

## Web-Beiträge

### Eine Plugin-Ansicht ausblenden oder nur lesbar zeigen

Eine Pluginansicht kann dieselben Rechte berücksichtigen wie die zugehörige Serverfunktion. Ohne Leserecht wird sie ausgeblendet; ohne Schreibrecht bleibt die Änderungsschaltfläche deaktiviert. Beide Seiten verwenden dafür dieselben Rechtenamen.

Einsatzort: React-Komponente eines Plugins; useAccess kommt aus dem Web-Host und accessMode aus dem gemeinsamen Rechtevertrag.

```tsx
function BoardAccess() {
  const access = useAccess();
  const mode = accessMode(access, "ragents.example.read", "ragents.example.write");
  if (mode === "hidden") return null;
  return <section>
    <p>Gemeinsame Übersicht</p>
    <button disabled={mode === "readonly"}>Eintrag ändern</button>
  </section>;
}
```

useAccess liefert enabled, user, can und logout. AccessSnapshot enthält bei aktiver Anmeldung ohne Sitzung user: null; ohne Anmeldemodus ist enabled false. Der Snapshot enthält niemals Passwort oder Sitzungstoken.

accessMode ergibt hidden, readonly oder write. hasRight und AccessContext.can berücksichtigen den optionalen Anmeldemodus identisch. Die echte Sendeaktion muss die geschützte Serverroute aufrufen; die Schaltfläche ist hier nur das Zustandsbeispiel.

Vertragsfelder: accessUser.id, accessUser.label, accessUser.rights, accessSnapshot.enabled, accessSnapshot.user.

### Web-Hälfte aktivieren

Die Web-Hälfte eines Plugins liefert seine Oberflächenbeiträge, etwa Reiter oder Einstellungen. Der Export webPlugin beschreibt, wie diese Beiträge aus der öffentlichen Konfiguration entstehen. Er kann sie für eine bestimmte Konfiguration auch ausdrücklich deaktivieren.

Einsatzort: plugins/ragents.example/web/index.tsx; WebPlugin wird aus dem neutralen Web-Hostvertrag importiert.

```tsx
export const webPlugin = {
  id: "ragents.example",
  activate: (config) => {
    if (typeof config.label !== "string") throw new Error("Die Beschriftung fehlt.");
    return { id: "ragents.example", enabled: () => true };
  },
} satisfies WebPlugin;
```

activate darf die Plugin-ID nicht ändern. Deaktivierung entfernt alle Beiträge dieser Web-Hälfte aus der aktiven Registry.

Der Plugin-Ordner wird als eigener Chunk gebaut. Fremde Web-Bundles werden nicht zur Laufzeit nachinstalliert.

Vertragsfelder: webIdentity.id, web.id, web.activate, web.enabled.

### Branding und Chatdarstellung

Ein Produktbeitrag legt Name und Erscheinungsbild der Anwendung fest. Er bestimmt außerdem, wie die Zwischenschritte der Agenten im Chat dargestellt werden, darunter Denkausgaben und Werkzeugaufrufe.

Einsatzort: Eigenschaften eines WebPlugin; genau ein aktiver Branding-Beitrag.

```tsx
const productUi = {
  id: "ragents.example",
  brand: { title: "Beispielwerkstatt", Logo: () => <span>B</span> },
  chatDisplayPolicy: {
    modes: { coordinator: "chips", agents: "compact" },
    stepsVisible: true, stepsExpandable: true, selectable: true,
  },
} satisfies WebPlugin;
```

Mehrere Branding-Beiträge oder mehrere Chat-Display-Policies sind Fehler. Ein Fachplugin neben einem bestehenden Produkt liefert normalerweise keines von beiden.

Vertragsfelder: web.brand, web.chatDisplayPolicy.

### Feste und dynamische Reiter

Ein Plugin kann einen eigenen Reiter mit Symbol, Inhalt und optional einer Statusmarkierung ergänzen. Feste Reiter sind immer Teil seines Angebots. Dynamische Reiter entstehen passend zum Zustand des geöffneten Runs.

Einsatzort: Eigenschaften eines WebPlugin; exampleTabs(session) ist eine eigene, validierende Projektion.

```tsx
const tabs = {
  id: "ragents.example",
  workspaceTabs: [{
    id: "ragents.example.overview", label: "Überblick", order: 100,
    Icon: () => <span>B</span>,
    Panel: ({ active }) => <p>{active ? "Aktiver Reiter" : "Inaktiv"}</p>,
    Badge: () => <span>1</span>,
  }],
  workspaceTabsFor: (session) => exampleTabs(session),
} satisfies WebPlugin;
```

available(session) filtert die Verfügbarkeit, keepMounted erhält eine inaktive Ansicht. Polling wird trotzdem anhand von active gesteuert.

Auch dynamische Tab-IDs müssen eindeutig sein. Im Run-Panel stehen dieselben Reiter in der Symbolleiste am rechten Rand.

Vertragsfelder: web.workspaceTabs, web.workspaceTabsFor.

### Eine zentrale Fläche

Die zentrale Fläche eines Runs zeigt die Beteiligten als Kacheln. Ein Plugin kann die Darstellung dieser Fläche übernehmen. Dafür erhält es die vorhandenen Funktionen für Chats, Navigation, Kartenabschnitte und zusätzliche Elemente.

Einsatzort: Eigenschaften eines WebPlugin; RunPanel ist die Fassung für das Run-Panel.

```tsx
const surfaceUi = {
  id: "ragents.example",
  surface: {
    Center: ({ renderChat }) => <div>{renderChat()}<p>Eigene Fläche</p></div>,
    RunPanel: ({ renderChat }) => <div>{renderChat()}</div>,
  },
} satisfies WebPlugin;
```

Es gibt höchstens einen Flächenbeitrag. Das Beispiel ersetzt die zentrale Fläche; es ergänzt nicht automatisch die bestehende Fläche der Orchestrierung. Ohne RunPanel zeigt das Run-Panel nur den Chat.

toolbarLeft ist Teil des renderChat-Vertrags für den Eigentümer der Fläche. Es gibt keinen allgemeinen Composer-Toolbar-Registry-Slot.

Vertragsfelder: web.surface.

### Elemente auf der vorhandenen Fläche

Ein Plugin kann zusätzliche Elemente als Kacheln auf der vorhandenen Fläche anzeigen. Es liefert dazu die Beschreibung des Elements und seine Darstellung. Das Element ist eine Oberfläche und bearbeitet selbst keine Aufträge.

Einsatzort: Eigenschaften eines WebPlugin.

```tsx
const elements = {
  id: "ragents.example",
  surfaceElements: [{
    id: "ragents.example.note", order: 100,
    select: () => [{ id: "example-note", title: "Hinweis", visible: true }],
    Element: ({ definition }) => <p>{definition.title}</p>,
  }],
} satisfies WebPlugin;
```

Definitionen nennen nur ihre id; title ist optional. visible: false nimmt ein Element aus der Fläche, ohne eine fehlende Kachelreferenz zu melden. Ohne visible ist es sichtbar. Die Größe bestimmt die Kachel, nicht der Beitrag. anchorActorId, entity und eigene data sind optional. Die Kachelaufteilung entscheidet über die Platzierung; der Beitrag allein erzeugt keine Actor-Identität. Das Run-Panel erkennt Besitzer an anchorActorId, auch bei visible: false.

Vertragsfelder: web.surfaceElements, surfaceElement.id, surfaceElement.visible, surfaceElement.title, surfaceElement.anchorActorId, surfaceElement.entity, surfaceElement.data.

### Abschnitte an Actor-Karten

Die Beteiligten eines Runs heißen Actors und werden auf der Fläche als Karten dargestellt. Ein Plugin kann diese Karten um eigene Abschnitte ergänzen, etwa für Dokumente oder einen Status.

Einsatzort: Eigenschaften eines WebPlugin; ein neutraler Abschnitt ohne Zugriff auf Actor-Felder.

```tsx
const cards = {
  id: "ragents.example",
  cardSections: [{ id: "ragents.example.note", order: 100,
    Section: () => <p>Zusätzlicher Karteninhalt</p> }],
} satisfies WebPlugin;
```

actor ist an dieser Grenze unknown. Wer Actor-Felder benutzt, muss sie mit dem Vertrag des zuständigen Plugins prüfen. Ein leerer Beitrag kann null rendern.

Vertragsfelder: web.cardSections.

### Run-Daten und React-Kontext

Mehrere Oberflächenbeiträge eines Plugins können gemeinsame Daten zum geöffneten Run benötigen. Ein SessionProvider reicht diese über React-Kontext weiter. Mit needsRunView fordert das Plugin zusätzlich den vom Server bereitgestellten Zustand des Runs an.

Einsatzort: Eigenschaften eines WebPlugin; der Provider kann hier eigene Context.Provider einsetzen.

```tsx
const sessionUi = {
  id: "ragents.example",
  needsRunView: true,
  SessionProvider: ({ children, session }) => <section aria-label={session.session.title}>{children}</section>,
} satisfies WebPlugin;
```

session.runView ist unknown und muss vor fachlichem Zugriff validiert werden. Ein Provider besitzt session und navigation und wird nur für aktive Plugins eingebunden.

Vertragsfelder: web.needsRunView, web.SessionProvider.

### Übersicht, globale Toolbar und Leisten des Runs

Ein Plugin kann Informationen für die ganze Anwendung oder für den gerade geöffneten Run anzeigen. Beiträge für die ganze Anwendung stehen in der Übersicht oder in der globalen Kopfzeile; Beiträge zum Run folgen der aktuellen Auswahl. Dafür gibt es overviewPanels mit einer Platzierungswahl und sessionHeaders für die Titelleiste oder die Leiste oben an der Fläche.

Einsatzort: Eigenschaften eines WebPlugin.

```tsx
const headers = {
  id: "ragents.example",
  overviewPanels: [
    { id: "ragents.example.panel", order: 100, readRight: "ragents.example.read",
      Panel: ({ open }) => <section>{open ? "Übersicht offen" : "Übersicht verborgen"}</section> },
    { id: "ragents.example.toolbar", order: 110, readRight: "ragents.example.read", placement: "toolbar",
      Panel: ({ open, onOpen, onClose }) => <button onClick={open ? onClose : onOpen}>
        {open ? "Beitrag schließen" : "Beitrag öffnen"}
      </button> },
  ],
  sessionHeaders: [{ id: "ragents.example.run-header", order: 100,
    Header: ({ session }) => <span>{session.running ? "In Arbeit" : "Bereit"}</span> }],
  sessionStatus: [{ id: "ragents.example.run-status", order: 100,
    Status: ({ session }) => <span>{session.connected ? "Verbunden" : "Getrennt"}</span> }],
} satisfies WebPlugin;
```

Der Kontext liefert Registry, open, onOpen, onClose und onBusy. Ohne placement steht der Beitrag in der Übersicht und wird beim ersten Öffnen gemountet. Toolbar-Beiträge sind ab Anwendungsstart gemountet; eigene Verbindungen aktivieren sie erst bei Nutzung. Der Host koordiniert das gegenseitige Schließen. sessionHeaders verwendet standardmäßig placement: header; placement: surface setzt den Beitrag in die Leiste oben an der Fläche. Diese bleibt auch bei einer App-Vollansicht bedienbar. Run-Kopf und untere Statusgruppen erhalten SessionContext und Navigation und folgen dem aktiven Run.

Vertragsfelder: web.overviewPanels, web.sessionHeaders, web.sessionStatus.

### Bearbeitbare Plugin-Einstellungen

Ein Plugin kann eine eigene Oberfläche zum Bearbeiten seiner Einstellungen anbieten. Mit category steht sie unter Modelle oder Darstellung, zusätzlich auf der Einstellungsseite des Plugins. Die Anwendung ordnet sie dem aktiven Plugin zu.

Einsatzort: Eigenschaften eines WebPlugin; ExampleSettings ist die eigene React-Komponente des Plugins.

```tsx
import { useState } from "react";
function ExampleSettings() {
  const [compact, setCompact] = useState(false);
  return <label>
    <input type="checkbox" checked={compact} onChange={(event) => setCompact(event.target.checked)} />
    Kompakte Darstellung
  </label>;
}
const settingsUi = {
  id: "ragents.example",
  settings: [{
    id: "ragents.example.preferences",
    label: "Darstellung",
    category: "appearance",
    readRight: "ragents.example.read",
    order: 100,
    Settings: ExampleSettings,
  }],
} satisfies WebPlugin;
```

category: models zeigt den Beitrag unter Modelle, appearance unter Darstellung. Ohne category bleibt er beim zugehörigen Plugin. Die Formularbereiche laden unabhängig vom technischen Beitragskatalog.

readRight blendet den Beitrag ohne das genannte Recht aus; ohne Angabe gilt settings.read. Die Komponente prüft ihr Schreibrecht mit useAccess und die Serverroute zusätzlich mit requiredRights.

Das Beispiel hält den Wert nur lokal. Settings erhält keine Props; das Plugin verbindet seine Komponente selbst mit Konfiguration, gemeinsamem Zustand und eigenen Serverrouten. Kennungen sind global eindeutig; order ist optional und standardmäßig 0. Ohne aktives Plugin wird kein Einstellungsbereich eingebunden.

Vertragsfelder: web.settings, settings.id, settings.label, settings.category, settings.readRight, settings.order, settings.Settings.

### Startoptionen und Leitfäden bedienen

Vor einem neuen Run können Startoptionen direkt gewählt oder in einem Einrichtungsdialog gesammelt werden. Das Plugin liefert dafür die Oberfläche und verbindet ihre Werte mit dem jeweiligen Serververtrag. Ein Leitfaden ist ein solcher Dialog für einen vorbereiteten Ablauf.

Einsatzort: Eigenschaften eines WebPlugin; die Option wird zusätzlich serverseitig registriert.

```tsx
const starters = {
  id: "ragents.example",
  startOptions: [{ id: "ragents.example.mode", placement: "composer",
    Control: ({ disabled, setValue }) => <button disabled={disabled} onClick={() => void setValue("brief")}>Kurz</button>,
    Badge: () => <span>Modus</span> }],
  guides: [{ id: "ragents.example.guide",
    Guide: ({ onComplete, onCancel }) => <div>
      <button onClick={() => onComplete({ topic: "Beispiel" })}>Starten</button>
      <button onClick={onCancel}>Abbrechen</button>
    </div> }],
} satisfies WebPlugin;
```

placement setzt die Option in die Eingabeleiste (composer) oder unter die Eingabe auf die Startseite (page, Vorgabe). Der Host zeigt sie nur an der gewählten Stelle; Modell und Denktiefe verwenden composer.

Das Objekt im Beispiel ist ein Script-Startwert. Ein Skill-Leitfaden liefert stattdessen den Text der ersten Nachricht. Der StartEntry verweist mit guide auf diese Kennung.

Das Referenz-Plugin liefert zwei vollständige Leitfäden: ConversationGuide sammelt Thema und Rundenzahl für eine Gesprächsrunde; SharedBoardGuide sammelt Titel und ersten Eintrag für ein gemeinsames Sammelboard. Beide beginnen erst nach Abschluss mit dem Run. Die Scripts prüfen die Eingaben vor dem Aufbau.

[Beide React-Leitfäden](../../plugins/ragents.reference/web/StartGuides.tsx)

[Registrierung der Leitfäden](../../plugins/ragents.reference/web/index.tsx)

[Setup der Gesprächsrunde](../../plugins/ragents.reference/run-scripts/conversation-circle/src/server.ts)

[Setup des Sammelboards](../../plugins/ragents.reference/run-scripts/shared-actor-list/src/server.ts)

Vertragsfelder: web.startOptions, web.guides.

### Werkzeuge und Entitäten darstellen

Plugins können festlegen, wie ihre Werkzeugaufrufe im Chat dargestellt werden und wohin Verweise auf ihre Daten führen. Ein Tool-Presenter liefert die Darstellung des Aufrufs. Ein Entity-Presenter übersetzt den Datenverweis in ein Navigationsziel.

Einsatzort: Eigenschaften eines WebPlugin; example.overview ist ein vom Plugin registrierter Tab.

```tsx
const presenters = {
  id: "ragents.example",
  toolPresenters: [{ toolName: "example_trim",
    Inline: () => <span>Textprüfung</span>,
    reveal: () => ({ tabId: "ragents.example.overview" }) }],
  entityPresenters: [{ reveal: (entity) => entity.type === "example-note"
    ? { tabId: "ragents.example.overview", selection: entity.id } : undefined }],
} satisfies WebPlugin;
```

navigation.openTab öffnet einen registrierten Reiter; revealEntity verwendet die Presenter. selection ist ein eigener geprüfter Vertrag zwischen Aufrufer und Zielpanel.

Vertragsfelder: web.toolPresenters, web.entityPresenters.

### Metadaten in Liste und Kopf

Zusatzangaben zu einem Run können in der Run-Liste und in seiner Kopfzeile erscheinen. Das Plugin erhält die Daten des Runs und den Anzeigeort. So kann es denselben Status je nach Platz kurz oder ausführlicher darstellen.

Einsatzort: Eigenschaften eines WebPlugin.

```tsx
const metadata = {
  id: "ragents.example",
  sessionMetadata: [{ id: "ragents.example.metadata", order: 100,
    Metadata: ({ placement }) => <span>{placement === "list" ? "B" : "Beispiel"}</span> }],
} satisfies WebPlugin;
```

Die Bereitstellung fachlicher Werte erfolgt über den serverseitigen sessionMetadata-Beitrag. Die Web-Hälfte zeigt die Werte an.

Vertragsfelder: web.sessionMetadata.

### Aufmerksamkeit und wartende Aktionen

Ein Plugin kann markieren, dass ein Run Aufmerksamkeit braucht. Wartet eine Aktion des Plugins auf eine Eingabe, stellt sein eigener actionViews-Beitrag sie dar und beantwortet sie über seinen Vertrag; der Kern kennt ihre Form nicht. Markierung und Darstellung sind getrennte Beiträge.

Einsatzort: Eigenschaften eines WebPlugin; answerQuestion ist der eigene geprüfte HTTP-Client.

```tsx
const interaction = {
  id: "ragents.example",
  attention: [{ id: "ragents.example.attention",
    assess: (session) => session.running ? { active: true, label: "In Arbeit" } : undefined }],
  actionViews: [{ owner: "ragents.example",
    View: ({ action, session }) => <button onClick={() =>
      void answerQuestion(session.session.id, action.actionId, "ok")}>{String(action.payload)}</button> }],
} satisfies WebPlugin;
```

Je Eigentümer gibt es genau eine Darstellung. Ohne Darstellung zeigt der Chat die Aktion generisch mit Titel, wartet auf Eingabe und Verwerfen. Attention erzeugt selbst keine Aktion oder Hintergrundarbeit.

Vertragsfelder: web.attention, web.actionViews.

## Actor-Programme

### Ein kleines TypeScript-Snippet ausführen

Einmalige Berechnungen, Abfragen und Einrichtungsschritte brauchen keinen eigenen Actor. Das Modell entdeckt die aktuelle API und kombiniert ihre Funktionen direkt in TypeScript.

Einsatzort: code für typescript_eval, oder derselbe Quelltext in einer Datei für path.

```typescript
const actors = await context.functions.actor_list({});
return actors;
```

Der Quelltext ist der Rumpf einer asynchronen Funktion mit context. await und return sind direkt erlaubt; Module werden mit await import(...) geladen. Die Typprüfung läuft vor der Ausführung.

context.log sammelt Ausgaben, return liefert ein JSON-Ergebnis; ohne return ist es null. Lokale Variablen und context.state gelten nur für diese Ausführung.

Registrierte Funktionen und ihre Ein- und Ergebnistypen sind in Snippets und Actor-Programmen dieselben. Ein Snippet handelt als Aufrufer. Bereits abgeschlossene Funktionsaufrufe bleiben bei einem späteren Fehler wirksam.

Für spätere Nachrichten, Ereignisse, dauerhaften Zustand oder Views steht ein Actor-Programm bereit. Die fachliche Aufgabe muss diese technische Wahl nicht vorgeben.

Vertragsfelder: .

### Ein TypeScript-Actor mit Zustand

Ein TypeScript-Actor verarbeitet zugestellte Nachrichten im Code. Funktionen und optionale Views verwenden denselben gespeicherten Zustand. Die Rückgabe einer Funktion ist ein Ergebnis; Zustandsänderungen erfolgen ausdrücklich.

Einsatzort: src/server.ts eines normalen Actor-Pakets.

```typescript
import { defineActor } from "@ragents/server";
import { Type } from "typebox";

export default defineActor({
  state: Type.Object({ processed: Type.Optional(Type.Integer()) }),
  functions: {},
  input: { capabilities: [] },
}, {
  functions: {},
  onInput: (input, context) => {
    context.throwIfAborted();
    const processed = (context.state.read().processed ?? 0) + 1;
    context.state.replace({ processed });
    context.log({ text: input.content, processed });
  },
});
```

defineActor leitet Zustand und Funktionssignaturen aus TypeBox ab. Relative Imports und Node-Bibliotheken sind regulär verfügbar.

Ein LLM-Actor kann Funktionen und Views besitzen; sein normaler Input bleibt beim Modelltreiber. Ein Programm mit onInput wird an ihm abgewiesen.

Vertragsfelder: run.state, run.log, run.throwIfAborted, run.signal.

### Run-Funktionen und Ausführungsidentität

Eine Run-Funktion steht mit identischem Vertrag für Snippets und Actor-Programme bereit. Jeder geprüfte Programmstand, der Build, nennt seine vollständige Liste dieser Funktionen samt Ein- und Ausgabetypen. Die Ausführungsidentität legt fest, in wessen Auftrag das Programm handelt und welche Rechte dabei gelten.

Einsatzort: Ausschnitt in einem asynchronen Actor-Handler; actor_input muss im Build deklariert und erlaubt sein.

```typescript
context.log({ run: context.run.id, actor: context.actor.handle, invocation: context.invocation.id,
  kind: context.invocation.kind, principal: context.principal.kind });
await context.functions.actor_input({
  actor: "@reviewer", content: "Prüfe das neue Ergebnis.",
});
```

Snippets handeln als Aufrufer, onInput als empfangender Actor. Eine aufgerufene Actor-Funktion besitzt ihren Zustand, führt Run-Aufrufe aber als ihr Aufrufer aus. Ein Abo gilt für die handelnde Identität.

@reviewer muss bereits im Run existieren. Laufzeit und Test lösen die Referenz auf; die Anleitung verlangt keine abgeschriebenen Actor-IDs.

Aufrufnamen verwenden Unterstriche, etwa actor_input. Punktierte Namen wie actor.input sind Grants. Zusätzliche Rechte des Actors erweitern einen installierten Build nicht automatisch.

invocation.kind kennt input, snippet, tool und app-action. event und schedule sind bereits als Typwerte deklariert, besitzen aber derzeit keinen eigenen Auslöser.

Vertragsfelder: run.run, run.actor, run.std, run.invocation, run.principal, run.functions.

### Ereignisse abonnieren und Nachrichten weitergeben

Ereignisse melden, was in einem Run geschehen ist, etwa dass ein Agent einen Beitrag abgeschlossen hat. Ein Abonnement, die Subscription, stellt passende neue Ereignisse einem Beteiligten als Nachricht zu. Ein programmierter Vermittler kann daraufhin das Ergebnis weitergeben oder den nächsten Arbeitsschritt anstoßen.

Einsatzort: Ausschnitt in einem Actor-Handler; die aufgeführten Capability-Aufrufe müssen freigegeben sein.

```typescript
await context.functions.event_subscribe({
  sourceActorIds: ["@reviewer"],
  eventTypes: ["model.output.completed"],
});
```

Ein Actor-Handler erhält bei einer Subscription das Quellevent über input.event, ansonsten null. input.content, artifactIds, sourceEventIds und subscriptionId beschreiben die Zustellung.

Der Abonnent benötigt einen neuen Turn; ein laufender Turn wird durch eine Subscription nicht heimlich verändert. Je Actor werden Inputs in Journal-Reihenfolge bearbeitet.

event_unsubscribe entfernt die Subscription. Bereits gespeicherte Events werden nach einem Serverneustart nicht erneut zugestellt.

context.std.mediators.route liefert eine Input-Funktion für feste Weiterleitungsregeln und speichert ihren Zustand ausdrücklich. context.std.now und context.std.id beziehen sich auf den aktuellen Actor-Turn.

Vertragsfelder: .

### Ein Run-Script als vorbereitetes Setup

Ein Run-Script ist ein vollständiges Actor-Programm für den Start eines Runs. Der Host aktiviert es mit demselben Compiler und denselben Fachtests wie ein während des Runs geschriebenes Programm.

Einsatzort: RUN.md; daneben liegen package.json, src/server.ts und tests/*.test.ts.

```markdown
---
title: Beispiel vorbereiten
description: Zählt den ersten Startauftrag.
order: 100
coordinator: true
---

Der Aufbau verwendet das Actor-Programm aus diesem Kapitel.
```

Der Paketordner bestimmt den Handle. package.json.ragents.backend nennt den Einstieg mit defineActor und onInput. Die Fähigkeiten stehen ausschließlich im TypeScript-Vertrag.

Weitere vorbereitete Programme liegen unter actors/<name>/. Der Host kopiert sie in @actors; das Setup aktiviert sie mit actor_program_activate und optionalem Actor-Handle.

coordinator: false lässt den üblichen Koordinator weg. Das Setup muss dann einen anderen Actor zum primären Chatpartner bestimmen.

Vertragsfelder: runScript.handle, runScript.coordinator, runScript.files, runScript.programs.

### Input-Verarbeitung im Fachtest prüfen

Normale TypeScript-Tests prüfen den Input-Handler und seine expliziten Zustandsänderungen. Der Host führt dieselben Tests vor der Aktivierung aus.

Einsatzort: tests/program.test.ts für das vorherige Zählerprogramm.

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import { createTestContext } from "@ragents/server/testing";
import program from "../src/server.ts";

test("merkt sich getrennte Inputs", async () => {
  const context = createTestContext<{ processed?: number }>({ state: {} });
  for (const content of ["eins", "zwei"]) {
    await program.onInput({ id: content, content, artifactIds: [], sourceEventIds: [], subscriptionId: null, event: null }, context);
  }
  assert.deepEqual(context.state.read(), { processed: 2 });
});
```

actor_program_activate prüft, baut, testet und aktiviert das Programm. Es gibt keinen zweiten Check/Test/Install-Vertrag oder Testnachweis als Modellargument.

Ein reines View-Paket benötigt weder einen Input-Handler noch eine erfundene Serverfunktion.

Vertragsfelder: .

### Ein Programm mit optionalen Views

Ein privates TypeScript-Paket kann Funktionen, Input-Verarbeitung und mehrere React-Views bereitstellen. Es bindet an einen vorhandenen Actor oder erzeugt bei einem neuen Backend einen TypeScript-Actor.

Einsatzort: package.json; pro View liefert der Host das HTML-Wurzelelement root.

```json
{
  "name": "shared-list",
  "private": true,
  "type": "module",
  "ragents": {
    "title": "Gemeinsame Liste",
    "description": "Ein Zustand für Funktion und Oberfläche.",
    "backend": "src/server.ts",
    "views": [{ "id": "main", "client": "src/client.tsx", "styles": "src/styles.css" }]
  }
}
```

Mindestens Backend oder eine View muss vorhanden sein. Ohne Backend bindet eine neue View an den aufrufenden Actor; eine Dummy-Installation entfällt.

actor_program_create legt das Paket mit festen lokalen Abhängigkeiten an. Dateiwerkzeuge und Language Server verwenden @actors/<name>/, Bash RAGENTS_ACTORS_DIR.

Geänderte Projektfehler erscheinen vor Modellanfragen als kurze Deltas. actor_program_diagnostics liefert den vollständigen Stand, actor_program_activate prüft und aktiviert.

Vertragsfelder: appPackage.title, appPackage.description, appPackage.backend, appPackage.views.

### Ein Vertrag für Actor-Zustand und Funktionen

Der TypeBox-Vertrag beschreibt die Daten eines Actors und die Ein- und Ausgaben ihrer Funktionen. Eine Funktion ist in der View aufrufbar und kann mit derselben Implementierung zusätzlich in der gemeinsamen TypeScript-API angeboten werden. Die SDK-Typen entstehen daraus automatisch.

Einsatzort: src/contract.ts; gemeinsamer Vertrag für die folgende Backend-Funktion.

```typescript
import { Type } from "typebox";

export const contract = {
  state: Type.Object({ entries: Type.Optional(Type.Array(Type.String())) }),
  functions: {
    append: {
      label: "Eintrag hinzufügen",
      description: "Ergänzt die gemeinsame Liste.",
      input: Type.Object({ text: Type.String() }),
      output: Type.Object({ entries: Type.Array(Type.String()) }),
      capabilities: [],
      tool: { name: "append_to_list", targets: ["self"], card: true },
    },
  },
} as const;
```

Das Zustandsschema akzeptiert {} als Initialwert. input und output bestimmen die Typen des zugehörigen Handlers; capabilities nennt seine benötigten Run-Fähigkeiten.

Ohne targets steht die Funktion aktiven ausführbaren Actors zur Verfügung. self meint den Besitzer des Programms, @handle ein bestimmtes Ziel. card: true erzeugt das Formular aus demselben Eingabevertrag. Eine optionale confirmation fordert eine Bestätigung vor der Aktion.

Nach der Aktivierung steht die Funktion schon im laufenden Modellturn in context.functions bereit. typescript_api liefert ihren aktuellen Vertrag. Erneute Aktivierung aktualisiert das Schema; Entfernen zieht die Funktion zurück.

Pro Actor ist ein Actor-Programm aktiv; weitere Funktionen und Views werden darin ergänzt. Eine reine View braucht keinen Backend-Vertrag. Optionales input im Vertrag verlangt onInput in der Implementierung und ist nur für TypeScript-Actors verfügbar.

Vertragsfelder: appContract.state, appContract.functions, appContract.input, appAction.label, appAction.description, appAction.input, appAction.output, appAction.capabilities, appAction.confirmation, appAction.tool.

### Eine Funktion für View und Werkzeug

Die Funktion verarbeitet eine typisierte Eingabe und ändert den Zustand ihres Actors. Aufrufe aus dessen React-View und über die TypeScript-API verwenden genau diese Implementierung, ohne zusätzlichen Modell-Turn.

Einsatzort: src/server.ts; package.json.ragents.backend nennt diesen Einstieg.

```typescript
import { defineActor } from "@ragents/server";
import { contract } from "./contract.ts";

export default defineActor(contract, {
  functions: {
    append: (input, context) => {
      const entries = [...(context.state.read().entries ?? []), input.text];
      context.state.replace({ entries });
      return { entries };
    },
  },
});
```

Eine Rückgabe ist immer das fachliche Ergebnis. Ausschließlich context.state.replace merkt neuen Actor-Zustand vor.

context.actor nennt den Besitzer der Funktion. Run-Funktionen verwenden die Identität des Aufrufers und die deklarierten Capabilities. onInput handelt als sein Actor.

Vertragsfelder: .

### Fachtests als TypeScript-Dateien

Die Backend-Funktion wird mit normalen Tests und expliziten Abhängigkeiten geprüft. Die Aktivierung führt die vorhandenen Testdateien aus; Fehler verhindern die Übernahme des neuen Stands.

Einsatzort: tests/program.test.ts; läuft mit node --import tsx --test.

```typescript
import assert from "node:assert/strict";
import test from "node:test";
import type { Static } from "typebox";
import { createTestContext } from "@ragents/server/testing";
import { contract } from "../src/contract.ts";
import program from "../src/server.ts";

test("erhält vorhandene Einträge", async () => {
  const context = createTestContext<Static<typeof contract.state>>({ state: { entries: ["Erster"] } });
  assert.deepEqual(await program.functions.append({ text: "Zweiter" }, context), {
    entries: ["Erster", "Zweiter"],
  });
  assert.deepEqual(context.state.read(), { entries: ["Erster", "Zweiter"] });
});
```

createTestContext stellt Zustand, Abbruchsignal und explizit angegebene typisierte Funktionen unter functions bereit. Die Mocks sind TypeScript-Funktionen im Test und kein Werkzeugargument des Modells.

Ein Fachtest prüft die gemeinsame Funktion. Eine echte Browserprüfung muss zusätzlich die sichtbare Bedienung nachweisen.

Vertragsfelder: .

### Views als Kacheln

Eine aktivierte View kann als Kachel auf der Fläche liegen und gehört dabei zu ihrem Actor. Der Benutzer kann sie im Host vergrößern; mehrere Views zeigen denselben Actor-Zustand.

Einsatzort: Ein Eintrag in package.json.ragents.views.

```json
{ "id": "main", "title": "Liste", "client": "src/client.tsx" }
```

actor_view_set_visibility verwendet Paketname/Viewname oder einen eindeutigen Titel. Die View-Kennung ist innerhalb des Pakets eindeutig. Eine View hat keine eigene Größe; die Kachel gibt sie vor, und der zugehörige Actor ist ihr Anker.

actor_view_set_visibility schaltet eine View sichtbar oder unsichtbar. Funktionen und Actor-Zustand bleiben erhalten; die lokale Vollansicht gehört zur Benutzerbedienung.

Views besitzen keine Dialog- oder Fenstersteuerungs-API.

Vertragsfelder: .

### React-View mit Actor-Zustand

Die View liest den intrinsischen Zustand ihres Actors. Neue erfolgreiche Änderungen erscheinen auch bei ruhendem Chat; lokale React-Eingaben bleiben erhalten.

Einsatzort: src/client.tsx für die gemeinsame Liste.

```tsx
import { createRoot } from "react-dom/client";
import { context, useAppState } from "@ragents/client";
import * as UI from "@ragents/client/ui";

function App() {
  const state = useAppState();
  return <>
    <p>Liste von {context.actor.handle}</p>
    <ul>{(state.entries ?? []).map((entry, index) => <li key={index}>{entry}</li>)}</ul>
    <UI.Button onClick={async () => { await context.capabilities.call("append", { text: "Beispiel" }); }}>Ergänzen</UI.Button>
  </>;
}
createRoot(document.getElementById("root")!).render(<App />);
```

context.actor beschreibt den Besitzer der View. ready bestätigt die Bridge, run und principal den gebundenen Run und die Bedieneridentität.

useAppState liest Actor-Zustand reaktiv. state.read und subscribe liefern alternativ Snapshot und Änderungsmeldungen.

context.capabilities.call ruft eine deklarierte Actor-Funktion auf. Lokale Entwürfe gehören in React-Zustand; ein Funktionsaufruf startet keinen Modell-Turn.

Vertragsfelder: app.ready, app.run, app.actor, app.principal, app.state, app.chat, app.capabilities, appState.read, appState.subscribe, appCapabilities.list, appCapabilities.call.

### Chats und wiederverwendbare UI

Eine Mini-App kann das Gespräch ihres Actors anzeigen und bedienen oder einen eigenen kontrollierten Verlauf darstellen. Nachrichtenansicht, Eingabe und weitere UI-Bausteine sind auch einzeln verfügbar.

Einsatzort: src/client.tsx; Alternative für einen bereits vorhandenen Actor dieses Runs.

```tsx
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";
import { context } from "@ragents/client";

function App() {
  return <UI.Chat actor={"@" + context.actor.handle} title="Prüfung" />;
}
createRoot(document.getElementById("root")!).render(<App />);
```

actor und messages/onSend sind unterschiedliche Chat-Varianten. primary bindet den primären Actor; @handle einen benannten Actor des Runs.

Der importierte Kontext bietet context.chat.read(actor), subscribe(actor, listener) und send(actor, text, attachments?). Eine Subscription wird beim Abbau abgemeldet.

UI.MessageList zeigt kontrollierte Nachrichten mit benannten Absendern. Die App liefert Reihenfolge und Inhalt; der Baustein erzeugt keine Antworten.

Die Bausteinreferenz zeigt aktuelle Props und lokale Demos der Komponenten.

Vertragsfelder: chat.read, chat.subscribe, chat.send.

## Produkt- und Laufzeitverträge

### Eine Produktpolitik bereitstellen

Der Koordinator ist der zentrale KI-Ansprechpartner eines Runs und kann Aufgaben an weitere Agenten verteilen. Die Produktpolitik legt seinen Start, die Rollen der Beteiligten und ihre Anweisungen fest. Eine eigene Anwendung stellt diese Regeln als Dienst bereit.

Einsatzort: register(host); policy erfüllt ProductRuntimePolicy, productRuntimeToken kommt aus dem neutralen Server-Host.

```typescript
const policy: ProductRuntimePolicy = {
  coordinator: {
    handle: "coordinator", displayName: "Koordinator", profile: "example-reviewer",
    runTitle: "Neuer Auftrag", ownerHandle: "owner", ownerDisplayName: "Benutzer",
  },
  roleFor: (view, actor) => view.primaryActorId === actor.id ? "primary" : "worker",
  contract: (role) => role === "primary" ? "Koordiniere den Auftrag." : "Bearbeite deinen Teilauftrag.",
  promptComposition: "Produktprompt und Rollenvertrag werden gemeinsam verwendet.",
  systemPrompts: () => ({ mode: "fixed", options: [], defaultIds: [], shareDefault: false }),
};
host.provide(productRuntimeToken, policy);
```

coordinator beschreibt Handle, Anzeigename, Profil, Run-Titel und Owner. roleFor bestimmt primary oder worker, contract liefert den Rollenprompt, promptComposition die Komposition und systemPrompts den Katalog.

Ein neues Fachplugin registriert keinen zweiten Produktdienst neben einem bestehenden Produkt. Die Konfiguration muss einen vollständigen Modellkatalog für das verwendete Profil bereitstellen.

Vertragsfelder: product.coordinator, product.roleFor, product.contract, product.promptComposition, product.systemPrompts.

### Arbeitsbereiche auflösen

Ein Arbeitsbereich legt fest, in welchen Verzeichnissen die Agenten eines Runs mit Dateien und Prozessen arbeiten. Der Dienst WorkspaceRuntime löst diesen Bereich auf und beschreibt ihn. Ein optionaler WorkspaceResolver kann die Zuordnung anpassen, ohne den ganzen Dienst zu ersetzen.

Einsatzort: register(host); workspaceResolverToken kommt aus dem neutralen Server-Host.

```typescript
host.provide(workspaceResolverToken, {
  resolve: async ({ directory }) => ({ cwd: directory }),
});
```

resolve der vollständigen WorkspaceRuntime liefert eine SessionWorkspace mit cwd, currentRoot und runOperation; optional kommen gitEnv, gitConfig und extraEnv hinzu. describe liefert Modus und Verzeichnismuster; placementOf nennt getrennt, ob ein Run auf dem Server oder einem Arbeitsplatz arbeitet und ob in einem neuen oder vorhandenen Ordner, dazu die Art eines beigesteuerten Ordners, und toolNaming kann die vorhandenen Dateiwerkzeuge benennen.

Ein Resolver erhält runId, directory, choice und emitSystem. optionId verbindet die Auswahl mit einer registrierten Startoption. kind beschreibt Kennung, Bezeichnung, Serverordner und Anzeigemuster des beigesteuerten Arbeitsbereichs auf dem Server. workstation stellt den neuen Ordner auf einem Arbeitsplatz: Bezeichnung und Schritte aus Operationen des Executors dort, die nach dem Anlegen (prepare) und vor dem Wegräumen (release) laufen; ohne workstation gibt es mit einem Resolver dort keinen neuen Ordner. Der gezeigte Resolver behält das vom Host vorbereitete Run-Verzeichnis bei.

stopSession und deleteSession ergänzen optional die Lebenszyklusgrenzen des beigesteuerten Arbeitsbereichs. Beim Stoppen erhält der Resolver auch den Abbau der Host-Sandbox; das Löschen folgt erst danach.

transfer beantwortet den Umzug eines Runs auf einen anderen Server: boundDirectory nennt einen vorhandenen Ordner dieses Rechners, an den der Run gebunden ist, assertDirectory prüft einen Ersatzordner, rebind bindet den Run dort an.

Datei- und Prozessarbeit erfolgt über die vorhandene Workspace-Grenze. Ein Plugin wechselt nicht eigenmächtig das globale Arbeitsverzeichnis des Servers.

Vertragsfelder: workspace.resolve, workspace.describe, workspace.placementOf, workspace.toolNaming, workspace.transfer, resolver.optionId, resolver.kind, resolver.workstation, resolver.resolve, resolver.stopSession, resolver.deleteSession.

### Dokumentablage und Git-Ansichten

Die Dokumentablage ordnet jedem Run ein Verzeichnis für ihre Dateien zu. Eine zusätzliche Git-Ansicht kann den Branch, Änderungen und Dateiinhalte eines Arbeitsbereichs liefern. Plugins stellen diese Dienste bereit, damit andere Beiträge dieselben Daten verwenden können.

Einsatzort: register(host); store und gitView erfüllen DocumentStore bzw. GitWorkspaceView.

```typescript
host.provide(documentStoreToken, store);
host.provide(gitWorkspaceViewToken, gitView);
```

DocumentStore löst mit directoryFor(runId) das Dokumentverzeichnis auf und beschreibt sein Verzeichnismuster.

GitWorkspaceView liefert branch(runId), changes(runId) und file(runId, filePath, view), wobei view diff oder current ist. Die Oberfläche erhält eine geprüfte Projektion, keinen freien Git-Prozess.

Vertragsfelder: documents.directoryFor, documents.describe, gitView.branch, gitView.changes, gitView.file.

### Die Modelllaufzeit austauschen

Ein AgentDriver verbindet die Modelllaufzeit mit RAgents. Er bearbeitet eine zugestellte Nachricht in einem Schritt, dem Turn, und verbindet dabei Modell, Werkzeuge, Abbruch und ausgegebene Ereignisse. Der Scheduler, die Ablaufsteuerung von RAgents, beauftragt ihn mit diesen Schritten.

Einsatzort: Ein einfacher Testdriver ohne Modellaufruf; AgentDriver kommt aus @ragents/engine.

```typescript
const testDriver: AgentDriver<"agent"> = {
  kind: "agent",
  supportsPlainLlm: true,
  async runTurn(request, signal) {
    signal.throwIfAborted();
    request.emit({ kind: "assistant", text: request.input.content });
    return { failure: null, usage: {
      inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0, costUsd: 0,
    } };
  },
};
```

kind bestimmt die Treiberart. supportsPlainLlm erklärt den Betrieb ohne RAgents-Werkzeuge. Optional sind disposeAgent, reviveAgent, haltRun, waitForRunSettlement, disposeRun und shutdown für die zugehörigen Lebenszyklusgrenzen.

request liefert unter anderem die zugestellte Eingabe, Prompt, Modellwahl, Werkzeugliste, invoke und Ereignisausgabe. Der Rückgabewert enthält failure und usage.

Es gibt keine host.drivers-Registry. Die derzeitige DriverRegistry kennt die festen Arten agent und script; eine neue Art verlangt eine bewusste Engine-Integration. profiles allein erweitert diese Grenze nicht.

Vertragsfelder: driver.kind, driver.supportsPlainLlm, driver.runTurn, driver.disposeAgent, driver.reviveAgent, driver.haltRun, driver.waitForRunSettlement, driver.disposeRun, driver.shutdown.

### Einen Language Server anbinden

Ein Language Server analysiert Quellcode und liefert Sprachfunktionen wie Fehlermeldungen und Symbolsuche. Ein Adapter beschreibt, wie RAgents das passende Projekt erkennt und den Server startet. Die vorhandene Einbindung macht diese Funktionen als Werkzeuge und Serverzugriffe verfügbar.

Einsatzort: Server-Einstieg für einen einfachen TypeScript-LSP. Node-Helfer und die neutralen language-server-Hosttypen werden importiert.

```typescript
const require = createRequire(import.meta.url);
const languages = { ".ts": "typescript" };
const adapter: LanguageServerAdapter = {
  id: "example", label: "TypeScript", languages,
  rootDescription: "Projektverzeichnis",
  resolveRoot: resolveRootDirectory,
  rootDirectory: (root) => root,
  launch: async (context, root) => ({
    label: "TypeScript", command: process.execPath,
    args: [require.resolve("typescript-language-server/lib/cli.mjs"), "--stdio"],
    cwd: root, env: context.env, uid: context.uid, gid: context.gid,
    rootUri: pathToFileURL(root).href, languages,
    initializationOptions: { tsserver: { path: path.dirname(require.resolve("typescript")) } },
  }),
  open: async () => "TypeScript-Server bereit.",
};
export const plugin: PluginModule = {
  requires: ["ragents.workspace"],
  create: () => createLanguageServerPlugin({ id: "ragents.lsp-example", adapter }),
};
```

languages ordnet Dateiendungen Sprachkennungen zu. resolveRoot prüft das Projektziel, rootDirectory nennt den Ordner, dem eine Datei dieses Ziels zugeordnet wird (das Projektverzeichnis selbst bei TypeScript, der Ordner der Projektdatei bei Roslyn und FSAC), launch liefert den Prozessstartvertrag für den Sandbox-Kontext und open ergänzt bei Bedarf serverspezifische Öffnungsschritte.

Die nötigen Serverprogramme werden als Pluginabhängigkeit installiert. Ein fehlendes Programm wird als Fehler gemeldet; es wird kein Ersatzprozess still gestartet.

Benötigte Imports: createRequire aus node:module, path aus node:path, pathToFileURL aus node:url und die neutralen Helfer LanguageServerAdapter, resolveRootDirectory, createLanguageServerPlugin sowie PluginModule. Die LSP-Initialisierung übernimmt der Host; open ergänzt danach nur serverspezifische Schritte.

Vertragsfelder: lsp.id, lsp.label, lsp.languages, lsp.rootDescription, lsp.resolveRoot, lsp.rootDirectory, lsp.launch, lsp.open.

## Eingebaute Rechte

Die Liste stammt aus den Rechteverträgen des Hosts und des Koordinator-Plugins; Plugins können zusätzliche exakte Namen verwenden.

- runs.read: Runs, Chats, Journale und Arbeitsbereiche ansehen.

- runs.read.all: Die Runs aller Benutzer sehen und bedienen, nicht nur die eigenen; einen Run, den nur sein Eigentümer bedient, nur im Journal lesen und stoppen, ohne seinen Arbeitsbereich.

- runs.write: Vorhandene Runs steuern, Nachrichten senden, freigegebene Setups starten und App-Aktionen ausführen.

- runs.create: Freie Runs erstellen, Startoptionen wählen und Aufträge vorbereiten.

- runs.inspect: Modelle, technische Laufdetails, Journale und Programmquellen ansehen.

- runs.trace: Denk- und Werkzeugschritte im Chat mit Inhalt sehen und ihren Detailgrad wählen.

- runs.delete: Runs und ihre gespeicherten Daten löschen.

- settings.read: Profil, Konfiguration und Plugins ansehen.

- settings.write: Einstellungen und externen Zugang ändern.

- models.use: Modelle über das Modell-Relay dieses Servers aufrufen.

- profile.fetch: Das Client-Profil dieses Servers beschreiben und herunterladen.

- ragents.overseer.read: Den globalen Koordinator und seine Modellauswahl ansehen.

- ragents.overseer.write: Dem globalen Koordinator Aufträge geben und sein Gespräch zurücksetzen.



### Kernmethoden



Automatisch aus den registrierten Verträgen; Methoden ohne feste Rechte prüft der Host je Run. Der globale Koordinator ergänzt seine eigene Regel.



| Methode | Rechte |

| --- | --- |

| ragents.chat.actorHistory | je Run |

| ragents.chat.capabilities | je Run |

| ragents.chat.send | je Run |

| ragents.chat.sendToActor | je Run |

| ragents.chat.start | je Run |

| ragents.chat.stop | je Run |

| ragents.external.set | settings.write |

| ragents.plugins.bootstrap | je Run |

| ragents.runs.delete | runs.read, runs.delete |

| ragents.runs.enqueueInput | je Run |

| ragents.runs.events | je Run |

| ragents.runs.export | runs.read, runs.inspect |

| ragents.runs.import | runs.read, runs.write, runs.create |

| ragents.runs.interruptTurn | je Run |

| ragents.runs.list | runs.read |

| ragents.runs.prepare | runs.read, runs.write, runs.create |

| ragents.runs.resolveAction | je Run |

| ragents.runs.restartActor | je Run |

| ragents.runs.stopActor | je Run |

| ragents.runs.stopAll | je Run |

| ragents.runs.view | je Run |

| ragents.settings.read | settings.read |

| ragents.settings.skill | settings.read |

| ragents.settings.titles.read | settings.read |

| ragents.settings.titles.save | settings.write |

| ragents.startOptions.list | runs.read, runs.create, runs.inspect |

| ragents.startOptions.select | runs.read, runs.write, runs.create, runs.inspect |

## Aktuelle Vertragsflächen

### SettingsContribution

Quelle im Repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface SettingsContribution {
  category?: "models" | "appearance";
  readRight?: string;
  id: string;
  label: string;
  order?: number;
  Settings: ComponentType;
}
```

### ProfileUser

Quelle im Repository: apps/server/src/config-definition.ts

```typescript
export interface ProfileAnonymousUser {
  readonly id: string;
  readonly label?: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}

export interface ProfileUser extends ProfileAnonymousUser {
  readonly password: string | EnvironmentReference;
  /** Dauerhafter Bearer-Token für Clients ohne Anmeldedialog; nur als env(...), nie im Klartext. */
  readonly token?: EnvironmentReference;
}
```

### ProfileAnonymousUser

Quelle im Repository: apps/server/src/config-definition.ts

```typescript
export interface ProfileAnonymousUser {
  readonly id: string;
  readonly label?: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}
```

### EnvironmentReference

Quelle im Repository: apps/server/src/config-definition.ts

```typescript
export interface EnvironmentReference {
  readonly kind: "environment";
  readonly name: string;
}
```

### AccessUser

Quelle im Repository: packages/ragents/src/access.ts

```typescript
export interface AccessUser {
  readonly id: string;
  readonly label: string;
  readonly rights: readonly string[];
  readonly startEntries?: readonly string[];
}
```

### AccessSnapshot

Quelle im Repository: packages/ragents/src/access.ts

```typescript
export interface AccessSnapshot {
  readonly enabled: boolean;
  readonly user: AccessUser | null;
}
```

### AccessContext

Quelle im Repository: packages/ragents/src/access.ts

```typescript
export interface AccessSnapshot {
  readonly enabled: boolean;
  readonly user: AccessUser | null;
}

export interface AccessContext extends AccessSnapshot {
  can(right: string): boolean;
}
```

### HttpRouteContribution

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface HttpRouteContribution {
  id: string;
  isApiPath: (pathname: string) => boolean;
  matches: (request: IncomingMessage, url: URL) => boolean;
  /** Overrides the default runs.read/runs.write check before the handler executes. */
  requiredRights?: readonly string[] | ((request: IncomingMessage, url: URL) => readonly string[]);
  handle: (context: HttpRouteContext) => void | Promise<void>;
}
```

### HttpRouteContext

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface HttpRouteContext {
  request: IncomingMessage;
  response: ServerResponse;
  url: URL;
  access: AccessContext;
}
```

### PluginModule

Quelle im Repository: apps/server/src/plugin-support/plugin-module.ts

```typescript
export interface PluginModule {
  readonly requires?: readonly string[];
  readonly create: (host: PluginHost) => RAgentsPlugin;
}
```

### PluginManifest

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface PluginManifest {
  id: string;
  requires?: readonly string[];
  web?: PluginWebAddresses;
  client?: {
    config?: Readonly<Record<string, unknown>>;
  };
}
```

### RAgentsPlugin

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface RAgentsPlugin {
  manifest: PluginManifest;
  register: (host: PluginRegistration) => void;
}
```

### PluginRegistration

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface PluginRegistration {
  readonly manifest: PluginManifest;
  readonly storage: PluginStorage;
  clientConfig: (values: Readonly<Record<string, unknown>>) => void;
  config: (...descriptors: readonly PluginConfigDescriptor[]) => void;
  channels: (...contributions: readonly ChannelContribution[]) => void;
  methods: (...contributions: readonly MethodContribution[]) => void;
  http: (...routes: readonly HttpRouteContribution[]) => void;
  lifecycle: (...contributions: readonly SessionLifecycleContribution[]) => void;
  operation: (id: string) => RegisteredOperationDescriptor | undefined;
  operations: (...contributions: readonly OperationContribution[]) => void;
  invokeOperation: (id: string, context: OperationContext, input: unknown) => Promise<JsonValue>;
  agentRuntime: (...contributions: readonly AgentContribution[]) => void;
  profiles: (...contributions: readonly ProfileContribution[]) => void;
  prompts: (...contributions: readonly PromptContribution[]) => void;
  provide: <T>(token: ServiceToken<T>, service: T) => void;
  service: <T>(token: ServiceToken<T>) => T;
  optionalService: <T>(token: ServiceToken<T>) => T | undefined;
  sessionMetadata: (...contributions: readonly SessionMetadataContribution[]) => void;
  skills: (...contributions: readonly SkillContribution[]) => void;
  startEntries: (...contributions: readonly StartEntryContribution[]) => void;
  startOptions: (...contributions: readonly StartOptionContribution[]) => void;
  functions: (...functions: readonly (RunFunction | ToolContributor)[]) => void;
  script: (...contributions: readonly ScriptContribution[]) => void;
}
```

### PluginStorage

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface PluginStorage {
  readonly sessionsRoot: string;
  readonly modes: PluginStorageModes;
  root: (...segments: string[]) => string;
  session: (runId: string, ...segments: string[]) => string;
}
```

### SessionLifecycleContribution

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface SessionLifecycleContribution {
  id: string;
  initialize?: () => void | Promise<void>;
  prepareSession?: (context: SessionLifecycleContext) => void | Promise<void>;
  stopSession?: (context: SessionStopContext) => void | Promise<void>;
  afterStopSession?: (context: SessionStopContext) => void | Promise<void>;
  deleteSession?: (context: SessionLifecycleContext) => void | Promise<void>;
  shutdown?: () => void | Promise<void>;
}
```

### RunScriptPackage

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface RunScriptPackage {
  handle: string;
  coordinator: boolean;
  files: readonly ActorProgramFile[];
  programs: readonly BundledActorProgram[];
}
```

### StartEntryBase

Quelle im Repository: packages/ragents/src/plugin-types.ts

```typescript
export interface StartEntryBase {
  id: string;
  title: string;
  description: string;
  order?: number;
  guide?: string;
  /** Searchable labels supplied by the plugin, independent of the entry action. */
  tags?: readonly string[];
  /** Start options this entry fixes, option id to value; a run started through it takes exactly these values. */
  fixedStartOptions?: Readonly<Record<string, JsonValue>>;
}
```

### WebPlugin

Quelle im Repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface WebPluginDescriptor {
  id: string;
}

export interface WebPlugin extends WebPluginDescriptor {
  activate?: (config: Readonly<Record<string, unknown>>) => WebPlugin;
  enabled?: (config: Readonly<Record<string, unknown>>) => boolean;
  brand?: ProductBrand;
  surface?: SurfaceContribution;
  surfaceElements?: SurfaceElementContribution[];
  cardSections?: CardSectionContribution[];
  chatDisplayPolicy?: ChatDisplayPolicy;
  startOptions?: StartOptionContribution[];
  needsRunView?: boolean;
  SessionProvider?: ComponentType<SessionProviderProps>;
  sessionHeaders?: SessionHeaderContribution[];
  sessionStatus?: SessionStatusContribution[];
  overviewPanels?: OverviewPanelContribution[];
  settings?: SettingsContribution[];
  workspaceTabs?: WorkspaceTabContribution[];
  workspaceTabsFor?: (session: SessionContext) => readonly WorkspaceTabContribution[];
  toolPresenters?: ToolPresenterContribution[];
  entityPresenters?: EntityPresenterContribution[];
  guides?: EntryGuideContribution[];
  sessionMetadata?: SessionMetadataContribution[];
  actionViews?: ActionViewContribution[];
  attention?: AttentionContribution[];
}
```

### WebPluginDescriptor

Quelle im Repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface WebPluginDescriptor {
  id: string;
}
```

### SurfaceElementDefinition

Quelle im Repository: apps/web/src/PluginRegistry.tsx

```typescript
export interface SurfaceElementDefinition {
  id: string;
  visible?: boolean;
  title?: string;
  anchorActorId?: string;
  entity?: EntityReference;
  data?: unknown;
}
```

### RunContext

Quelle im Repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
interface RunContext<State> {
  readonly run: { readonly id: string };
  readonly actor: {readonly id: string; readonly handle: string};
  readonly std: RAgentsStd;
  readonly invocation: { readonly id: string; readonly kind: string };
  readonly principal: { readonly id: string; readonly kind: string };
  readonly signal: AbortSignal;
  readonly state: { read(): Readonly<State>; replace(value: State): void };
  readonly functions: {readonly [Name in keyof CapabilityContracts]: (...args: {} extends CapabilityContracts[Name]['input'] ? [input?: CapabilityContracts[Name]['input']] : [input: CapabilityContracts[Name]['input']]) => Promise<CapabilityContracts[Name]['output']>};
  log(value: unknown): void;
  throwIfAborted(): void;
}
```

### AppContext

Quelle im Repository: apps/server/src/plugin-support/actor-programs/client-compiler.ts

```typescript
interface AppContext<State, Actions> {
  readonly ready: Promise<void>;
  readonly run: { readonly id: string };
  readonly actor: { readonly id: string; readonly handle: string };
  readonly principal: { readonly id: string; readonly kind: "operator" };
  readonly state: AppStateView<State>;
  readonly chat: ChatConnection;
  readonly capabilities: AppCapabilities<Actions>;
}
```

### AppStateView

Quelle im Repository: apps/server/src/plugin-support/actor-programs/client-compiler.ts

```typescript
interface AppStateView<State> {
  read(): Readonly<State>;
  subscribe(listener: (state: Readonly<State>) => void): () => void;
}
```

### AppCapabilities

Quelle im Repository: apps/server/src/plugin-support/actor-programs/client-compiler.ts

```typescript
interface AppCapabilities<Actions> {
  list(): ReadonlyArray<keyof Actions & string>;
  call<Name extends keyof Actions & string>(
    name: Name,
    input: Actions[Name] extends { readonly input: infer Input } ? Input : never,
  ): Promise<Actions[Name] extends { readonly output: infer Output } ? Output : never>;
}
```

### ChatConnection

Quelle im Repository: apps/web/src/actor-programs/client-ui/contracts.d.ts

```typescript
export interface ChatConnection {
  read(actor: string): ChatSnapshot | undefined;
  subscribe(actor: string, listener: () => void): () => void;
  send(actor: string, text: string, attachments?: ChatAttachmentInput[]): Promise<void>;
}
```

### appPackageSchema

Quelle im Repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
{
  title: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()), backend: Type.Optional(Type.String({ minLength: 1 })),
  views: Type.Optional(Type.Array(Type.Object({
    id: Type.String({ pattern: "^[a-z][a-z0-9-]{0,63}$" }), title: Type.Optional(Type.String({ minLength: 1 })),
    client: Type.String({ minLength: 1 }), styles: Type.Optional(Type.String()),
  }, { additionalProperties: false }))),
}
```

### appContractSchema

Quelle im Repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
{
  state: schema, functions: Type.Record(Type.String(), actionSchema),
  input: Type.Optional(Type.Object({ capabilities: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })) }, { additionalProperties: false })),
}
```

### actionSchema

Quelle im Repository: apps/server/src/plugin-support/actor-programs/app-project.ts

```typescript
{
  label: Type.String({ minLength: 1 }), description: Type.Optional(Type.String()),
  input: schema, output: schema,
  capabilities: Type.Optional(Type.Array(Type.String(), { uniqueItems: true })),
  confirmation: Type.Optional(Type.String()),
  tool: Type.Optional(Type.Object({ name: Type.String(), targets: Type.Optional(Type.Array(Type.String(), { minItems: 1 })), card: Type.Optional(Type.Boolean()) }, { additionalProperties: false })),
}
```

### ProductRuntimePolicy

Quelle im Repository: apps/server/src/ragents/product-runtime.ts

```typescript
export interface ProductRuntimePolicy {
  coordinator: CoordinatorDescriptor;
  roleFor: (view: ActorRoleView, actor: ProductActor) => ActorRole;
  contract: (role: ActorRole) => string;
  promptComposition: string;
  systemPrompts: () => SystemPromptCatalog;
}
```

### WorkspaceRuntime

Quelle im Repository: apps/server/src/ragents/workspace-runtime.ts

```typescript
export interface WorkspaceRuntime {
  resolve: (runId: string, emitSystem: (text: string) => void) => Promise<SessionWorkspace>;
  describe: () => WorkspaceRuntimeDescription;
  /** Die eine Stelle, an der ein Ablauf zentral fragt, wo und in welchem Ordner ein Run arbeitet. */
  placementOf: (runId: string) => WorkspacePlacement;
  toolNaming?: WorkspaceToolNaming;
  transfer?: WorkspaceTransfer;
}
```

### WorkspaceResolver

Quelle im Repository: apps/server/src/ragents/workspace-runtime.ts

```typescript
export interface WorkspaceResolver {
  optionId?: string;
  kind?: WorkspaceKind;
  /** Den neuen Ordner je Run gibt es mit einem Beitrag auf einem Arbeitsplatz nur, wenn er ihn dort stellt. */
  workstation?: WorkstationFolder;
  resolve: (context: WorkspaceResolverContext) => Promise<WorkspaceResolution>;
  /** Beenden eines Runs im beigesteuerten Arbeitsbereich auf dem Server; `sandbox` beendet dabei die Werkzeuge des Hosts. */
  stopSession?: (runId: string, sandbox: () => Promise<void>) => Promise<void>;
  /** Löschen eines Runs im beigesteuerten Arbeitsbereich auf dem Server, nach dem Beenden. */
  deleteSession?: (runId: string) => Promise<void>;
}
```

### DocumentStore

Quelle im Repository: apps/server/src/ragents/document-store.ts

```typescript
export interface DocumentStore {
  directoryFor: (runId: string) => Promise<string>;
  describe: () => DocumentStoreDescription;
}
```

### GitWorkspaceView

Quelle im Repository: apps/server/src/ragents/workspace-runtime.ts

```typescript
export interface GitWorkspaceView {
  branch: (runId: string) => Promise<string | undefined>;
  changes: (runId: string) => Promise<unknown>;
  /** previousPath nennt die Quelle einer Umbenennung aus der Änderungsliste; nur so paart Git sie ohne die ganze Liste. */
  file: (runId: string, filePath: string, view: "diff" | "current", previousPath?: string) => Promise<unknown>;
}
```

### AgentDriver

Quelle im Repository: packages/ragents/src/drivers/types.ts

```typescript
export interface AgentDriver<Kind extends AutomatedDriverKind = AutomatedDriverKind> {
    readonly kind: Kind;
    readonly supportsPlainLlm?: boolean;
    runTurn(request: TurnRequest<Kind>, signal: AbortSignal): Promise<TurnResult>;
    disposeAgent?(runId: string, agentId: string): Promise<void>;
    reviveAgent?(runId: string, agentId: string): void;
    haltRun?(runId: string): Promise<void>;
    waitForRunSettlement?(runId: string): Promise<void> | undefined;
    disposeRun?(runId: string): Promise<void>;
    shutdown?(): Promise<void>;
}
```

### LanguageServerAdapter

Quelle im Repository: packages/workspace-executor/src/language-server/host.ts

```typescript
export interface LanguageServerAdapter {
  id: string;
  label: string;
  languages: Readonly<Record<string, string>>;
  rootDescription: string;
  resolveRoot: (workspaceRoot: string, root: string) => Promise<string>;
  rootDirectory: (root: string) => string;
  launch: (context: WorkspaceProcessContext, root: string) => Promise<LanguageServerLaunch>;
  open: (session: LanguageServerSession, root: string, timeoutMs: number) => Promise<string>;
}
```
