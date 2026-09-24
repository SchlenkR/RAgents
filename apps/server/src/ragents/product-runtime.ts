import { serviceToken } from "@ragents/engine";
import type { SystemPromptCatalog } from "../plugin-support/system-prompts.js";

export type ActorRole = "primary" | "worker";

export interface ActorRoleView {
  primaryActorId: string | null;
}

export interface ProductActor {
  id: string;
}

export interface CoordinatorDescriptor {
  handle: string;
  displayName: string;
  profile: string;
  runTitle: string;
  ownerHandle: string;
  ownerDisplayName: string;
}

export interface ProductRuntimePolicy {
  coordinator: CoordinatorDescriptor;
  roleFor: (view: ActorRoleView, actor: ProductActor) => ActorRole;
  contract: (role: ActorRole) => string;
  promptComposition: string;
  systemPrompts: () => SystemPromptCatalog;
}

export const productRuntimeToken = serviceToken<ProductRuntimePolicy>("ragents.product-runtime");
