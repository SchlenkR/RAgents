import { createHash } from "node:crypto";
import { canonicalJson } from "./canonical-json.ts";

export const canonicalHash = (value: unknown): string =>
    createHash("sha256").update(canonicalJson(value), "utf8").digest("hex");
