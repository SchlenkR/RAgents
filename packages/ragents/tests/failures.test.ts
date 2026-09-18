import assert from "node:assert/strict";
import test from "node:test";
import { throwFailures, throwRejected } from "../src/runtime/failures.ts";

test("cleanup failures retain distinct causes and flatten repeated aggregate wrappers", async () => {
    const first = new Error("first cleanup failed");
    const second = new Error("second cleanup failed");
    const results = await Promise.allSettled([
        Promise.resolve(),
        Promise.reject(new AggregateError([first, new AggregateError([first, second])])),
        Promise.reject(second),
    ]);
    assert.throws(() => throwRejected(results, "cleanup failed"), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.equal(error.message, "cleanup failed");
        assert.deepEqual(error.errors, [first, second]);
        return true;
    });
});

test("a repeated single failure is thrown with its original identity", () => {
    const failure = new Error("cleanup failed");
    assert.throws(() => throwFailures([failure, new AggregateError([failure])], "cleanup failed"), (error) => error === failure);
    assert.doesNotThrow(() => throwFailures([], "cleanup failed"));
    assert.doesNotThrow(() => throwRejected([{ status: "fulfilled", value: undefined }], "cleanup failed"));
});

test("non-Error rejections are preserved", () => {
    assert.throws(() => throwFailures([null, undefined, "failed"], "cleanup failed"), (error: unknown) => {
        assert.ok(error instanceof AggregateError);
        assert.deepEqual(error.errors, [null, undefined, "failed"]);
        return true;
    });
});

test("an empty aggregate rejection remains a failure on its own and inside another aggregate", async () => {
    const failure = new AggregateError([], "cleanup failed without nested causes");
    const results = await Promise.allSettled([Promise.reject(failure)]);
    assert.throws(() => throwRejected(results, "cleanup failed"), (error) => error === failure);
    assert.throws(() => throwFailures([new AggregateError([failure])], "cleanup failed"), (error) => error === failure);
});
