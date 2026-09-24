import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prepareAppDependencies } from "../../../apps/server/src/plugin-support/actor-programs/app-project.ts";
import { compileClientProject, installClientSdk, type ClientContracts } from "../../../apps/server/src/plugin-support/actor-programs/client-compiler.ts";

export const createClientProject = async (contracts: ClientContracts, files: Record<string, string>) => {
  const directory = await mkdtemp(path.join(tmpdir(), "ragents-native-client-"));
  await prepareAppDependencies(directory);
  await installClientSdk(directory, contracts);
  const allFiles = { "package.json": '{"private":true,"type":"module"}',
    "tsconfig.client.json": JSON.stringify({ extends: "./node_modules/@ragents/client/tsconfig.json", include: ["src/client.tsx"] }), ...files };
  for (const [name, source] of Object.entries(allFiles)) {
    await mkdir(path.dirname(path.join(directory, name)), { recursive: true });
    await writeFile(path.join(directory, name), source);
  }
  return { directory, compile: () => compileClientProject({ directory, entryPoint: "src/client.tsx", ...contracts }),
    remove: () => rm(directory, { recursive: true, force: true }) };
};

export const compileClientSource = async (request: ClientContracts & { source: string }) => {
  const project = await createClientProject(request, { "src/client.tsx": request.source });
  try { return await project.compile(); } finally { await project.remove(); }
};
