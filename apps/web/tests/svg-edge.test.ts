import assert from "node:assert/strict";
import test from "node:test";
import { createElement, Fragment } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SvgEdge, type SvgEdgeProps } from "../src/ui/SvgEdge";
import { SvgEdge as PublicSvgEdge } from "../../../plugins/ragents.actor-programs/client-ui/index";

const render = (props: SvgEdgeProps) => renderToStaticMarkup(createElement("svg", null, createElement(SvgEdge, props)));

test("SvgEdge preserves caller geometry and optional arrow directions through the public SDK", () => {
  assert.equal(PublicSvgEdge, SvgEdge);
  const d = "M120 30 C90 30 30 80 10 80";
  for (const arrow of ["none", "end", "both"] as const) {
    const html = render({ d, arrow });
    assert.ok(html.includes(`d="${d}"`));
    const marker = html.match(/<marker id="([^"]+)"/);
    assert.equal(!!marker, arrow !== "none");
    assert.equal(html.includes("marker-end="), arrow !== "none");
    assert.equal(html.includes("marker-start="), arrow === "both");
    if (marker) {
      assert.ok(html.includes(`marker-end="url(#${marker[1]})"`));
      assert.match(html, /orient="auto-start-reverse"/);
      if (arrow === "both") assert.ok(html.includes(`marker-start="url(#${marker[1]})"`));
    }
  }
});

test("multiple diagrams keep every arrow bound to its own marker", () => {
  const html = renderToStaticMarkup(createElement(Fragment, null, ...[0, 1].map((index) => createElement("svg", { key: index },
    createElement(SvgEdge, { d: "M0 10 L40 10", tone: "success", arrow: "both" }),
    createElement(SvgEdge, { d: "M40 20 L0 20", tone: "danger" })))));
  const ids = [...html.matchAll(/<marker id="([^"]+)"/g)].map((match) => match[1]);
  assert.equal(ids.length, 4);
  assert.equal(new Set(ids).size, ids.length);
  const references = [...html.matchAll(/marker-(?:start|end)="url\(#([^)]+)\)"/g)].map((match) => match[1]);
  assert.equal(references.length, 6);
  assert.ok(references.every((id) => ids.includes(id)));
  assert.deepEqual(ids.map((id) => references.filter((reference) => reference === id).length), [2, 1, 2, 1]);
});

test("edge state changes retain geometry and independently describe tone, dashes and activity", () => {
  const pending = render({ d: "M0 0 L40 40", arrow: "none", lineStyle: "dashed" });
  assert.match(pending, /data-active="false" data-line-style="dashed" data-tone="neutral"/);
  assert.doesNotMatch(pending, /data-active="true"|<marker/);
  const active = render({ d: "M0 0 L40 40", tone: "warning", active: true });
  assert.match(active, /data-active="true" data-line-style="solid" data-tone="warning"/);
  const finished = render({ d: "M0 0 L40 40", tone: "success" });
  assert.match(finished, /data-active="false" data-line-style="solid" data-tone="success"/);
});
