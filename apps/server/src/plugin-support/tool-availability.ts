import {
  defineToolAvailability,
  type ToolAvailability,
} from "@ragents/engine";

export const alwaysAvailable = defineToolAvailability({
  availability: "always",
  availabilityDetail: "In jedem Modell-Turn verfügbar.",
}, () => true);

export const facesOperator: ToolAvailability = defineToolAvailability({
  availability: "always",
  availabilityDetail: "In jedem Turn verfügbar; die Frage geht immer an den Benutzer des Runs.",
}, () => true);
