import { implement, type MethodContribution } from "@ragents/engine";
import { overseerContracts } from "../contract.js";
import type { OverseerModelSettings } from "./settings.js";

export const createSettingsMethods = (settings: OverseerModelSettings): MethodContribution[] => [
  implement(overseerContracts.settings.read, () => settings.get()),
  implement(overseerContracts.settings.save, (selection) => settings.save(selection)),
];
