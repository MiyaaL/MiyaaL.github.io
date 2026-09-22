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
  state = window.PlanCore.recordSession(state, source, { status: "skipped", notes: "出差" });

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));
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
  assert(confirm.querySelector("[data-plan-move-confirm-title]").textContent.includes("提前"));
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("整体提前 1 天"));
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();

  stored = await memory.loadPrivate();
  generated = window.PlanCore.generate(stored.state, [holidays], { asOfDate: "2026-09-20" });
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(stored.state.activeCycle.scheduleAdjustments.length, 2);
  assert.strictEqual(stored.state.activeCycle.scheduleAdjustments.map((entry) => entry.days).join(","), "7,-1");
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).date, "2026-09-21");

  console.log("PASS: a workout can defer and then advance the remaining plan");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
