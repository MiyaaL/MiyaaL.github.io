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
  const fixedNow = new NativeDate("2026-10-08T12:00:00+08:00").getTime();
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
  state = core.recordSession(state, completed, { status: "completed", notes: "保留训练记录" });
  const originalLogs = JSON.parse(JSON.stringify(state.logs));

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));
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
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("整体顺延 6 天"));
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("2026年11月6日"));
  assert.strictEqual((await memory.loadPrivate()).version, 0, "preview must not save the adjustment");
  confirm.querySelector("[data-plan-cancel-move]").click();
  assert.strictEqual(confirm.open, false);
  assert.strictEqual((await memory.loadPrivate()).version, 0, "cancel must preserve the stored plan");

  adjust(source.date);
  assert(detailMessage().textContent.includes("训练日期没有变化"), "unchanged dates need visible drawer feedback");
  adjust("2026-09-30");
  assert(detailMessage().textContent.includes("此前最后一场训练"), "date conflicts need visible drawer feedback");
  assert.strictEqual(confirm.open, false);

  adjust("2026-10-08");
  const save = memory.save;
  memory.save = async () => { throw new Error("offline test"); };
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();
  assert(detailMessage().textContent.includes("保存失败"), "save failures must remain visible in the drawer");
  assert.strictEqual(drawer.hidden, false);
  assert.strictEqual((await memory.loadPrivate()).version, 0);
  memory.save = save;

  adjust("2026-10-08");
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("整体顺延 6 天"),
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
  assert(confirm.querySelector("[data-plan-move-confirm-message]").textContent.includes("整体提前 1 天"));
  confirm.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();
  stored = await memory.loadPrivate();
  generated = core.generate(stored.state, [holidays], { asOfDate: "2026-10-08" });
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(generated.cycle.endDate, "2026-11-05");
  assert.strictEqual(generated.sessions.find((session) => session.id === source.id).date, "2026-10-07");
  assert.strictEqual(generated.sessions.length, initial.sessions.length);
  console.log("PASS: whole-plan adjustment confirms, saves and retries fixed-deadline plans with visible feedback");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
