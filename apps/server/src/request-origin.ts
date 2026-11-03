import type { IncomingMessage } from "node:http";

const originOf = (value: string): string | undefined => {
  if (!/^https?:\/\/[^/\\?#\s]+\/?$/i.test(value)) return undefined;
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.pathname !== "/" || url.search || url.hash) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
};

export const parseAllowedOrigins = (values: readonly string[]): readonly string[] => Object.freeze(values.map((value) => {
  const origin = originOf(value);
  if (!origin) throw new Error(`ALLOWED_ORIGINS needs HTTP or HTTPS origins without paths, credentials, queries or fragments, not ${JSON.stringify(value)}`);
  return origin;
}));

export const isSameOriginRequest = (request: IncomingMessage, allowedOrigins: readonly string[] = []): boolean => {
  const offered = request.headers.origin;
  if (offered === undefined) return request.headers["sec-fetch-site"] !== "cross-site";
  const origin = originOf(offered);
  if (!origin) return false;
  if (allowedOrigins.includes(origin)) return true;
  if (request.headers["sec-fetch-site"] === "cross-site") return false;
  const forwarded = request.headers["x-forwarded-proto"];
  const protocol = forwarded === "http" || forwarded === "https" ? forwarded : (request.socket as { encrypted?: boolean }).encrypted ? "https" : "http";
  return request.headers.host !== undefined && origin === originOf(`${protocol}://${request.headers.host}`);
};
