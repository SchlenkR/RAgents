import { modelToolDescriptors, type PluginHost } from "@aicontainer/ragents";

const summary = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  const end = normalized.indexOf(". ");
  const sentence = end < 0 ? normalized : normalized.slice(0, end + 1);
  return sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}...` : sentence;
};

export function overseerOrientation(host: PluginHost): string {
  const tools = [
    ...modelToolDescriptors.map((tool) => ({ ...tool, owner: "engine" })),
    ...host.tools.describe(),
    ...host.agentRuntime.describeTools(),
  ];
  const owners = [...new Set(tools.map((tool) => tool.owner))].sort();
  const methods = [...host.methods.describe()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  return [
    "[Fähigkeitenüberblick aus den registrierten Verträgen]",
    "JSON-RPC-Aufrufe über bash/curl gegen $RAGENTS_API_BASE_URL/rpc. Eingaben und Ergebnisse bei Bedarf in rpc-reference.md oder openrpc.json nachlesen.",
    ...methods.map((method) => `- ${method.id}: ${summary(method.description)} [${method.rights.join(", ") || "keine festen Rechte"}]`),
    "Die Rechte in Klammern gelten für angemeldete Benutzer. Dieser globale Koordinator verwendet die lokale Dienstidentität, keine zusätzlich vergebenen Benutzerrechte.",
    "",
    "[Bausteine regulärer Runs]",
    "Dies ist der Katalog der Engine und der aktuell installierten Plugins, keine zusätzliche Werkzeugliste dieses Chats. Nutze diese Bausteine für Run-Aufträge oder eigene Run-Setups über die JSON-RPC-API. Verfügbarkeit und Aufrufbarkeit hängen weiterhin von Actor, Grants, deklarierter Script-Teilmenge und Run-Kontext ab; ein Katalogeintrag erteilt keine Rechte.",
    "Details und Beispiele: $RAGENTS_API_BASE_URL/help/llms.txt. Die öffentliche Hilfe beschreibt core; der folgende Bestand stammt aus diesem laufenden Profil. Für zusätzliche profilabhängige Beiträge die tatsächlich registrierten Plugin-Verträge nachlesen.",
    ...owners.flatMap((owner) => [
      `${owner}:`,
      ...tools.filter((tool) => tool.owner === owner).sort((a, b) => a.name.localeCompare(b.name, "en"))
        .map((tool) => `- ${tool.name}: ${summary(tool.description)}${tool.availability === "conditional" ? " [kontextabhängig]" : ""}`),
    ]),
  ].join("\n");
}
