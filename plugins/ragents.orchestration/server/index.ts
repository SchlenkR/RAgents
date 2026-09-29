import {
  actorInputSchema,
  agentTools,
  enqueueActorInput,
  eventResultSchemaOf,
  ScriptDriver,
  type ActorInputRequest,
  type RAgentsPlugin,
} from "@ragents/engine";
import { runtimeProviderToken } from "@ragents/host/ragents/host-services.js";
import { pluginAsset } from "@ragents/host/plugin-support/plugin-folder.js";
import type { PluginModule } from "@ragents/host/plugin-support/plugin-module.js";
import { boundToTools, handlebarsPrompt } from "@ragents/host/plugin-support/prompt.js";
import { createSurfaceToolContributor } from "./surface-tool.js";
import { createRunStopContributor } from "./run-stop-tool.js";
import { runManagementToken } from "@ragents/host/ragents/global-chat.js";

const orchestrationPlugin: RAgentsPlugin = {
  manifest: { id: "ragents.orchestration" },
  register: (host) => {
    host.functions(createSurfaceToolContributor());
    host.functions(createRunStopContributor(
      (runId) => host.service(runManagementToken)().stop(runId),
      (error) => console.error("Run stop by the coordinator failed", error),
    ));
    host.operations({
      id: "actor_input",
      label: "Enqueue actor input",
      description: "Enqueues a normal text input for an actor under the bound identity - "
        + "as an agent or, from an app action, as the owner of the run. Only confirms the enqueueing. TypeScript actors understand only their programmed input protocol, no free-form tasks.",
      schema: actorInputSchema,
      resultSchema: eventResultSchemaOf("actor.input.enqueued"),
      operator: "direct",
      execute: (context, input) =>
        enqueueActorInput(host.service(runtimeProviderToken)(), {
          actorId: context.principal.actorId,
          commandId: context.invocationId,
          ...(context.principal.kind === "agent" && context.principal.turnId
            ? { turnId: context.principal.turnId }
            : {}),
          correlationId: context.invocationId,
          causationId: context.invocationId,
        }, context.runId, input as ActorInputRequest),
    });
    host.script({
      id: "typescript",
      create: (context) => ({
        driver: new ScriptDriver({ runtime: context.runtime }),
      }),
    });
    host.prompts(
      handlebarsPrompt("ragents.orchestration.prompt", 600, pluginAsset("ragents.orchestration", "orchestration.hbs")),
      boundToTools(
        handlebarsPrompt("ragents.orchestration.surface", 650, pluginAsset("ragents.orchestration", "surface.hbs")),
        "canvas_layout_replace",
      ),
    );
  },
};

export const plugin: PluginModule = { create: () => orchestrationPlugin };
