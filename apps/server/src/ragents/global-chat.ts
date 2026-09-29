import { serviceToken, type AccessContext, type CatalogModel, type ExecutableActor, type JournalEvent, type JsonValue, type ModelSelection, type Orchestration, type RunView } from "@ragents/engine";
import type { GlobalRunPolicy } from "../api/rights.js";
import type { ChatUser, RunScriptListing, SessionInfo, StartedScript } from "../chat-handler.js";

export interface GlobalChatPolicy {
  /** A user's coordinator; without sign-in (null) there is exactly one. */
  runIdFor: (userId: string | null) => string;
  /** Every id reserved for a coordinator, including one that no longer belongs to any access. */
  isCoordinator: (runId: string) => boolean;
  access?: { read: string; write: string };
  title: string;
  prompt: string;
  preparationPrompt?: string;
  toolNames: readonly string[];
  workspaceDirectory: (runId: string) => string;
  prepareWorkspace?: (directory: string) => Promise<void>;
  /** One file <runId>.json per coordinator, as long as its conversation reset is not complete. */
  resetIntentDirectory?: string;
  inputContext?: (runtime: Orchestration, runId: string, value: unknown) => Promise<readonly string[]>;
  contextPrompt?: (runtime: Orchestration, runId: string, actor: ExecutableActor) => string;
  model?: {
    initialize: (models: readonly (CatalogModel & { input: readonly string[] })[], initial: ModelSelection, requiredInputs: () => readonly string[]) => Promise<void>;
    selection: () => ModelSelection;
    forTurn: (runtime: Orchestration, runId: string, actorId: string, turnId: string) => ModelSelection;
  };
}

export type ManagedRunStart = {
  title: string;
  options?: Readonly<Record<string, JsonValue>>;
  /** Who chooses the start options and owns the run: the user of the request, null without sign-in. */
  user: ChatUser | null;
} & ({ kind: "message"; message: string } | { kind: "script"; entryId: string; input: JsonValue }
  | {
    kind: "package";
    directory: string;
    input: JsonValue;
    /** The plugin that starts the package; it stands as the owner of this start's template. */
    owner: string;
  });

export interface RunManagement {
  /** With an access, only its own runs remain; without one it is the server's list. */
  list: (access?: AccessContext) => Promise<SessionInfo[]>;
  view: (runId: string) => RunView;
  events: (runId: string) => readonly JournalEvent[];
  create: (start: ManagedRunStart) => Promise<string>;
  /** A message operates the run; the host checks the same access for it as for the chat. */
  send: (runId: string, message: string, access: AccessContext) => Promise<void>;
  stop: (runId: string) => Promise<void>;
  resetGlobal: (runId: string) => Promise<void>;
  /** The run scripts the run's owner may start, and whether each can start in the run now. */
  scripts: (runId: string) => readonly RunScriptListing[];
  /** Starts a run script in the run as its owner would; startedBy is the actor that receives its result. */
  startScript: (runId: string, entryId: string, input: JsonValue | null, startedBy: string) => Promise<StartedScript>;
}

export const globalChatToken = serviceToken<GlobalChatPolicy>("host.global-chat");

/** The coordinators' rights for the message layer; without rights from the plugin, none counts as an own run. */
export const globalRunPolicyOf = (policy: GlobalChatPolicy | undefined): GlobalRunPolicy | undefined =>
  policy?.access ? { isCoordinator: policy.isCoordinator, runIdFor: policy.runIdFor, ...policy.access } : undefined;
export const runManagementToken = serviceToken<() => RunManagement>("host.run-management");
