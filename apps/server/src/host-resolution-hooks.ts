import type { ResolveHook } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const hostEntries = ["apps/server/src/main.ts", "apps/web/src/main.tsx"]
  .map((entry) => pathToFileURL(path.join(repositoryRoot, entry)).href);

const isBareSpecifier = (specifier: string): boolean =>
  !/^(\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier);

const isResolutionFailure = (error: unknown): boolean =>
  typeof error === "object" && error !== null
  && ["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"].includes(String((error as { code?: unknown }).code));

/** Bare imports of files outside the repository resolve through the host, so plugins need no own node_modules. */
export const resolve: ResolveHook = async (specifier, context, next) => {
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!isBareSpecifier(specifier) || !isResolutionFailure(error) || hostEntries.includes(context.parentURL ?? "")) throw error;
    for (const [index, parentURL] of hostEntries.entries()) {
      try {
        return await next(specifier, { ...context, parentURL });
      } catch (retryError) {
        if (index === hostEntries.length - 1 || !isResolutionFailure(retryError)) throw retryError;
      }
    }
    throw error;
  }
};
