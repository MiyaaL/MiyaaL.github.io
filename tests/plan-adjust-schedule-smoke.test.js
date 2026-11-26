"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const { createPlanWindow, startPlanApp } = require("./helpers/dom.js");

const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 50));

test('whole-plan adjustment confirms, saves and retries fixed-deadline plans with visible feedback', async function () {
  const { window, holidays } = createPlanWindow({ today: "2026-10-08" });
  const core = window.PlanCore;
  let state = core.createDefaultState("2026-09-01");
  state.activeCycle.status = "active";
  state.activeCycle.endDate = "2026-10-31";
  state.activeCycle.requestedEndDate = "2026-10-31";
  state.activeCycle.bodyweightEntries = [{ date: "2026-09-01", value: 70 }];
  Object.keys(state.activeCycle.lifts).forEach((key) => {
    state.activeCycle.lifts[key].current1rm = key === "squat" ? 140 : 100;
    state.activeCycle.lifts[key].target1rm = state.activeCycle.lifts[key].current1rm;
  });
  state = core.replanRemaining(state, [holidays], {
    fromDate: "2026-09-25", endDate: "2026-10-31", trainOnHolidays: true, asOfDate: "2026-10-08"
  });
  const initial = core.generate(state, [holidays], { asOfDate: "2026-10-08" });
  const source = initial.sessions.find((session) => session.date === "2026-10-02");
  const next = initial.sessions.find((session) => session.date === "2026-10-05");
  const completed = initial.sessions.find((session) => session.date === "2026-09-30");
  assert(source);
  state = core.recordSession(state, source, { status: "skipped" });
  state = core.recordSession(state, next, { status: "skipped" });
  state = core.recordSession(state, completed, { status: "completed", notes: "Keep this log" });
  const originalLogs = JSON.parse(JSON.stringify(state.logs));

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  startPlanApp(window);
  await waitForRender();

  const document = window.document;
  document.querySelector(`[data-session-id="${source.id}"]`).click();
  const drawer = document.querySelector("[data-plan-drawer]");
  const confirm = document.querySelector("[data-plan-move-confirm]");
  const adjust = (date) => {
    drawer.querySelector("[data-move-date]").value = date;
    drawer.querySelector("[data-adjust-schedule]").click();
  };
  const detailMessage = () => drawer.querySelector("[data-plan-detail-message]");
  adjust("2026-10-08");
  assert.strictEqual(confirm.open, true, "whole-plan adjustment must respond for a fixed-deadline plan");
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("back by 6 days"));
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("Nov 6, 2026"));
  assert.strictEqual((await memory.loadPrivate()).version, 0, "preview must not save the adjustment");
  confirm.querySelector("[data-plan-cancel-move]").click();
  assert.strictEqual(confirm.open, false);
  assert.strictEqual((await memory.loadPrivate()).version, 0, "cancel must preserve the stored plan");

  adjust(source.date);
  assert(detailMessage().textContent.includes("The date is unchanged"), "unchanged dates need visible drawer feedback");
  adjust("2026-09-30");
  assert(detailMessage().textContent.includes("on or before the previous session"), "date conflicts need visible drawer feedback");
  assert.strictEqual(confirm.open, false);

  adjust("2026-10-08");
  const save = memory.save;
  memory.save = async () => { throw new Error("offline test"); };
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();
  assert(detailMessage().textContent.includes("Saving failed"), "save failures must remain visible in the drawer");
  assert.strictEqual(drawer.open, true);
  assert.strictEqual((await memory.loadPrivate()).version, 0);
  memory.save = save;

  adjust("2026-10-08");
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("back by 6 days"),
    "a failed save must restore the in-memory schedule before retrying");
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();
  let stored = await memory.loadPrivate();
  let generated = core.generate(stored.state, [holidays], { asOfDate: "2026-10-08" });
  assert.strictEqual(stored.version, 1);
  assert.strictEqual(generated.sessions.length, initial.sessions.length);
  assert.strictEqual(generated.cycle.endDate, "2026-11-06");
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).date, "2026-10-08");
  assert.strictEqual(generated.sessions.find((session) => session.id === next.id).date, "2026-10-11");
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).status, "planned");
  assert.strictEqual(generated.sessions.find((session) => session.id === next.id).status, "planned");
  assert.deepStrictEqual(JSON.parse(JSON.stringify(stored.state.logs[completed.id])), originalLogs[completed.id]);
  const published = (await memory.loadPublic()).record.snapshot;
  assert.strictEqual(published.cycle.endDate, "2026-11-06");
  assert.strictEqual(published.sessions.find((session) => session.id === source.id).date, "2026-10-08");

  document.querySelector(`[data-session-id="${source.id}"]`).click();
  adjust("2026-10-07");
  assert.strictEqual(confirm.open, true);
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("forward by 1 day"));
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();
  stored = await memory.loadPrivate();
  generated = core.generate(stored.state, [holidays], { asOfDate: "2026-10-08" });
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(generated.cycle.endDate, "2026-11-05");
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).date, "2026-10-07");
  assert.strictEqual(generated.sessions.length, initial.sessions.length);
  window.close();
});
