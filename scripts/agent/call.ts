import { Type } from "typebox";
import { coreContracts } from "../../apps/server/src/api/contracts.ts";
import { defineOperation } from "../../packages/ragents/src/rpc/contract.ts";
import { addressOf, hostClient, loadProfile, withLoginHint } from "./host.ts";

export type CallCommand =
  | { readonly kind: "call"; readonly profile: string; readonly method: string; readonly params: string; readonly raw: boolean }
  | { readonly kind: "call-list"; readonly profile: string };

const parametersOf = (text: string): Record<string, unknown> => {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw new Error(`Call params are not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Call params must be a JSON object.");
  return value as Record<string, unknown>;
};

const stdinText = async (): Promise<string> => {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
};

export const callCommand = async (command: CallCommand, write: (line: string) => void): Promise<number> => {
  const contract = command.kind === "call-list" ? coreContracts.api.openrpc : defineOperation({
    id: command.method,
    description: "Call a method registered at the host.",
    input: Type.Record(Type.String(), Type.Any()),
    result: Type.Any(),
  });
  const params = command.kind === "call-list" ? {} : parametersOf(command.params === "-" ? await stdinText() : command.params);
  const target = await loadProfile(command.profile);
  const rpc = hostClient(await addressOf(target));
  try {
    const result: unknown = await withLoginHint(() => rpc.call(contract, params));
    if (command.kind === "call") write(JSON.stringify(result, null, command.raw ? undefined : 2));
    else {
      const methods = (result as { methods?: unknown } | null)?.methods;
      if (!Array.isArray(methods) || methods.some((method) => typeof method?.name !== "string" || typeof method?.description !== "string")) {
        throw new Error("The host's OpenRPC reference has no valid method list.");
      }
      for (const method of methods) {
        if (method["x-implemented-by"] === "client") continue;
        write(`${method.name}  ${method.description.replace(/\s+/g, " ").trim()}`);
      }
    }
    return 0;
  } finally {
    rpc.close();
  }
};
