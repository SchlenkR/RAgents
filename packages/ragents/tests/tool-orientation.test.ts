import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { toolOrientationText } from "../src/agents/tool-orientation.ts";
import { defineRunFunction } from "../src/agents/tools.ts";

const evaluator = defineRunFunction({
    name: "typescript_eval", label: "TypeScript", description: "Execute TypeScript.",
    schema: Type.Object({ code: Type.String() }), resultSchema: Type.Null(), available: () => true, run: () => null,
});

test("native tool orientation points at the shared API without an opening protocol", () => {
    const orientation = toolOrientationText([evaluator]);
    assert.match(orientation, /typescript_api/);
    assert.match(orientation, /context.functions/);
    assert.doesNotMatch(orientation, /tool_open|indexed/);
});

test("plain LLMs receive no TypeScript orientation", () => {
    assert.equal(toolOrientationText([]), "");
});


test("only functions that opt out of native calls are listed, as snippet-only", () => {
    const native = defineRunFunction({
        name: "read", label: "Read", description: "Read a file.",
        schema: Type.Object({ path: Type.String() }), resultSchema: Type.String(), available: () => true, run: () => "",
    });
    const snippetOnly = defineRunFunction({
        name: "journal_query", label: "Query", description: "Read raw journal events.", nativeTool: false,
        schema: Type.Object({}), resultSchema: Type.Null(), available: () => true, run: () => null,
    });
    const orientation = toolOrientationText([evaluator, native, snippetOnly]);
    assert.match(orientation, /Call your tools directly/);
    assert.doesNotMatch(orientation, /- read:/);
    assert.match(orientation, /Only available through context.functions:\n- journal_query: Read raw journal events/);
});

test("without opt-outs the orientation lists no functions", () => {
    const orientation = toolOrientationText([evaluator]);
    assert.doesNotMatch(orientation, /Only available through/);
    assert.doesNotMatch(orientation, /^- /m);
});
