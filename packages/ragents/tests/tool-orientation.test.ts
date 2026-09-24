import assert from "node:assert/strict";
import test from "node:test";
import { Type } from "typebox";
import { toolOrientationText } from "../src/agents/tool-orientation.ts";
import { defineRunFunction } from "../src/agents/tools.ts";

const evaluator = defineRunFunction({
    name: "typescript_eval", label: "TypeScript", description: "Execute TypeScript.", nativeTool: true,
    schema: Type.Object({ code: Type.String() }), resultSchema: Type.Null(), available: () => true, run: () => null,
});

test("native tool orientation points at the shared API without an opening protocol", () => {
    const orientation = toolOrientationText([evaluator]);
    assert.match(orientation, /typescript_api/);
    assert.match(orientation, /context.functions/);
    assert.doesNotMatch(orientation, /tool_open|indexiert/);
});

test("plain LLMs receive no TypeScript orientation", () => {
    assert.equal(toolOrientationText([]), "");
});


test("native workspace tools are identified as direct calls alongside TypeScript functions", () => {
    const native = defineRunFunction({
        name: "read", label: "Read", description: "Read a file.", nativeTool: true,
        schema: Type.Object({ path: Type.String() }), resultSchema: Type.String(), available: () => true, run: () => "",
    });
    const workflow = defineRunFunction({
        name: "implementation_status", label: "Status", description: "Read workflow state.",
        schema: Type.Object({}), resultSchema: Type.Null(), available: () => true, run: () => null,
    });
    const orientation = toolOrientationText([evaluator, native, workflow]);
    assert.match(orientation, /read \(direktes Werkzeug\)/);
    assert.match(orientation, /ohne zusätzliche TypeScript-Hülle/);
    assert.match(orientation, /- implementation_status: Read workflow state/);
});
