import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { ListDetail, type ListDetailItem } from "../src/ui/ListDetail";
import { ListDetail as PublicListDetail } from "../../../apps/web/src/actor-programs/client-ui/index";
import type { ListDetailProps as PublicListDetailProps } from "../../../apps/web/src/actor-programs/client-ui/contracts";

const items: readonly ListDetailItem[] = Object.freeze([
  Object.freeze({ id: "first", title: "Erster Entwurf", group: "Texte", description: "Ein kurzer Text", tone: "accent" as const }),
  Object.freeze({ id: "review", title: "Prüfung", group: "Aufgaben", tone: "purple" as const }),
  Object.freeze({ id: "second", title: "Zweiter Entwurf", group: "Texte", tone: "success" as const }),
]);

test("ListDetail behält Gruppen- und Eintragsreihenfolge und markiert genau die kontrollierte Auswahl", () => {
  const props: PublicListDetailProps = {
    label: "Bibliothek", items, selectedId: "second", onSelect: () => {},
    detailHeader: createElement("h2", null, "Vollständige Vorschau"),
    detailFooter: createElement("button", { type: "button" }, "Übernehmen"),
    children: "Nur die Vorschau wird angezeigt.",
  };
  assert.equal(PublicListDetail, ListDetail);
  const html = renderToStaticMarkup(createElement(ListDetail, props));
  assert.equal((html.match(/aria-pressed="true"/g) ?? []).length, 1);
  assert.equal((html.match(/<ul /g) ?? []).length, 2);
  assert.ok(html.indexOf("Erster Entwurf") < html.indexOf("Zweiter Entwurf"));
  assert.ok(html.indexOf("Zweiter Entwurf") < html.indexOf("Prüfung"));
  assert.match(html, /<h2>Vollständige Vorschau<\/h2>/);
  assert.match(html, /<footer[^>]*>.*Übernehmen/s);
  const detailId = html.match(/id="([^"]+-detail)"/)?.[1];
  assert.ok(detailId);
  assert.equal(html.split(`aria-controls="${detailId}"`).length - 1, items.length);
  assert.deepEqual(items.map((item) => item.id), ["first", "review", "second"]);
});

test("ListDetail zeigt bei entfernten oder fehlenden Auswahlen keine veralteten Details und Aktionen", () => {
  const render = (selectedId?: string) => renderToStaticMarkup(createElement(ListDetail, {
    label: "Gefilterte Liste", items: [items[0]], selectedId, onSelect: () => {},
    children: "Veralteter Inhalt", detailHeader: "Veralteter Titel", detailFooter: "Veraltete Aktion",
  }));
  for (const html of [render("review"), render()]) {
    assert.match(html, /Wähle einen Eintrag/);
    assert.doesNotMatch(html, /Veralteter Inhalt|Veralteter Titel|Veraltete Aktion/);
    assert.doesNotMatch(html, /aria-pressed="true"/);
  }
});

test("ListDetail erhält die Filterleiste bei leerem Ergebnis und sperrt Auswahlaktionen bei disabled", () => {
  const empty = renderToStaticMarkup(createElement(ListDetail, {
    label: "Suche", items: [], onSelect: () => {},
    toolbar: createElement("input", { type: "search", "aria-label": "Suchen", value: "fehlend", readOnly: true }),
    emptyState: createElement("p", null, "Keine passenden Texte"),
  }));
  assert.match(empty, /type="search"/);
  assert.match(empty, /Keine passenden Texte/);
  assert.doesNotMatch(empty, /aria-pressed/);
  const disabled = renderToStaticMarkup(createElement(ListDetail, { label: "Liste", items, onSelect: () => {}, disabled: true }));
  assert.equal((disabled.match(/disabled=""/g) ?? []).length, items.length);
});

test("ListDetail lehnt mehrdeutige und leere Eintragskennungen ab", () => {
  const render = (next: ListDetailItem[]) => renderToStaticMarkup(createElement(ListDetail, { label: "Liste", items: next, onSelect: () => {} }));
  assert.throws(() => render([items[0], items[0]]), /eindeutige, nicht leere IDs/);
  assert.throws(() => render([{ id: " ", title: "Ohne Kennung" }]), /eindeutige, nicht leere IDs/);
});

test("ListDetail schaltet nach der eigenen Breite um, nicht nach der Fensterbreite", () => {
  const html = renderToStaticMarkup(createElement(ListDetail, {
    label: "Liste", items, onSelect: () => {}, selectedId: "first",
    toolbar: createElement("input", { type: "search", "aria-label": "Suchen", readOnly: true }),
  }));
  assert.match(html, /@container\/list-detail/);
  assert.doesNotMatch(html, /max-\[700px\]:/);
  const narrowDetail = html.match(/@max-\[900px\]\/list-detail:group-data-\[detail=true\]\/list-detail:hidden/g) ?? [];
  assert.equal(narrowDetail.length, 2);
});
