import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

/** One token per coordinator for its tools; it acts as that coordinator's user, null is the one access without sign-in. */
const coordinatorTokens = new Map<string | null, string>();

export const coordinatorAccessToken = (userId: string | null): string => {
  const known = coordinatorTokens.get(userId);
  if (known) return known;
  const created = randomBytes(32).toString("hex");
  coordinatorTokens.set(userId, created);
  return created;
};

export const profileAccessCookieName = (productId: string | undefined, profile: string | undefined): string => {
  if (!productId || !profile) throw new Error("User sign-in requires PRODUCT_ID and PRODUCT_PROFILE");
  return `${productId}-${profile}-user`;
};

/** The user for whom a coordinator calls the message layer locally; otherwise undefined. */
export const coordinatorRequestUser = (request: IncomingMessage, url: URL): { userId: string | null } | undefined => {
  const address = request.socket.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return undefined;
  if (url.pathname !== "/rpc" && url.pathname !== "/rpc/stream" && !url.pathname.startsWith("/help/")) return undefined;
  const offered = request.headers.authorization;
  if (!offered?.startsWith("Bearer ")) return undefined;
  const value = Buffer.from(offered.slice(7));
  const matching = [...coordinatorTokens].filter(([, token]) => {
    const expected = Buffer.from(token);
    return value.length === expected.length && timingSafeEqual(value, expected);
  });
  return matching.length === 1 ? { userId: matching[0]![0] } : undefined;
};
