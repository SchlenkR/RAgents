import { appContractSchema, appPackageSchema } from "./app-project.js";
import { clientApiDeclarations } from "./client-compiler.js";
import { readClientUiExportContracts } from "./client-contracts.js";

export const actorProgramAuthoringContracts = () => ({
  package: appPackageSchema,
  backend: appContractSchema,
  client: clientApiDeclarations(),
  clientTypes: readClientUiExportContracts("ChatConnection"),
});
