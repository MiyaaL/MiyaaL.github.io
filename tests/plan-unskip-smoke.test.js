"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 50));

(async function () {
  const page = fs.readFileSync("/site/_site/plan/index.html", "utf8");
  const holidays = JSON.parse(fs.readFileSync("/site/assets/data/holidays/cn-2026.json", "utf8"));
  const dom = new JSDOM(page, {
    url: "https://miyaal.github.io/plan/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const NativeDate = window.Date;
  const fixedNow = new NativeDate("2026-09-20T12:00:00+08:00").getTime();
  window.Date = class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = async () => ({ ok: true, json: async () => holidays });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};

  window.eval(fs.readFileSync("/site/assets/js/plan-core.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-store.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-chart.js", "utf8"));

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
  state = window.PlanCore.recordSession(state, source, { status: "skipped", notes: "出差" });
  state = window.PlanCore.recordSession(state, failureSource, { status: "skipped", notes: "待恢复" });

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));
  await waitForRender();

  const day = window.document.querySelector(`[data-session-id="${source.id}"]`);
  assert(day.getAttribute("aria-label").includes("已跳过"));
  day.click();

  const drawer = window.document.querySelector("[data-plan-drawer]");
  const restore = drawer.querySelector("[data-restore-skipped-session]");
  assert(restore, "a skipped workout should offer cancellation");
  assert.strictEqual(restore.textContent, "取消跳过");
  assert.strictEqual(drawer.querySelector("[data-skip-session]"), null);
  restore.click();
  await waitForRender();

  const stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(stored.state.logs, source.id), false);
  const publicRecord = await memory.loadPublic();
  assert.strictEqual(
    publicRecord.record.snapshot.sessions.find((session) => session.id === source.id).status,
    "planned"
  );
  assert(window.document.querySelector("[data-plan-message]").textContent.includes("训练恢复为计划中"));

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
  await Promise.resolve();
  window.dispatchEvent(new window.Event("offline"));
  assert(
    window.document.querySelector(`[data-session-id="${failureSource.id}"]`)
      .getAttribute("aria-label").includes("计划中"),
    "an intermediate render should reflect the optimistic state"
  );
  rejectSave(new Error("network_down"));
  await waitForRender();
  assert(
    window.document.querySelector(`[data-session-id="${failureSource.id}"]`)
      .getAttribute("aria-label").includes("已跳过"),
    "a failed save must render the restored skipped state"
  );
  const failedStored = await memory.loadPrivate();
  assert.strictEqual(failedStored.version, 1);
  assert.strictEqual(failedStored.state.logs[failureSource.id].status, "skipped");
  assert(window.document.querySelector("[data-plan-message]").textContent.includes("保存失败"));

  console.log("PASS: skipped workout can be restored and rolls back after save failure");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
