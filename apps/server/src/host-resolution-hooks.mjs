import { existsSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const hostEntries = ["apps/server/src/main.ts", "apps/web/src/main.tsx"]
  .map((entry) => pathToFileURL(path.join(repositoryRoot, entry)).href);

const serverEntry = hostEntries[0];

const workflowEntry = pathToFileURL(path.join(repositoryRoot, "apps/server/src/plugin-support/actor-programs/workflow/index.ts")).href;

const bundles = new Map();
let serverModules = new Set();

export const initialize = ({ port, serverModules: modules }) => {
  serverModules = new Set(modules);
  port.on("message", ({ id, bundles: announced }) => {
    for (const [bundleId, folder] of announced) bundles.set(bundleId, pathToFileURL(`${folder}${path.sep}`).href);
    port.postMessage({ acknowledged: id });
  });
  port.unref();
};

const isBareSpecifier = (specifier) => !/^(\.{1,2}\/|\/|[a-z][a-z0-9+.-]*:)/i.test(specifier);

const isResolutionFailure = (error) =>
  typeof error === "object" && error !== null
  && ["ERR_MODULE_NOT_FOUND", "ERR_PACKAGE_PATH_NOT_EXPORTED"].includes(String(error.code));

const bundleOf = (url) => {
  if (!url) return undefined;
  for (const [id, folder] of bundles) if (url.startsWith(folder)) return id;
  return undefined;
};

/** A bundle gets from the host only what the server list names, and from other bundles only their exports. */
const resolveFromBundle = async (bundle, specifier, context, next) => {
  if (!isBareSpecifier(specifier) || isBuiltin(specifier)) return next(specifier, context);
  const cross = /^@ragents\/plugins\/([^/]+)\/(.+)$/.exec(specifier);
  if (cross) {
    const [, owner, name] = cross;
    const folder = bundles.get(owner);
    if (!folder) throw new Error(`Das Bundle ${bundle} importiert ${specifier}, aber ${owner} steht nicht in der Pluginliste`);
    const url = new URL(`server/exports/${name.replace(/\.js$/, "")}.js`, folder).href;
    if (!existsSync(fileURLToPath(url))) throw new Error(`Das Bundle ${bundle} importiert ${specifier}, das Bundle ${owner} exportiert ${name} aber nicht für den Server; beide Bundles aus ihren Quellen neu bauen`);
    return { url, shortCircuit: true };
  }
  const listed = specifier.replace(/\.(js|ts|tsx)$/, "");
  if (listed === "@ragents/workflow") return { url: workflowEntry, shortCircuit: true };
  if (!serverModules.has(listed)) throw new Error(`Das Bundle ${bundle} importiert ${specifier}, das der Host nicht bereitstellt; das Bundle gegen diesen Host neu bauen`);
  return next(specifier, { ...context, parentURL: serverEntry });
};

/** Bundle code is always ESM, also where no package.json says so. */
export const load = async (url, context, next) =>
  bundleOf(url) !== undefined && url.endsWith(".js") ? next(url, { ...context, format: "module" }) : next(url, context);

// Reines JavaScript, weil Node diese Datei im Loader-Thread lädt und dort unter node_modules keine Typen entfernt.
/** Bundles resolve strictly; other code outside the repository resolves bare imports through the host, so it needs no own node_modules. */
export const resolve = async (specifier, context, next) => {
  const bundle = bundleOf(context.parentURL);
  if (bundle !== undefined) return resolveFromBundle(bundle, specifier, context, next);
  try {
    return await next(specifier, context);
  } catch (error) {
    if (!isBareSpecifier(specifier) || !isResolutionFailure(error) || hostEntries.includes(context.parentURL ?? "")) throw error;
    if (specifier === "@ragents/workflow") return { url: workflowEntry, shortCircuit: true };
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
