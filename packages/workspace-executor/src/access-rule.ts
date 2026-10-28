import path from "node:path";
import type { WorkspaceGrant } from "./grants.js";

export const PROCESS_RESOURCE_PATHS: readonly string[] = ["/proc", "/dev", "/sys"];

export interface WorkspaceAccessRule {
  readonly blocked: readonly string[];
  readonly readable: readonly string[];
  readonly writable: readonly string[];
  readonly processNamespaces?: readonly string[];
  readonly readOnly?: readonly string[];
  readonly grants?: readonly (WorkspaceGrant & { readonly directory?: boolean })[];
  readonly writeProtected?: readonly { readonly root: string; readonly names: readonly string[] }[];
}

const normalized = (value: string): string => {
  const windows = /^[a-z]:[\\/]|^[\\/]{2}[^\\/]/i.test(value);
  const result = (windows ? path.win32 : path.posix).normalize(value).replaceAll("\\", "/").replace(/\/+$/, "") || "/";
  return windows ? result.toLowerCase() : result;
};

const contains = (root: string, candidate: string): boolean => {
  const parent = normalized(root);
  const child = normalized(candidate);
  if (parent.includes("*")) {
    const pattern = parent.split("*").map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("[^/]*");
    return new RegExp(`^${pattern}(?:/|$)`).test(child);
  }
  return child === parent || child.startsWith(parent.endsWith("/") ? parent : `${parent}/`);
};

export const ruleAllowsPath = (rule: WorkspaceAccessRule, filename: string, access: "read" | "write"): boolean => {
  const granted = (rule.grants ?? []).some((grant) => (access === "read" || grant.access === "write")
    && (grant.directory ? contains(grant.path, filename) : normalized(grant.path) === normalized(filename)));
  if (access === "read") return granted || [...rule.readable, ...rule.writable].some((root) => contains(root, filename))
    || !rule.blocked.some((root) => contains(root, filename));
  if ((rule.readOnly ?? []).some((root) => contains(root, filename))) return false;
  if ((rule.writeProtected ?? []).some(({ root, names }) => {
    if (!contains(root, filename)) return false;
    const relative = normalized(filename).slice(normalized(root).length).replace(/^\//, "").toLowerCase();
    return names.some((name) => (`/${relative}/`).includes(`/${name.toLowerCase()}/`));
  })) return false;
  return granted || rule.writable.some((root) => contains(root, filename));
};
