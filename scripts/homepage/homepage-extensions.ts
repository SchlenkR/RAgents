import { readFile } from "node:fs/promises";
import path from "node:path";
import ts from "typescript";
import { builtinPermissions } from "../../packages/ragents/src/access.js";
import { overseerPermissions } from "../../plugins/ragents.overseer/contract.js";
import { coreContracts, runContracts } from "../../apps/server/src/api/contracts.js";

const permissions = [...builtinPermissions, ...overseerPermissions];

const declaredContracts = (value: object): Array<{ kind: string; id: string; rights: readonly string[] }> => Object.values(value)
  .flatMap((entry: object) => "kind" in entry ? [entry as { kind: string; id: string; rights: readonly string[] }] : declaredContracts(entry));

/** Die Rechte der Kernmethoden; Methoden ohne feste Rechte entscheidet der Host je Run. */
const methodRights = [coreContracts, runContracts].flatMap((group) => declaredContracts(group))
  .filter((contract) => contract.kind === "operation")
  .map((contract) => ({ id: contract.id, rights: [...contract.rights] }))
  .sort((left, right) => left.id.localeCompare(right.id, "en"));

export interface HomepageExtension {
  id: string;
  category: string;
  title: string;
  description: string;
  environment: string;
  example: string;
  language: "typescript" | "tsx" | "json" | "markdown";
  notes: string[];
  covers: string[];
  sources?: { title: string; file: string }[];
}

export interface HomepageExtensionsResult {
  html: string;
  extensions: HomepageExtension[];
  contracts: { name: string; text: string; file: string }[];
  permissions: readonly { id: string; description: string }[];
  methodRights: typeof methodRights;
}

type Contract = { id: string; file: string; name: string; kind?: "schema" | "embedded" };
const contracts: Contract[] = [
  { id: "settings", file: "apps/web/src/PluginRegistry.tsx", name: "SettingsContribution" },
  { id: "profileUser", file: "apps/server/src/config-definition.ts", name: "ProfileUser" },
  { id: "profileAnonymousUser", file: "apps/server/src/config-definition.ts", name: "ProfileAnonymousUser" },
  { id: "environmentReference", file: "apps/server/src/config-definition.ts", name: "EnvironmentReference" },
  { id: "accessUser", file: "packages/ragents/src/access.ts", name: "AccessUser" },
  { id: "accessSnapshot", file: "packages/ragents/src/access.ts", name: "AccessSnapshot" },
  { id: "accessContext", file: "packages/ragents/src/access.ts", name: "AccessContext" },
  { id: "httpRoute", file: "packages/ragents/src/plugin-types.ts", name: "HttpRouteContribution" },
  { id: "httpContext", file: "packages/ragents/src/plugin-types.ts", name: "HttpRouteContext" },
  { id: "module", file: "apps/server/src/plugin-support/plugin-module.ts", name: "PluginModule" },
  { id: "manifest", file: "packages/ragents/src/plugin-types.ts", name: "PluginManifest" },
  { id: "plugin", file: "packages/ragents/src/plugin-types.ts", name: "RAgentsPlugin" },
  { id: "host", file: "packages/ragents/src/plugin-types.ts", name: "PluginRegistration" },
  { id: "storage", file: "packages/ragents/src/plugin-types.ts", name: "PluginStorage" },
  { id: "lifecycle", file: "packages/ragents/src/plugin-types.ts", name: "SessionLifecycleContribution" },
  { id: "runScript", file: "packages/ragents/src/plugin-types.ts", name: "RunScriptPackage" },
  { id: "start", file: "packages/ragents/src/plugin-types.ts", name: "StartEntryBase" },
  { id: "web", file: "apps/web/src/PluginRegistry.tsx", name: "WebPlugin" },
  { id: "webIdentity", file: "apps/web/src/PluginRegistry.tsx", name: "WebPluginDescriptor" },
  { id: "surfaceElement", file: "apps/web/src/PluginRegistry.tsx", name: "SurfaceElementDefinition" },
  { id: "run", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "RunContext", kind: "embedded" },
  { id: "app", file: "apps/server/src/plugin-support/actor-programs/client-compiler.ts", name: "AppContext", kind: "embedded" },
  { id: "appState", file: "apps/server/src/plugin-support/actor-programs/client-compiler.ts", name: "AppStateView", kind: "embedded" },
  { id: "appCapabilities", file: "apps/server/src/plugin-support/actor-programs/client-compiler.ts", name: "AppCapabilities", kind: "embedded" },
  { id: "chat", file: "apps/web/src/actor-programs/client-ui/contracts.d.ts", name: "ChatConnection" },
  { id: "appPackage", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "appPackageSchema", kind: "schema" },
  { id: "appContract", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "appContractSchema", kind: "schema" },
  { id: "appAction", file: "apps/server/src/plugin-support/actor-programs/app-project.ts", name: "actionSchema", kind: "schema" },
  { id: "product", file: "apps/server/src/ragents/product-runtime.ts", name: "ProductRuntimePolicy" },
  { id: "workspace", file: "apps/server/src/ragents/workspace-runtime.ts", name: "WorkspaceRuntime" },
  { id: "resolver", file: "apps/server/src/ragents/workspace-runtime.ts", name: "WorkspaceResolver" },
  { id: "documents", file: "apps/server/src/ragents/document-store.ts", name: "DocumentStore" },
  { id: "gitView", file: "apps/server/src/ragents/workspace-runtime.ts", name: "GitWorkspaceView" },
  { id: "driver", file: "packages/ragents/src/drivers/types.ts", name: "AgentDriver" },
  { id: "lsp", file: "packages/workspace-executor/src/language-server/host.ts", name: "LanguageServerAdapter" },
];

const entry = (id: string, category: string, title: string, description: string, environment: string,
  example: string, covers: string[], notes: string[] = [], language: HomepageExtension["language"] = "typescript", sources?: HomepageExtension["sources"]): HomepageExtension =>
  ({ id, category, title, description, environment, example: example.trim(), covers, notes, language, sources });

const definitions = (): HomepageExtension[] => [
  entry("plugin-module", "Plugin und Profil", "Ein Plugin anlegen", "Ein Plugin bündelt eine zusätzliche Fähigkeit von RAgents, etwa Werkzeuge und die zugehörige Oberfläche. Es liegt in einem eigenen Ordner mit einem Server-Einstieg und bei Bedarf einer Web-Hälfte. Beim Start meldet es der Anwendung, welche Funktionen es bereitstellt.", "plugins/ragents.example/server/index.ts", `
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
};`, ["module.create", "module.requires", "plugin.manifest", "plugin.register", "manifest.id", "manifest.requires", "manifest.client", "manifest.web"], [
    "Abhängigkeiten stehen als requires am exportierten PluginModule. Der Composer prüft ihre Reihenfolge und übernimmt sie in das Manifest.",
    "web im Manifest setzt ebenfalls der Composer: true, wenn der Plugin-Ordner eine Web-Hälfte web/index.tsx enthält. Die Oberfläche verlangt dann, dass das Bundle sie enthält.",
    "Host-Bausteine importiert ein Plugin über die Pakete @ragents/host, @ragents/web und @ragents/engine, andere Plugins über @ragents/plugins/<id>. Damit darf der Plugin-Ordner an beliebiger Stelle liegen; das Profil nennt ihn per Kennung oder Pfad.",
    "create erhält den gesamten PluginHost. register erhält dagegen die auf dieses Plugin gebundene PluginRegistration. Die beiden host-Parameter sind verschiedene Verträge.",
    "client.config im Manifest und host.clientConfig tragen öffentliche Browserkonfiguration. Geheime Werte gehören dort nicht hinein.",
    "Der Plugin-Ordner allein aktiviert nichts. Die Instanz muss die Plugin-ID oder den Ordnerpfad in ihrer Profilkonfiguration aufnehmen; benötigte Produkt- und Workspace-Dienste bleiben Pflicht.",
  ]),
  entry("profile", "Plugin und Profil", "Ein Profil zusammenstellen", "Ein Profil legt fest, welche Plugins und Einstellungen eine RAgents-Installation verwendet. Es stellt damit die verfügbaren Fähigkeiten zusammen. Das Beispiel ergänzt die Grundausstattung core um ein eigenes Plugin.", "ragents.config.example.ts; erweitert die lokal konfigurierte neutrale Basis.", `
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
} as const satisfies RAgentsConfig;`, [], [
    "Die Basiskonfiguration liefert die vorhandenen Pflichtplugins und Modellwerte. Der Einstieg scripts/start.sh example wählt die neue Datei; benötigte Zugangswerte werden lokal konfiguriert.",
    "Ohne gültige Profilwahl startet der Server nicht. Plugins können registrieren, solange der Host noch nicht versiegelt ist; doppelte Kennungen und fehlende Pflichtdienste sind Fehler.",
  ]),
  entry("profile-access", "Plugin und Profil", "Lesen und vorbereitete Setups freigeben", "Ein Profil kann festlegen, wer sich anmelden und welche Funktionen verwenden darf. Dafür nennt sein users-Export die Benutzer und ihre Rechte. Das Beispiel gibt einer Person Leserechte und einer zweiten das vorbereitete Wortspiel samt Chat und Mini-App.", "Neben dem config-Export einer eigenen Profildatei mit ragents.reference; die benannten Passwortvariablen werden lokal gesetzt.", `
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
] satisfies readonly ProfileUser[];`, ["profileUser.id", "profileUser.label", "profileUser.password", "profileUser.token", "profileUser.rights", "profileUser.startEntries", "environmentReference.kind", "environmentReference.name"], [
    "Ohne users-Export gibt es keine Anmeldung. Ein optionaler anonymousUser kann den Zugang trotzdem einschränken. Eine leere users-Liste ist ein Startfehler. Passwörter dürfen Klartext oder env-Referenzen sein und werden niemals im Browser veröffentlicht. Ein persönlicher token (nur als env-Referenz) gilt als Bearer ohne Ablauf für Clients ohne Anmeldedialog, etwa pnpm connect und das Modell-Relay.",
    "Rechte sind exakte Strings. Nur der einzelne Wert * bedeutet alle Rechte; Teilmuster und Vererbung gibt es nicht. Ein Run gehört dem Benutzer, der ihn angelegt hat; ein Bedienerzugang erreicht nur seine eigenen Runs, runs.read.all zeigt die aller Benutzer. Einen Run, den eine Startoption mit ownerOnly seinem Eigentümer vorbehält, etwa durch die Bindung an einen Arbeitsplatz, kann runs.read.all nur im Journal lesen und stoppen; seinen Arbeitsbereich (Dateien, Prozesse, Sprachserver) sieht nur der Eigentümer. Ein Run ohne Eigentümer, etwa aus einem Profil ohne Anmeldung, bleibt runs.read.all vorbehalten. runs.write erlaubt Chat und App-Aktionen in bestehenden eigenen Runs. runs.create ergänzt freie Runs und Startoptionen. Ohne dieses Recht begrenzt startEntries die freigegebenen Run-Scripts; runs.inspect schützt technische Ansichten. Diese Rechte ersetzen keine Sandbox für nativen Code.",
    "Die Liste der eingebauten Rechte unten wird aus builtinPermissions erzeugt. Plugins wählen ihre eigenen Namen und prüfen sie auf Server und Oberfläche.",
  ]),
  entry("profile-anonymous", "Plugin und Profil", "Ein vorbereitetes Setup ohne Anmeldung anbieten", "Ein eingeschränkter Zugang kann auch ohne Anmeldung gelten. Der anonymousUser-Export legt seine Rechte und freigegebenen Setups fest. In diesem Beispiel kann jeder Besucher das vorbereitete Wortspiel starten und dessen Mini-App bedienen.", "Neben dem config-Export einer eigenen Profildatei mit ragents.reference; dieses Profil exportiert keine users-Liste.", `
import type { ProfileAnonymousUser } from "@ragents/host/config-definition.js";

export const anonymousUser = {
  id: "visitor",
  label: "Gast",
  rights: ["runs.read", "runs.write"],
  startEntries: ["ragents.reference.word-game"],
} satisfies ProfileAnonymousUser;`, ["profileAnonymousUser.id", "profileAnonymousUser.label", "profileAnonymousUser.rights", "profileAnonymousUser.startEntries", "accessUser.startEntries"], [
    "users und anonymousUser schließen einander aus. Ohne beide Exporte ist das Profil uneingeschränkt. anonymousUser enthält kein Passwort; enabled bleibt im AccessSnapshot false und user beschreibt den eingeschränkten Zugang.",
    "canStartEntry verlangt runs.write und entweder runs.create oder den ausdrücklich freigegebenen Eintrag in startEntries. Ohne runs.create sind nur registrierte Run-Scripts zulässig. Freie Aufträge und Skills mit Vorbereitung sind gesperrt; vorhandene Runs bleiben nach ihren normalen Leserechten zugänglich.",
    "runs.inspect und settings.read fehlen hier: Modellnamen, technische Details und Einstellungen werden nicht angeboten. Der Server prüft die Rechte auch bei direkten HTTP-Aufrufen.",
  ]),
  entry("access-route", "Serverbeiträge", "Eine Plugin-Route mit eigenen Rechten", "Eine HTTP-Route macht eine Pluginfunktion für den Browser oder andere Clients erreichbar. Für Lesen und Ändern kann sie unterschiedliche Rechte verlangen. Der Server prüft diese Rechte, bevor er die Funktion ausführt.", "Innerhalb von register(host); die Nutzdatenverarbeitung ist hier bewusst nur ein kleines bestätigtes Echo.", `
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
});`, ["httpRoute.requiredRights", "httpContext.access", "accessContext.can", "accessContext.enabled", "accessContext.user"], [
    "requiredRights ersetzt die Standardanforderung der Route. Ohne ausdrückliche Liste verlangen GET/HEAD/OPTIONS runs.read, andere Methoden runs.read und runs.write. Weitere fachliche Prüfungen gehören weiterhin in die Operation.",
    "access enthält den angemeldeten Benutzer ohne Passwort und can prüft denselben Rechtevertrag wie die Oberfläche. UI-Ausblenden allein schützt keine HTTP-Route.",
  ]),
  entry("access-view", "Web-Beiträge", "Eine Plugin-Ansicht ausblenden oder nur lesbar zeigen", "Eine Pluginansicht kann dieselben Rechte berücksichtigen wie die zugehörige Serverfunktion. Ohne Leserecht wird sie ausgeblendet; ohne Schreibrecht bleibt die Änderungsschaltfläche deaktiviert. Beide Seiten verwenden dafür dieselben Rechtenamen.", "React-Komponente eines Plugins; useAccess kommt aus dem Web-Host und accessMode aus dem gemeinsamen Rechtevertrag.", `
function BoardAccess() {
  const access = useAccess();
  const mode = accessMode(access, "ragents.example.read", "ragents.example.write");
  if (mode === "hidden") return null;
  return <section>
    <p>Gemeinsame Übersicht</p>
    <button disabled={mode === "readonly"}>Eintrag ändern</button>
  </section>;
}`, ["accessUser.id", "accessUser.label", "accessUser.rights", "accessSnapshot.enabled", "accessSnapshot.user"], [
    "useAccess liefert enabled, user, can und logout. AccessSnapshot enthält bei aktiver Anmeldung ohne Sitzung user: null; ohne Anmeldemodus ist enabled false. Der Snapshot enthält niemals Passwort oder Sitzungstoken.",
    "accessMode ergibt hidden, readonly oder write. hasRight und AccessContext.can berücksichtigen den optionalen Anmeldemodus identisch. Die echte Sendeaktion muss die geschützte Serverroute aufrufen; die Schaltfläche ist hier nur das Zustandsbeispiel.",
  ], "tsx"),
  entry("storage", "Serverbeiträge", "Pluginidentität und Dateiablage", "Plugins können Daten für die ganze Anwendung oder für einen einzelnen Run speichern. Die Anwendung stellt jedem Plugin dafür eigene Ablagepfade bereit und ordnet sie seiner Kennung zu.", "Innerhalb von register(host); Dateien werden hier noch nicht erzeugt.", `
const pluginId = host.manifest.id;
const globalFile = host.storage.root("settings.json");
const runFile = host.storage.session(runId, "notes.json");
const directoryModes = host.storage.modes;
const sessionsRoot = host.storage.sessionsRoot;`, ["host.manifest", "host.storage", "storage.sessionsRoot", "storage.modes", "storage.root", "storage.session"], [
    "runId stammt aus dem jeweiligen Host-Aufruf, nicht aus einem fest einkopierten Beispielwert. Pfadsegmente sind einzelne Namen; keine Absolutpfade, Schrägstriche oder übergeordneten Verzeichnisse.",
    "Plugin-Dateien ersetzen keinen journalisierten fachlichen Zustand. Bereinigung gehört in den Plugin-Lebenszyklus.",
  ]),
  entry("config", "Serverbeiträge", "Konfiguration und Browserwerte", "Plugins können eigene Einstellungen besitzen. Eine Konfigurationsbeschreibung nennt deren Bedeutung und Standardwerte. Über clientConfig veröffentlicht das Plugin die Werte, die seine Oberfläche im Browser benötigt.", "Innerhalb von register(host).", `
host.config(
  { key: "EXAMPLE_LABEL", source: "environment" },
  { key: "EXAMPLE_API_KEY", source: "environment", secret: true },
);
host.clientConfig({ label: "Beispiel", routePrefix: "/api/plugins/ragents.example" });`, ["host.config", "host.clientConfig"], [
    "config liest keine Umgebungsvariable und erzeugt keinen Wert. Die Implementierung muss benötigte Werte selbst prüfen; die Host-Hilfen für deklarierte Konfiguration unterstützen das.",
    "Ein secret-Deskriptor macht einen später über clientConfig veröffentlichten Wert nicht geheim.",
  ]),
  entry("services", "Serverbeiträge", "Dienste zwischen Plugins teilen", "Ein Dienst ist eine Funktion oder ein Objekt, das mehrere Plugins gemeinsam verwenden können. Ein Plugin stellt den Dienst unter einem typisierten Namen bereit, andere beziehen ihn über diesen Namen. So bleibt die gemeinsame Funktion an einer Stelle implementiert.", "Gemeinsamer Vertrag plus Registrierung; serviceToken kommt aus @ragents/engine.", `
const formatterToken = serviceToken<(text: string) => string>("ragents.example.formatter");
host.provide(formatterToken, (text) => text.trim());
const format = host.service(formatterToken);
const optionalFormat = host.optionalService(formatterToken);
const result = format(" Beispiel ");`, ["host.provide", "host.service", "host.optionalService"], [
    "Der Token gehört in einen serverseitigen gemeinsamen Dienstvertrag, damit Anbieter und Verbraucher denselben Vertrag verwenden. Der Anbieter muss vor dem Verbraucher registrieren.",
    "optionalService ist nur für eine bewusst optionale Fähigkeit bestimmt. Eine erforderliche Integration verwendet service und scheitert beim Fehlen.",
  ]),
  entry("http", "Serverbeiträge", "HTTP-Routen bereitstellen", "Eine HTTP-Route verbindet einen URL-Pfad mit einer Serverfunktion. Plugins können solche Routen selbst anmelden und die passenden Anfragen bearbeiten. Der zentrale Server übernimmt ihre Einbindung.", "Innerhalb von register(host); Beispiel einer zustandslosen GET-Route.", `
const pathname = "/api/plugins/ragents.example/status";
host.http({
  id: "ragents.example.status",
  isApiPath: (value) => value === pathname,
  matches: (request, url) => request.method === "GET" && url.pathname === pathname,
  handle: ({ response }) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ ready: true }));
  },
});`, ["host.http", "httpRoute.id", "httpRoute.isApiPath", "httpRoute.matches", "httpRoute.handle", "httpContext.request", "httpContext.response", "httpContext.url"], [
    "Runbezogene Routen prüfen den Run über die vorhandenen Hostdienste. Schreiboperationen bleiben an ihre fachlichen Prüfungen und das Journal gebunden.",
    "isApiPath und matches sind verschiedene Prüfungen: zur Erkennung einer API gehört auch ein Pfad mit gerade nicht erlaubter HTTP-Methode.",
  ]),
  entry("methods", "Serverbeiträge", "Methoden und Kanäle der API", "Ein Plugin ergänzt die JSON-RPC-API um eigene Methoden und Ereigniskanäle. Der Vertrag beschreibt Kennung, Beschreibung, Rechte sowie Eingabe und Ergebnis; Server und Oberfläche verwenden denselben Vertrag.", "Verträge im contract.ts des Plugins, Implementierung innerhalb von register(host).", `
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
host.channels(implementChannel(heartbeat, (_params, emit) => service.onBeat((at) => emit({ at }))));`, ["host.methods", "host.channels"], [
    "Der Dispatcher prüft vor der Ausführung die Rechte und die Eingabe und danach das Ergebnis gegen den Vertrag. Ein DomainError trägt Code und Status in die Antwort.",
    "Die Web-Hälfte ruft denselben Vertrag mit rpc.call auf und abonniert Kanäle mit rpc.subscribe; ein Kanal liefert beim Öffnen seine Abmeldefunktion zurück.",
    "context nennt access, signal, progress, die aufrufende Verbindung und ob die Anfrage lokal ist. Eine Operation mit implementedBy client führt der verbundene Client aus; der Server ruft sie über context.connection.call auf.",
  ]),
  entry("lifecycle", "Serverbeiträge", "Start, Run-Ende und Shutdown", "Ein Plugin kann bei Anwendungsstart, beim Stoppen oder Löschen eines Runs und beim Herunterfahren eigene Funktionen ausführen. So lassen sich seine Hintergrunddienste und Ressourcen passend starten und aufräumen.", "register(host); service ist ein zuvor erzeugter Dienst mit den hier gezeigten Methoden.", `
host.lifecycle({
  id: "ragents.example.lifecycle",
  initialize: () => service.initialize(),
  prepareSession: ({ runId }) => service.prepare(runId),
  stopSession: ({ runId, signal }) => service.stop(runId, signal),
  afterStopSession: ({ runId, signal }) => service.stop(runId, signal),
  deleteSession: ({ runId }) => service.remove(runId),
  shutdown: () => service.shutdown(),
});`, ["host.lifecycle", "lifecycle.id", "lifecycle.initialize", "lifecycle.prepareSession", "lifecycle.stopSession", "lifecycle.afterStopSession", "lifecycle.deleteSession", "lifecycle.shutdown"], [
    "Die Rückgabewerte dürfen void oder Promise<void> sein. Ein Stop-Handler beachtet sein AbortSignal und wartet auf das Ende seiner Arbeit.",
    "afterStopSession läuft nach dem Stillstand der Ausführung und räumt auch spät entstandene Ressourcen auf. Der Run bleibt während dieses zeitlich begrenzten Nachlaufs gesperrt; beide Stop-Phasen müssen wiederholbar sein.",
    "Initialisierung und Vorbereitung folgen der Pluginreihenfolge. Abbau berücksichtigt die umgekehrte Reihenfolge; Stop und Löschen sind unterschiedliche Vorgänge.",
  ]),
  entry("tools", "Serverbeiträge", "Eine typisierte Run-Funktion", "Ein Plugin stellt eine Funktion einmal mit Beschreibung, Eingabe, Ergebnis und Implementierung bereit. Ein LLM verwendet sie in einem TypeScript-Snippet; ein dauerhafter Actor ruft dieselbe Funktion mit derselben API auf.", "register(host); Type aus typebox, Helfer aus @ragents/engine.", `
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
host.functions(trim);`, ["host.functions"], [
    "description ist die Kurzbeschreibung der automatischen Funktionsübersicht, label die lesbare Bezeichnung. longDescription ergänzt optional ausführliche Hinweise und Beispiele, die typescript_api gezielt mit den Typverträgen liefert.",
    "Snippets und Actor-Programme rufen context.functions.example_trim({ text }) auf; Eingabe- und Ergebnistypen entstehen aus derselben Registrierung.",
    "nativeTool: true bietet dieselbe Funktion zusätzlich als natives Modellwerkzeug an. Das bleibt die Ausnahme: Standardmäßig genügt die gemeinsame TypeScript-API, und nur wenn der Umweg über TypeScript etwas verliert (Dateiwerkzeuge, native Bild-Eingabe), ist die Option gerechtfertigt.",
    "host.functions nimmt auch Beiträge mit zur Laufzeit aufgelösten Funktionen und Deskriptoren an. Statische Deskriptoren stimmen mit dem Bestand überein; dynamic: true kennzeichnet eine variable Funktionsliste mit leeren statischen descriptors.",
    "availability begrenzt die Verwendung. executionMode: parallel ist nur für dafür geeignete Wirkungen vorgesehen. Modellzugewandte Eingabeschemata haben eine Objektwurzel.",
  ]),
  entry("operations", "Serverbeiträge", "Eine Fachoperation als Capability", "Eine Operation ist eine Serverfunktion, die Actor-Programme und Views verwenden können. Sie wird ihnen als benannte Fähigkeit, eine Capability, mit festgelegten Ein- und Ausgaben angeboten. Ihre Bedienerregel legt fest, ob ein Aufruf direkt, nach Bestätigung oder gar nicht erlaubt ist.", "Innerhalb von register(host); Type kommt aus typebox.", `
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
});`, ["host.operations"], [
    "direct erlaubt die Bedieneraktion unmittelbar. confirm verlangt eine bestätigte Frage. unavailable sperrt die Fähigkeit für den Bedienerpfad.",
    "Eine Operation wird dadurch nicht automatisch zum Agentenwerkzeug. Wenn beide Zugänge gebraucht werden, registrieren sie dieselbe Fachfunktion über getrennte Beiträge.",
    "Die Laufzeit prüft Eingabe und Ergebnis erneut; die Typbehauptung im Beispiel ersetzt diese Prüfung nicht.",
  ]),
  entry("invoke-operation", "Serverbeiträge", "Registrierte Operationen aufrufen", "Plugins können eine bereits registrierte Operation verwenden, also eine gemeinsame Serverfunktion mit festgelegten Ein- und Ausgaben. Sie schlagen ihren Vertrag nach und rufen sie über dieselbe Prüfung auf, die auch für andere Aufrufer gilt.", "Eine asynchrone Plugin-Funktion erhält operationContext vom Host-Aufruf.", `
const descriptor = host.operation("example_trim");
if (!descriptor) throw new Error("Die Textoperation fehlt.");
const result = await host.invokeOperation(
  descriptor.id,
  operationContext,
  { text: " Beispiel " },
);`, ["host.operation", "host.invokeOperation"], [
    "operationContext trägt runId, invocationId, signal und einen Agenten- oder Bediener-Principal. Die Implementierung darf keine fremde Identität aus Browsereingaben übernehmen.",
    "Die Bestätigung eines Bedieneraufrufs muss aus dem vorgesehenen Bestätigungspfad stammen; ein selbst erfundener Nachweis ist kein Ersatz.",
  ]),
  entry("agent-runtime", "Serverbeiträge", "In die Modellaufrufe eines Agenten eingreifen", "Jeder KI-Agent ruft sein Modell in einem Turn mehrmals auf, dazwischen laufen seine Werkzeuge. Ein Agent-Beitrag hängt sich mit zwei Hooks dazwischen: vor jedem Modellaufruf kann er dem Modell einen verborgenen Hinweis mitgeben, nach jedem Werkzeugaufruf dessen Ergebnis ersetzen. Die Agentenlaufzeit dahinter sieht das Plugin nie.", "register(host); der Hinweis erscheint nicht im Chat.", `
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
});`, ["host.agentRuntime"], [
    "Beide Hooks laufen je Agent; der erste Parameter nennt Run, Agent, Audience und Arbeitsverzeichnis. call.kept und call.keep halten einen JSON-Wert im Gesprächsverlauf des Agenten, auch über einen Neustart; das Modell sieht ihn nie.",
    "Ein Beitrag registriert keine Werkzeuge; Werkzeuge kommen über host.functions. Ein zurückgegebener Hinweis gilt nur für den nächsten Modellaufruf und landet nicht im Journal.",
  ]),
  entry("models", "Serverbeiträge", "Modelle und Rollen", "Der Modellkatalog nennt die KI-Modelle, die für Agenten auswählbar sind. Eine Rolle kombiniert ein Modell mit Einstellungen wie Denktiefe und Ausführungsgrenzen. Solche Rollen beschreiben einzelne Agenten; das Profil stellt die gesamte Installation zusammen.", "register(host); modelId ist eine zuvor geprüfte, konfigurierte OpenRouter-Modellkennung.", `
host.profiles({
  id: "ragents.example.models",
  models: () => [{ driver: "agent", provider: "openrouter", model: modelId,
    label: "Konfiguriertes Modell", thinking: ["off", "low", "high"] }],
  profiles: () => [{ name: "example-reviewer", description: "Prüft einen Auftrag.",
    driver: "agent", provider: "openrouter", model: modelId, thinking: "low",
    turnTimeoutMs: null, isolateWorkspace: false }],
});`, ["host.profiles"], [
    "Die Denktiefen müssen vom ausgewählten Modell unterstützt werden. Katalogeinträge liefern keine neue Providerimplementierung; die aktuelle Produktanbindung verwendet OpenRouter.",
    "Das Agentenmodell wird beim Spawn aus dem angebotenen Katalog gewählt. Eine Dokumentation sollte keine wechselnden konkreten Modellkennungen festschreiben.",
  ]),
  entry("prompts", "Serverbeiträge", "Promptteile und Skills", "Ein Prompt gibt einem Agenten Anweisungen für seine Arbeit. Plugins können Textteile beitragen, die die Anwendung in festgelegter Reihenfolge zusammenfügt. Ein Skill ist eine ausführlichere Arbeitsanleitung, die für bestimmte Agenten oder Aufgaben bereitgestellt wird.", "Innerhalb von register(host); skillDirectory ist der absolute Pfad des mitgelieferten Skill-Ordners.", `
host.prompts({
  id: "ragents.example.prompt", order: 200,
  requiresTools: ["example_trim"],
  render: () => "Nutze example_trim für äußere Leerzeichen.",
});
host.skills({
  id: "ragents.example.skills", audiences: ["coordinator", "agent"],
  paths: () => [skillDirectory],
});`, ["host.prompts", "host.skills"], [
    "requiresTools bindet einen Promptteil an die tatsächlich verfügbaren Funktionen. Ein Skill ist kein ausführbarer Actor und kein Plugin.",
    "Alternativ wird skills/<name>/SKILL.md aus dem Plugin-Ordner eingelesen. start: true mit title und category ergänzt eine Vorlage; prompt kann einen eigenen Startauftrag vorgeben, sonst wird der Body verwendet. Explizite Beiträge und automatisch geladene Ordner-Assets dürfen sich nicht unbeabsichtigt doppeln.",
  ]),
  entry("start-entries", "Serverbeiträge", "Skills und Run-Scripts als Vorlage", "Die Startseite bietet Vorlagen für einen neuen Run an. Ein Skill verbindet einen bearbeitbaren Startauftrag mit einer Arbeitsanleitung und optionalen Dateien. Ein Run-Script liefert einen programmierten Aufbau. Plugins melden beide Arten über denselben Vertrag an.", "Innerhalb von register(host); text-review ist ein registrierter Skill.", `
host.startEntries({
  id: "ragents.example.start", title: "Text prüfen",
  description: "Beginnt mit einem Prüfauftrag.", order: 100,
  tags: ["Anwendungsfall", "Textprüfung"],
  action: "skill", skill: "text-review", category: "Zusammenarbeit",
  prompt: "Bitte prüfe meinen Text auf Widersprüche.",
});`, ["host.startEntries", "start.id", "start.title", "start.description", "start.order", "start.guide", "start.tags", "start.fixedStartOptions"], [
    "category ist für Skill-Vorlagen genau ein freier, nicht leerer Text und bestimmt ihre Gruppe auf der Startseite. tags ist davon unabhängig eine optionale Liste von Schlagworten für Suche, Filter und Referenz. Nur die Tags werden in SKILL.md- und RUN.md-Frontmatter kommagetrennt angegeben. Das Referenz-Plugin liefert Demos und mögliche High-Level-Testfälle. Ihre description erklärt den Demonstrationszweck; Anwendungsfall, Konzeptdemo und Produktkonzepte stehen in tags. Die öffentliche Generierung prüft mindestens zwei unterschiedliche Beispiele pro Produktkonzept. UI-Controls haben keine Beispielquote und müssen nicht vollständig in den Demos vorkommen. Reine Bedienkonzepte verwenden getrennte Anleitungen aus walkthroughs.ts des Referenz-Plugins. Diese erzeugen keine Vorlagen und erweitern den StartEntry-Vertrag nicht.",
    "action: skill verwendet den registrierten Skillnamen. action: script enthält ein RunScriptPackage. guide verweist auf einen gleichnamigen Web-Leitfaden.",
    "fixedStartOptions legt Startoptionen für jeden Run über die Vorlage fest, etwa { \"ragents.workspace.binding\": { machine: \"server\", folder: \"fresh\" } }; in RUN.md heißt die Kopfzeile fixed-start-options. Eine vorher abweichende Wahl ist beim Start ein Fehler, die Startseite zeigt die Option fest.",
    "In Auftrag übernehmen öffnet für jeden Skill den Vorbereitungschat mit dem bearbeitbaren Startauftrag, auch nach einem Leitfaden. Erst Run erstellen sendet den Auftrag mit dem Skillbezug; beim Script wird der Startwert an den vorbereiteten Actor übergeben.",
  ]),
  entry("start-options", "Serverbeiträge", "Startwerte prüfen und einfrieren", "Startoptionen sind Werte, die vor einem neuen Run gewählt werden, etwa das Modell. Das Plugin legt erlaubte Werte, einen Standardwert und die Prüfung der Auswahl fest. Beim Start wird der gewählte Wert für den Run gespeichert und fixiert.", "Innerhalb von register(host); Type kommt aus typebox.", `
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
});`, ["host.startOptions"], [
    "Die choice-Darstellung funktioniert mit dem vorhandenen Auswahlmenü. Eine eigene Bedienkomponente kann auf der Web-Seite unter derselben Option-ID registriert werden; describe enthält keine Prüfregeln.",
    "Ein voreingestellter Wert muss ebenfalls gültig sein; eine fehlende Voraussetzung wird nicht still ersetzt.",
    "defaultValue, accept und describe bekommen neben runId den handelnden Benutzer als userId, ohne Anmeldung null. Das optionale ownerOnly(value) behält einen Run mit diesem Wert zum Bedienen seinem Eigentümer vor; lesen und stoppen bleiben allen, die ihn sehen.",
  ]),
  entry("session-metadata", "Serverbeiträge", "Run-Metadaten bereitstellen", "Ein Plugin kann kurze Zusatzangaben zu einem Run liefern, etwa einen Bearbeitungsstatus. Solche Metadaten stehen der Oberfläche zur Anzeige zur Verfügung. Die zugrunde liegenden Fachdaten bleiben beim Plugin.", "Innerhalb von register(host); Beispiel ohne eigene Datenablage.", `
host.sessionMetadata({
  id: "ragents.example.metadata",
  describe: ({ runId }) => ({ run: runId, label: "Beispiel" }),
});`, ["host.sessionMetadata"], ["Die passende Anzeige wird getrennt als sessionMetadata- oder Header-Beitrag in der Web-Hälfte registriert."]),
  entry("script-runtime", "Serverbeiträge", "Die TypeScript-Laufzeit einbinden", "Die TypeScript-Laufzeit führt die programmierten Abläufe eines Runs aus. Der Server bindet sie über den Beitrag script ein. Dieser stellt die Ausführung und die verfügbaren Programmierfunktionen bereit.", "Verdrahtungsbeispiel; createRuntime erfüllt ScriptContribution['create'].", `
function registerRuntime(host: PluginRegistration, createRuntime: ScriptContribution["create"]) {
  host.script({ id: "ragents.example.script", create: createRuntime });
}`, ["host.script"], [
    "Der Host akzeptiert höchstens einen ScriptRuntime-Beitrag. Actor-Inputs und Actor-Funktionen verwenden gemeinsam diese Plattform.",
    "Normale Fachplugins benötigen diesen Slot nicht; sie ergänzen Werkzeuge oder Operationen mit typisierten Verträgen.",
  ]),
  entry("web-activation", "Web-Beiträge", "Web-Hälfte aktivieren", "Die Web-Hälfte eines Plugins liefert seine Oberflächenbeiträge, etwa Reiter oder Einstellungen. Der Export webPlugin beschreibt, wie diese Beiträge aus der öffentlichen Konfiguration entstehen. Er kann sie für eine bestimmte Konfiguration auch ausdrücklich deaktivieren.", "plugins/ragents.example/web/index.tsx; WebPlugin wird aus dem neutralen Web-Hostvertrag importiert.", `
export const webPlugin = {
  id: "ragents.example",
  activate: (config) => {
    if (typeof config.label !== "string") throw new Error("Die Beschriftung fehlt.");
    return { id: "ragents.example", enabled: () => true };
  },
} satisfies WebPlugin;`, ["webIdentity.id", "web.id", "web.activate", "web.enabled"], [
    "activate darf die Plugin-ID nicht ändern. Deaktivierung entfernt alle Beiträge dieser Web-Hälfte aus der aktiven Registry.",
    "Der Plugin-Ordner wird als eigener Chunk gebaut. Fremde Web-Bundles werden nicht zur Laufzeit nachinstalliert.",
  ], "tsx"),
  entry("web-brand", "Web-Beiträge", "Branding und Chatdarstellung", "Ein Produktbeitrag legt Name und Erscheinungsbild der Anwendung fest. Er bestimmt außerdem, wie die Zwischenschritte der Agenten im Chat dargestellt werden, darunter Denkausgaben und Werkzeugaufrufe.", "Eigenschaften eines WebPlugin; genau ein aktiver Branding-Beitrag.", `
const productUi = {
  id: "ragents.example",
  brand: { title: "Beispielwerkstatt", Logo: () => <span>B</span> },
  chatDisplayPolicy: {
    modes: { coordinator: "chips", agents: "compact" },
    stepsVisible: true, stepsExpandable: true, selectable: true,
  },
} satisfies WebPlugin;`, ["web.brand", "web.chatDisplayPolicy"], ["Mehrere Branding-Beiträge oder mehrere Chat-Display-Policies sind Fehler. Ein Fachplugin neben einem bestehenden Produkt liefert normalerweise keines von beiden."], "tsx"),
  entry("web-tabs", "Web-Beiträge", "Feste und dynamische Reiter", "Ein Plugin kann einen eigenen Reiter mit Symbol, Inhalt und optional einer Statusmarkierung ergänzen. Feste Reiter sind immer Teil seines Angebots. Dynamische Reiter entstehen passend zum Zustand des geöffneten Runs.", "Eigenschaften eines WebPlugin; exampleTabs(session) ist eine eigene, validierende Projektion.", `
const tabs = {
  id: "ragents.example",
  workspaceTabs: [{
    id: "ragents.example.overview", label: "Überblick", order: 100,
    Icon: () => <span>B</span>,
    Panel: ({ active }) => <p>{active ? "Aktiver Reiter" : "Inaktiv"}</p>,
    Badge: () => <span>1</span>,
  }],
  workspaceTabsFor: (session) => exampleTabs(session),
} satisfies WebPlugin;`, ["web.workspaceTabs", "web.workspaceTabsFor"], [
    "available(session) filtert die Verfügbarkeit, keepMounted erhält eine inaktive Ansicht. Polling wird trotzdem anhand von active gesteuert.",
    "Auch dynamische Tab-IDs müssen eindeutig sein. Im Run-Panel stehen dieselben Reiter in der Symbolleiste am rechten Rand.",
  ], "tsx"),
  entry("web-surface", "Web-Beiträge", "Eine zentrale Fläche", "Die zentrale Fläche eines Runs zeigt die Beteiligten als Kacheln. Ein Plugin kann die Darstellung dieser Fläche übernehmen. Dafür erhält es die vorhandenen Funktionen für Chats, Navigation, Kartenabschnitte und zusätzliche Elemente.", "Eigenschaften eines WebPlugin; RunPanel ist die Fassung für das Run-Panel.", `
const surfaceUi = {
  id: "ragents.example",
  surface: {
    Center: ({ renderChat }) => <div>{renderChat()}<p>Eigene Fläche</p></div>,
    RunPanel: ({ renderChat }) => <div>{renderChat()}</div>,
  },
} satisfies WebPlugin;`, ["web.surface"], [
    "Es gibt höchstens einen Flächenbeitrag. Das Beispiel ersetzt die zentrale Fläche; es ergänzt nicht automatisch die bestehende Fläche der Orchestrierung. Ohne RunPanel zeigt das Run-Panel nur den Chat.",
    "toolbarLeft ist Teil des renderChat-Vertrags für den Eigentümer der Fläche. Es gibt keinen allgemeinen Composer-Toolbar-Registry-Slot.",
  ], "tsx"),
  entry("web-surface-elements", "Web-Beiträge", "Elemente auf der vorhandenen Fläche", "Ein Plugin kann zusätzliche Elemente als Kacheln auf der vorhandenen Fläche anzeigen. Es liefert dazu die Beschreibung des Elements und seine Darstellung. Das Element ist eine Oberfläche und bearbeitet selbst keine Aufträge.", "Eigenschaften eines WebPlugin.", `
const elements = {
  id: "ragents.example",
  surfaceElements: [{
    id: "ragents.example.note", order: 100,
    select: () => [{ id: "example-note", title: "Hinweis", visible: true }],
    Element: ({ definition }) => <p>{definition.title}</p>,
  }],
} satisfies WebPlugin;`, ["web.surfaceElements", "surfaceElement.id", "surfaceElement.visible", "surfaceElement.title", "surfaceElement.anchorActorId", "surfaceElement.entity", "surfaceElement.data"], ["Definitionen nennen nur ihre id; title ist optional. visible: false nimmt ein Element aus der Fläche, ohne eine fehlende Kachelreferenz zu melden. Ohne visible ist es sichtbar. Die Größe bestimmt die Kachel, nicht der Beitrag. anchorActorId, entity und eigene data sind optional. Die Kachelaufteilung entscheidet über die Platzierung; der Beitrag allein erzeugt keine Actor-Identität. Das Run-Panel erkennt Besitzer an anchorActorId, auch bei visible: false."], "tsx"),
  entry("web-card-sections", "Web-Beiträge", "Abschnitte an Actor-Karten", "Die Beteiligten eines Runs heißen Actors und werden auf der Fläche als Karten dargestellt. Ein Plugin kann diese Karten um eigene Abschnitte ergänzen, etwa für Dokumente oder einen Status.", "Eigenschaften eines WebPlugin; ein neutraler Abschnitt ohne Zugriff auf Actor-Felder.", `
const cards = {
  id: "ragents.example",
  cardSections: [{ id: "ragents.example.note", order: 100,
    Section: () => <p>Zusätzlicher Karteninhalt</p> }],
} satisfies WebPlugin;`, ["web.cardSections"], ["actor ist an dieser Grenze unknown. Wer Actor-Felder benutzt, muss sie mit dem Vertrag des zuständigen Plugins prüfen. Ein leerer Beitrag kann null rendern."], "tsx"),
  entry("web-context", "Web-Beiträge", "Run-Daten und React-Kontext", "Mehrere Oberflächenbeiträge eines Plugins können gemeinsame Daten zum geöffneten Run benötigen. Ein SessionProvider reicht diese über React-Kontext weiter. Mit needsRunView fordert das Plugin zusätzlich den vom Server bereitgestellten Zustand des Runs an.", "Eigenschaften eines WebPlugin; der Provider kann hier eigene Context.Provider einsetzen.", `
const sessionUi = {
  id: "ragents.example",
  needsRunView: true,
  SessionProvider: ({ children, session }) => <section aria-label={session.session.title}>{children}</section>,
} satisfies WebPlugin;`, ["web.needsRunView", "web.SessionProvider"], ["session.runView ist unknown und muss vor fachlichem Zugriff validiert werden. Ein Provider besitzt session und navigation und wird nur für aktive Plugins eingebunden."], "tsx"),
  entry("web-headers", "Web-Beiträge", "Übersicht, globale Toolbar und Leisten des Runs", "Ein Plugin kann Informationen für die ganze Anwendung oder für den gerade geöffneten Run anzeigen. Beiträge für die ganze Anwendung stehen in der Übersicht oder in der globalen Kopfzeile; Beiträge zum Run folgen der aktuellen Auswahl. Dafür gibt es overviewPanels mit einer Platzierungswahl und sessionHeaders für die Titelleiste oder die Leiste oben an der Fläche.", "Eigenschaften eines WebPlugin.", `
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
} satisfies WebPlugin;`, ["web.overviewPanels", "web.sessionHeaders", "web.sessionStatus"], ["Der Kontext liefert Registry, open, onOpen, onClose und onBusy. Ohne placement steht der Beitrag in der Übersicht und wird beim ersten Öffnen gemountet. Toolbar-Beiträge sind ab Anwendungsstart gemountet; eigene Verbindungen aktivieren sie erst bei Nutzung. Der Host koordiniert das gegenseitige Schließen. sessionHeaders verwendet standardmäßig placement: header; placement: surface setzt den Beitrag in die Leiste oben an der Fläche. Diese bleibt auch bei einer App-Vollansicht bedienbar. Run-Kopf und untere Statusgruppen erhalten SessionContext und Navigation und folgen dem aktiven Run."], "tsx"),
  entry("web-settings", "Web-Beiträge", "Bearbeitbare Plugin-Einstellungen", "Ein Plugin kann eine eigene Oberfläche zum Bearbeiten seiner Einstellungen anbieten. Mit category steht sie unter Modelle oder Darstellung, zusätzlich auf der Einstellungsseite des Plugins. Die Anwendung ordnet sie dem aktiven Plugin zu.", "Eigenschaften eines WebPlugin; ExampleSettings ist die eigene React-Komponente des Plugins.", `
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
} satisfies WebPlugin;`, ["web.settings", "settings.id", "settings.label", "settings.category", "settings.readRight", "settings.order", "settings.Settings"], ["category: models zeigt den Beitrag unter Modelle, appearance unter Darstellung. Ohne category bleibt er beim zugehörigen Plugin. Die Formularbereiche laden unabhängig vom technischen Beitragskatalog.", "readRight blendet den Beitrag ohne das genannte Recht aus; ohne Angabe gilt settings.read. Die Komponente prüft ihr Schreibrecht mit useAccess und die Serverroute zusätzlich mit requiredRights.", "Das Beispiel hält den Wert nur lokal. Settings erhält keine Props; das Plugin verbindet seine Komponente selbst mit Konfiguration, gemeinsamem Zustand und eigenen Serverrouten. Kennungen sind global eindeutig; order ist optional und standardmäßig 0. Ohne aktives Plugin wird kein Einstellungsbereich eingebunden."], "tsx"),
  entry("web-start", "Web-Beiträge", "Startoptionen und Leitfäden bedienen", "Vor einem neuen Run können Startoptionen direkt gewählt oder in einem Einrichtungsdialog gesammelt werden. Das Plugin liefert dafür die Oberfläche und verbindet ihre Werte mit dem jeweiligen Serververtrag. Ein Leitfaden ist ein solcher Dialog für einen vorbereiteten Ablauf.", "Eigenschaften eines WebPlugin; die Option wird zusätzlich serverseitig registriert.", `
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
} satisfies WebPlugin;`, ["web.startOptions", "web.guides"], [
    "placement setzt die Option in die Eingabeleiste (composer) oder unter die Eingabe auf die Startseite (page, Vorgabe). Der Host zeigt sie nur an der gewählten Stelle; Modell und Denktiefe verwenden composer.",
    "Das Objekt im Beispiel ist ein Script-Startwert. Ein Skill-Leitfaden liefert stattdessen den Text der ersten Nachricht. Der StartEntry verweist mit guide auf diese Kennung.",
    "Das Referenz-Plugin liefert zwei vollständige Leitfäden: ConversationGuide sammelt Thema und Rundenzahl für eine Gesprächsrunde; SharedBoardGuide sammelt Titel und ersten Eintrag für ein gemeinsames Sammelboard. Beide beginnen erst nach Abschluss mit dem Run. Die Scripts prüfen die Eingaben vor dem Aufbau.",
  ], "tsx", [
    { title: "Beide React-Leitfäden", file: "plugins/ragents.reference/web/StartGuides.tsx" },
    { title: "Registrierung der Leitfäden", file: "plugins/ragents.reference/web/index.tsx" },
    { title: "Setup der Gesprächsrunde", file: "plugins/ragents.reference/run-scripts/conversation-circle/src/server.ts" },
    { title: "Setup des Sammelboards", file: "plugins/ragents.reference/run-scripts/shared-actor-list/src/server.ts" },
  ]),
  entry("web-presenters", "Web-Beiträge", "Werkzeuge und Entitäten darstellen", "Plugins können festlegen, wie ihre Werkzeugaufrufe im Chat dargestellt werden und wohin Verweise auf ihre Daten führen. Ein Tool-Presenter liefert die Darstellung des Aufrufs. Ein Entity-Presenter übersetzt den Datenverweis in ein Navigationsziel.", "Eigenschaften eines WebPlugin; example.overview ist ein vom Plugin registrierter Tab.", `
const presenters = {
  id: "ragents.example",
  toolPresenters: [{ toolName: "example_trim",
    Inline: () => <span>Textprüfung</span>,
    reveal: () => ({ tabId: "ragents.example.overview" }) }],
  entityPresenters: [{ reveal: (entity) => entity.type === "example-note"
    ? { tabId: "ragents.example.overview", selection: entity.id } : undefined }],
} satisfies WebPlugin;`, ["web.toolPresenters", "web.entityPresenters"], ["navigation.openTab öffnet einen registrierten Reiter; revealEntity verwendet die Presenter. selection ist ein eigener geprüfter Vertrag zwischen Aufrufer und Zielpanel."], "tsx"),
  entry("web-metadata", "Web-Beiträge", "Metadaten in Liste und Kopf", "Zusatzangaben zu einem Run können in der Run-Liste und in seiner Kopfzeile erscheinen. Das Plugin erhält die Daten des Runs und den Anzeigeort. So kann es denselben Status je nach Platz kurz oder ausführlicher darstellen.", "Eigenschaften eines WebPlugin.", `
const metadata = {
  id: "ragents.example",
  sessionMetadata: [{ id: "ragents.example.metadata", order: 100,
    Metadata: ({ placement }) => <span>{placement === "list" ? "B" : "Beispiel"}</span> }],
} satisfies WebPlugin;`, ["web.sessionMetadata"], ["Die Bereitstellung fachlicher Werte erfolgt über den serverseitigen sessionMetadata-Beitrag. Die Web-Hälfte zeigt die Werte an."], "tsx"),
  entry("web-attention", "Web-Beiträge", "Aufmerksamkeit und wartende Aktionen", "Ein Plugin kann markieren, dass ein Run Aufmerksamkeit braucht. Wartet eine Aktion des Plugins auf eine Eingabe, stellt sein eigener actionViews-Beitrag sie dar und beantwortet sie über seinen Vertrag; der Kern kennt ihre Form nicht. Markierung und Darstellung sind getrennte Beiträge.", "Eigenschaften eines WebPlugin; answerQuestion ist der eigene geprüfte HTTP-Client.", `
const interaction = {
  id: "ragents.example",
  attention: [{ id: "ragents.example.attention",
    assess: (session) => session.running ? { active: true, label: "In Arbeit" } : undefined }],
  actionViews: [{ owner: "ragents.example",
    View: ({ action, session }) => <button onClick={() =>
      void answerQuestion(session.session.id, action.actionId, "ok")}>{String(action.payload)}</button> }],
} satisfies WebPlugin;`, ["web.attention", "web.actionViews"], ["Je Eigentümer gibt es genau eine Darstellung. Ohne Darstellung zeigt der Chat die Aktion generisch mit Titel, wartet auf Eingabe und Verwerfen. Attention erzeugt selbst keine Aktion oder Hintergrundarbeit."], "tsx"),
  entry("run-snippet", "Actor-Programme", "Ein kleines TypeScript-Snippet ausführen", "Einmalige Berechnungen, Abfragen und Einrichtungsschritte brauchen keinen eigenen Actor. Das Modell entdeckt die aktuelle API und kombiniert ihre Funktionen direkt in TypeScript.", "code für typescript_eval, oder derselbe Quelltext in einer Datei für path.", `
const actors = await context.functions.actor_list({});
return actors;`, [], [
    "Der Quelltext ist der Rumpf einer asynchronen Funktion mit context. await und return sind direkt erlaubt; Module werden mit await import(...) geladen. Die Typprüfung läuft vor der Ausführung.",
    "context.log sammelt Ausgaben, return liefert ein JSON-Ergebnis; ohne return ist es null. Lokale Variablen und context.state gelten nur für diese Ausführung.",
    "Registrierte Funktionen und ihre Ein- und Ergebnistypen sind in Snippets und Actor-Programmen dieselben. Ein Snippet handelt als Aufrufer. Bereits abgeschlossene Funktionsaufrufe bleiben bei einem späteren Fehler wirksam.",
    "Für spätere Nachrichten, Ereignisse, dauerhaften Zustand oder Views steht ein Actor-Programm bereit. Die fachliche Aufgabe muss diese technische Wahl nicht vorgeben.",
  ]),
  entry("actor-state", "Actor-Programme", "Ein TypeScript-Actor mit Zustand", "Ein TypeScript-Actor verarbeitet zugestellte Nachrichten im Code. Funktionen und optionale Views verwenden denselben gespeicherten Zustand. Die Rückgabe einer Funktion ist ein Ergebnis; Zustandsänderungen erfolgen ausdrücklich.", "src/server.ts eines normalen Actor-Pakets.", `
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
});`, ["run.state", "run.log", "run.throwIfAborted", "run.signal"], [
    "defineActor leitet Zustand und Funktionssignaturen aus TypeBox ab. Relative Imports und Node-Bibliotheken sind regulär verfügbar.",
    "Ein LLM-Actor kann Funktionen und Views besitzen; sein normaler Input bleibt beim Modelltreiber. Ein Programm mit onInput wird an ihm abgewiesen.",
  ]),
  entry("run-capabilities", "Actor-Programme", "Run-Funktionen und Ausführungsidentität", "Eine Run-Funktion steht mit identischem Vertrag für Snippets und Actor-Programme bereit. Jeder geprüfte Programmstand, der Build, nennt seine vollständige Liste dieser Funktionen samt Ein- und Ausgabetypen. Die Ausführungsidentität legt fest, in wessen Auftrag das Programm handelt und welche Rechte dabei gelten.", "Ausschnitt in einem asynchronen Actor-Handler; actor_input muss im Build deklariert und erlaubt sein.", `
context.log({ run: context.run.id, actor: context.actor.handle, invocation: context.invocation.id,
  kind: context.invocation.kind, principal: context.principal.kind });
await context.functions.actor_input({
  actor: "@reviewer", content: "Prüfe das neue Ergebnis.",
});`, ["run.run", "run.actor", "run.std", "run.invocation", "run.principal", "run.functions"], [
    "Snippets handeln als Aufrufer, onInput als empfangender Actor. Eine aufgerufene Actor-Funktion besitzt ihren Zustand, führt Run-Aufrufe aber als ihr Aufrufer aus. Ein Abo gilt für die handelnde Identität.",
    "@reviewer muss bereits im Run existieren. Laufzeit und Test lösen die Referenz auf; die Anleitung verlangt keine abgeschriebenen Actor-IDs.",
    "Aufrufnamen verwenden Unterstriche, etwa actor_input. Punktierte Namen wie actor.input sind Grants. Zusätzliche Rechte des Actors erweitern einen installierten Build nicht automatisch.",
    "invocation.kind kennt input, snippet, tool und app-action. event und schedule sind bereits als Typwerte deklariert, besitzen aber derzeit keinen eigenen Auslöser.",
  ]),
  entry("subscriptions", "Actor-Programme", "Ereignisse abonnieren und Nachrichten weitergeben", "Ereignisse melden, was in einem Run geschehen ist, etwa dass ein Agent einen Beitrag abgeschlossen hat. Ein Abonnement, die Subscription, stellt passende neue Ereignisse einem Beteiligten als Nachricht zu. Ein programmierter Vermittler kann daraufhin das Ergebnis weitergeben oder den nächsten Arbeitsschritt anstoßen.", "Ausschnitt in einem Actor-Handler; die aufgeführten Capability-Aufrufe müssen freigegeben sein.", `
await context.functions.event_subscribe({
  sourceActorIds: ["@reviewer"],
  eventTypes: ["model.output.completed"],
});`, [], [
    "Ein Actor-Handler erhält bei einer Subscription das Quellevent über input.event, ansonsten null. input.content, artifactIds, sourceEventIds und subscriptionId beschreiben die Zustellung.",
    "Der Abonnent benötigt einen neuen Turn; ein laufender Turn wird durch eine Subscription nicht heimlich verändert. Je Actor werden Inputs in Journal-Reihenfolge bearbeitet.",
    "event_unsubscribe entfernt die Subscription. Bereits gespeicherte Events werden nach einem Serverneustart nicht erneut zugestellt.",
    "context.std.mediators.route liefert eine Input-Funktion für feste Weiterleitungsregeln und speichert ihren Zustand ausdrücklich. context.std.now und context.std.id beziehen sich auf den aktuellen Actor-Turn.",
  ]),
  entry("run-scripts", "Actor-Programme", "Ein Run-Script als vorbereitetes Setup", "Ein Run-Script ist ein vollständiges Actor-Programm für den Start eines Runs. Der Host aktiviert es mit demselben Compiler und denselben Fachtests wie ein während des Runs geschriebenes Programm.", "RUN.md; daneben liegen package.json, src/server.ts und tests/*.test.ts.", `
---
title: Beispiel vorbereiten
description: Zählt den ersten Startauftrag.
order: 100
coordinator: true
---

Der Aufbau verwendet das Actor-Programm aus diesem Kapitel.`, ["runScript.handle", "runScript.coordinator", "runScript.files", "runScript.programs"], [
    "Der Paketordner bestimmt den Handle. package.json.ragents.backend nennt den Einstieg mit defineActor und onInput. Die Fähigkeiten stehen ausschließlich im TypeScript-Vertrag.",
    "Weitere vorbereitete Programme liegen unter actors/<name>/. Der Host kopiert sie in @actors; das Setup aktiviert sie mit actor_program_activate und optionalem Actor-Handle.",
    "coordinator: false lässt den üblichen Koordinator weg. Das Setup muss dann einen anderen Actor zum primären Chatpartner bestimmen.",
  ], "markdown"),
  entry("program-tests", "Actor-Programme", "Input-Verarbeitung im Fachtest prüfen", "Normale TypeScript-Tests prüfen den Input-Handler und seine expliziten Zustandsänderungen. Der Host führt dieselben Tests vor der Aktivierung aus.", "tests/program.test.ts für das vorherige Zählerprogramm.", `
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
});`, [], [
    "actor_program_activate prüft, baut, testet und aktiviert das Programm. Es gibt keinen zweiten Check/Test/Install-Vertrag oder Testnachweis als Modellargument.",
    "Ein reines View-Paket benötigt weder einen Input-Handler noch eine erfundene Serverfunktion.",
  ]),
  entry("app-package", "Actor-Programme", "Ein Programm mit optionalen Views", "Ein privates TypeScript-Paket kann Funktionen, Input-Verarbeitung und mehrere React-Views bereitstellen. Es bindet an einen vorhandenen Actor oder erzeugt bei einem neuen Backend einen TypeScript-Actor.", "package.json; pro View liefert der Host das HTML-Wurzelelement root.", `
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
}`, ["appPackage.title", "appPackage.description", "appPackage.backend", "appPackage.views"], [
    "Mindestens Backend oder eine View muss vorhanden sein. Ohne Backend bindet eine neue View an den aufrufenden Actor; eine Dummy-Installation entfällt.",
    "actor_program_create legt das Paket mit festen lokalen Abhängigkeiten an. Dateiwerkzeuge und Language Server verwenden @actors/<name>/, Bash denselben Alias als cwd.",
    "Geänderte Projektfehler erscheinen vor Modellanfragen als kurze Deltas. actor_program_diagnostics liefert den vollständigen Stand, actor_program_activate prüft und aktiviert.",
  ], "json"),
  entry("app-contract", "Actor-Programme", "Ein Vertrag für Actor-Zustand und Funktionen", "Der TypeBox-Vertrag beschreibt die Daten eines Actors und die Ein- und Ausgaben ihrer Funktionen. Eine Funktion ist in der View aufrufbar und kann mit derselben Implementierung zusätzlich in der gemeinsamen TypeScript-API angeboten werden. Die SDK-Typen entstehen daraus automatisch.", "src/contract.ts; gemeinsamer Vertrag für die folgende Backend-Funktion.", `
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
} as const;`, ["appContract.state", "appContract.functions", "appContract.input", "appAction.label", "appAction.description", "appAction.input", "appAction.output", "appAction.capabilities", "appAction.confirmation", "appAction.tool"], [
    "Das Zustandsschema akzeptiert {} als Initialwert. input und output bestimmen die Typen des zugehörigen Handlers; capabilities nennt seine benötigten Run-Fähigkeiten.",
    "Ohne targets steht die Funktion aktiven ausführbaren Actors zur Verfügung. self meint den Besitzer des Programms, @handle ein bestimmtes Ziel. card: true erzeugt das Formular aus demselben Eingabevertrag. Eine optionale confirmation fordert eine Bestätigung vor der Aktion.",
    "Nach der Aktivierung steht die Funktion schon im laufenden Modellturn in context.functions bereit. typescript_api liefert ihren aktuellen Vertrag. Erneute Aktivierung aktualisiert das Schema; Entfernen zieht die Funktion zurück.",
    "Pro Actor ist ein Actor-Programm aktiv; weitere Funktionen und Views werden darin ergänzt. Eine reine View braucht keinen Backend-Vertrag. Optionales input im Vertrag verlangt onInput in der Implementierung und ist nur für TypeScript-Actors verfügbar.",
  ]),
  entry("app-handler", "Actor-Programme", "Eine Funktion für View und Werkzeug", "Die Funktion verarbeitet eine typisierte Eingabe und ändert den Zustand ihres Actors. Aufrufe aus dessen React-View und über die TypeScript-API verwenden genau diese Implementierung, ohne zusätzlichen Modell-Turn.", "src/server.ts; package.json.ragents.backend nennt diesen Einstieg.", `
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
});`, [], [
    "Eine Rückgabe ist immer das fachliche Ergebnis. Ausschließlich context.state.replace merkt neuen Actor-Zustand vor.",
    "context.actor nennt den Besitzer der Funktion. Run-Funktionen verwenden die Identität des Aufrufers und die deklarierten Capabilities. onInput handelt als sein Actor.",
  ]),
  entry("app-tests", "Actor-Programme", "Fachtests als TypeScript-Dateien", "Die Backend-Funktion wird mit normalen Tests und expliziten Abhängigkeiten geprüft. Die Aktivierung führt die vorhandenen Testdateien aus; Fehler verhindern die Übernahme des neuen Stands.", "tests/program.test.ts; läuft mit node --import tsx --test.", `
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
});`, [], [
    "createTestContext stellt Zustand, Abbruchsignal und explizit angegebene typisierte Funktionen unter functions bereit. Die Mocks sind TypeScript-Funktionen im Test und kein Werkzeugargument des Modells.",
    "Ein Fachtest prüft die gemeinsame Funktion. Eine echte Browserprüfung muss zusätzlich die sichtbare Bedienung nachweisen.",
  ]),
  entry("app-placements", "Actor-Programme", "Views als Kacheln", "Eine aktivierte View kann als Kachel auf der Fläche liegen und gehört dabei zu ihrem Actor. Der Benutzer kann sie im Host vergrößern; mehrere Views zeigen denselben Actor-Zustand.", "Ein Eintrag in package.json.ragents.views.", `
{ "id": "main", "title": "Liste", "client": "src/client.tsx" }`, [], [
    "actor_view_set_visibility verwendet Paketname/Viewname oder einen eindeutigen Titel. Die View-Kennung ist innerhalb des Pakets eindeutig. Eine View hat keine eigene Größe; die Kachel gibt sie vor, und der zugehörige Actor ist ihr Anker.",
    "actor_view_set_visibility schaltet eine View sichtbar oder unsichtbar. Funktionen und Actor-Zustand bleiben erhalten; die lokale Vollansicht gehört zur Benutzerbedienung.",
    "Views besitzen keine Dialog- oder Fenstersteuerungs-API.",
  ], "json"),
  entry("app-client", "Actor-Programme", "React-View mit Actor-Zustand", "Die View liest den intrinsischen Zustand ihres Actors. Neue erfolgreiche Änderungen erscheinen auch bei ruhendem Chat; lokale React-Eingaben bleiben erhalten.", "src/client.tsx für die gemeinsame Liste.", `
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
createRoot(document.getElementById("root")!).render(<App />);`, ["app.ready", "app.run", "app.actor", "app.principal", "app.state", "app.chat", "app.capabilities", "appState.read", "appState.subscribe", "appCapabilities.list", "appCapabilities.call"], [
    "context.actor beschreibt den Besitzer der View. ready bestätigt die Bridge, run und principal den gebundenen Run und die Bedieneridentität.",
    "useAppState liest Actor-Zustand reaktiv. state.read und subscribe liefern alternativ Snapshot und Änderungsmeldungen.",
    "context.capabilities.call ruft eine deklarierte Actor-Funktion auf. Lokale Entwürfe gehören in React-Zustand; ein Funktionsaufruf startet keinen Modell-Turn.",
  ], "tsx"),
  entry("app-chat", "Actor-Programme", "Chats und wiederverwendbare UI", "Eine Mini-App kann das Gespräch ihres Actors anzeigen und bedienen oder einen eigenen kontrollierten Verlauf darstellen. Nachrichtenansicht, Eingabe und weitere UI-Bausteine sind auch einzeln verfügbar.", "src/client.tsx; Alternative für einen bereits vorhandenen Actor dieses Runs.", `
import { createRoot } from "react-dom/client";
import * as UI from "@ragents/client/ui";
import { context } from "@ragents/client";

function App() {
  return <UI.Chat actor={"@" + context.actor.handle} title="Prüfung" />;
}
createRoot(document.getElementById("root")!).render(<App />);`, ["chat.read", "chat.subscribe", "chat.send"], [
    "actor und messages/onSend sind unterschiedliche Chat-Varianten. primary bindet den primären Actor; @handle einen benannten Actor des Runs.",
    "Der importierte Kontext bietet context.chat.read(actor), subscribe(actor, listener) und send(actor, text, attachments?). Eine Subscription wird beim Abbau abgemeldet.",
    "UI.MessageList zeigt kontrollierte Nachrichten mit benannten Absendern. Die App liefert Reihenfolge und Inhalt; der Baustein erzeugt keine Antworten.",
    "Die Bausteinreferenz zeigt aktuelle Props und lokale Demos der Komponenten.",
  ], "tsx"),
  entry("product-policy", "Produkt- und Laufzeitverträge", "Eine Produktpolitik bereitstellen", "Der Koordinator ist der zentrale KI-Ansprechpartner eines Runs und kann Aufgaben an weitere Agenten verteilen. Die Produktpolitik legt seinen Start, die Rollen der Beteiligten und ihre Anweisungen fest. Eine eigene Anwendung stellt diese Regeln als Dienst bereit.", "register(host); policy erfüllt ProductRuntimePolicy, productRuntimeToken kommt aus dem neutralen Server-Host.", `
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
host.provide(productRuntimeToken, policy);`, ["product.coordinator", "product.roleFor", "product.contract", "product.promptComposition", "product.systemPrompts"], [
    "coordinator beschreibt Handle, Anzeigename, Profil, Run-Titel und Owner. roleFor bestimmt primary oder worker, contract liefert den Rollenprompt, promptComposition die Komposition und systemPrompts den Katalog.",
    "Ein neues Fachplugin registriert keinen zweiten Produktdienst neben einem bestehenden Produkt. Die Konfiguration muss einen vollständigen Modellkatalog für das verwendete Profil bereitstellen.",
  ]),
  entry("workspace-policy", "Produkt- und Laufzeitverträge", "Arbeitsbereiche auflösen", "Ein Arbeitsbereich legt fest, in welchen Verzeichnissen die Agenten eines Runs mit Dateien und Prozessen arbeiten. Der Dienst WorkspaceRuntime löst diesen Bereich auf und beschreibt ihn. Ein optionaler WorkspaceResolver kann die Zuordnung anpassen, ohne den ganzen Dienst zu ersetzen.", "register(host); workspaceResolverToken kommt aus dem neutralen Server-Host.", `
host.provide(workspaceResolverToken, {
  resolve: async ({ directory }) => ({ cwd: directory }),
});`, ["workspace.resolve", "workspace.describe", "workspace.placementOf", "workspace.toolNaming", "workspace.transfer", "resolver.optionId", "resolver.kind", "resolver.workstation", "resolver.resolve", "resolver.stopSession", "resolver.deleteSession"], [
    "resolve der vollständigen WorkspaceRuntime liefert eine SessionWorkspace mit cwd, currentRoot und runOperation; optional kommen gitEnv, gitConfig und extraEnv hinzu. describe liefert Modus und Verzeichnismuster; placementOf nennt getrennt, ob ein Run auf dem Server oder einem Arbeitsplatz arbeitet und ob in einem neuen oder vorhandenen Ordner, dazu die Art eines beigesteuerten Ordners, und toolNaming kann die vorhandenen Dateiwerkzeuge benennen.",
    "Ein Resolver erhält runId, directory, choice und emitSystem. optionId verbindet die Auswahl mit einer registrierten Startoption. kind beschreibt Kennung, Bezeichnung, Serverordner und Anzeigemuster des beigesteuerten Arbeitsbereichs auf dem Server. workstation stellt den neuen Ordner auf einem Arbeitsplatz: Bezeichnung und Schritte aus Operationen des Executors dort, die nach dem Anlegen (prepare) und vor dem Wegräumen (release) laufen; ohne workstation gibt es mit einem Resolver dort keinen neuen Ordner. Der gezeigte Resolver behält das vom Host vorbereitete Run-Verzeichnis bei.",
    "stopSession und deleteSession ergänzen optional die Lebenszyklusgrenzen des beigesteuerten Arbeitsbereichs. Beim Stoppen erhält der Resolver auch den Abbau der Host-Sandbox; das Löschen folgt erst danach.",
    "transfer beantwortet den Umzug eines Runs auf einen anderen Server: boundDirectory nennt einen vorhandenen Ordner dieses Rechners, an den der Run gebunden ist, assertDirectory prüft einen Ersatzordner, rebind bindet den Run dort an.",
    "Datei- und Prozessarbeit erfolgt über die vorhandene Workspace-Grenze. Ein Plugin wechselt nicht eigenmächtig das globale Arbeitsverzeichnis des Servers.",
  ]),
  entry("document-store", "Produkt- und Laufzeitverträge", "Dokumentablage und Git-Ansichten", "Die Dokumentablage ordnet jedem Run ein Verzeichnis für ihre Dateien zu. Eine zusätzliche Git-Ansicht kann den Branch, Änderungen und Dateiinhalte eines Arbeitsbereichs liefern. Plugins stellen diese Dienste bereit, damit andere Beiträge dieselben Daten verwenden können.", "register(host); store und gitView erfüllen DocumentStore bzw. GitWorkspaceView.", `
host.provide(documentStoreToken, store);
host.provide(gitWorkspaceViewToken, gitView);`, ["documents.directoryFor", "documents.describe", "gitView.branch", "gitView.changes", "gitView.file"], [
    "DocumentStore löst mit directoryFor(runId) das Dokumentverzeichnis auf und beschreibt sein Verzeichnismuster.",
    "GitWorkspaceView liefert branch(runId), changes(runId) und file(runId, filePath, view), wobei view diff oder current ist. Die Oberfläche erhält eine geprüfte Projektion, keinen freien Git-Prozess.",
  ]),
  entry("driver", "Produkt- und Laufzeitverträge", "Die Modelllaufzeit austauschen", "Ein AgentDriver verbindet die Modelllaufzeit mit RAgents. Er bearbeitet eine zugestellte Nachricht in einem Schritt, dem Turn, und verbindet dabei Modell, Werkzeuge, Abbruch und ausgegebene Ereignisse. Der Scheduler, die Ablaufsteuerung von RAgents, beauftragt ihn mit diesen Schritten.", "Ein einfacher Testdriver ohne Modellaufruf; AgentDriver kommt aus @ragents/engine.", `
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
};`, ["driver.kind", "driver.supportsPlainLlm", "driver.runTurn", "driver.disposeAgent", "driver.reviveAgent", "driver.haltRun", "driver.waitForRunSettlement", "driver.disposeRun", "driver.shutdown"], [
    "kind bestimmt die Treiberart. supportsPlainLlm erklärt den Betrieb ohne RAgents-Werkzeuge. Optional sind disposeAgent, reviveAgent, haltRun, waitForRunSettlement, disposeRun und shutdown für die zugehörigen Lebenszyklusgrenzen.",
    "request liefert unter anderem die zugestellte Eingabe, Prompt, Modellwahl, Werkzeugliste, invoke und Ereignisausgabe. Der Rückgabewert enthält failure und usage.",
    "Es gibt keine host.drivers-Registry. Die derzeitige DriverRegistry kennt die festen Arten agent und script; eine neue Art verlangt eine bewusste Engine-Integration. profiles allein erweitert diese Grenze nicht.",
  ]),
  entry("language-server", "Produkt- und Laufzeitverträge", "Einen Language Server anbinden", "Ein Language Server analysiert Quellcode und liefert Sprachfunktionen wie Fehlermeldungen und Symbolsuche. Ein Adapter beschreibt, wie RAgents das passende Projekt erkennt und den Server startet. Die vorhandene Einbindung macht diese Funktionen als Werkzeuge und Serverzugriffe verfügbar.", "Server-Einstieg für einen einfachen TypeScript-LSP. Node-Helfer und die neutralen language-server-Hosttypen werden importiert.", `
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
};`, ["lsp.id", "lsp.label", "lsp.languages", "lsp.rootDescription", "lsp.resolveRoot", "lsp.rootDirectory", "lsp.launch", "lsp.open"], [
    "languages ordnet Dateiendungen Sprachkennungen zu. resolveRoot prüft das Projektziel, rootDirectory nennt den Ordner, dem eine Datei dieses Ziels zugeordnet wird (das Projektverzeichnis selbst bei TypeScript, der Ordner der Projektdatei bei Roslyn und FSAC), launch liefert den Prozessstartvertrag für den Sandbox-Kontext und open ergänzt bei Bedarf serverspezifische Öffnungsschritte.",
    "Die nötigen Serverprogramme werden als Pluginabhängigkeit installiert. Ein fehlendes Programm wird als Fehler gemeldet; es wird kein Ersatzprozess still gestartet.",
    "Benötigte Imports: createRequire aus node:module, path aus node:path, pathToFileURL aus node:url und die neutralen Helfer LanguageServerAdapter, resolveRootDirectory, createLanguageServerPlugin sowie PluginModule. Die LSP-Initialisierung übernimmt der Host; open ergänzt danach nur serverspezifische Schritte.",
  ]),
];

const escape = (value: string) => value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]!));

function embeddedDeclaration(source: string, name: string): string {
  const start = source.indexOf(`interface ${name}`);
  if (start < 0) throw new Error(`Der generierte Vertrag ${name} fehlt.`);
  const brace = source.indexOf("{", start);
  let depth = 0;
  for (let index = brace; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] === "}" && --depth === 0) return source.slice(start, index + 1);
  }
  throw new Error(`Der generierte Vertrag ${name} ist unvollständig.`);
}

async function readContract(repoRoot: string, contract: Contract): Promise<{ keys: string[]; text: string }> {
  const source = await readFile(path.join(repoRoot, contract.file), "utf8");
  const text = contract.kind === "embedded" ? embeddedDeclaration(source, contract.name) : source;
  const file = ts.createSourceFile(contract.name + ".ts", text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  if (contract.kind === "schema") {
    let found: ts.ObjectLiteralExpression | undefined;
    const visit = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.name.getText(file) === contract.name && node.initializer && ts.isCallExpression(node.initializer)) {
        const object = node.initializer.arguments[0];
        if (object && ts.isObjectLiteralExpression(object)) found = object;
      }
      ts.forEachChild(node, visit);
    };
    visit(file);
    if (!found) throw new Error(`Der Manifestvertrag ${contract.name} fehlt.`);
    return { keys: found.properties.map((member) => `${contract.id}.${member.name!.getText(file)}`), text: found.getText(file) };
  }
  const declaration = file.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === contract.name);
  if (!declaration) throw new Error(`Der Vertrag ${contract.name} fehlt.`);
  const inheritedDeclarations = (current: ts.InterfaceDeclaration, ancestors: readonly string[]): ts.InterfaceDeclaration[] => {
    if (ancestors.includes(current.name.text)) throw new Error(`Zyklische Vererbung im Vertrag ${contract.name}.`);
    const parents = current.heritageClauses?.flatMap((clause) => clause.types.map((base) => {
      const parent = file.statements.find((node): node is ts.InterfaceDeclaration => ts.isInterfaceDeclaration(node) && node.name.text === base.expression.getText(file));
      if (!parent) throw new Error(`Der geerbte Vertrag ${base.expression.getText(file)} von ${current.name.text} fehlt in ${contract.file}.`);
      return parent;
    })) ?? [];
    return [...parents.flatMap((parent) => inheritedDeclarations(parent, [...ancestors, current.name.text])), current];
  };
  const declarations = [...new Set(inheritedDeclarations(declaration, []))];
  return {
    keys: [...new Set(declarations.flatMap((entry) => entry.members.map((member) => `${contract.id}.${member.name!.getText(file)}`)))],
    text: declarations.map((entry) => entry.getText(file)).join("\n\n"),
  };
}

export async function buildHomepageExtensions(repoRoot: string): Promise<HomepageExtensionsResult> {
  const extensions = definitions();
  const loaded = await Promise.all(contracts.map(async (contract) => ({ contract, ...await readContract(repoRoot, contract) })));
  const actual = new Set(loaded.flatMap((contract) => contract.keys));
  const covered = new Set(extensions.flatMap((extension) => extension.covers));
  const missing = [...actual].filter((key) => !covered.has(key));
  const stale = [...covered].filter((key) => !actual.has(key));
  if (missing.length || stale.length) throw new Error(`Die Entwicklerreferenz ist nicht vollständig. Neu: ${missing.join(", ") || "keine"}; entfernt: ${stale.join(", ") || "keine"}.`);
  for (const extension of extensions) {
    if (!extension.example || !extension.description) throw new Error(`Der Eintrag ${extension.id} hat kein Beispiel.`);
    if (extension.language === "json") JSON.parse(extension.example);
    if (extension.language === "typescript" || extension.language === "tsx") {
      const result = ts.transpileModule(extension.example, { fileName: `${extension.id}.${extension.language === "tsx" ? "tsx" : "ts"}`, reportDiagnostics: true, compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } });
      if (result.diagnostics?.length) throw new Error(`Das Beispiel ${extension.id} ist syntaktisch ungültig.`);
    }
  }
  const groups = [...new Set(extensions.map((extension) => extension.category))];
  const html = `<header class="intro"><p class="eyebrow">Für Entwickler</p><h1>RAgents erweitern</h1><p class="lead">RAgents lässt sich um typisierte Funktionen, Oberflächen und programmierte Abläufe ergänzen. Snippets und Actor-Programme verwenden dieselben registrierten Funktionen. Ein Plugin bündelt solche Ergänzungen für die ganze Anwendung. Eine einzelne Arbeit mit eigenem Journal heißt Run; innerhalb eines Runs können eigene Abläufe und kleine Bedienoberflächen, die Mini-Apps, entstehen.</p></header><p>Die Beispiele zeigen, wo diese Ergänzungen eingebunden werden: Serverbeiträge führen Funktionen aus, Web-Beiträge ergänzen die Oberfläche der Anwendung. Programmierte Abläufe und Mini-Apps gehören zum jeweiligen Run. Die Produkt- und Laufzeitverträge beschreiben die Einbindung in eine eigene Anwendung.</p>
<p>New to the project? The <a href="guide.html">guide</a> explains the runtime, model context, and execution forms. <a href="guide-plugins.html">Plugins, profiles, and skills</a> leads to the relevant extension points.</p><p class="note">The code blocks are excerpts, and each one names its intended location. Plugins are built with the host, while code for a single run is checked and tested before installation.</p><nav class="section-nav" aria-label="Extension points">${groups.map((group, index) => `<a href="#extensions-${index}">${escape(group)}</a>`).join("")}<a href="#access-rights">Built-in permissions</a><a href="#extension-contracts">Contracts</a></nav>
${groups.map((group, index) => `<section id="extensions-${index}"><h2>${escape(group)}</h2>${extensions.filter((extension) => extension.category === group).map((extension) => `<article id="extension-${extension.id}"><h3>${escape(extension.title)}</h3><p>${escape(extension.description)}</p><details><summary>Beispiel (${extension.language})</summary><p class="example-context">${escape(extension.environment)}</p><pre><code class="language-${extension.language}">${escape(extension.example)}</code></pre></details>${extension.sources?.length ? `<p>${extension.sources.map((source) => `<a href="../../${escape(source.file)}">${escape(source.title)}</a>`).join(" / ")}</p>` : ""}${extension.notes.length ? `<ul>${extension.notes.map((note) => `<li>${escape(note)}</li>`).join("")}</ul>` : ""}</article>`).join("")}</section>`).join("\n")}
<section id="access-rights"><h2>Eingebaute Rechte</h2><p>Rechte legen fest, welche Daten ein Benutzer lesen und welche Aktionen er ausführen darf. Die Liste zeigt die in RAgents eingebauten Rechtenamen und ihre Bedeutung. Plugins können zusätzliche eigene Rechte prüfen.</p><table><thead><tr><th>Recht</th><th>Bedeutung</th></tr></thead><tbody>${permissions.map((permission) => `<tr><td><code>${escape(permission.id)}</code></td><td>${escape(permission.description)}</td></tr>`).join("")}</tbody></table><h3>Kernmethoden</h3><p>Die Tabelle ordnet den Methoden der JSON-RPC-API ihre nötigen Rechte zu. Methoden ohne feste Rechte prüft der Host je Run; für den globalen Koordinator, den KI-Ansprechpartner über alle Runs hinweg, gilt eine zusätzliche eigene Regel.</p><table><thead><tr><th>Methode</th><th>Rechte</th></tr></thead><tbody>${methodRights.map((method) => `<tr><td><code>${escape(method.id)}</code></td><td>${escape(method.rights.join(", ") || "je Run")}</td></tr>`).join("")}</tbody></table></section>
<section id="extension-contracts"><h2>Aktuelle Vertragsflächen</h2><p>Ein Vertrag legt die Namen, Felder und Typen fest, die ein Plugin bereitstellen oder verwenden kann. Die folgenden Definitionen stammen direkt aus den TypeScript-Schnittstellen und Paketbeschreibungen im Code. Sie dienen zum Nachschlagen der genauen Anforderungen zu den Beispielen oben.</p>${loaded.map(({ contract, keys, text }) => `<details><summary>${escape(contract.name)} (${keys.length} Felder)</summary><pre><code>${escape(text)}</code></pre></details>`).join("")}</section>`;
  return { html, extensions, permissions, methodRights, contracts: loaded.map(({ contract, text }) => ({ name: contract.name, file: contract.file, text })) };
}
