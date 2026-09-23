"use strict";

const assert = require("assert");
const core = require("../assets/js/plan-core.js");
const holidays = require("../assets/data/holidays/cn-2026.json");

function fixture() {
  const state = core.createDefaultState("2026-08-03");
  const cycle = state.activeCycle;
  cycle.status = "active";
  cycle.endDate = "2026-11-07";
  cycle.requestedEndDate = "2026-10-31";
  cycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  for (const [key, current, target] of [["bench", 85.5, 100], ["squat", 105.1, 120], ["pullup", 15.6, 20]]) {
    Object.assign(cycle.lifts[key], { current1rm: current, assessed1rm: current, baseline1rm: current, target1rm: target });
  }
  cycle.scheduleAdjustments = [{ fromDate: "2026-09-15", days: 7 }];
  cycle.sessionOverrides[cycle.id + ":pull:2026-09-15"] = { action: "move", date: "2026-09-23", scheduleAdjustmentCount: 1 };
  cycle.sessionOverrides[cycle.id + ":squat:2026-09-16"] = { action: "move", date: "2026-09-24", scheduleAdjustmentCount: 1 };
  const plan = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
  const moved = plan.sessions.find((session) => session.type === "push-volume" && session.date === "2026-09-25");
  state.logs[moved.id] = {
    status: "completed", notes: "keep this original record", mainSets: [],
    sessionSnapshot: { ...moved, date: "2026-09-22", status: "completed" }
  };
  return state;
}

const options = { fromDate: "2026-09-25", endDate: "2026-10-31", trainOnHolidays: true, asOfDate: "2026-09-23" };

(function fixedDeadlineAndHolidayContinuity() {
  const state = fixture();
  const before = JSON.stringify(state);
  const original = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
  const revised = core.replanRemaining(state, [holidays], options);
  const plan = core.generate(revised, [holidays], { asOfDate: "2026-09-23" });
  assert.strictEqual(JSON.stringify(state), before, "replanning must not mutate its input");
  assert.strictEqual(plan.cycle.endDate, options.endDate);
  assert.strictEqual(plan.cycle.requestedEndDate, options.endDate);
  assert.strictEqual(plan.cycle.schedule.shiftDays, 0);
  assert.deepStrictEqual(plan.state.logs, original.state.logs, "all training records remain intact");
  assert.deepStrictEqual(plan.cycle.lifts, original.cycle.lifts, "goals and assessed capacity remain intact");
  assert.deepStrictEqual(plan.cycle.bodyweightEntries, original.cycle.bodyweightEntries);
  for (const date of ["2026-09-25", "2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"]) {
    assert(plan.sessions.some((session) => session.date === date), "training day restored: " + date);
  }
  assert(plan.sessions.every((session) => session.date <= options.endDate));
  for (const week of ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-19", "2026-10-26"]) {
    assert.strictEqual(plan.sessions.filter((session) => session.date >= week && session.date < core.addDays(week, 7)).length, 4, week);
  }
  assert.strictEqual(new Set(plan.sessions.map((session) => session.id)).size, plan.sessions.length);
  assert.strictEqual(new Set(plan.sessions.map((session) => session.date)).size, plan.sessions.length);
  const loggedId = Object.keys(state.logs)[0];
  assert.deepStrictEqual(plan.sessions.find((session) => session.id === loggedId).workout, state.logs[loggedId].sessionSnapshot.workout);
  assert.strictEqual(plan.sessions.find((session) => session.id === loggedId).date, "2026-09-22");
  assert.deepStrictEqual(plan.sessions.filter((session) => session.date < options.fromDate).map((session) => [session.id, session.date]),
    original.sessions.filter((session) => session.date < options.fromDate).map((session) => [session.id, session.date]));
  const targetDates = plan.sessions.filter((session) => /周期目标/.test(session.label)).map((session) => [session.workout.liftKey, session.date]);
  assert.deepStrictEqual(targetDates, [["pullup", "2026-10-27"], ["squat", "2026-10-28"], ["bench", "2026-10-30"]]);
  const planned = plan.sessions.find((session) => session.date === "2026-10-05");
  assert.throws(() => core.adjustSchedule(revised, planned.id, "2026-10-06"), { code: "schedule_deadline_locked" });
  const moved = core.moveSession(revised, planned.id, "2026-10-08", { holidayCalendars: [holidays], asOfDate: "2026-09-23" });
  assert.strictEqual(core.generate(moved, [holidays]).cycle.endDate, options.endDate, "a single move keeps the deadline");
}());

(function recordedFutureAndRepeatedReplan() {
  const state = core.replanRemaining(fixture(), [holidays], options);
  const plan = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
  const completed = plan.sessions.find((session) => session.date === "2026-10-05");
  state.logs[completed.id] = { status: "completed", mainSets: [], sessionSnapshot: completed };
  const again = core.replanRemaining(state, [holidays], options);
  const result = core.generate(again, [holidays], { asOfDate: "2026-10-06" });
  assert.strictEqual(result.sessions.filter((session) => session.date === completed.date).length, 1);
  assert.deepStrictEqual(result.state.logs, state.logs);
  assert.strictEqual(result.cycle.endDate, options.endDate);
  const saved = core.generate(JSON.parse(JSON.stringify(result.state)), [holidays], { asOfDate: "2026-10-06" });
  assert.deepStrictEqual(saved.sessions, result.sessions, "persisting and reloading must keep the same calendar");
  assert.throws(() => core.replanRemaining(state, [holidays], { ...options, endDate: "2026-10-04" }), { code: "replan_recorded_after_deadline" });
}());

(function explicitDaysOffAndCustomTemplate() {
  const state = fixture();
  state.activeCycle.holidayOverrides["2026-10-02"] = "off";
  const template = core.DEFAULT_TEMPLATE.map((item) => ({ ...item, weekday: item.type === "squat" ? 4 : item.weekday }));
  const revised = core.replanRemaining(state, [holidays], { ...options, template });
  const plan = core.generate(revised, [holidays], { asOfDate: "2026-09-23" });
  assert(!plan.sessions.some((session) => session.date === "2026-10-02"), "an explicit rest day takes precedence");
  assert(plan.sessions.some((session) => session.date === "2026-10-08" && session.type === "squat"));
  assert.throws(() => core.replanRemaining(state, [holidays], { ...options, fromDate: "2026-11-01" }), { code: "invalid_replan_dates" });
  assert.throws(() => core.replanRemaining(state, [holidays], { ...options, template: [template[0], template[0]] }), { code: "invalid_replan_template" });
}());

(function retainedPrescriptionsDoNotReceiveAdjustmentsTwice() {
  const state = fixture();
  state.activeCycle.loadAdjustments.bench = { percentage: -0.05, afterDate: "2026-09-18" };
  const before = core.generate(state, [holidays], { asOfDate: options.asOfDate });
  let revised = core.replanRemaining(state, [holidays], options);
  for (let i = 0; i < 2; i += 1) {
    const plan = core.generate(revised, [holidays], { asOfDate: options.asOfDate });
    for (const previous of before.sessions.filter((session) => session.date < options.fromDate)) {
      const retained = plan.sessions.find((session) => session.id === previous.id);
      assert.deepStrictEqual(retained.workout, previous.workout, "retained prescription changed: " + previous.date);
      assert.deepStrictEqual(retained.phase, previous.phase, "retained phase changed: " + previous.date);
    }
    revised = core.replanRemaining(revised, [holidays], options);
  }
}());

(function futureMakeupsCannotMoveIntoRetainedHistory() {
  const state = fixture();
  state.activeCycle.holidayOverrides = { "2026-09-24": "work", "2026-10-02": "off" };
  const revised = core.replanRemaining(state, [holidays], options);
  const plan = core.generate(revised, [holidays], { asOfDate: options.asOfDate });
  assert(plan.sessions.filter((session) => session.id.includes(":replan-"))
    .every((session) => session.date >= options.fromDate));
  assert.strictEqual(plan.sessions.filter((session) => session.date === "2026-09-24").length, 1);
}());

(function aRecordedDeloadResetsBothBenchVariantsAtTheReplanBoundary() {
  const state = fixture();
  const recorded = Object.values(state.logs)[0];
  recorded.sessionSnapshot.phase = { key: "deload", label: "减量周", blockWeek: 3, weekIndex: 7 };
  const revised = core.replanRemaining(state, [holidays], options);
  const plan = core.generate(revised, [holidays], { asOfDate: options.asOfDate });
  for (const date of ["2026-09-25", "2026-09-28"]) {
    assert.strictEqual(plan.sessions.find((session) => session.date === date).phase.key, "load-1",
      "a completed bench deload must not be immediately followed by another deload: " + date);
  }
  assert.deepStrictEqual(plan.state.logs, core.normalizeState(state).logs);
}());

console.log("plan replan tests passed");
