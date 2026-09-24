import { implement, type MethodContribution } from "@ragents/engine";
import { overseerContracts } from "../contract.js";
import { coordinatorRunIdOf } from "./coordinator.js";

export const createResetMethod = (reset: (runId: string) => Promise<void>): MethodContribution =>
  implement(overseerContracts.reset, async (_input, { access }) => { await reset(coordinatorRunIdOf(access)); return null; });
