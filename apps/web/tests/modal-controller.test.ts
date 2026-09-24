import assert from "node:assert/strict";
import test from "node:test";

import { createModalController, type ModalNextBehavior, type ModalPage } from "../src/ui/modal-controller.ts";

const page = (title: string): ModalPage => ({ title, render: () => null });

test("Vorwärtsschritte behalten Vorgänger und Zurück stellt dieselben Einträge wieder her", () => {
  const controller = createModalController({ nextBehavior: () => "push", onClose: () => assert.fail("Zurück darf den Host nicht schließen") });
  const root = controller.getSnapshot()[0];
  const firstPage = page("Einrichten");

  controller.open(firstPage);
  const first = controller.getSnapshot()[1];
  controller.open(page("Prüfen"));

  assert.equal(controller.canGoBack, true);
  assert.equal(controller.getSnapshot()[0], root);
  assert.equal(controller.getSnapshot()[1], first);
  assert.equal(first.page, firstPage);
  controller.back();
  assert.equal(controller.getSnapshot().at(-1), first);
  controller.back();
  assert.deepEqual(controller.getSnapshot(), [root]);
  assert.equal(controller.canGoBack, false);
  const snapshot = controller.getSnapshot();
  assert.throws(() => controller.back(), /keinen vorherigen Dialogschritt/);
  assert.equal(controller.getSnapshot(), snapshot);
});

test("Ersetzen verwirft die aktuelle Seite ohne einen Rückweg anzulegen", () => {
  const controller = createModalController({ nextBehavior: () => "replace", onClose: () => {} });
  const root = controller.getSnapshot()[0];
  const firstPage = page("Erster Schritt");
  const replacement = page("Nächster Schritt");

  controller.open(firstPage);
  controller.open(replacement);

  assert.equal(controller.getSnapshot().length, 1);
  assert.equal(controller.getSnapshot()[0].page, replacement);
  assert.equal(controller.getSnapshot().includes(root), false);
  assert.equal(controller.getSnapshot().some((entry) => entry.page === firstPage), false);
  assert.equal(controller.canGoBack, false);
  assert.throws(() => controller.back(), /keinen vorherigen Dialogschritt/);
});

test("Eine geänderte Host-Policy ersetzt nur den aktuellen Schritt und erhält frühere Historie", () => {
  let behavior: ModalNextBehavior = "push";
  const controller = createModalController({ nextBehavior: () => behavior, onClose: () => {} });
  const root = controller.getSnapshot()[0];
  controller.open(page("Auswahl"));
  const selection = controller.getSnapshot().at(-1);
  controller.open(page("Vorschau"));
  const discarded = controller.getSnapshot().at(-1);

  behavior = "replace";
  controller.open(page("Ergebnis"));

  assert.equal(controller.getSnapshot().length, 3);
  assert.equal(controller.getSnapshot()[0], root);
  assert.equal(controller.getSnapshot()[1], selection);
  assert.equal(controller.getSnapshot().includes(discarded!), false);
  controller.back();
  assert.equal(controller.getSnapshot().at(-1), selection);

  behavior = "push";
  controller.open(page("Neue Vorschau"));
  assert.equal(controller.getSnapshot()[1], selection);
  assert.equal(controller.getSnapshot().length, 3);
});

test("Schließen fragt den Host an und verändert vor dessen Zustimmung weder Verlauf noch Abonnements", () => {
  let requests = 0;
  let approved = false;
  let notifications = 0;
  const controller = createModalController({
    nextBehavior: () => "push",
    onClose: () => {
      requests += 1;
      if (approved) controller.reset();
    },
  });
  controller.open(page("Bestätigung"));
  controller.subscribe(() => { notifications += 1; });
  const snapshot = controller.getSnapshot();

  controller.close();

  assert.equal(requests, 1);
  assert.equal(controller.getSnapshot(), snapshot);
  assert.equal(controller.canGoBack, true);
  assert.equal(notifications, 0);

  approved = true;
  controller.close();
  assert.equal(requests, 2);
  assert.equal(controller.canGoBack, false);
  assert.equal(controller.getSnapshot()[0].page, null);
  assert.equal(notifications, 1);
});

test("Ein behaltenes Modal startet nach Reset wieder an seiner ursprünglichen Seite", () => {
  const controller = createModalController({ nextBehavior: () => "replace", onClose: () => assert.fail("Reset ist keine Schließanfrage") });
  const rootKey = controller.getSnapshot()[0].key;
  controller.open(page("Verworfene ursprüngliche Seite"));
  const previousKey = controller.getSnapshot()[0].key;
  let notifications = 0;
  controller.subscribe(() => { notifications += 1; });

  controller.reset();
  const resetSnapshot = controller.getSnapshot();
  assert.deepEqual(resetSnapshot, [{ key: rootKey, page: null }]);
  assert.equal(controller.canGoBack, false);
  assert.equal(notifications, 1);

  controller.reset();
  assert.equal(controller.getSnapshot(), resetSnapshot);
  assert.equal(notifications, 1);
  controller.open(page("Neuer Ablauf"));
  assert.notEqual(controller.getSnapshot()[0].key, previousKey);
});

test("Abonnenten sehen vollständige neue Snapshots und können sich unabhängig abmelden", () => {
  const controller = createModalController({ nextBehavior: () => "push", onClose: () => {} });
  const observations: string[] = [];
  const unsubscribeFirst = controller.subscribe(() => { observations.push(`first:${controller.getSnapshot().at(-1)?.page?.title ?? "root"}`); });
  const unsubscribeSecond = controller.subscribe(() => { observations.push(`second:${controller.getSnapshot().at(-1)?.page?.title ?? "root"}`); });
  const initial = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), initial);

  controller.open(page("Einrichten"));
  assert.notEqual(controller.getSnapshot(), initial);
  assert.deepEqual(initial.map((entry) => entry.page), [null]);
  unsubscribeFirst();
  unsubscribeFirst();
  controller.back();
  unsubscribeSecond();
  controller.open(page("Unbeobachtet"));

  assert.deepEqual(observations, ["first:Einrichten", "second:Einrichten", "second:root"]);
});

test("Neue Schritte erhalten auch nach Zurück, Ersetzen und Reset eindeutige Schlüssel", () => {
  let behavior: ModalNextBehavior = "push";
  const departed: number[] = [];
  const controller = createModalController({
    nextBehavior: () => behavior,
    onClose: () => {},
    onNavigate: (from) => {
      assert.equal(controller.getSnapshot().at(-1)?.key, from);
      departed.push(from);
    },
  });
  const keys = new Set([controller.getSnapshot()[0].key]);
  const openUnique = () => {
    const from = controller.getSnapshot().at(-1)!.key;
    controller.open(page("Gleicher Titel"));
    const key = controller.getSnapshot().at(-1)!.key;
    assert.equal(keys.has(key), false);
    keys.add(key);
    assert.equal(departed.at(-1), from);
  };

  openUnique();
  controller.back();
  openUnique();
  behavior = "replace";
  openUnique();
  controller.reset();
  openUnique();
  assert.equal(keys.size, 5);
});

test("Leere Schritttitel werden ohne Navigation oder Zustandsänderung abgelehnt", () => {
  let notifications = 0;
  const controller = createModalController({
    nextBehavior: () => "push",
    onClose: () => {},
    onNavigate: () => assert.fail("Ungültige Seiten dürfen keine Navigation auslösen"),
  });
  controller.subscribe(() => { notifications += 1; });
  const snapshot = controller.getSnapshot();

  for (const title of ["", "   ", "\n\t"]) {
    assert.throws(() => controller.open(page(title)), /benötigt einen Titel/);
  }

  assert.equal(controller.getSnapshot(), snapshot);
  assert.equal(controller.canGoBack, false);
  assert.equal(notifications, 0);
});
