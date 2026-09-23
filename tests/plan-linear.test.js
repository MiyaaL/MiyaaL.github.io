"use strict";

const assert = require("assert");
const core = require("../assets/js/plan-core.js");
const holidays = require("../assets/data/holidays/cn-2026.json");
const asOfDate = "2026-09-23";

function fixture() {
  const state = core.createDefaultState("2026-08-03");
  const cycle = state.activeCycle;
  cycle.status = "active";
  cycle.requestedEndDate = cycle.endDate = "2026-10-31";
  cycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  for (const [key, current, target] of [["bench", 85.5, 100], ["squat", 105.1, 120], ["pullup", 15.6, 20]]) {
    Object.assign(cycle.lifts[key], { current1rm: current, assessed1rm: current, baseline1rm: current, target1rm: target });
  }
  const revised = core.replanRemaining(state, [holidays], {
    fromDate: "2026-09-25", endDate: "2026-10-31", trainOnHolidays: true, asOfDate
  });
  revised.activeCycle.progression = {
    kind: "linear-wave", anchorDate: "2026-09-28",
    anchor1rm: { bench: 85.5, squat: 105.1, pullup: 15.6 }
  };
  return revised;
}

function mainSet(session) {
  return session.workout.workSets.find((set) => set.sets > 1);
}

function sessionAt(plan, date) {
  const session = plan.sessions.find((candidate) => candidate.date === date);
  assert(session, "missing session on " + date);
  return session;
}

(function calendarWeeksAreSharedAcrossAllLifts() {
  const plan = core.generate(fixture(), [holidays], { asOfDate });
  assert.strictEqual(sessionAt(plan, "2026-09-25").phase.key, "deload");
  for (const [start, expected] of [["2026-09-28", "load-1"], ["2026-10-05", "load-2"], ["2026-10-12", "load-3"], ["2026-10-19", "deload"]]) {
    const sessions = plan.sessions.filter((session) => session.date >= start && session.date < core.addDays(start, 7));
    assert.strictEqual(sessions.length, 4, "four weekly sessions, including holidays");
    assert(sessions.every((session) => session.phase.key === expected), start + " must have one shared phase");
  }
  const future = plan.sessions.filter((session) => session.date >= "2026-09-25");
  assert(future.every((session) => session.date <= "2026-10-31"));
  assert.deepStrictEqual(future.filter((session) => session.phase.key === "deload").map((session) => session.date),
    ["2026-09-25", "2026-10-19", "2026-10-20", "2026-10-21", "2026-10-23"]);
  assert(future.every((session) => !["return", "taper", "assessment"].includes(session.phase.key)));
}());

(function progressiveWeightsAndOneValleyAreExplicit() {
  const state = fixture();
  const before = JSON.stringify(state);
  const plan = core.generate(state, [holidays], { asOfDate });
  assert.strictEqual(JSON.stringify(state), before, "generation must not mutate its input");
  assert.deepStrictEqual(plan.cycle.lifts, state.activeCycle.lifts, "calendar progress is not measured strength");
  const bench = ["2026-09-28", "2026-10-05", "2026-10-12"].map((date) => sessionAt(plan, date));
  assert.deepStrictEqual(bench.map((session) => mainSet(session).loadKg), [67.5, 72.5, 80]);
  assert.deepStrictEqual(bench.map((session) => [mainSet(session).sets, mainSet(session).reps]), [[4, 5], [4, 4], [4, 3]]);
  for (const dates of [["2026-09-29", "2026-10-06", "2026-10-13"], ["2026-09-30", "2026-10-07", "2026-10-14"], ["2026-10-02", "2026-10-09", "2026-10-16"]]) {
    const loads = dates.map((date) => mainSet(sessionAt(plan, date)).loadKg);
    assert(loads[1] > loads[0] && loads[2] > loads[1], "weekly peaks must increase: " + dates);
  }
  assert.strictEqual(sessionAt(plan, "2026-10-19").workout.workSets[0].loadKg, 60);
  assert.strictEqual(sessionAt(plan, "2026-10-20").workout.workSets[0].reps, 4);
  assert.strictEqual(sessionAt(plan, "2026-10-20").workout.workSets[0].percentage, 0.7);
  assert.strictEqual(sessionAt(plan, "2026-10-26").workout.planned1rm, 100);
  assert.strictEqual(mainSet(sessionAt(plan, "2026-10-26")).loadKg, 80, "test week does not add another reduction");
  assert.deepStrictEqual(plan.sessions.filter((session) => session.isTest).map((session) => [session.workout.liftKey, session.date]),
    [["pullup", "2026-10-27"], ["squat", "2026-10-28"], ["bench", "2026-10-30"]]);
  const again = core.generate(JSON.parse(JSON.stringify(plan.state)), [holidays], { asOfDate });
  assert.deepStrictEqual(again.sessions, plan.sessions, "reloads must reproduce the same calendar");
}());

(function nonMaximalTopSetsPrecedeTheUnchangedMainWorkOnlyOnLoadingStrengthDays() {
  const plan = core.generate(fixture(), [holidays], { asOfDate });
  const sessions = plan.sessions.filter((session) => session.date >= "2026-09-25");
  for (const session of sessions) {
    const sets = session.workout.workSets;
    const needsTop = /^load-/.test(session.phase.key) && session.type !== "push-volume";
    assert.strictEqual(sets.filter((set) => set.label === "非极限顶组").length, needsTop ? 1 : 0,
      session.date + " top-set eligibility");
    if (needsTop) {
      const top = sets[0];
      assert.strictEqual(sets.length, 2);
      assert.deepStrictEqual([top.label, top.sets, top.reps, top.rpe, top.percentage], ["非极限顶组", 1, 1, 8, 0.9]);
      assert.strictEqual(sets[1].label, "主训练组");
      assert(top.loadKg >= sets[1].loadKg, "the top set must not be lighter than the main work");
      assert(session.workout.warmups.every((set) => set.loadKg < top.loadKg));
    }
    if (session.phase.key === "test") assert(session.workout.guidance);
    else assert.strictEqual(session.workout.guidance, undefined, "routine sessions omit the removed explanatory paragraph");
  }
  const benchDates = ["2026-09-28", "2026-10-05", "2026-10-12", "2026-10-26"];
  assert.deepStrictEqual(benchDates.map((date) => sessionAt(plan, date).workout.workSets[0].loadKg), [77.5, 80, 82.5, 90]);
  assert.deepStrictEqual(["2026-09-30", "2026-10-07", "2026-10-14"].map((date) => sessionAt(plan, date).workout.workSets[0].loadKg), [95, 97.5, 102.5]);
  assert.deepStrictEqual(["2026-09-29", "2026-10-06", "2026-10-13"].map((date) => sessionAt(plan, date).workout.workSets[0].loadKg), [7.5, 7.5, 10],
    "pull-up percentages apply to bodyweight plus added load");
  const benchWarmups = sessionAt(plan, "2026-09-28").workout.warmups;
  assert.strictEqual(benchWarmups[benchWarmups.length - 1].loadKg, 72.5, "warmups build toward the top set, not the lighter main work");
}());

(function sparseLogsAndActualRpeNeverRestartOrAutomaticallyUnloadThePlan() {
  let state = fixture();
  const initial = core.generate(state, [holidays], { asOfDate });
  const completed = JSON.parse(JSON.stringify(sessionAt(initial, "2026-09-14")));
  completed.workout.workSets = completed.workout.workSets.filter((set) => set.label !== "非极限顶组");
  completed.workout.guidance = "旧处方说明";
  state = core.recordSession(state, completed, { status: "completed", mainSets: [{ weight: 85, reps: 1, rpe: 10 }] });
  state.activeCycle.loadAdjustments.bench = { percentage: -0.05, afterDate: "2026-09-14" };
  const logs = JSON.stringify(state.logs);
  const plan = core.generate(state, [holidays], { asOfDate });
  assert.strictEqual(JSON.stringify(plan.state.logs), logs, "recorded sets remain intact");
  assert.deepStrictEqual(sessionAt(plan, "2026-09-14").workout, completed.workout, "legacy completed prescriptions are preserved without adding a top set or deleting their stored guidance");
  assert.deepStrictEqual(sessionAt(plan, "2026-09-28").workout, sessionAt(initial, "2026-09-28").workout,
    "sparse logs and legacy RPE adjustments cannot alter the prescribed wave");
  const next = sessionAt(plan, "2026-09-28");
  const recorded = core.recordSession(plan.state, next, { mainSets: [{ weight: 67.5, reps: 4, rpe: 10, completed: false }] });
  assert.deepStrictEqual(recorded.activeCycle.loadAdjustments, plan.state.activeCycle.loadAdjustments, "recording must not create an automatic load adjustment");
  const after = core.generate(recorded, [holidays], { asOfDate: "2026-09-29" });
  assert.deepStrictEqual(sessionAt(after, "2026-10-05").workout, sessionAt(initial, "2026-10-05").workout);
}());

(function daysPassingNeverDowngradeTheLastTargetAttempt() {
  const state = fixture();
  const before = core.generate(state, [holidays], { asOfDate });
  const after = core.generate(state, [holidays], { asOfDate: "2026-10-26" });
  for (const date of ["2026-10-27", "2026-10-28", "2026-10-30"]) {
    assert.strictEqual(sessionAt(after, date).phase.key, "test");
    assert.deepStrictEqual(sessionAt(after, date).workout, sessionAt(before, date).workout);
  }
}());

(function theDefaultPlanAlsoUsesTheSingleLinearRule() {
  const state = fixture();
  delete state.activeCycle.progression;
  delete state.activeCycle.replannedSchedule;
  state.activeCycle.startDate = "2026-09-28";
  const plan = core.generate(state, [holidays], { asOfDate });
  assert.strictEqual(mainSet(sessionAt(plan, "2026-09-28")).loadKg, 67.5);
  assert.strictEqual(sessionAt(plan, "2026-10-19").phase.key, "deload");
}());

console.log("plan linear wave tests passed");
