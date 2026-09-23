"use strict";

const assert = require("assert");
const core = require("../assets/js/plan-core.js");
const holidays = require("../assets/data/holidays/cn-2026.json");

function configured() {
  const state = core.createDefaultState("2026-08-03");
  Object.assign(state.activeCycle, {
    status: "active", endDate: "2026-10-31", requestedEndDate: "2026-10-31"
  });
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  for (const [key, baseline, current, target] of [
    ["bench", 80, 85.5, 100], ["squat", 100, 105.1, 120], ["pullup", 10, 15.6, 20]
  ]) {
    Object.assign(state.activeCycle.lifts[key], {
      baseline1rm: baseline, current1rm: current, assessed1rm: current, target1rm: target
    });
  }
  return state;
}

(function currentMeasurementsDoNotRewriteTheLinearTrajectory() {
  const state = configured();
  const expected = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
  const measured = core.normalizeState(state);
  Object.assign(measured.activeCycle.lifts.bench, { current1rm: 70, assessed1rm: 70 });
  Object.assign(measured.activeCycle.lifts.squat, { current1rm: 130, assessed1rm: 130 });
  measured.activeCycle.loadAdjustments.bench = { percentage: -0.05, afterDate: "2026-08-01" };
  const actual = core.generate(measured, [holidays], { asOfDate: "2026-09-23" });
  assert.deepStrictEqual(actual.sessions.map(session => session.workout), expected.sessions.map(session => session.workout),
    "measured capacity and legacy RPE adjustments must not replace the fixed linear trajectory");
  assert.strictEqual(actual.state.activeCycle.lifts.bench.current1rm, 70);
  assert.strictEqual(actual.state.activeCycle.lifts.squat.current1rm, 130);
  assert.strictEqual(actual.cycle.lifts.bench.target1rm, 100);
  assert.strictEqual(state.activeCycle.lifts.bench.baseline1rm, 80);
}());

(function movedSchedulesKeepOnlyTheWeeklyWaveAndFinalGoalAttempts() {
  const state = configured();
  state.activeCycle.scheduleAdjustments = [{ fromDate: "2026-09-15", days: 7 }];
  const plan = core.generate(state, [], { asOfDate: "2026-09-23" });
  assert.strictEqual(plan.cycle.requestedEndDate, "2026-10-31");
  assert.strictEqual(plan.cycle.endDate, "2026-11-07");
  assert(plan.sessions.every(session => session.date <= plan.cycle.endDate));
  const allowed = new Set(["load-1", "load-2", "load-3", "deload", "test"]);
  for (const session of plan.sessions) {
    assert(allowed.has(session.phase.key), session.date + " has an unexpected training phase");
    if (session.phase.key === "test") continue;
    assert.strictEqual(session.phase.key, session.phase.blockWeek === 3 ? "deload" : "load-" + (session.phase.blockWeek + 1));
  }
  for (const liftKey of ["bench", "pullup", "squat"]) {
    const sessions = plan.sessions.filter(session => session.workout.liftKey === liftKey);
    assert.strictEqual(sessions[sessions.length - 1].phase.key, "test");
    assert.strictEqual(sessions.filter(session => session.phase.key === "test").length, 1);
  }
  assert.deepStrictEqual(core.generate(plan.state, [], { asOfDate: "2026-11-06" }).sessions, plan.sessions,
    "reaching the test date must not insert a taper or substitute a light assessment");
}());

(function actualRpeRemainsRequiredForStrengthStatistics() {
  const state = configured();
  const plan = core.generate(state, [], { asOfDate: "2026-09-23" });
  let recorded = state;
  for (const date of ["2026-09-07", "2026-09-14"]) {
    const session = plan.sessions.find(candidate => candidate.date === date);
    assert(/^load-/.test(session.phase.key));
    recorded = core.recordSession(recorded, session, {
      mainSets: [{ weight: 95, reps: 1, rpe: 8, completed: true }]
    });
  }
  const measured = core.generate(recorded, [], { asOfDate: "2026-09-23" });
  assert(measured.state.activeCycle.lifts.bench.current1rm > 85.5);

  for (const invalid of ["missing", "planned", "too-light"]) {
    const untrusted = core.normalizeState(recorded);
    for (const log of Object.values(untrusted.logs)) {
      if (invalid === "missing") log.mainSets[0].rpe = null;
      if (invalid === "planned") log.mainSets[0].rpeSource = "target";
      if (invalid === "too-light") log.mainSets[0].rpe = 6;
    }
    const result = core.generate(untrusted, [], { asOfDate: "2026-09-23" });
    assert.strictEqual(result.state.activeCycle.lifts.bench.current1rm, 85.5);
    assert.deepStrictEqual(result.state.logs, untrusted.logs, "generation retains the original measurement records");
    assert.strictEqual(result.sessions.find(session => session.date === "2026-10-30").phase.key, "test");
  }
}());

console.log("PASS: fixed prescription trajectory, weekly phases, and actual RPE statistics");
