import { mkdir, open } from "node:fs/promises";
import path from "node:path";
import { validateWorkspaceGrants, type WorkspaceGrant, type WorkspaceGrantPolicy } from "./grants.js";

export const prepareGrantedWritePaths = async (grants: readonly WorkspaceGrant[], policy?: WorkspaceGrantPolicy): Promise<void> => {
  await validateWorkspaceGrants(grants, policy);
  for (const grant of grants.filter((entry) => entry.access === "write")) {
    await mkdir(path.dirname(grant.path), { recursive: true });
    await validateWorkspaceGrants([grant], policy);
    const file = await open(grant.path, "wx", 0o600).catch((error: NodeJS.ErrnoException) => {
      if (error.code === "EEXIST") return undefined;
      throw error;
    });
    await file?.close();
  }
  await validateWorkspaceGrants(grants, policy);
};
