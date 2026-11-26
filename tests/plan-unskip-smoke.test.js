"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const { createPlanWindow, startPlanApp } = require("./helpers/dom.js");

const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 50));

test('skipped workout can be restored and rolls back after save failure', async function () {
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
  const failureSource = initial.sessions.find((session) => session.date === "2026-09-16");
  state = window.PlanCore.recordSession(state, source, { status: "skipped", notes: "Travelling" });
  state = window.PlanCore.recordSession(state, failureSource, { status: "skipped", notes: "To restore" });

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  startPlanApp(window);
  await waitForRender();

  const day = window.document.querySelector(`[data-session-id="${source.id}"]`);
  assert(day.getAttribute("aria-label").includes("Skipped"));
  day.click();

  const drawer = window.document.querySelector("[data-plan-drawer]");
  const restore = drawer.querySelector("[data-restore-skipped-session]");
  assert(restore, "a skipped workout should offer cancellation");
  assert.strictEqual(restore.textContent, "Undo skip");
  assert.strictEqual(drawer.querySelector("[data-skip-session]"), null);
  restore.click();
  await waitForRender();

  const stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(stored.state.logs, source.id), false);
  const publicRecord = await memory.loadPublic();
  // The restored session lies before the page's date, so it is now overdue.
  assert.strictEqual(
    publicRecord.record.snapshot.sessions.find((session) => session.id === source.id).status,
    source.date < "2026-09-20" ? "missed" : "planned"
  );
  assert(window.document.querySelector("[data-plan-message]").textContent.includes("The skip was undone"));

  window.document.querySelector(`[data-session-id="${source.id}"]`).click();
  assert(drawer.querySelector("[data-skip-session]"));
  assert.strictEqual(drawer.querySelector("[data-restore-skipped-session]"), null);

  let rejectSave;
  memory.save = () => new Promise((_, reject) => {
    rejectSave = reject;
  });
  window.document.querySelector(`[data-session-id="${failureSource.id}"]`).click();
  const failedRestore = drawer.querySelector("[data-restore-skipped-session]");
  assert(failedRestore, "the second skipped workout should also offer cancellation");
  failedRestore.click();
  await waitForRender();
  window.dispatchEvent(new window.Event("offline"));
  assert(
    window.document.querySelector(`[data-session-id="${failureSource.id}"]`)
      .getAttribute("aria-label").includes("Skipped"),
    "a render while the save is in flight must not show the unsaved state"
  );
  rejectSave(new Error("network_down"));
  await waitForRender();
  assert(
    window.document.querySelector(`[data-session-id="${failureSource.id}"]`)
      .getAttribute("aria-label").includes("Skipped"),
    "a failed save must render the restored skipped state"
  );
  const failedStored = await memory.loadPrivate();
  assert.strictEqual(failedStored.version, 1);
  assert.strictEqual(failedStored.state.logs[failureSource.id].status, "skipped");
  assert(window.document.querySelector("[data-plan-message]").textContent.includes("Saving failed"));

  window.close();
});
