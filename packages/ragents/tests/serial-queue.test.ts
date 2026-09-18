import assert from "node:assert/strict";
import test from "node:test";

import { SerialQueue } from "../src/runtime/serial-queue.ts";

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
