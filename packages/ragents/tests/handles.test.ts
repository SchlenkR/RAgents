import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../src/runtime/domain-error.ts";
import { handleOf } from "../src/runtime/guards.ts";

test("handles allow Unicode letters and normalize to NFC and lowercase", () => {
    assert.equal(handleOf("noël"), "noël");
    assert.equal(handleOf("@NOËL"), "noël");
    assert.equal(handleOf("noe\u0308l"), "no\u00ebl");
    assert.equal(handleOf("héloïse_2"), "héloïse_2");
    assert.equal(handleOf("日本語"), "日本語");
});

test("handles still reject spaces, control characters and empty values", () => {
    for (const value of ["", "  ", "two words", "line\nbreak", "emoji🙂", "-leading"]) {
        assert.throws(() => handleOf(value), DomainError);
    }
});
