"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const { createPlanWindow, startPlanApp } = require("./helpers/dom.js");

const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 50));

test('a workout can defer and then advance the remaining plan', async function () {
  const { window, holidays } = createPlanWindow({ today: "2026-09-20" });

  let state = window.PlanCore.createDefaultState("2026-09-01");
  state.activeCycle.status = "active";
  state.activeCycle.endDate = "2026-10-31";
  state.activeCycle.requestedEndDate = "2026-10-31";
  state.activeCycle.bodyweightEntries = [{ date: "2026-09-01", value: 70 }];
  Object.keys(state.activeCycle.lifts).forEach((key) => {
    state.activeCycle.lifts[key].current1rm = key === "squat" ? 140 : 100;
    state.activeCycle.lifts[key].target1rm = state.activeCycle.lifts[key].current1rm;
  });
  const initial = window.PlanCore.generate(state, [holidays], { asOfDate: "2026-09-20" });
  const source = initial.sessions.find((session) => session.date === "2026-09-15");
  state = window.PlanCore.recordSession(state, source, { status: "skipped", notes: "Travelling" });

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  startPlanApp(window);
  await waitForRender();

  const drawer = window.document.querySelector("[data-plan-drawer]");
  const confirm = window.document.querySelector("[data-plan-move-confirm]");

  window.document.querySelector(`[data-session-id="${source.id}"]`).click();
  drawer.querySelector("[data-move-date]").value = "2026-09-22";
  drawer.querySelector("[data-adjust-schedule]").click();
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();

  let stored = await memory.loadPrivate();
  let generated = window.PlanCore.generate(stored.state, [holidays], { asOfDate: "2026-09-20" });
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).date, "2026-09-22");
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).status, "planned");
  assert.strictEqual(stored.state.activeCycle.scheduleAdjustments.length, 1);

  window.document.querySelector(`[data-session-id="${source.id}"]`).click();
  const secondAdjustment = drawer.querySelector("[data-adjust-schedule]");
  assert(secondAdjustment, "a planned workout must still offer another whole-plan adjustment");
  drawer.querySelector("[data-move-date]").value = "2026-09-21";
  secondAdjustment.click();
  assert.strictEqual(confirm.open, true);
  assert(confirm.querySelector("[data-plan-move-confirm-title]").textContent.includes("Pull"));
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("forward by 1 day"));
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();

  stored = await memory.loadPrivate();
  generated = window.PlanCore.generate(stored.state, [holidays], { asOfDate: "2026-09-20" });
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(stored.state.activeCycle.scheduleAdjustments.length, 2);
  assert.strictEqual(stored.state.activeCycle.scheduleAdjustments.map((entry) => entry.days).join(","), "7,-1");
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).date, "2026-09-21");

  window.close();
});
