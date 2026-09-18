import assert from "node:assert/strict";
import test from "node:test";

import { DomainError } from "../src/runtime/domain-error.ts";
import { handleOf } from "../src/runtime/guards.ts";

test("Handles erlauben Unicode-Buchstaben und normalisieren auf NFC und Kleinschreibung", () => {
    assert.equal(handleOf("grün"), "grün");
    assert.equal(handleOf("@GRÜN"), "grün");
    assert.equal(handleOf("gru\u0308n"), "gr\u00fcn");
    assert.equal(handleOf("héloïse_2"), "héloïse_2");
    assert.equal(handleOf("日本語"), "日本語");
});

test("Handles lehnen Leerzeichen, Steuerzeichen und leere Werte weiterhin ab", () => {
    for (const value of ["", "  ", "zwei wörter", "zeile\numbruch", "emoji🙂", "-vorne"]) {
        assert.throws(() => handleOf(value), DomainError);
    }
});
