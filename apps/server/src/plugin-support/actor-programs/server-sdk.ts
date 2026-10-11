export { defineProgram } from "./program-runner.js";

export const defineActor = (contract: unknown, implementation: object) => ({ contract, ...implementation });
