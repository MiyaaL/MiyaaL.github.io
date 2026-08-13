"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

(async function () {
  const html = fs.readFileSync("/site/_site/plan/index.html", "utf8");
  const holidays = JSON.parse(fs.readFileSync("/site/assets/data/holidays/cn-2026.json", "utf8"));
  const dom = new JSDOM(html, {
    url: "https://miyaal.github.io/plan/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  window.fetch = async () => ({ ok: true, json: async () => holidays });
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};

  window.eval(fs.readFileSync("/site/assets/js/plan-core.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-store.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-chart.js", "utf8"));

  const state = window.PlanCore.createDefaultState("2026-08-03");
  state.activeCycle.endDate = "2026-10-25";
  state.activeCycle.status = "active";
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  state.activeCycle.lifts.bench.current1rm = 100;
  state.activeCycle.lifts.bench.target1rm = 110;
  state.activeCycle.lifts.pullup.current1rm = 30;
  state.activeCycle.lifts.pullup.target1rm = 40;
  state.activeCycle.lifts.squat.current1rm = 150;
  state.activeCycle.lifts.squat.target1rm = 165;
  const archivedState = window.PlanCore.createDefaultState("2026-04-06");
  archivedState.activeCycle.endDate = "2026-06-28";
  archivedState.activeCycle.status = "archived";
  archivedState.activeCycle.bodyweightEntries = [{ date: "2026-04-06", value: 72 }];
  archivedState.activeCycle.lifts.bench.current1rm = 92.5;
  archivedState.activeCycle.lifts.bench.target1rm = 100;
  archivedState.activeCycle.lifts.pullup.current1rm = 20;
  archivedState.activeCycle.lifts.pullup.target1rm = 27.5;
  archivedState.activeCycle.lifts.squat.current1rm = 140;
  archivedState.activeCycle.lifts.squat.target1rm = 152.5;
  const archivedCycle = {
    cycle: archivedState.activeCycle,
    logs: {},
    archivedAt: "2026-06-29T00:00:00.000Z"
  };

  const memory = window.PlanStore.createMemoryAdapter({
    version: 0,
    state,
    signedIn: true
  });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(window.document.querySelector("[data-plan-owner-actions]").hidden, false);
  assert.strictEqual(window.document.querySelector("[data-plan-auth]").hidden, true);
  assert(window.document.querySelector(".plan-chart-svg"));
  const cycleSelect = window.document.querySelector("[data-plan-cycle-select]");
  assert.strictEqual(cycleSelect.closest("[data-plan-chart]") !== null, true);
  assert.strictEqual(window.document.querySelector("[data-plan-cycle-select-wrap]").hidden, false);
  assert.strictEqual(cycleSelect.options.length, 1);
  assert(cycleSelect.options[0].textContent.includes("Cycle 01 · Current"));

  const stateWithArchive = JSON.parse(JSON.stringify(state));
  stateWithArchive.archivedCycles = [archivedCycle];
  const planWithArchive = window.PlanCore.generate(stateWithArchive, [holidays]);
  const snapshotWithArchive = window.PlanCore.createPublicSnapshot(stateWithArchive, planWithArchive);
  await memory.save(0, stateWithArchive, snapshotWithArchive);
  await memory.signOut();
  await new Promise((resolve) => setTimeout(resolve, 50));
  await memory.signIn();
  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(cycleSelect.options.length, 2);
  assert(cycleSelect.options[0].textContent.includes("Current"));
  assert(cycleSelect.options[1].textContent.includes("Archived"));
  const activeTitle = window.document.querySelector("[data-plan-title]").textContent;
  const activeSessionId = window.document.querySelector("[data-session-id]").dataset.sessionId;
  cycleSelect.value = "0";
  cycleSelect.dispatchEvent(new window.Event("change"));
  assert.strictEqual(window.document.querySelector("[data-plan-title]").textContent, activeTitle);
  assert.strictEqual(window.document.querySelector("[data-session-id]").dataset.sessionId, activeSessionId);
  assert(window.document.querySelector('[data-chart-point][data-date="2026-04-06"]'));
  window.document.querySelector("[data-session-id]").click();
  assert(window.document.querySelector("[data-save-log]"));
  window.document.querySelector("[data-plan-close-details]").click();

  cycleSelect.value = "-1";
  cycleSelect.dispatchEvent(new window.Event("change"));

  const generated = window.PlanCore.generate(state, [holidays]);
  const chartPlot = window.document.querySelector("[data-plan-chart-plot]");
  Object.defineProperty(chartPlot, "clientWidth", { configurable: true, value: 420 });
  Object.defineProperty(chartPlot, "clientHeight", { configurable: true, value: 260 });
  window.PlanChart.render(
    window.document.querySelector("[data-plan-chart]"),
    generated,
    { today: "2026-08-20" }
  );
  assert.strictEqual(window.document.querySelector(".plan-chart-svg").getAttribute("viewBox"), "0 0 420 260");
  assert(window.document.querySelector(".plan-chart-today-line"));
  assert.strictEqual(window.document.querySelectorAll(".plan-chart-point-hit.is-today").length, 4);
  const chartPoint = window.document.querySelector("[data-chart-point]");
  chartPoint.dispatchEvent(new window.MouseEvent("mouseenter"));
  assert.strictEqual(window.document.querySelector("[data-chart-tooltip]").hidden, false);
  assert(window.document.querySelector("[data-chart-tooltip-value]").textContent.includes("kg"));

  window.document.querySelector("[data-session-id]").click();
  assert(window.document.querySelector("[data-save-log]"));
  window.document.querySelector("[data-save-log]").click();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(Object.keys(stored.state.logs).length, 1);
  const savedLog = stored.state.logs[Object.keys(stored.state.logs)[0]];
  assert.strictEqual(savedLog.accessories.length, 3);

  const updateBodyweight = window.document.querySelector("[data-plan-update-bodyweight]");
  assert(updateBodyweight, "owner view should expose a dedicated bodyweight update entry");
  updateBodyweight.click();
  const bodyweightDialog = window.document.querySelector("[data-plan-bodyweight-dialog]");
  assert.strictEqual(bodyweightDialog.open, true);
  bodyweightDialog.querySelector('[name="date"]').value = "2026-08-20";
  bodyweightDialog.querySelector('[name="bodyweight"]').value = "69.5";
  bodyweightDialog.querySelector("form").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true })
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  const bodyweightState = await memory.loadPrivate();
  assert.strictEqual(bodyweightState.version, 3);
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(bodyweightState.state.activeCycle.bodyweightEntries.slice(-1)[0])),
    { date: "2026-08-20", value: 69.5 }
  );
  const publicAfterBodyweight = await memory.loadPublic();
  assert(!JSON.stringify(publicAfterBodyweight.record.snapshot).includes("bodyweightEntries"));
  assert.strictEqual(bodyweightDialog.open, false);

  window.document.querySelector("[data-plan-edit]").click();
  assert.strictEqual(window.document.querySelector("[data-plan-settings]").open, true);

  console.log("PASS: owner login, training log save, bodyweight update, version increment, and settings smoke test");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
