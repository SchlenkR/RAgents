import { modelToolDescriptors, type PluginHost } from "@ragents/engine";

const summary = (text: string): string => {
  const normalized = text.replace(/\s+/g, " ").trim();
  const end = normalized.indexOf(". ");
  const sentence = end < 0 ? normalized : normalized.slice(0, end + 1);
  return sentence.length > 200 ? `${sentence.slice(0, 197).trimEnd()}...` : sentence;
};

export function overseerOrientation(host: PluginHost, shell: boolean): string {
  const tools = [
    ...modelToolDescriptors.map((tool) => ({ ...tool, owner: "engine" })),
    ...host.tools.describe(),
  ];
  const owners = [...new Set(tools.map((tool) => tool.owner))].sort();
  const methods = [...host.methods.describe()].sort((left, right) => left.id.localeCompare(right.id, "en"));
  return [
    "[Capability overview from the registered contracts]",
    `JSON-RPC calls via ${shell ? "bash/curl" : "fetch in a snippet"} against $RAGENTS_API_BASE_URL/rpc. Look up inputs and results in rpc-reference.md or openrpc.json when needed.`,
    ...methods.map((method) => `- ${method.id}: ${summary(method.description)} [${method.rights.join(", ") || "no fixed rights"}]`),
    "The rights in brackets apply to signed-in users. This coordinator calls the methods with its user's access and thus has exactly their rights.",
    "",
    "[Building blocks of regular runs]",
    "This is the catalog of the engine and the currently installed plugins, not an additional tool list of this chat. Use these building blocks for run tasks or your own run setups via the JSON-RPC API. Availability and callability still depend on actor, grants, declared script subset and run context; a catalog entry grants no rights.",
    "Details and examples: $RAGENTS_API_BASE_URL/help/llms.txt. The public help describes core; the following inventory comes from this running profile. For additional profile-dependent contributions, look up the actually registered plugin contracts.",
    ...owners.flatMap((owner) => [
      `${owner}:`,
      ...tools.filter((tool) => tool.owner === owner).sort((a, b) => a.name.localeCompare(b.name, "en"))
        .map((tool) => `- ${tool.name}: ${summary(tool.description)}${tool.availability === "conditional" ? " [context-dependent]" : ""}`),
    ]),
  ].join("\n");
}
