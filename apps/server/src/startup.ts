import { createServer } from "node:net";
export { assertDataDirectoryIsolated, defaultDataDirectory } from "./data-directory.js";

export const assertServerPortAvailable = async (port: number): Promise<void> => {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("PORT muss eine ganze Zahl zwischen 1 und 65535 sein.");
  for (const host of ["127.0.0.1", undefined, "0.0.0.0"]) await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once("error", (error: NodeJS.ErrnoException) => reject(error.code === "EADDRINUSE"
      ? new Error(`Port ${port} ist bereits belegt. Beende den anderen Dienst oder setze PORT ausdrücklich auf einen anderen festen Port.`, { cause: error })
      : new Error(`Port ${port} kann nicht geöffnet werden: ${error.message}`, { cause: error })));
    server.listen({ port, host }, () => server.close((error) => error ? reject(error) : resolve()));
  });
};
