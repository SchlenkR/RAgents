import { createAccessContext, type AccessContext } from "@ragents/engine";
import { configuredAnonymousUser, configuredUsers } from "../config-file.js";

export const profileAccessFor = (userId: string | null): AccessContext => {
  const users = configuredUsers();
  const user = userId === null
    ? users ? null : configuredAnonymousUser() ?? null
    : users?.find((entry) => entry.id === userId) ?? null;
  return createAccessContext({
    enabled: userId !== null || users !== undefined,
    user: user ? {
      id: user.id,
      label: user.label,
      rights: user.rights,
      ...(user.startEntries ? { startEntries: user.startEntries } : {}),
    } : null,
  });
};
