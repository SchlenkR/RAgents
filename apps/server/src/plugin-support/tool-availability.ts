import {
  defineToolAvailability,
  type ToolAvailability,
} from "@ragents/engine";

export const alwaysAvailable = defineToolAvailability({
  availability: "always",
  availabilityDetail: "Available in every model turn.",
}, () => true);

export const facesOperator: ToolAvailability = defineToolAvailability({
  availability: "always",
  availabilityDetail: "Available in every turn; the question always goes to the user of the run.",
}, () => true);
