import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { ESLint } from "eslint";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const lint = new ESLint({ cwd: root });
const messages = async (source: string, filePath = "apps/web/src/example.tsx") => (await lint.lintText(source, { filePath }))[0]!.messages
  .filter((message) => message.ruleId === "ragents-ui/no-native-title");

test("native title attributes fail for HTML and shared controls in host and plugin views", async () => {
  for (const filePath of ["apps/web/src/example.tsx", "plugins/example/web/index.tsx"]) {
    const errors = await messages(`import { Button as Action } from "@ragents/web/ui";
import { Radio } from "@base-ui/react/radio";
import { Button as BaseButton } from "@base-ui/react";
import { XIcon } from "lucide-react";
export const view = <><span title="Full text">Text</span><Action title="Action" /><Radio.Root title="Choice" />
<BaseButton title="Action" /><XIcon title="Close" /><button {...{ title: "Hidden hint" }} />
<Action {...(true ? { title: "Hint" } : {})} /></>;`, filePath);
    assert.equal(errors.length, 7);
    assert.ok(errors.every((message) => message.severity === 2));
  }
});

test("namespaced UI controls fail while accessible SVG and semantic headings keep their titles", async () => {
  assert.equal((await messages(`import * as Ui from "@ragents/web/ui"; export const view = <Ui.Button title="Action" />;`)).length, 1);
  assert.deepEqual(await messages(`import { BrandLogo } from "./ui/brand-logo";
import { SectionHeading } from "./ui/SectionLabel";
import { RenderBoundary } from "./RenderBoundary";
document.title = "Run";
export const view = <><svg role="img"><title>Diagram</title></svg><BrandLogo title="Product" />
<SectionHeading title="Workspace" /><RenderBoundary title="The view failed"><span aria-label="Full text">Text</span></RenderBoundary></>;`), []);
});

test("only the shared tooltip implementation is excluded from the native title rule", async () => {
  assert.deepEqual(await messages('export const view = <span title="Tooltip" />;', "apps/web/src/ui/tooltip.tsx"), []);
  assert.equal((await messages('export const view = <span title="Tooltip" />;', "plugins/example/web/tooltip.tsx")).length, 1);
});
