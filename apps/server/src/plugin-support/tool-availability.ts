import {
  defineToolAvailability,
  holdsUsable,
  type ToolAvailability,
} from "@aicontainer/ragents";

export const alwaysAvailable = defineToolAvailability({
  availability: "always",
  availabilityDetail: "In jedem Modell-Turn verfügbar.",
}, () => true);

export const canUseWorkspace = defineToolAvailability({
  availability: "conditional",
  availabilityDetail: "Nur mit der Capability workspace.use.",
}, (actor) => holdsUsable(actor, "workspace.use"));

export const facesOperator: ToolAvailability = defineToolAvailability({
  availability: "always",
  availabilityDetail: "In jedem Turn verfügbar; die Frage geht immer an den Benutzer des Runs.",
}, () => true);
