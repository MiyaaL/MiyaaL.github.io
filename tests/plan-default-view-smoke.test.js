"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const { createPlanWindow, startPlanApp } = require("./helpers/dom.js");

test('the first owner save drops learning plans left in a stored row', async function () {
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
  // A row saved while the learning planner still existed.
  state.learningPlans = [{ id: "learning-2026-09-01", type: "learning", title: "Old plan", logs: {}, artifacts: [] }];
  state.activePlanId = "learning-2026-09-01";

  const memory = window.PlanStore.createMemoryAdapter({ version: 1, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  startPlanApp(window);

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(window.document.querySelector(".plan-kind-toolbar"), null, "single-plan view has no mode toolbar");
  assert.strictEqual(window.document.querySelector("[data-plan-kind]"), null, "plan kind tabs are removed");
  assert.strictEqual(window.document.querySelector("[data-plan-learning-selector]"), null);
  assert.strictEqual(window.document.querySelector("[data-plan-new-learning]"), null);
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
  assert.strictEqual(Object.hasOwn(stored.state, "learningPlans"), false,
    "the first save after the removal clears the stored learning plans");
  assert.strictEqual(Object.hasOwn(stored.state, "activePlanId"), false);
  const published = (await memory.loadPublic()).record.snapshot;
  assert.strictEqual(Object.hasOwn(published, "learningPlans"), false,
    "and stops publishing them in the public snapshot");
  assert.doesNotMatch(window.document.body.innerHTML, /learning/i);

  window.close();
});
