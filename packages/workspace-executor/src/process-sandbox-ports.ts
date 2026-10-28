import { chown, mkdtemp, open, rm, stat } from "node:fs/promises";
import { connect, createServer, type Server, type Socket } from "node:net";
import path from "node:path";
import { WorkspaceOperationError } from "./errors.js";
import type { ProcessLaunch, PublishedProcessLaunch, TcpForward } from "./process-sandbox.js";
import { closeListener, listenLoopback } from "./process-sandbox.js";

const relayProgram = `
const net = require("node:net");
const fs = require("node:fs");
const { spawn } = require("node:child_process");
const [directory, encodedPorts, command, ...args] = process.argv.slice(1);
const { ports, forwards } = JSON.parse(encodedPorts);
const descriptor = fs.openSync(directory, "r");
const sockets = new Set();
const relay = (socket, address) => {
  const target = net.connect({ ...address, allowHalfOpen: true });
  for (const stream of [socket, target]) {
    sockets.add(stream);
    stream.once("close", () => sockets.delete(stream));
    stream.once("error", () => { socket.destroy(); target.destroy(); });
  }
  socket.pipe(target);
  target.pipe(socket);
};
const servers = [];
const close = () => {
  for (const socket of sockets) socket.destroy();
  for (const server of servers) server.close();
};
(async () => {
  for (const port of ports) {
    const server = net.createServer({ allowHalfOpen: true }, (socket) => relay(socket, { host: "127.0.0.1", port }));
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once("error", (error) => reject(new Error("Cannot publish loopback TCP port " + port + ": " + error.message)));
      server.listen("/proc/self/fd/" + descriptor + "/" + port + ".sock", resolve);
    });
  }
  for (const [index, forward] of forwards.entries()) {
    const server = net.createServer({ allowHalfOpen: true }, (socket) => relay(socket, { path: "/proc/self/fd/" + descriptor + "/out-" + index + ".sock" }));
    servers.push(server);
    await new Promise((resolve, reject) => {
      server.once("error", (error) => reject(new Error("Cannot forward TCP target " + forward.host + ":" + forward.port + " on inside port " + forward.insidePort + ": " + error.message)));
      server.listen({ host: "127.0.0.1", port: forward.insidePort, exclusive: true }, resolve);
    });
  }
  const child = spawn(command, args, { stdio: ["ignore", "inherit", "inherit"] });
  child.once("error", (error) => { console.error(error.message); close(); process.exit(1); });
  child.once("exit", (code, signal) => { close(); process.exit(code ?? (signal ? 1 : 0)); });
})().catch((error) => { console.error(error.message); close(); process.exit(1); });
`;

const pipeConnection = (socket: Socket, target: Socket, sockets: Set<Socket>): void => {
  for (const stream of [socket, target]) {
    sockets.add(stream);
    stream.once("close", () => sockets.delete(stream));
    stream.once("error", () => { socket.destroy(); target.destroy(); });
  }
  socket.pipe(target);
  target.pipe(socket);
};

export const forwardLoopbackTargets = async (
  launch: ProcessLaunch,
  forwards: readonly TcpForward[],
  wrap: (launch: ProcessLaunch) => Promise<ProcessLaunch>,
): Promise<PublishedProcessLaunch> => {
  const servers: Server[] = [];
  const sockets = new Set<Socket>();
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= (async () => {
    for (const socket of sockets) socket.destroy();
    await Promise.all(servers.map(closeListener));
  })();
  try {
    for (const forward of forwards) {
      const server = createServer({ allowHalfOpen: true }, (socket) => {
        if (closing) { socket.destroy(); return; }
        pipeConnection(socket, connect({ host: forward.host, port: forward.port, allowHalfOpen: true }), sockets);
      });
      servers.push(server);
      await listenLoopback(server, forward.insidePort).catch((error: Error) => {
        throw new WorkspaceOperationError("process-tcp-unavailable", `Cannot forward TCP target ${forward.host}:${forward.port} on inside port ${forward.insidePort}: ${error.message}`, 409);
      });
    }
    return { launch: await wrap(launch), close };
  } catch (error) {
    await close();
    throw error;
  }
};

/** Each launch shares only its own socket folder with the namespace; directory descriptors avoid Unix socket path limits. */
export const publishLoopbackPorts = async (
  temporary: string,
  launch: ProcessLaunch,
  ports: readonly number[],
  wrap: (launch: ProcessLaunch) => Promise<ProcessLaunch>,
  forwards: readonly TcpForward[] = [],
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
    const relay = (socket: Socket, address: { host: string; port: number } | { path: string }): void => {
      if (closing) { socket.destroy(); return; }
      pipeConnection(socket, connect({ ...address, allowHalfOpen: true }), sockets);
    };
    for (const port of ports) {
      const server = createServer({ allowHalfOpen: true }, (socket) => relay(socket, { path: `/proc/self/fd/${descriptor.fd}/${port}.sock` }));
      servers.push(server);
      await listenLoopback(server, port);
    }
    for (const [index, forward] of forwards.entries()) {
      const server = createServer({ allowHalfOpen: true }, (socket) => relay(socket, { host: forward.host, port: forward.port }));
      servers.push(server);
      const socketPath = `/proc/self/fd/${descriptor.fd}/out-${index}.sock`;
      await new Promise<void>((resolve, reject) => {
        server.once("error", (error) => reject(new WorkspaceOperationError(
          "process-tcp-unavailable", `Cannot forward TCP target ${forward.host}:${forward.port}: ${error.message}`, 409,
        )));
        server.listen(socketPath, resolve);
      });
      await chown(socketPath, owner.uid, owner.gid);
    }
    return {
      launch: await wrap({ command: process.execPath, args: ["-e", relayProgram, directory, JSON.stringify({ ports, forwards }), launch.command, ...launch.args] }),
      close,
    };
  } catch (error) {
    await close();
    throw error;
  }
};
