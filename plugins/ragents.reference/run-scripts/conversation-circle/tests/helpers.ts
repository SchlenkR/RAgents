import { createTestContext } from "@ragents/server/testing";

export const setupContext = (profiles = [{ name: "coordinator", driver: "agent" }, { name: "standard", driver: "agent" }]) => {
  const calls: { name: string; input: unknown }[] = [];
  const functions = Object.fromEntries(["model_list", "agent_spawn", "run_configure", "actor_input", "canvas_layout_replace", "actor_program_activate"].map((name) => [name, (input: unknown) => {
    calls.push({ name, input });
    if (name === "agent_spawn") {
      const handle = (input as { handle: string }).handle;
      return { id: `actor-${handle}`, handle };
    }
    if (name === "actor_program_activate") {
      const value = input as { name: string; actor: string };
      return { name: value.name, actor: value.actor, views: 1, active: true };
    }
    return name === "model_list" ? {
      profiles: profiles.map((profile) => ({ ...profile, description: "Testprofil", turnTimeoutMs: null,
        isolateWorkspace: false, provider: "test", model: "test" })), models: [],
    } : name === "actor_input" ? [] : null;
  }]));
  return { calls, context: createTestContext<{ built?: boolean }>({ state: {}, functions }) };
};

export const startInput = (input: unknown) => ({
  id: "start", content: JSON.stringify({ input, options: {} }), artifactIds: [],
  sourceEventIds: [], subscriptionId: null, event: null,
});
