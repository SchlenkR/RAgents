import path from "node:path";
import { declaredEnvironment } from "@aicontainer/server/plugin-support/plugin-config.js";

export const ragentsDocumentsConfigDescriptors = [
  { key: "DOCUMENTS_DIR", source: "environment" },
] as const;

const env = declaredEnvironment(ragentsDocumentsConfigDescriptors);

const externalRoot = env.optional("DOCUMENTS_DIR");

export const ragentsDocumentsConfig = Object.freeze({
  externalRoot: externalRoot ? path.resolve(externalRoot) : undefined,
});
