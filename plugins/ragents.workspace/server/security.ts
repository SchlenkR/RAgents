import { Type } from "typebox";
import { DomainError, type AccessContext, type AgentContribution, type JsonValue, type StartOptionContext, type StartOptionContribution } from "@ragents/engine";
import { storedStartOption } from "@ragents/host/ragents/start-option-state.js";
import { bindingOf, type WorkspaceRunState } from "./binding.js";
import { WORKSPACE_ACCESS_OPTION_ID, WORKSPACE_BINDING_OPTION_ID, storedWorkspaceBinding, type WorkspaceBinding } from "../contract.js";
import type { RunSecurityPolicy } from "./contract.js";

export const accessLevelOf = (state: WorkspaceRunState | null): "isolated" | "full" => {
  const value = storedStartOption(state, WORKSPACE_ACCESS_OPTION_ID);
  if (value === undefined) return "isolated";
  if (value !== "isolated" && value !== "full") {
    throw new DomainError("workspace-access-invalid", "The stored access must be isolated or full.", 409);
  }
  return value;
};

const fullAccessReason = (force: boolean, access: AccessContext, binding: WorkspaceBinding): string | null =>
  binding.machine !== "server" ? null
    : force ? "The server requires isolated access (PROCESS_SANDBOX=on)."
      : !access.can("*") ? "Full access on the server requires administrator permissions." : null;

export const assertAccessBinding = (level: string, force: boolean, access: AccessContext, binding: WorkspaceBinding): void => {
  const reason = level === "full" ? fullAccessReason(force, access, binding) : null;
  if (reason) throw new DomainError("workspace-access-forbidden", `${reason} Switch the run to Isolated or choose a workstation.`, 403);
};

export const securityPolicyFor = (force: boolean, access: AccessContext, state: WorkspaceRunState | null): RunSecurityPolicy => {
  const level = accessLevelOf(state);
  assertAccessBinding(level, force, access, bindingOf(state));
  return { level, restricted: level === "isolated" };
};

const bindingFor = (context: StartOptionContext, state: WorkspaceRunState | null): WorkspaceBinding =>
  storedWorkspaceBinding(context.values?.[WORKSPACE_BINDING_OPTION_ID]) ?? bindingOf(state);

export const accessStartOption = (
  force: boolean,
  accessFor: (userId: string | null) => AccessContext,
  stateFor: (runId: string) => WorkspaceRunState | null,
  changed?: (runId: string) => Promise<void>,
  platformFor: (binding: WorkspaceBinding, owner: string | null) => string | undefined = () => undefined,
): StartOptionContribution => ({
  id: WORKSPACE_ACCESS_OPTION_ID,
  schema: Type.Union([Type.Literal("isolated"), Type.Literal("full")]),
  selectable: () => true,
  changeable: true,
  defaultValue: () => "isolated",
  accept: (value, context) => {
    if (value !== "isolated" && value !== "full") throw new DomainError("workspace-access-invalid", "Access must be isolated or full.", 400);
    const state = stateFor(context.runId);
    if (state && state.ownerUserId !== context.userId) {
      throw new DomainError("workspace-access-owner", "Only the run's owner may change its access.", 403);
    }
    assertAccessBinding(value, force, accessFor(state ? state.ownerUserId : context.userId), bindingFor(context, state));
    return value;
  },
  describe: (_value, context): JsonValue => {
    const state = stateFor(context.runId);
    const binding = bindingFor(context, state);
    const reason = state && state.ownerUserId !== context.userId ? "Only the run's owner may change its access."
      : fullAccessReason(force, accessFor(state ? state.ownerUserId : context.userId), binding);
    return {
      kind: "workspace-access",
      machine: binding.machine === "server" ? "server" : "workstation",
      commandIsolation: commandIsolationFor(binding.machine !== "server", platformFor(binding, state ? state.ownerUserId : context.userId)),
      fullAccessDisabledReason: reason,
    };
  },
  ownerOnly: (value) => value === "full",
  ...(changed ? { changed: async (_value: JsonValue, { runId }: StartOptionContext) => changed(runId) } : {}),
});

export const commandIsolationFor = (workstation: boolean, platform: string | undefined): "isolated" | "unsupported" | "unknown" =>
  !workstation || platform === "darwin" || platform === "linux" ? "isolated" : platform === "win32" ? "unsupported" : "unknown";

export const accessDescription = (level: "isolated" | "full", workstation: boolean, platform?: string): string => {
  if (level === "full") return `Full access on ${workstation ? "the workstation" : "the server"}: file tools accept every path and commands run without an OS sandbox. ${workstation ? "Commands inherit the workstation environment, including secrets, after local confirmation." : "The server environment keeps its safe allowlist."}`;
  const files = "The machine's read and write rule allows reads outside blocked homes, temporary folders and application data, plus the run's allowed folders and granted paths; writes are limited to the run's writable folders and write grants.";
  if (!workstation) return `Isolated access on the server: ${files} Commands use the server process sandbox, a per-run package cache, the safe environment allowlist and the host's network policy.`;
  const isolation = commandIsolationFor(true, platform);
  const commands = isolation === "isolated" ? "Commands are isolated by the workstation OS sandbox."
    : isolation === "unsupported" ? "Commands are not isolated on this machine; the file rule applies to file tools only."
      : "The workstation's platform is unavailable; commands cannot run until it reconnects and reports its platform.";
  return `Isolated access on the workstation: ${files} Secrets are removed from the inherited environment, which keeps only toolchain, locale, and terminal variables. ${commands} Network access is unrestricted, including loopback and the local network.`;
};

export const accessNoteContribution = (
  stateFor: (runId: string) => WorkspaceRunState | null,
  revisionFor: (runId: string) => number = () => 0,
  initialRevisionFor: (runId: string) => number = revisionFor,
  platformFor: (binding: WorkspaceBinding, owner: string | null) => string | undefined = () => undefined,
): AgentContribution => ({
  id: "ragents.workspace.access-note",
  beforeModelCall: ({ runId }, call) => {
    const state = stateFor(runId);
    const level = accessLevelOf(state);
    const marker = revisionFor(runId);
    const current = { level, revision: marker };
    if (JSON.stringify(call.kept) === JSON.stringify(current)) return undefined;
    call.keep(current);
    if (call.kept === undefined && marker === initialRevisionFor(runId)) return undefined;
    const binding = bindingOf(state);
    return `Run access changed. ${accessDescription(level, binding.machine !== "server", platformFor(binding, state?.ownerUserId ?? null))}`;
  },
});
