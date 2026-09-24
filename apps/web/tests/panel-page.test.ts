import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { PanelPage } from "../src/panel/PanelPage";
import { isPanelActionMessage, isPanelStateMessage, type PanelState, type TargetView } from "../src/panel/contract";

const render = (state: PanelState) => renderToStaticMarkup(createElement(PanelPage, { state, send: () => {} }));

const target = (overrides: Partial<TargetView> = {}): TargetView => ({
  name: "werkstatt",
  kind: "server",
  address: "http://localhost:4710",
  route: { kind: "server", host: "localhost:4710", localHost: false },
  state: { kind: "connected" },
  runs: [{ id: "run-a", title: "Nachtbus-Runde", state: "running", pendingActions: 0, updatedAt: Date.now() }],
  entries: [
    { id: "ragents.reference.board", title: "Sammelboard", description: "Ein Board für Ideen", kind: "skill", category: "Mini-Apps" },
    { id: "ragents.reference.circle", title: "Gesprächsrunde", description: "Vier Agenten im Kreis", kind: "script", category: "Run-Scripts" },
  ],
  canCreate: true,
  ...overrides,
});

const page = (overrides: Partial<PanelState> = {}): PanelState =>
  ({ theme: "dark", page: "start", targets: [target()], profileSuggestions: [], ...overrides });

test("Start zeigt die Umgebungen als Block, die letzten Runs und alle Vorlagen als Kacheln; die Aktionen stehen nur in der Titelzeile von VS Code", () => {
  const html = render(page({
    targets: [
      target(),
      target({ name: "core", kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "starting" }, runs: [], entries: [], canCreate: false }),
    ],
  }));
  assert.doesNotMatch(html, /<h1/, "Start hat keine eigene Kopfzeile, der Titel steht schon in der Titelzeile der Ansicht");
  assert.doesNotMatch(html, /aria-label="Runs"|aria-label="Umgebungen einrichten"|Zur Start-Seite/, "keine Symbole, die die Titelzeile schon hat");
  assert.match(html, /aria-label="Umgebungen"/);
  assert.match(html, />Umgebungen</);
  assert.match(html, />werkstatt</);
  assert.match(html, /title="verbunden"/);
  assert.match(html, /aria-label="Runs auf werkstatt"[^>]*>/, "eine verbundene Umgebung führt auf ihre Runs");
  assert.doesNotMatch(html, />Runs<\/span>/, "eine verbundene Umgebung trägt kein Aktionswort");
  assert.match(html, /data-cell="route"[^>]*title="localhost:4710"[^>]*>localhost:4710</);
  assert.match(html, />core</);
  assert.match(html, /title="startet"/);
  assert.match(html, /aria-label="core startet"[^>]*disabled=""/, "eine startende Umgebung ist nicht klickbar");
  assert.match(html, />startet \.\.\.</);
  assert.match(html, /data-cell="route"[^>]*title="lokal \u00b7 core"[^>]*>lokal \u00b7 core</);
  assert.match(html, /aria-label="Neuer Chat auf werkstatt"/);
  assert.doesNotMatch(html, /aria-label="Neuer Chat auf core"/, "eine Umgebung ohne Startrecht bekommt kein Plus");
  assert.match(html, />Weiter</);
  assert.match(html, />Nachtbus-Runde</);
  assert.match(html, /title="läuft"/);
  assert.match(html, />Neu</);
  assert.match(html, />Sammelboard</);
  assert.match(html, />Gesprächsrunde</);
  assert.doesNotMatch(html, /Vorlagen suchen/, "auf Start gibt es keine Suche über die Kacheln");
  assert.doesNotMatch(html, /Trennen|Stoppen|Rückfrage/);
});

test("Neu beginnt je erreichbarer Umgebung mit ihrem Einstieg: der Default als markierte Vorlage, sonst Neuer Chat; das Plus nimmt denselben", () => {
  const chat = render(page());
  assert.match(chat, />Neu<span[^>]*>3</, "die Kachel Neuer Chat zählt mit");
  assert.match(chat, /<ul aria-label="Vorlagen"[^>]*><li[^>]*><button[^>]*title="Neuer Chat"/, "Neuer Chat steht als erste Kachel");
  assert.match(chat, />Ohne Vorlage</);
  assert.match(chat, />Neuer Chat</);
  assert.match(chat, />Leerer Run, der Auftrag entsteht im Chat\.</);
  assert.match(chat, /lucide-plus size-3\.5/, "Neuer Chat unterscheidet sich nur durch sein Icon");
  assert.match(chat, /aria-label="Neuer Chat auf werkstatt"/);
  assert.doesNotMatch(chat, />Standard</);
  const standard = render(page({ targets: [target({ defaultEntry: "ragents.reference.circle" })] }));
  assert.match(standard, />Neu<span[^>]*>2</, "der Default steht nicht ein zweites Mal");
  assert.match(standard, /<ul aria-label="Vorlagen"[^>]*><li[^>]*><button[^>]*title="Gesprächsrunde"/, "die Default-Kachel steht zuerst");
  assert.match(standard, />Standard</);
  assert.equal(standard.match(/>Gesprächsrunde</g)?.length, 1);
  assert.doesNotMatch(standard, />Neuer Chat</);
  assert.match(standard, /aria-label="Neuer Run aus Gesprächsrunde auf werkstatt"/);
  const two = render(page({ targets: [target(), target({ name: "zweit", address: "http://localhost:4727", runs: [] })] }));
  assert.match(two, /aria-label="Vorlagen auf werkstatt"[^>]*><li[^>]*><button[^>]*title="Neuer Chat"/, "je Umgebung beginnt ihre Gruppe mit dem Einstieg");
  assert.match(two, /aria-label="Vorlagen auf zweit"[^>]*><li[^>]*><button[^>]*title="Neuer Chat"/);
  const none = render(page({ targets: [target({ state: { kind: "stopped" }, runs: [] })] }));
  assert.doesNotMatch(none, />Neu</, "ohne erreichbare Umgebung gibt es keinen Abschnitt Neu");
});

test("bei einem Fehler ist das Zustandssymbol ein eigener Knopf für die Meldung, beim Schloss für die Anmeldung, sonst keiner", () => {
  const failed = render(page({ targets: [target({ state: { kind: "failed", message: "kein Checkout" }, runs: [] })] }));
  assert.match(failed, /aria-haspopup="dialog"[^>]*aria-label="Fehler von werkstatt anzeigen"/);
  assert.match(failed, /title="gescheitert"/);
  assert.match(failed, /aria-label="werkstatt erneut versuchen"/, "der linke Teil des Chips behält seine Aktion");
  assert.doesNotMatch(failed, /kein Checkout/, "die Meldung steht erst im geöffneten Popover");
  const forbidden = render(page({ targets: [target({ state: { kind: "forbidden", message: "Kein Zugriff" }, runs: [] })] }));
  assert.match(forbidden, /aria-label="Fehler von werkstatt anzeigen"/);
  const login = render(page({ targets: [target({ state: { kind: "login-required", mode: "password" }, runs: [] })] }));
  assert.match(login, /aria-label="Anmeldung an werkstatt"/);
  assert.doesNotMatch(login, /aria-label="Fehler von/);
  for (const state of [{ kind: "connected" as const }, { kind: "starting" as const }, { kind: "stopped" as const }]) {
    const html = render(page({ targets: [target({ state, runs: [] })] }));
    assert.doesNotMatch(html, /aria-label="Fehler von|aria-label="Anmeldung an/, `${state.kind}: das Symbol hat keine eigene Aktion`);
  }
});

test("ab zwei Umgebungen nennt jede Run-Zeile ihre Umgebung und Neu gruppiert die Kacheln je Umgebung, bei einer keins von beidem", () => {
  const two = render(page({ targets: [target(), target({ name: "zweit", address: "http://localhost:4727", runs: [] })] }));
  assert.match(two, /Nachtbus-Runde \(werkstatt\)/);
  assert.match(two, /<h3[^>]*>[\s\S]*?werkstatt<\/h3><ul aria-label="Vorlagen auf werkstatt"/, "Gruppenüberschrift je Umgebung");
  assert.match(two, /<h3[^>]*>[\s\S]*?zweit<\/h3><ul aria-label="Vorlagen auf zweit"/);
  assert.equal(two.match(/title="Sammelboard"/g)?.length, 2, "die Kachel nennt die Umgebung nicht mehr selbst");
  const one = render(page());
  assert.doesNotMatch(one, /Nachtbus-Runde \(werkstatt\)|<h3/);
  assert.match(one, /<ul aria-label="Vorlagen"/);
});

test("eine Run-Zeile nennt das Problem eines Runs, dessen Laufansicht nicht lesbar ist", () => {
  const html = render(page({ targets: [target({ runs: [
    { id: "run-a", title: "Nachtbus-Runde", state: "idle", pendingActions: 0, updatedAt: Date.now(), problem: "Die Laufansicht ist nicht lesbar: kaputt" },
    { id: "run-b", title: "Balkon", state: "idle", pendingActions: 0, updatedAt: Date.now() },
  ] })] }));
  assert.match(html, /Nachtbus-Runde<\/span><span class="[^"]*text-destructive[^"]*" title="Die Laufansicht ist nicht lesbar: kaputt">/);
  assert.equal(html.match(/text-destructive[^"]*" title="Die Laufansicht/g)?.length, 1, "nur der betroffene Run trägt die Meldung");
});

test("Start zeigt höchstens fünf Runs und führt auf die volle Liste", () => {
  const runs = Array.from({ length: 7 }, (unused, index) => ({
    id: `run-${index}`, title: `Run ${index}`, state: "idle" as const, pendingActions: 0, updatedAt: Date.now() - index * 60_000,
  }));
  const html = render(page({ targets: [target({ runs })] }));
  assert.match(html, />Alle 7 Runs</);
  assert.match(html, />Run 4</);
  assert.doesNotMatch(html, />Run 5</, "nach fünf Zeilen endet der Block Weiter");
});

test("eine Kachel mit Leitfaden heißt Einrichten wie in der Web-App, sonst Starten", () => {
  const html = render(page({ targets: [target({ entries: [
    { id: "ragents.reference.board", title: "Sammelboard", description: "Ein Board für Ideen", kind: "skill", category: "Mini-Apps" },
    { id: "ragents.reference.circle", title: "Gesprächsrunde", description: "Vier Agenten im Kreis", kind: "script", category: "Run-Scripts", guided: true },
  ] })] }));
  assert.match(html, /title="Gesprächsrunde"(?:(?!<\/button>).)*>Einrichten</s);
  assert.match(html, /title="Sammelboard"(?:(?!<\/button>).)*>Starten</s);
  assert.doesNotMatch(html, /title="Gesprächsrunde"(?:(?!<\/button>).)*>Starten</s);
});

test("der linke Teil des Chips trägt je Zustand sein Aktionswort", () => {
  const login = render(page({ targets: [target({ state: { kind: "login-required", mode: "password" }, runs: [] })] }));
  assert.match(login, /title="Anmeldung nötig"/);
  assert.match(login, /aria-label="An werkstatt anmelden"/);
  assert.match(login, />Anmelden<\/span>/);
  const unreachable = render(page({ targets: [target({ state: { kind: "unreachable", message: "fetch failed" }, runs: [] })] }));
  assert.match(unreachable, /title="nicht erreichbar"/);
  assert.match(unreachable, /aria-label="werkstatt erneut versuchen"/);
  assert.match(unreachable, />Erneut versuchen<\/span>/);
  const stoppedServer = render(page({ targets: [target({ state: { kind: "stopped" }, runs: [] })] }));
  assert.match(stoppedServer, /aria-label="Mit werkstatt verbinden"/);
  assert.match(stoppedServer, />Verbinden<\/span>/);
  const stoppedProfile = render(page({ targets: [target({ kind: "profile", route: { kind: "profile", profile: "core" }, state: { kind: "stopped" }, runs: [] })] }));
  assert.match(stoppedProfile, /aria-label="werkstatt starten"/);
  assert.match(stoppedProfile, />Starten<\/span>/);
  const distributed = render(page({ targets: [target({ route: { kind: "server", host: "workshop.example.com", localHost: true }, runs: [] })] }));
  assert.match(distributed, /title="workshop.example.com \u00b7 lokal"/);
});

test("ohne Umgebung und bei kaputter Einstellung führt Start zu den Umgebungen", () => {
  const empty = render(page({ targets: [] }));
  assert.match(empty, />Umgebung anlegen</);
  const broken = render(page({ targets: [], problem: "ragents.connections muss eine Liste sein" }));
  assert.match(broken, /role="alert"[^>]*>ragents.connections muss eine Liste sein</);
});

test("die Seite Runs führt alle Runs zusammen und bietet Suche, Ausblenden und Auswahl", () => {
  const html = render(page({
    page: "runs",
    targets: [
      target({ runs: [{ id: "run-a", title: "Nachtbus-Runde", state: "waiting", pendingActions: 2, updatedAt: Date.now() }] }),
      target({ name: "core", runs: [{ id: "run-b", title: "Wortspiel", state: "ended", pendingActions: 0, updatedAt: Date.now() - 3 * 86_400_000 }] }),
    ],
  }));
  assert.match(html, /<h1[^>]*>Runs<\/h1>/);
  assert.match(html, /aria-label="Zur Start-Seite"/);
  assert.doesNotMatch(html, /aria-label="Umgebungen"/, "die Kopfzeile trägt nur Titel und Zurück");
  assert.match(html, /aria-label="Runs suchen"/);
  assert.match(html, />Beendete ausblenden</);
  assert.match(html, />Auswählen</);
  assert.match(html, />Nachtbus-Runde</);
  assert.match(html, />Wortspiel</);
  assert.match(html, /title="wartet auf Eingabe \(2\)"/);
  assert.match(html, />3 d</);
  assert.doesNotMatch(html, /Alle Umgebungen/, "Filterchips sind aus");
  assert.doesNotMatch(html, /aria-label="Nur /, "ohne Chip-Klick gibt es keinen Umgebungsfilter");
  assert.doesNotMatch(html, /ausgewählt</, "die Auswahlleiste kommt erst mit dem Auswahlmodus");
  assert.match(html, /<ul aria-label="Runs" class="[^"]*grid-cols-\[auto_minmax\(0,1fr\)_auto_auto\]/, "ab zwei Umgebungen hat die Liste eine Spalte für die Umgebung");
  assert.match(html, /data-cell="environment"[^>]*title="core"[^>]*>core</);
});

test("der Chip auf Start gibt der Seite Runs ihre Umgebung mit; der Filter steht als gedrückter Schalter", () => {
  const html = render(page({
    page: "runs",
    runsEnvironment: "core",
    targets: [
      target({ runs: [{ id: "run-a", title: "Nachtbus-Runde", state: "waiting", pendingActions: 2, updatedAt: Date.now() }] }),
      target({ name: "core", runs: [{ id: "run-b", title: "Wortspiel", state: "ended", pendingActions: 0, updatedAt: Date.now() }] }),
    ],
  }));
  assert.match(html, /aria-pressed="true"[^>]*aria-label="Nur core"/);
  assert.match(html, />Wortspiel</);
  assert.doesNotMatch(html, />Nachtbus-Runde</, "die Runs der anderen Umgebung bleiben draußen");
  const single = render(page({ page: "runs" }));
  assert.match(single, /<ul aria-label="Runs" class="[^"]*grid-cols-\[auto_minmax\(0,1fr\)_auto\]/, "mit einer Umgebung fehlt die Spalte");
  assert.doesNotMatch(single, /data-cell="environment"/);
});

test("die Seite Umgebungen führt die Zeilen mit ihren Handlungen, ohne Starten und Stoppen", () => {
  const html = render(page({
    page: "environments",
    targets: [
      target({ savedLogin: true }),
      target({ name: "core", kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "starting" }, runs: [], entries: [], canCreate: false }),
    ],
  }));
  assert.match(html, /<h1[^>]*>Umgebungen<\/h1>/);
  assert.match(html, /aria-label="Zur Start-Seite"/);
  assert.match(html, /aria-label="Einstellung öffnen"[^>]*>.*settings\.json</);
  assert.match(html, /aria-label="werkstatt entfernen"/);
  assert.match(html, /title="http:\/\/localhost:4710"/);
  assert.match(html, /title="\/x\/ragents\.config\.core\.ts"[^>]*>ragents\.config\.core\.ts</);
  assert.match(html, />Trennen</);
  assert.match(html, />Abmelden</);
  assert.match(html, />Bearbeiten</);
  assert.match(html, />Neue Umgebung</);
  assert.match(html, /title="startet"/);
  assert.doesNotMatch(html, />Starten</, "ein lokales Profil startet die Erweiterung selbst");
  assert.doesNotMatch(html, />Stoppen</);
  assert.doesNotMatch(html, /Wirklich entfernen\?/, "das Entfernen fragt im Dialog zurück");
  assert.doesNotMatch(html, /Art der Umgebung/, "der Dialog steht erst nach dem Klick");
  const failed = render(page({ page: "environments", targets: [target({ kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "failed", message: "setze ragents.hostPath darauf" }, runs: [], entries: [] })] }));
  assert.match(failed, /title="gescheitert"/);
  assert.match(failed, /role="alert"[^>]*>setze ragents.hostPath darauf</);
  assert.match(failed, />Erneut versuchen</);
  const empty = render(page({ page: "environments", targets: [] }));
  assert.match(empty, />Noch keine Umgebung.</);
});

test("die Seite Umgebungen nennt Namen aus ragents.hostEnvironment ohne Wert und bietet das Setzen an", () => {
  assert.doesNotMatch(render(page({ page: "environments" })), /Fehlende Werte/, "ohne Angabe bleibt die Seite unverändert");
  assert.doesNotMatch(render(page({ page: "environments", missingSecrets: [] })), /Fehlende Werte/, "ist nichts offen, steht dort kein leerer Kasten");
  const one = render(page({ page: "environments", missingSecrets: ["SERVICE_TOKEN"] }));
  assert.match(one, />Fehlende Werte</);
  assert.match(one, /ragents\.hostEnvironment/);
  assert.match(one, /kein Wert in der SecretStorage/);
  assert.match(one, /lokal gestarteter Host bekommt die Umgebungsvariable nicht/);
  assert.match(one, />SERVICE_TOKEN</);
  assert.match(one, /aria-label="Wert für SERVICE_TOKEN setzen"/);
  const two = render(page({ page: "environments", missingSecrets: ["SERVICE_TOKEN", "SERVICE_URL"] }));
  assert.match(two, /aria-label="Wert für SERVICE_TOKEN setzen"/);
  assert.match(two, /aria-label="Wert für SERVICE_URL setzen"/);
  assert.equal(two.match(/>Wert setzen</g)?.length, 2, "je fehlendem Namen eine Zeile");
  assert.doesNotMatch(render(page({ missingSecrets: ["SERVICE_TOKEN"] })), /Fehlende Werte/, "Start bleibt, wie es war");
});

test("eine Umgebung, der eine Umgebungsvariable fehlt, erklärt den Fall und führt zum Wert und zum neuen Versuch", () => {
  const missing = { variable: "SERVICE_TOKEN", section: "ragents.example", key: "SERVICE_KEY" };
  const html = render(page({
    page: "environments",
    targets: [target({ kind: "profile", address: "/x/ragents.config.core.ts", route: { kind: "profile", profile: "core" }, state: { kind: "failed", message: "run-provision.ts endete mit Code 1" }, runs: [], entries: [], missingEnvironment: missing })],
  }));
  assert.match(html, /role="alert"[^>]*>Die Umgebungsvariable SERVICE_TOKEN ist nicht gesetzt; die Konfiguration verlangt sie für ragents\.example\.SERVICE_KEY\./);
  assert.match(html, /Hinterlege ihren Wert als Secret/);
  assert.doesNotMatch(html, /endete mit Code 1/, "statt der Zeile aus dem Ausgabekanal steht dort der verständliche Grund");
  assert.match(html, /aria-label="Wert für SERVICE_TOKEN setzen und werkstatt erneut starten"/);
  assert.match(html, />Wert setzen</);
  assert.match(html, />Erneut versuchen</);
  const start = render(page({ targets: [target({ state: { kind: "failed", message: "run-provision.ts endete mit Code 1" }, runs: [], missingEnvironment: missing })] }));
  assert.match(start, /aria-label="Fehler von werkstatt anzeigen"/, "die Kachel trägt den Grund an ihrem Zustandssymbol");
  const ohne = render(page({ page: "environments", targets: [target({ state: { kind: "failed", message: "kein Checkout" }, runs: [], entries: [] })] }));
  assert.match(ohne, /role="alert"[^>]*>kein Checkout</);
  assert.doesNotMatch(ohne, />Wert setzen</, "ohne Befund bleibt es beim bisherigen Grund");
});

test("Nachrichten in beide Richtungen werden vor der Verarbeitung geprüft", () => {
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "start" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "runs" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "environments" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "run" }), false, "zum Run führt openRun, nicht page");
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "irgendwas" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "runs", environment: "core" }), true, "der Chip gibt Runs seine Umgebung mit");
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "page", page: "runs", environment: 3 }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "connect", name: "werkstatt" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "connect" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "retry", name: "werkstatt" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "addServer", name: "a", url: "http://x" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "addProfile", name: "a", profileFile: "/x/ragents.config.a.ts" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "updateServer", name: "a", newName: "b", url: "http://x" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "updateServer", name: "a", url: "http://x" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "updateProfile", name: "a", newName: "b", profileFile: "/x/ragents.config.b.ts" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "login", name: "werkstatt", user: "a", password: "b" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "login", name: "werkstatt", token: "t" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "login", name: "werkstatt" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "openRun", name: "werkstatt", runId: "run-a" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "werkstatt", runIds: ["run-a", "run-b"] }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "werkstatt", runIds: [] }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "werkstatt", runIds: "run-a" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "deleteRuns", name: "werkstatt" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "newRun", name: "werkstatt" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "newRun", name: "werkstatt", entryId: 3 }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret", name: "SERVICE_TOKEN" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret", name: "SERVICE_TOKEN", environment: "core" }), true, "aus dem Fehler einer Umgebung kommt ihr Name mit");
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret", name: "SERVICE_TOKEN", environment: 3 }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "setSecret" }), false);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "showOutput" }), true);
  assert.equal(isPanelActionMessage({ type: "ragents.panel", action: "evil" }), false);
  assert.equal(isPanelStateMessage({ type: "ragents.panel.state", state: { theme: "dark", page: "start", targets: [], profileSuggestions: [] } }), true);
  assert.equal(isPanelStateMessage({ type: "ready" }), false);
});
