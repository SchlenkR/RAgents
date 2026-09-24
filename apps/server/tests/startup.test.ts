import assert from "node:assert/strict";
import { createServer, type Server } from "node:net";
import test from "node:test";
import { assertServerPortAvailable } from "../src/startup.ts";

const listen = (server: Server, port = 0): Promise<number> => new Promise((resolve, reject) => {
  const failed = (error: Error) => reject(error);
  server.once("error", failed);
  server.listen(port, "127.0.0.1", () => {
    server.off("error", failed);
    const address = server.address();
    assert.ok(address && typeof address !== "string");
    resolve(address.port);
  });
});

const close = (server: Server): Promise<void> => new Promise((resolve, reject) => {
  server.close((error) => error ? reject(error) : resolve());
});

test("die Portprüfung akzeptiert einen freien Port und gibt ihn vor der Rückkehr wieder frei", async () => {
  const reservation = createServer();
  const port = await listen(reservation);
  await close(reservation);

  await assertServerPortAvailable(port);

  const nextServer = createServer();
  try {
    assert.equal(await listen(nextServer, port), port);
  } finally {
    if (nextServer.listening) await close(nextServer);
  }
});

test("ein belegter Port nennt den Port und die konfigurierbare PORT-Alternative", async () => {
  const occupied = createServer();
  const port = await listen(occupied);
  try {
    await assert.rejects(assertServerPortAvailable(port), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.ok(error.message.includes(String(port)));
      assert.match(error.message, /belegt|verwendet|nicht verfügbar/i);
      assert.match(error.message, /\bPORT\b/);
      return true;
    });
    assert.equal(occupied.listening, true);
  } finally {
    await close(occupied);
  }
  await assertServerPortAvailable(port);
});

test("ungültige Portwerte scheitern mit einer verständlichen Konfigurationsmeldung", async () => {
  for (const port of [0, -1, 65_536, 1.5, Number.NaN, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY]) {
    await assert.rejects(assertServerPortAvailable(port), (error: unknown) => {
      assert.ok(error instanceof Error);
      assert.match(error.message, /\bPORT\b|Port/);
      assert.match(error.message, /ungültig|ganze Zahl|1.*65535|65.?535/i);
      return true;
    });
  }
});
