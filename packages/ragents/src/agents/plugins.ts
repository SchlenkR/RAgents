import type { Actor, RunView } from "../domain/model.ts";
import {
    agentTools,
    describeToolAvailability,
    type RunFunction,
    type ToolDescriptor,
} from "./tools.ts";

export type PluginContext = {
    runId: string;
    actorId: string;
    turnId: string | null;
    actor: Actor;
    view: RunView;
    workspace: string;
};

export type ToolContributor = {
    name: string;
    descriptors: readonly ToolDescriptor[];
    dynamic?: boolean;
    tools: (context: PluginContext) => readonly RunFunction[] | Promise<readonly RunFunction[]>;
};

export type AgentToolPlugin = ToolContributor;

export interface ToolProvider {
    resolve(context: PluginContext, onUnavailable?: (tool: RunFunction) => void): Promise<RunFunction[]>;
}

export class ToolRegistry implements ToolProvider {
    readonly #plugins: ToolContributor[] = [];
    readonly #descriptorOwners = new Map(agentTools.map((tool) => [tool.name, "ragents.agent-tools"]));

    register(plugin: ToolContributor) {
        if (this.#plugins.some((entry) => entry.name === plugin.name))
            throw new Error(`Tool plugin ${plugin.name} is already registered.`);

        if (plugin.dynamic && plugin.descriptors.length > 0)
            throw new Error(`Dynamic tool plugin ${plugin.name} cannot declare static descriptors.`);

        const names = new Set<string>();
        for (const descriptor of plugin.descriptors) {
            if (!descriptor.name.trim() || !descriptor.description.trim() || !descriptor.availabilityDetail.trim())
                throw new Error(`Tool plugin ${plugin.name} has an incomplete descriptor.`);

            if (descriptor.scope !== "per-turn")
                throw new Error(`Tool plugin ${plugin.name} must declare ${descriptor.name} with per-turn scope.`);

            if (names.has(descriptor.name))
                throw new Error(`Tool plugin ${plugin.name} declares ${descriptor.name} more than once.`);

            const owner = this.#descriptorOwners.get(descriptor.name);
            if (owner)
                throw new Error(`Tool plugin ${plugin.name} declares ${descriptor.name}, already declared by ${owner}.`);

            names.add(descriptor.name);
        }

        this.#plugins.push(plugin);
        for (const name of names) this.#descriptorOwners.set(name, plugin.name);

        return this;
    }

    get plugins(): readonly ToolContributor[] {
        return this.#plugins;
    }

    async resolve(context: PluginContext, onUnavailable?: (tool: RunFunction) => void) {
        const resolved = agentTools.filter((tool) => {
            if (tool.available(context.actor, context.view)) return true;
            onUnavailable?.(tool);
            return false;
        });
        const taken = new Set(agentTools.map((entry) => entry.name));

        for (const plugin of this.#plugins) {
            const tools = await plugin.tools(context);
            this.#assertDescriptors(plugin, tools);

            for (const tool of tools) {
                if (taken.has(tool.name))
                    throw new Error(`Tool plugin ${plugin.name} redefines tool ${tool.name}.`);

                taken.add(tool.name);

                if (tool.available(context.actor, context.view))
                    resolved.push(tool);
                else
                    onUnavailable?.(tool);
            }
        }

        return resolved;
    }

    #assertDescriptors(plugin: ToolContributor, tools: readonly RunFunction[]) {
        const actual = new Map<string, RunFunction>();
        for (const tool of tools) {
            if (!tool.name.trim() || !tool.description.trim())
                throw new Error(`Tool plugin ${plugin.name} resolved an incomplete tool.`);
            if (actual.has(tool.name))
                throw new Error(`Tool plugin ${plugin.name} resolves ${tool.name} more than once.`);
            actual.set(tool.name, tool);
        }

        if (plugin.dynamic)
            return;

        if (actual.size !== plugin.descriptors.length)
            throw new Error(`Tool plugin ${plugin.name} resolved a different number of tools than it declares.`);

        for (const descriptor of plugin.descriptors) {
            const tool = actual.get(descriptor.name);
            if (!tool)
                throw new Error(`Tool plugin ${plugin.name} did not resolve declared tool ${descriptor.name}.`);

            const availability = describeToolAvailability(tool.available);
            if (tool.description !== descriptor.description
                || availability.availability !== descriptor.availability
                || availability.availabilityDetail !== descriptor.availabilityDetail
                || Boolean(tool.nativeTool) !== Boolean(descriptor.nativeTool)) {
                throw new Error(`Tool plugin ${plugin.name} resolved ${descriptor.name} differently from its descriptor.`);
            }
        }
    }
}

export const emptyRegistry = () => new ToolRegistry();
