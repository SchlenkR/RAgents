import { createHash } from "node:crypto";

export const canonicalTypeScriptBuildContract = (value: unknown): string => {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(canonicalTypeScriptBuildContract).join(",")}]`;
    return `{${Object.entries(value as Record<string, unknown>)
        .filter(([, entry]) => entry !== undefined)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)
        .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalTypeScriptBuildContract(entry)}`)
        .join(",")}}`;
};

export const typeScriptBuildContractHash = (contract: string): string =>
    createHash("sha256").update(contract).digest("hex");
