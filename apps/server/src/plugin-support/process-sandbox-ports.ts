import { chown, mkdtemp, open, rm, stat } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import type { ProcessLaunch, PublishedProcessLaunch } from "@ragents/workspace-executor";
import { closeListener, listenLoopback } from "@ragents/workspace-executor/src/process-sandbox.ts";

const relayProgram = `
const net = require("node:net");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const [directory, encodedPorts, command, ...args] = process.argv.slice(1);
const ports = JSON.parse(encodedPorts);
const descriptor = fs.openSync(directory, "r");
const sockets = new Set();
const servers = ports.map((port) => net.createServer({ allowHalfOpen: true }, (socket) => {
  const target = net.connect({ host: "127.0.0.1", port, allowHalfOpen: true });
  for (const stream of [socket, target]) {
    sockets.add(stream);
    stream.once("close", () => sockets.delete(stream));
    stream.once("error", () => { socket.destroy(); target.destroy(); });
  }
  socket.pipe(target);
  target.pipe(socket);
}));
const close = () => {
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
};
(async () => {
  for (const [index, port] of ports.entries()) {
    await new Promise((resolve, reject) => {
      servers[index].once("error", (error) => reject(new Error("Cannot publish loopback TCP port " + port + ": " + error.message)));
      servers[index].listen("/proc/self/fd/" + descriptor + "/" + port + ".sock", resolve);
    });
  }
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
  child.once("error", (error) => { console.error(error.message); close(); process.exit(1); });
  child.once("exit", (code, signal) => { close(); process.exit(code ?? (signal ? 1 : 0)); });
})().catch((error) => { console.error(error.message); close(); process.exit(1); });
`;

/** Each launch shares only its own socket folder with the namespace; directory descriptors avoid Unix socket path limits. */
export const publishLoopbackPorts = async (
  temporary: string,
  launch: ProcessLaunch,
  ports: readonly number[],
  wrap: (launch: ProcessLaunch) => Promise<ProcessLaunch>,
): Promise<PublishedProcessLaunch> => {
  const directory = await mkdtemp(path.join(temporary, "ports-"));
  const servers: Server[] = [];
  const sockets = new Set<Socket>();
  const descriptor = await open(directory, "r").catch(async (error: unknown) => {
    await rm(directory, { recursive: true, force: true });
    throw error;
  });
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    for (const socket of sockets) socket.destroy();
    try {
      await Promise.all(servers.map(closeListener));
    } finally {
      await descriptor.close();
      await rm(directory, { recursive: true, force: true });
    }
  })();
  try {
    const owner = await stat(temporary);
    await chown(directory, owner.uid, owner.gid);
    for (const port of ports) {
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        if (closing) { socket.destroy(); return; }
        const target = connect({ path: `/proc/self/fd/${descriptor.fd}/${port}.sock`, allowHalfOpen: true });
        for (const stream of [socket, target]) {
          sockets.add(stream);
          stream.once("close", () => sockets.delete(stream));
          stream.once("error", () => { socket.destroy(); target.destroy(); });
        }
        socket.pipe(target);
        target.pipe(socket);
      });
      servers.push(server);
      await listenLoopback(server, port);
    }
    return {
      launch: await wrap({ command: process.execPath, args: ["-e", relayProgram, directory, JSON.stringify(ports), launch.command, ...launch.args] }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};
