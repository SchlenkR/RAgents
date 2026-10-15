import { createServer } from "node:net";
export { configuredBindAddress, localHttpUrl, parseBindAddress } from "./bind-address.js";
export { assertDataDirectoryIsolated, defaultDataDirectory } from "./data-directory.js";

const cannotOpen = (port: number, bindAddress: string | undefined, error: NodeJS.ErrnoException): Error => {
  if (error.code === "EADDRINUSE") return new Error(`Port ${port} is already in use. Stop the other service or explicitly set PORT to another fixed port.`, { cause: error });
  return bindAddress === undefined
    ? new Error(`Port ${port} cannot be opened: ${error.message}`, { cause: error })
    : new Error(`BIND_ADDRESS ${bindAddress} cannot be opened on port ${port}: ${error.message}`, { cause: error });
};

export const assertServerPortAvailable = async (port: number, bindAddress?: string): Promise<void> => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  for (const host of bindAddress === undefined ? ["127.0.0.1", undefined, "0.0.0.0"] : [bindAddress]) await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => reject(cannotOpen(port, bindAddress, error)));
    server.listen({ port, host }, () => server.close((error) => error ? reject(error) : resolve()));
  });
};
