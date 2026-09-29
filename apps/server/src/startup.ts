import { createServer } from "node:net";
export { assertDataDirectoryIsolated, defaultDataDirectory } from "./data-directory.js";

export const assertServerPortAvailable = async (port: number): Promise<void> => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT must be an integer between 1 and 65535.");
  for (const host of ["127.0.0.1", undefined, "0.0.0.0"]) await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => reject(error.code === "EADDRINUSE"
      ? new Error(`Port ${port} is already in use. Stop the other service or explicitly set PORT to another fixed port.`, { cause: error })
      : new Error(`Port ${port} cannot be opened: ${error.message}`, { cause: error })));
    server.listen({ port, host }, () => server.close((error) => error ? reject(error) : resolve()));
  });
};
