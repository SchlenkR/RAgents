import { implement, type MethodContribution } from "@aicontainer/ragents";
import { overseerContracts } from "../contract.js";

export const createResetMethod = (reset: () => Promise<void>): MethodContribution =>
  implement(overseerContracts.reset, async () => { await reset(); return null; });
