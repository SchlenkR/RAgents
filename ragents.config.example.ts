// RAgents-Konfiguration als TypeScript: Sektionen je Plugin-ID plus host, echte Listen, echte
// Kommentare. Diese Datei ist nur die Vorlage und wird nicht geladen; das Muster kopierst Du in
// ragents.config.<profil>.ts daneben.
//
// Je Produkt eine eigene Datei: ragents.config.core.ts oder ragents.config.<eigenes profil>.ts.
// PRODUCT_PROFILE wählt aus (scripts/start.sh <profil> setzt es); eine Datei außerhalb des Repos
// wählt PRODUCT_PROFILE_FILE oder scripts/start.sh <pfad zur datei>;
// getrennte Dateien sind Pflicht, weil die Schlüssel als Umgebungsvariablen materialisiert werden
// und sonst für alle Profile gleichzeitig gälten.
//
// Schichtung: die Datei liefert Werte, bereits gesetzte Umgebungsvariablen gewinnen pro Schlüssel.
// Ohne Konfiguration für das Profil läuft alles rein über Umgebungsvariablen.
//
// Secrets (Schlüssel auf _PAT, _KEY, _TOKEN, _SECRET, _PASSWORD sowie als secret deklarierte)
// stehen NICHT im Klartext, sondern nur als env("ENV_NAME"); der Wert kommt aus der Umgebung, fehlt
// die Variable -> harter Startfehler. Es gibt KEINE .env: die Werte stehen in der ~/.zshrc, der
// Container bekommt sie über environment: im Compose durchgereicht.
//
// Booleans werden als 1/0 materialisiert, Listen als JSON-Array. Sektionsnamen und Schlüssel der
// Plugins prüft der Start gegen die Deklarationen der geladenen Plugins; unbekanntes bricht ab.
import { env, type ProfileUser, type RAgentsConfig } from "./apps/server/src/config-definition.js";

// Ohne diesen Export bleibt die Anmeldung aus; eine leere Liste ist ein Startfehler.
export const users = [
  { id: "admin", label: "Administration", password: env("RAGENTS_ADMIN_PASSWORD"), rights: ["*"] },
  { id: "reader", label: "Lesezugang", password: env("RAGENTS_READER_PASSWORD"), rights: ["runs.read", "ragents.overseer.read"] },
] as const satisfies readonly ProfileUser[];

export const config = {
  // Host-Ebene (Server selbst, keine Plugin-Schlüssel)
  host: {
    PORT: 4712,
    // DATA_DIR: "/data",
    // WEB_DIST_DIR: "apps/web/dist",
    // AGENT_HOME_DIR: "apps/server/agent-home",
    // Vorgabe für Agentenprofile; die Stufe muss zum jeweiligen Modell passen
    // AGENT_THINKING: "high",
    // Modell für kompakte Sidebar-Titel (leer = erste Prompt-Zeile), Provider default openrouter
  COMPACTION_MODEL: "google/gemma-4-26b-a4b-it",
    // Default-Timeout des bash-Werkzeugs in Sekunden
    // RAGENTS_BASH_TIMEOUT_SECONDS: 600,
    // Produktprofil: der Name dieser Datei ohne ragents.config. und .ts
    PRODUCT_PROFILE: "core",
    // Produkt und Pluginliste DIESES Profils. Es gibt kein Preset mehr: ein Profil ist genau
    // diese Datei. PRODUCT_ID bestimmt auch den Namen des Zugangs-Cookies.
    PRODUCT_ID: "ragents",
    PRODUCT_TITLE: "RAgents",
    // Ein Eintrag ist eine Kennung (Ordner unter plugins/) oder ein Pfad auf einen Plugin-Ordner
    // an beliebiger Stelle, relativ zu dieser Datei oder absolut.
    PLUGINS: [
      "ragents.orchestration",
      "ragents.workspace",
      "ragents.product",
      "ragents.overseer",
      "ragents.activity",
      "ragents.watch",
      "./plugins/mein.plugin",
      // "/absoluter/pfad/zu/mein.anderes-plugin",
    ],
    // Secrets nur als Referenz oder direkt per Umgebung:
    // ACCESS_TOKEN: env("RAGENTS_ACCESS_TOKEN"),
  },

  // Neutrales Produkt: Koordinator- und Umsetzungsmodelle
  "ragents.product": {
    AGENT_PROVIDER: "openrouter",
    AGENT_MODEL: "anthropic/claude-sonnet-4.6",
    AGENT_THINKING: "high",
    // Leer lassen fällt auf AGENT_MODEL zurück
    AGENT_COORDINATOR_MODEL: "deepseek/deepseek-v4-flash-0731",
    AGENT_COORDINATOR_THINKING: "high",
    // Reviewer: eigenes Modell und eigene Denkstufe (Vorgabe: AGENT_MODEL, low)
    AGENT_REVIEWER_MODEL: "deepseek/deepseek-v4-flash-0731",
    AGENT_REVIEWER_THINKING: "low",
    OPENROUTER_API_KEY: env("OPENROUTER_VSCODE_APIKEY"),
    // Auswahl im leeren Chat: eine echte Liste, kein Wert mit Trennzeichen
    AGENT_MODELS: ["deepseek/deepseek-v4-flash-0731", "anthropic/claude-sonnet-4.6"],
    // Optional die Modellfähigkeiten einschränken; ohne Eintrag gelten die Modellmetadaten
    AGENT_MODEL_REASONING: ["deepseek/deepseek-v4-flash-0731: off high"],
    // SYSTEM_PROMPT_PATH: "pfad/zu/prompt.hbs",
    // Anzeige der Tool-/Denkschritte im Chat (leer = Default)
    // CHAT_STEPS_MODE_COORDINATOR: "grouped",
    // CHAT_STEPS_MODE_AGENTS: "grouped",
    // CHAT_STEPS_VISIBLE: true,
    // CHAT_STEPS_EXPANDABLE: true,
    // Umschalter im Chat; voreingestellt an
    // CHAT_STEPS_SELECTABLE: true,
    // Modellwahl als Startoption im leeren Chat; voreingestellt an.
    // Systemprompt- und Modellwahl sind Startoptionen des Produkt-Plugins; weitere Startoptionen
    // (etwa die Quelle des Arbeitsverzeichnisses) melden andere Plugins an.
    // MODEL_SELECTABLE: true,
    // Zusätzliche Skill-Ordner mit SKILL.md außerhalb des Repos.
    // SKILLS_DIR: "/pfad/außerhalb/des/repos/skills",
    // Ebenso deployment-lokale auswählbare Systemprompts: jede .md oder .hbs im Verzeichnis ist
    // eine Auswahl, die Kennung ist der Dateiname ohne Endung, die Beschriftung die erste
    // # Überschrift darin.
    // SYSTEM_PROMPTS_DIR: "/pfad/außerhalb/des/repos/prompts",
    // selectable = der Benutzer wählt im leeren Chat, fixed = immer SYSTEM_PROMPT_DEFAULT
    // SYSTEM_PROMPT_MODE: "selectable",
    // Bei fixed Pflicht, bei selectable die Voreinstellung (sonst die erste Datei)
    // SYSTEM_PROMPT_DEFAULT: "01-standard",
    // 1 = der gewählte Prompt steht auch im Systemprompt jedes erzeugten Agenten, außer bei
    // Plain-LLMs mit tools: [], die ausschließlich ihren eigenen Prompt erhalten
    // SYSTEM_PROMPT_SHARE_DEFAULT: "1",
  },

  // Ein eigenes Plugin bringt seine Sektion selbst mit: der Sektionsname ist die Plugin-Kennung,
  // die Schlüssel stehen in seiner Konfigurationsdeklaration. Liegt das Plugin außerhalb von
  // plugins/, steht sein Pfad in PLUGINS, die Sektion trägt trotzdem nur den Ordnernamen.
  "mein.plugin": {
    PLUGIN_ENDPOINT: "https://beispiel.invalid/api",
    PLUGIN_API_TOKEN: env("MEIN_PLUGIN_API_TOKEN"),
  },

  // Arbeitsverzeichnis je Unterhaltung: ragents.workspace legt es leer unter der Session-Ablage an
  // (/data/sessions/<runId>/plugins/ragents.workspace/workspace) und braucht dafür keinen Schlüssel.
  // Inhalt oder ein anderes Verzeichnis liefert ein Plugin über den Dienst workspaceResolverToken;
  // meldet es dafür eine Startoption an, wählt der Benutzer im leeren Chat. Die Sandbox löst Symlinks
  // auf: was die Agenten lesen sollen, muss real unterhalb des gelieferten Verzeichnisses liegen.

  // Dateiablage (Dokumente) je Unterhaltung, getrennt vom Arbeitsverzeichnis. Ohne Schlüssel liegt sie
  // unter der Session-Ablage und verschwindet mit der Unterhaltung; mit DOCUMENTS_DIR entsteht je
  // Unterhaltung ein Unterordner unter diesem absoluten Pfad, den der Host beim Löschen nicht anfasst.
  "ragents.documents": {
    // DOCUMENTS_DIR: "/pfad/außerhalb/des/repos/dokumente",
  },

  // Language Server (Diagnostik nach jedem edit/write, ohne Build). Binaries per
  // scripts/install-plugin-dependencies.sh <zielordner> laden; Pfade absolut angeben.
  // ragents.lsp-typescript braucht keinen Schlüssel (typescript-language-server ist gebündelt).
  "ragents.lsp-roslyn": {
    // ROSLYN_LANGUAGE_SERVER: "/opt/language-servers/roslyn/Microsoft.CodeAnalysis.LanguageServer.dll",
  },
  "ragents.lsp-fsharp": {
    // FSHARP_LANGUAGE_SERVER: "/opt/language-servers/fsautocomplete/fsautocomplete",
  },

  // ragents.ask deklariert derzeit keine Schlüssel.
} as const satisfies RAgentsConfig;
