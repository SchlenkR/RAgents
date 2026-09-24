import assert from "node:assert/strict";
import test from "node:test";

import { KeyedSerialQueue, SerialQueue } from "../src/runtime/serial-queue.ts";

test("the command queue runs one request at a time in arrival order", async () => {
    const queue = new SerialQueue();
    const trace: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const first = queue.run(async () => {
        trace.push("first:start");
        await firstGate;
        trace.push("first:end");
    });
    const second = queue.run(() => {
        trace.push("second");
    });

    await Promise.resolve();
    assert.deepEqual(trace, ["first:start"]);
    releaseFirst();
    await Promise.all([first, second]);
    assert.deepEqual(trace, ["first:start", "first:end", "second"]);
});

test("a keyed queue keeps each key in order, lets other keys pass and forgets a key once it is idle", async () => {
    const queue = new KeyedSerialQueue();
    const trace: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
        releaseFirst = resolve;
    });
    const first = queue.run("a", async () => {
        trace.push("a:first");
        await firstGate;
    });
    const second = queue.run("a", () => {
        trace.push("a:second");
    });

    await queue.run("b", () => {
        trace.push("b");
    });
    assert.deepEqual(trace, ["a:first", "b"]);
    releaseFirst();
    await Promise.all([first, second]);
    await Promise.resolve();
    assert.deepEqual(trace, ["a:first", "b", "a:second"]);
    assert.equal(queue.size, 0);
});
