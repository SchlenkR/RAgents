import { DomainError, implement, type AccessContext, type MethodContribution } from "@ragents/engine";
import type { UserPreferences } from "../user-preferences.js";
import { coreContracts } from "./contracts.js";

/** The methods name no user: a caller reaches only its own preferences, without sign-in those of the one access. */
const ownerOf = (access: AccessContext): string | null => {
  if (access.enabled && !access.user) throw new DomainError("login-required", "Preferences belong to a signed-in user.", 401);
  return access.user?.id ?? null;
};

export const preferenceMethods = (preferences: UserPreferences): MethodContribution[] => [
  implement(coreContracts.preferences.read, ({ key }, { access }) => preferences.read(ownerOf(access), key)),
  implement(coreContracts.preferences.write, async ({ key, value }, { access }) => {
    await preferences.write(ownerOf(access), key, value);
    return null;
  }),
];
