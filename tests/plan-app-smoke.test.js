"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const { loadPlanPage } = require("./helpers/dom.js");

test("the unconfigured page previews the default template in English", async () => {
  const page = await loadPlanPage({ today: "2026-11-26" });
  assert.strictEqual(page.text("[data-plan-sync-state]"), "Sync not configured");
  assert.strictEqual(page.$("[data-plan-view]").hidden, false);
  assert.strictEqual(page.$$(".plan-day").length, 42);
  assert.strictEqual(page.$("[data-plan-chart-empty]").hidden, false);
  assert.strictEqual(page.text("[data-plan-title]"), "Push / Pull / Squat · 5 sessions per week");
  assert.strictEqual(page.$("[data-plan-app]").closest("[lang]").getAttribute("lang"), "en");
  assert.doesNotMatch(page.document.body.textContent, /[㐀-鿿]/, "no Chinese copy is left in the page");
  page.close();
});

test("the session drawer is a modal dialog that returns focus to its trigger", async () => {
  const page = await loadPlanPage({ today: "2026-11-26" });
  const trigger = page.$("[data-session-id]");
  trigger.focus();
  trigger.click();
  const drawer = page.$("[data-plan-drawer]");
  assert.strictEqual(drawer.tagName, "DIALOG");
  assert.ok(drawer.hasAttribute("open"));
  assert.strictEqual(drawer.getAttribute("aria-labelledby"), "plan-detail-title");
  assert.match(page.text("[data-plan-detail-body]"), /Main lift/);
  page.$("[data-plan-close-details]").click();
  assert.ok(!drawer.hasAttribute("open"));
  assert.strictEqual(page.document.activeElement, trigger);
  page.close();
});

test("every dialog is labelled and the calendar exposes its structure", async () => {
  const page = await loadPlanPage({ today: "2026-11-26" });
  page.$$("dialog").forEach((dialog) => {
    const id = dialog.getAttribute("aria-labelledby");
    assert.ok(id && page.document.getElementById(id), "dialog labelled by an existing heading");
  });
  assert.strictEqual(page.$(".plan-weekdays").getAttribute("aria-hidden"), null);
  assert.strictEqual(page.$$(".plan-weekdays abbr").length, 7);
  page.$$(".plan-day").forEach((cell) => {
    if (cell.dataset.sessionId) {
      assert.strictEqual(cell.tagName, "BUTTON");
      assert.ok(cell.getAttribute("aria-label"));
    } else {
      assert.notStrictEqual(cell.tagName, "BUTTON", "empty days are not focusable");
      assert.strictEqual(cell.getAttribute("tabindex"), null);
    }
  });
  page.$$('input[type="number"]').forEach((input) => {
    assert.ok(input.getAttribute("inputmode"), "numeric inputs ask for a numeric keyboard");
  });
  page.close();
});

test("the mobile layout lists the week as an agenda", async () => {
  const page = await loadPlanPage({ today: "2026-11-26", mobile: true });
  assert.strictEqual(page.$$(".plan-agenda-day").length, 7);
  assert.match(page.text("[data-plan-view-title]"), /Nov 23, 2026 — Nov 29, 2026/);
  page.close();
});
