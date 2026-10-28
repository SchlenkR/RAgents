import { stat } from "node:fs/promises";
import { resolveReadPathAsync, resolveToCwd } from "@ragents/agent";
import { WorkspaceOperationError } from "./errors.js";
import { assertNarrowWorkspaceGrant, validateWorkspaceGrants } from "./grants.js";
import type { WorkspaceModuleFactory } from "./module.js";
import { allowedWorkspacePath, expandPathVariables, expandWorkspaceAlias, resolvedWorkspacePath, rootsOfFields, workspacePathRoots } from "./paths.js";

export const ACCESS_OPERATIONS = { inspect: "access.inspect" } as const;

export interface WorkspaceAccessInspection {
  readonly path: string;
  readonly kind: "file" | "directory" | "missing";
  readonly reachable: boolean;
}

export const accessModule: WorkspaceModuleFactory = (host) => ({
  operations: {
    [ACCESS_OPERATIONS.inspect]: async ({ runId, input }): Promise<WorkspaceAccessInspection> => {
      const request = input as { path?: unknown; access?: unknown } | null;
      if (typeof request?.path !== "string" || !request.path.trim() || request.path.includes("\0") || (request.access !== "read" && request.access !== "write")) {
        throw new WorkspaceOperationError("workspace-path-invalid", "Give a path and read or write access.", 400);
      }
      const context = await host.contextFor(runId);
      const requested = expandPathVariables(expandWorkspaceAlias(request.path, context.workspaceAliases ?? {}), context.pathVariables ?? {});
      const resolved = request.access === "read" ? await resolveReadPathAsync(requested, context.cwd) : resolveToCwd(requested, context.cwd);
      const canonical = await resolvedWorkspacePath(resolved);
      const info = await stat(canonical).catch((error: NodeJS.ErrnoException) => {
        if ((error.code === "ENOENT" || error.code === "ENOTDIR") && request.access === "write") return undefined;
        throw error;
      });
      if (info && !info.isFile() && !info.isDirectory()) throw new WorkspaceOperationError("workspace-path-invalid", "Access grants require a regular file or a folder.", 400);
      const roots = await workspacePathRoots(context, canonical, request.access === "write").catch((error: unknown) => {
        if (error instanceof WorkspaceOperationError && error.code === "workspace-process-namespace") assertNarrowWorkspaceGrant(canonical, context.grantPolicy);
        throw error;
      });
      const reachable = await allowedWorkspacePath(canonical, roots).then(() => true, () => false);
      if (!reachable) {
        assertNarrowWorkspaceGrant(resolved, context.grantPolicy);
        await validateWorkspaceGrants([{ path: canonical, access: request.access }], context.grantPolicy);
      }
      return { path: canonical, kind: info?.isDirectory() ? "directory" : info ? "file" : "missing", reachable };
    },
  },
  footprints: { [ACCESS_OPERATIONS.inspect]: (input) => ({ roots: rootsOfFields(input, "path") }) },
});
