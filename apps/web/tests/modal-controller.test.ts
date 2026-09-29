import assert from "node:assert/strict";
import test from "node:test";

import { createModalController, type ModalNextBehavior, type ModalPage } from "../src/ui/modal-controller.ts";

const page = (title: string): ModalPage => ({ title, render: () => null });

test("forward steps keep their predecessors and back restores the same entries", () => {
  const controller = createModalController({ nextBehavior: () => "push", onClose: () => assert.fail("Back must not close the host") });
  const root = controller.getSnapshot()[0];
  const firstPage = page("Set up");

  controller.open(firstPage);
  const first = controller.getSnapshot()[1];
  controller.open(page("Review"));

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
  assert.throws(() => controller.back(), /no previous dialog step/);
  assert.equal(controller.getSnapshot(), snapshot);
});

test("replace discards the current page without creating a way back", () => {
  const controller = createModalController({ nextBehavior: () => "replace", onClose: () => {} });
  const root = controller.getSnapshot()[0];
  const firstPage = page("First step");
  const replacement = page("Next step");

  controller.open(firstPage);
  controller.open(replacement);

  assert.equal(controller.getSnapshot().length, 1);
  assert.equal(controller.getSnapshot()[0].page, replacement);
  assert.equal(controller.getSnapshot().includes(root), false);
  assert.equal(controller.getSnapshot().some((entry) => entry.page === firstPage), false);
  assert.equal(controller.canGoBack, false);
  assert.throws(() => controller.back(), /no previous dialog step/);
});

test("a changed host policy replaces only the current step and keeps earlier history", () => {
  let behavior: ModalNextBehavior = "push";
  const controller = createModalController({ nextBehavior: () => behavior, onClose: () => {} });
  const root = controller.getSnapshot()[0];
  controller.open(page("Selection"));
  const selection = controller.getSnapshot().at(-1);
  controller.open(page("Preview"));
  const discarded = controller.getSnapshot().at(-1);

  behavior = "replace";
  controller.open(page("Result"));

  assert.equal(controller.getSnapshot().length, 3);
  assert.equal(controller.getSnapshot()[0], root);
  assert.equal(controller.getSnapshot()[1], selection);
  assert.equal(controller.getSnapshot().includes(discarded!), false);
  controller.back();
  assert.equal(controller.getSnapshot().at(-1), selection);

  behavior = "push";
  controller.open(page("New preview"));
  assert.equal(controller.getSnapshot()[1], selection);
  assert.equal(controller.getSnapshot().length, 3);
});

test("close asks the host and changes neither history nor subscriptions before its approval", () => {
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
  controller.open(page("Confirmation"));
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

test("a kept modal starts at its original page again after reset", () => {
  const controller = createModalController({ nextBehavior: () => "replace", onClose: () => assert.fail("Reset is not a close request") });
  const rootKey = controller.getSnapshot()[0].key;
  controller.open(page("Discarded original page"));
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
  controller.open(page("New flow"));
  assert.notEqual(controller.getSnapshot()[0].key, previousKey);
});

test("subscribers see complete new snapshots and can unsubscribe independently", () => {
  const controller = createModalController({ nextBehavior: () => "push", onClose: () => {} });
  const observations: string[] = [];
  const unsubscribeFirst = controller.subscribe(() => { observations.push(`first:${controller.getSnapshot().at(-1)?.page?.title ?? "root"}`); });
  const unsubscribeSecond = controller.subscribe(() => { observations.push(`second:${controller.getSnapshot().at(-1)?.page?.title ?? "root"}`); });
  const initial = controller.getSnapshot();
  assert.equal(controller.getSnapshot(), initial);

  controller.open(page("Set up"));
  assert.notEqual(controller.getSnapshot(), initial);
  assert.deepEqual(initial.map((entry) => entry.page), [null]);
  unsubscribeFirst();
  unsubscribeFirst();
  controller.back();
  unsubscribeSecond();
  controller.open(page("Unobserved"));

  assert.deepEqual(observations, ["first:Set up", "second:Set up", "second:root"]);
});

test("new steps get unique keys even after back, replace and reset", () => {
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
    controller.open(page("Same title"));
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

test("empty step titles are rejected without navigation or state change", () => {
  let notifications = 0;
  const controller = createModalController({
    nextBehavior: () => "push",
    onClose: () => {},
    onNavigate: () => assert.fail("Invalid pages must not trigger navigation"),
  });
  controller.subscribe(() => { notifications += 1; });
  const snapshot = controller.getSnapshot();

  for (const title of ["", "   ", "\n\t"]) {
    assert.throws(() => controller.open(page(title)), /requires a title/);
  }

  assert.equal(controller.getSnapshot(), snapshot);
  assert.equal(controller.canGoBack, false);
  assert.equal(notifications, 0);
});
