import { isIP } from "node:net";
import { isEnvironmentReference } from "./config-definition.js";

const isWildcard = (address: string): boolean => address === "0.0.0.0" || (isIP(address) === 6 && /^[0:]+$/.test(address));

/** An IPv4 or IPv6 address without brackets, port, or zone, or localhost; anything else is a hard error. */
export const parseBindAddress = (value: unknown, source: string): string => {
  if (typeof value === "string" && value.toLowerCase() === "localhost") return "localhost";
  if (typeof value !== "string" || isIP(value) === 0 || value.includes("%")) {
    throw new Error(`${source} needs an IPv4 or IPv6 address without brackets, port, or zone, or localhost, not ${JSON.stringify(value)}`);
  }
  return value;
};

/** The address the server binds as the server itself resolves it: environment before profile file; none means all interfaces. */
export const configuredBindAddress = (
  profileValue: unknown,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): string | undefined => {
  if (environment.BIND_ADDRESS !== undefined) return parseBindAddress(environment.BIND_ADDRESS, "BIND_ADDRESS");
  if (profileValue === undefined) return undefined;
  if (!isEnvironmentReference(profileValue)) return parseBindAddress(profileValue, "host.BIND_ADDRESS");
  const referenced = environment[profileValue.name];
  if (referenced === undefined) throw new Error(`host.BIND_ADDRESS refers to the unset environment variable ${profileValue.name}.`);
  return parseBindAddress(referenced, `host.BIND_ADDRESS (${profileValue.name})`);
};

/** The address under which a client on this machine reaches a server bound to `address`; all interfaces are reached as `wildcardHost`. */
export const localHttpUrl = (address: string | undefined, port: number, wildcardHost = "localhost"): string => {
  const host = address === undefined || isWildcard(address) ? wildcardHost : isIP(address) === 6 ? `[${address}]` : address;
  return `http://${host}:${port}`;
};
