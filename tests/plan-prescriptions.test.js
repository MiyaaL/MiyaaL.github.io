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

(function goalsDoNotInflateWorkOrRecoveryLoads() {
  const state = configured();
  const expected = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
  const ambitious = core.normalizeState(state);
  Object.values(ambitious.activeCycle.lifts).forEach(lift => { lift.target1rm *= 2; });
  const actual = core.generate(ambitious, [holidays], { asOfDate: "2026-09-23" });
  const phases = new Set();
  for (const session of actual.sessions) {
    if (["test", "assessment"].includes(session.phase.key)) continue;
    phases.add(session.phase.key);
    const original = expected.sessions.find(candidate => candidate.id === session.id);
    assert.deepStrictEqual(session.workout.workSets, original.workout.workSets,
      "raising a goal must not raise an ordinary, taper, deload, or return prescription");
    assert.strictEqual(session.workout.planned1rm,
      state.activeCycle.lifts[session.workout.liftKey].current1rm);
  }
  for (const phase of ["load-1", "load-2", "load-3", "taper", "deload", "return"]) {
    assert(phases.has(phase), "fixture must exercise " + phase);
  }
  assert.strictEqual(actual.cycle.endDate, "2026-10-31");
}());

(function reducedMeasuredCapacityOverridesAnOlderHigherBaseline() {
  const state = configured();
  Object.assign(state.activeCycle.lifts.bench, { current1rm: 70, assessed1rm: 70 });
  const plan = core.generate(state, [], { asOfDate: "2026-09-23" });
  const bench = plan.sessions.filter(session => session.workout.liftKey === "bench" && session.phase.key !== "test");
  assert(bench.length);
  assert(bench.every(session => session.workout.planned1rm === 70));
  assert.strictEqual(state.activeCycle.lifts.bench.baseline1rm, 80);
}());

(function taperFollowsEachActualFinalSessionDate() {
  const state = configured();
  state.activeCycle.scheduleAdjustments = [{ fromDate: "2026-09-15", days: 7 }];
  const plan = core.generate(state, [], { asOfDate: "2026-09-23" });
  for (const liftKey of ["bench", "pullup", "squat"]) {
    const sessions = plan.sessions.filter(session => session.workout.liftKey === liftKey);
    const finalDate = sessions[sessions.length - 1].date;
    const taper = sessions.filter(session => session.phase.key === "taper");
    assert(taper.length, liftKey + " must retain a taper exposure");
    assert(taper.every(session => core.daysBetween(session.date, finalDate) <= 7));
    assert(sessions.filter(session => core.daysBetween(session.date, finalDate) > 7)
      .every(session => session.phase.key !== "taper"));
  }
  // The preceding full training week remains available even after a manual shift.
  assert.notStrictEqual(plan.sessions.find(session => session.date === "2026-10-21").phase.key, "taper");
}());

(function actualTaperCalibrationCanConfirmReadiness() {
  const state = configured();
  const plan = core.generate(state, [], { asOfDate: "2026-09-23" });
  let recorded = state;
  for (const date of ["2026-10-23", "2026-10-26"]) {
    const session = plan.sessions.find(candidate => candidate.date === date);
    assert.strictEqual(session.phase.key, "taper");
    recorded = core.recordSession(recorded, session, {
      mainSets: [{ weight: 95, reps: 1, rpe: 8, completed: true }]
    });
  }
  const confirmed = core.generate(recorded, [], { asOfDate: "2026-10-26" });
  assert(confirmed.sessions.find(session => session.date === "2026-10-30").isTest);

  for (const invalid of ["missing", "planned", "too-light"]) {
    const untrusted = core.normalizeState(recorded);
    for (const log of Object.values(untrusted.logs)) {
      if (invalid === "missing") log.mainSets[0].rpe = null;
      if (invalid === "planned") log.mainSets[0].rpeSource = "target";
      if (invalid === "too-light") log.mainSets[0].rpe = 6;
    }
    const result = core.generate(untrusted, [], { asOfDate: "2026-10-26" });
    assert.strictEqual(result.state.activeCycle.lifts.bench.current1rm, 85.5);
    assert.strictEqual(result.sessions.find(session => session.date === "2026-10-30").phase.key, "assessment");
  }
}());

console.log("PASS: measured training loads, actual-date taper, and taper readiness evidence");
