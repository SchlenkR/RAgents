import { randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage } from "node:http";

const token = randomBytes(32).toString("hex");

export const accessServiceToken = (): string => token;

export const profileAccessCookieName = (productId: string | undefined, profile: string | undefined): string => {
  if (!productId || !profile) throw new Error("Die Benutzeranmeldung benötigt PRODUCT_ID und PRODUCT_PROFILE");
  return `${productId}-${profile}-user`;
};

export const isAccessServiceRequest = (request: IncomingMessage, url: URL): boolean => {
  const address = request.socket.remoteAddress;
  if (address !== "127.0.0.1" && address !== "::1" && address !== "::ffff:127.0.0.1") return false;
  if (url.pathname !== "/rpc" && url.pathname !== "/rpc/stream" && !url.pathname.startsWith("/help/")) return false;
  const offered = request.headers.authorization;
  if (!offered?.startsWith("Bearer ")) return false;
  const value = Buffer.from(offered.slice(7));
  const expected = Buffer.from(token);
  return value.length === expected.length && timingSafeEqual(value, expected);
};
