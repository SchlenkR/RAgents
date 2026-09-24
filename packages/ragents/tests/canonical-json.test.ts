import assert from "node:assert/strict";
import test from "node:test";

import { canonicalJson } from "../src/runtime/canonical-json.ts";

test("canonical JSON is independent of object key order", () => {
    assert.equal(
        canonicalJson({ beta: [1, { y: true, x: null }], alpha: "one" }),
        canonicalJson({ alpha: "one", beta: [1, { x: null, y: true }] }),
    );
    assert.equal(
        canonicalJson({ beta: 2, alpha: "one" }),
        "{\"alpha\":\"one\",\"beta\":2}",
    );
    assert.notEqual(canonicalJson(["one", "two"]), canonicalJson(["two", "one"]));
});

test("canonical JSON rejects cycles", () => {
    const value: Record<string, unknown> = {};
    value.self = value;

    assert.throws(() => canonicalJson(value), /cannot contain cycles/);
});

test("canonical JSON rejects undefined and non-finite numbers", () => {
    assert.equal(canonicalJson({ key: undefined }), "{}");
    assert.throws(() => canonicalJson([undefined]), /cannot contain undefined/);
    assert.throws(() => canonicalJson(Number.POSITIVE_INFINITY), /non-finite/);
});
