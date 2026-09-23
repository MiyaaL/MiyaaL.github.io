"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 50));
const plain = (value) => JSON.parse(JSON.stringify(value));

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
  const fixedNow = new NativeDate("2026-09-23T12:00:00+08:00").getTime();
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
    state.activeCycle.lifts[key].target1rm = state.activeCycle.lifts[key].current1rm + 5;
  });
  let generated = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
  const completed = generated.sessions.find((session) => session.date === "2026-09-09");
  state = core.recordSession(state, completed, { status: "completed", notes: "保留原始记录" });
  const deferred = generated.sessions.find((session) => session.date === "2026-09-15");
  state = core.adjustSchedule(state, deferred.id, "2026-09-22", { holidayCalendars: [holidays] });
  const before = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
  state = before.state;
  const originalLogs = plain(state.logs);
  const originalTargets = Object.keys(state.activeCycle.lifts).map((key) => state.activeCycle.lifts[key].target1rm);
  assert.strictEqual(state.activeCycle.endDate, "2026-11-07");

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  let replanCalls = 0;
  const replanRemaining = core.replanRemaining;
  core.replanRemaining = (...args) => { replanCalls += 1; return replanRemaining(...args); };
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));
  await waitForRender();

  const document = window.document;
  const settings = document.querySelector("[data-plan-settings]");
  const form = document.querySelector("[data-plan-settings-form]");
  const fields = form.elements;
  const open = () => document.querySelector("[data-plan-edit]").click();
  const submit = async () => {
    form.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
    await waitForRender();
  };
  const changeWeekdays = () => {
    document.querySelectorAll("[data-template-weekday]").forEach((select, index) => {
      select.value = String([1, 2, 4, 6][index]);
    });
  };

  open();
  assert.strictEqual(document.querySelector('[name="scheduleMode"]'), null, "fixed-deadline scheduling needs no mode selection");
  assert.strictEqual(fields.endDate.value, "2026-10-31");
  assert.strictEqual(fields.replanFromDate.value, "2026-09-23");
  assert.strictEqual(fields.trainOnHolidays.value, "yes", "holiday training is the default");
  assert.strictEqual(fields.startDate.readOnly, true);
  assert.strictEqual(fields.replanFromDate.disabled, false);
  fields.replanFromDate.value = "2026-08-31";
  await submit();
  assert.strictEqual((await memory.loadPrivate()).version, 0);
  assert.strictEqual(replanCalls, 1, "existing plans automatically use fixed-deadline replanning");
  assert(document.querySelector("[data-plan-form-error]").textContent.includes("重排起始日期"));
  assert.strictEqual(settings.open, true);

  fields.replanFromDate.value = "2026-09-25";
  changeWeekdays();
  const save = memory.save;
  memory.save = async () => { throw new Error("offline test"); };
  await submit();
  assert.strictEqual((await memory.loadPrivate()).version, 0);
  assert.strictEqual(settings.open, true);
  assert(document.querySelector("[data-plan-form-error]").textContent.includes("当前计划未更改"));
  memory.save = save;

  // Reopening reads the in-memory owner state; a rejected save must not leak into it.
  document.querySelector("[data-plan-cancel-settings]").click();
  open();
  assert.deepStrictEqual(Array.from(document.querySelectorAll("[data-template-weekday]"), (select) => Number(select.value)), [1, 2, 3, 5]);
  let stored = await memory.loadPrivate();
  assert.strictEqual(stored.state.activeCycle.endDate, "2026-11-07");
  assert.strictEqual(stored.state.activeCycle.scheduleAdjustments.length, 1);
  assert(!stored.state.activeCycle.replannedSchedule);
  const beforeReplan = core.generate(stored.state, [holidays], { asOfDate: "2026-09-23" });
  const historicalSessions = (plan) => plain(plan.sessions
    .filter((session) => session.date < "2026-09-25")
    .map((session) => ({ id: session.id, date: session.date, phase: session.phase, workout: session.workout })));

  fields.replanFromDate.value = "2026-09-25";
  assert.strictEqual(fields.trainOnHolidays.value, "yes");
  changeWeekdays();
  document.querySelector("[data-plan-holiday-date]").value = "2026-10-04";
  document.querySelector("[data-plan-holiday-type]").value = "off";
  document.querySelector("[data-plan-add-holiday]").click();
  await submit();
  assert.strictEqual(settings.open, false);
  stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 1);
  assert.strictEqual(stored.state.activeCycle.endDate, "2026-10-31");
  assert.strictEqual(stored.state.activeCycle.requestedEndDate, "2026-10-31");
  assert.strictEqual(stored.state.activeCycle.scheduleAdjustments.length, 0);
  assert.strictEqual(stored.state.activeCycle.holidayOverrides["2026-10-01"], "work");
  assert.strictEqual(stored.state.activeCycle.holidayOverrides["2026-10-04"], "off", "manual rest overrides survive holiday training");
  assert.deepStrictEqual(plain(stored.state.logs), originalLogs);
  assert.deepStrictEqual(Object.keys(stored.state.activeCycle.lifts).map((key) => stored.state.activeCycle.lifts[key].target1rm), originalTargets);
  generated = core.generate(stored.state, [holidays], { asOfDate: "2026-09-23" });
  assert.deepStrictEqual(
    historicalSessions(generated),
    historicalSessions(beforeReplan)
  );
  assert.deepStrictEqual(
    plain(generated.sessions.filter((session) => session.date >= "2026-10-05" && session.date <= "2026-10-11").map((session) => session.date)),
    ["2026-10-05", "2026-10-06", "2026-10-08", "2026-10-10"],
    "the updated four-day template runs through the holiday week"
  );
  assert(generated.sessions.every((session) => session.date <= "2026-10-31"));
  const published = (await memory.loadPublic()).record.snapshot;
  assert.strictEqual(published.cycle.endDate, "2026-10-31");
  assert.deepStrictEqual(plain(published.sessions.map((session) => session.date)), plain(generated.sessions.map((session) => session.date)));

  // A later settings edit that changes only the training time must keep single-session moves.
  const movedSession = generated.sessions.find((session) => session.date === "2026-09-26");
  assert(movedSession);
  document.querySelector(`[data-session-id="${movedSession.id}"]`).click();
  const drawer = document.querySelector("[data-plan-drawer]");
  drawer.querySelector("[data-move-date]").value = "2026-09-27";
  drawer.querySelector("[data-move-session]").click();
  await waitForRender();
  stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(stored.state.activeCycle.sessionOverrides[movedSession.id].date, "2026-09-27");
  const overridesAfterMove = plain(stored.state.activeCycle.sessionOverrides);
  const callsBeforeTimeEdit = replanCalls;
  open();
  fields.trainingTime.value = "20:30";
  await submit();
  stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 3);
  assert.strictEqual(replanCalls, callsBeforeTimeEdit, "time-only edits do not regenerate the remaining schedule");
  assert.strictEqual(stored.state.preferences.trainingTime, "20:30");
  assert.deepStrictEqual(plain(stored.state.activeCycle.sessionOverrides), overridesAfterMove);
  generated = core.generate(stored.state, [holidays], { asOfDate: "2026-09-23" });
  assert.strictEqual(generated.sessions.find((session) => session.id === movedSession.id).date, "2026-09-27");
  assert.strictEqual(stored.state.activeCycle.endDate, "2026-10-31");

  // The fixed-deadline edit is scoped to the existing cycle.
  const callsBeforeNewCycle = replanCalls;
  document.querySelector("[data-plan-new-cycle]").click();
  assert.strictEqual(document.querySelector("[data-plan-settings-replan-from]").hidden, true);
  assert.strictEqual(document.querySelector("[data-plan-settings-replan-holidays]").hidden, true);
  assert.strictEqual(fields.replanFromDate.disabled, true);
  assert.strictEqual(fields.trainOnHolidays.disabled, true);
  fields.startDate.value = "2026-11-01";
  fields.endDate.value = "2026-12-31";
  await submit();
  stored = await memory.loadPrivate();
  assert.strictEqual(replanCalls, callsBeforeNewCycle);
  assert.strictEqual(stored.state.activeCycle.startDate, "2026-11-01");
  assert(!stored.state.activeCycle.replannedSchedule);
  assert.strictEqual(stored.state.archivedCycles[0].cycle.endDate, "2026-10-31");

  console.log("PASS: fixed-deadline replanning is the default, preserves history and later moves, and isolates failed saves");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
