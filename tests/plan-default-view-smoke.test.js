"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const { createPlanWindow, startPlanApp } = require("./helpers/dom.js");

test('the owner view shows a single plan and saves bodyweight updates', async function () {
  const { window, holidays } = createPlanWindow({ today: "2026-09-22" });

  const state = window.PlanCore.createDefaultState("2026-08-03");
  state.activeCycle.status = "active";
  state.activeCycle.endDate = "2026-10-31";
  state.activeCycle.requestedEndDate = "2026-10-31";
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  Object.keys(state.activeCycle.lifts).forEach((key) => {
    state.activeCycle.lifts[key].current1rm = key === "squat" ? 120 : 80;
    state.activeCycle.lifts[key].target1rm = key === "squat" ? 130 : 90;
  });

  const memory = window.PlanStore.createMemoryAdapter({ version: 1, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  startPlanApp(window);

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(window.document.querySelector("[data-plan-title]").textContent, "Push / Pull / Squat · 5 sessions per week");

  window.document.querySelector("[data-plan-update-bodyweight]").click();
  const bodyweightForm = window.document.querySelector("[data-plan-bodyweight-form]");
  assert.strictEqual(bodyweightForm.closest("dialog").open, true, "fitness actions remain available");
  bodyweightForm.elements.date.value = "2026-09-22";
  bodyweightForm.elements.bodyweight.value = "69.5";
  bodyweightForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 2, "fitness updates still save");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(stored.state.activeCycle.bodyweightEntries.slice(-1)[0])),
    { date: "2026-09-22", value: 69.5 }
  );
  const published = (await memory.loadPublic()).record;
  assert.strictEqual(published.version, 2, "the public snapshot is saved with the same version");

  window.close();
});
