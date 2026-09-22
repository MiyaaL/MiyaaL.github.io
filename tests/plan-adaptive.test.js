"use strict";

const assert = require("assert");
const core = require("../assets/js/plan-core.js");
const holidays = require("../assets/data/holidays/cn-2026.json");

function configured() {
  const state = core.createDefaultState("2026-08-03");
  state.activeCycle.endDate = "2026-10-31";
  state.activeCycle.status = "active";
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  for (const [key, current, target] of [["bench", 80, 100], ["squat", 100, 120], ["pullup", 10, 20]]) {
    Object.assign(state.activeCycle.lifts[key], { baseline1rm: current, current1rm: current, target1rm: target });
  }
  return state;
}

const failures = [];
function check(name, run) {
  try { run(); console.log("PASS:", name); }
  catch (error) { failures.push(name); console.error("FAIL:", name, error.message); }
}

check("saving or editing the same workout does not count it twice", () => {
  const state = configured();
  const session = core.generate(state, [holidays]).sessions[0];
  const log = { mainSets: [{ weight: 80, reps: 1, rpe: 8, completed: true }] };
  const once = core.recordSession(state, session, log);
  const twice = core.recordSession(once, session, Object.assign({}, log, { notes: "edited note" }));
  assert.strictEqual(twice.activeCycle.lifts.bench.current1rm, once.activeCycle.lifts.bench.current1rm);
});

check("deload and missing RPE do not lower the strength estimate", () => {
  const state = configured();
  const session = core.generate(state, [holidays]).sessions.find(x => x.date === "2026-08-24");
  const next = core.recordSession(state, session, { mainSets: [{ weight: 50, reps: 5, rpe: 6, completed: true }] });
  assert.strictEqual(next.activeCycle.lifts.bench.current1rm, 80);
  const first = core.generate(state, [holidays]).sessions[0];
  assert.strictEqual(core.recordSession(state, first, { mainSets: [{ weight: 60, reps: 1, rpe: null }] }).activeCycle.lifts.bench.current1rm, 80);
});

check("calendar progress alone never increases prescribed capacity", () => {
  const plan = core.generate(configured(), [holidays]);
  const future = plan.sessions.find(x => x.date === "2026-09-14");
  assert.strictEqual(future.workout.planned1rm, 80);
  assert(future.workout.workSets[0].loadKg < 80);
});

check("an aggressive goal can extend beyond the two-week tolerance", () => {
  const state = configured();
  const plan = core.generate(state, [holidays], { asOfDate: "2026-09-09" });
  assert.strictEqual(plan.cycle.requestedEndDate, "2026-10-31");
  assert(plan.cycle.endDate > "2026-11-14");
  assert(plan.cycle.schedule.reason);
  assert.strictEqual(state.activeCycle.endDate, "2026-10-31", "generation must not mutate its input");
  assert.strictEqual(core.generate(plan.state, [holidays], { asOfDate: "2026-09-09" }).cycle.endDate, plan.cycle.endDate);
});

check("reliable readiness may advance the end by at most two weeks", () => {
  let state = configured();
  const initial = core.generate(state, [holidays]);
  for (const [date, weight] of [["2026-09-07", 95], ["2026-09-14", 95], ["2026-09-09", 115], ["2026-09-16", 115]]) {
    state = core.recordSession(state, initial.sessions.find(x => x.date === date), {
      mainSets: [{ weight, reps: 1, rpe: 8, completed: true }]
    });
  }
  const plan = core.generate(state, [holidays], { asOfDate: "2026-09-16" });
  assert.strictEqual(plan.cycle.endDate, "2026-10-17");
  assert.deepStrictEqual(plan.cycle.priorities, ["bench", "squat"]);
});

check("holiday return reduces intensity and does not test immediately", () => {
  const plan = core.generate(configured(), [holidays]);
  const session = plan.sessions.find(x => x.date === "2026-10-14");
  assert.strictEqual(session.phase.key, "return");
  assert(session.workout.workSets[0].loadKg <= 75);
  assert(!session.isTest);
});

check("deload reduces accessories and includes a second light squat exposure", () => {
  const plan = core.generate(configured(), [holidays]);
  const regular = plan.sessions.find(x => x.date === "2026-08-03");
  const light = plan.sessions.find(x => x.date === "2026-08-24");
  assert(light.workout.accessories.reduce((sum, x) => sum + x.sets, 0) <= regular.workout.accessories.reduce((sum, x) => sum + x.sets, 0) / 2);
  assert(light.workout.accessories.every(x => x.rpe <= 6));
  assert(plan.sessions.find(x => x.date === "2026-08-07").workout.accessories.some(x => x.liftKey === "squat"));
});

check("RPE compares every set with its own prescription", () => {
  const state = configured();
  const session = core.generate(state, [holidays]).sessions[0];
  const mainSets = session.workout.workSets.flatMap((set, index) => Array.from({ length: set.sets }, () => ({
    weight: set.loadKg, reps: set.reps, rpe: index ? set.rpe + 0.5 : set.rpe, completed: true
  })));
  const next = core.recordSession(state, session, { mainSets });
  assert.strictEqual(next.activeCycle.loadAdjustments.bench.percentage, 0);
});

check("accessories require all sets and controlled effort before increasing", () => {
  const state = configured();
  const first = core.generate(state, [holidays]).sessions.find(x => x.type === "pull");
  const next = core.recordSession(state, first, { accessories: [{ name: "哑铃弯举", weight: 10, reps: 12, completed: true }] });
  const following = core.generate(next, [holidays]).sessions.find(x => x.type === "pull" && x.date > first.date);
  assert.strictEqual(following.workout.accessories.find(x => x.name === "哑铃弯举").loadKg, 10);
});

check("ordinary dates remain stable and non-priority goals do not delay them", () => {
  const state = configured();
  state.activeCycle.lifts.bench.target1rm = 84;
  state.activeCycle.lifts.squat.target1rm = 105;
  state.activeCycle.lifts.pullup.target1rm = 150;
  const plan = core.generate(state, [holidays], { asOfDate: "2026-08-03" });
  assert.strictEqual(plan.cycle.endDate, "2026-10-31");
  state.activeCycle.priorities = ["pullup"];
  assert(core.generate(state, [holidays]).cycle.endDate > plan.cycle.endDate);
});

check("removing the only measurement restores its fixed baseline", () => {
  let state = configured();
  const session = core.generate(state, [holidays]).sessions[0];
  state = core.recordSession(state, session, { mainSets: [{ weight: 90, reps: 1, rpe: 8 }] });
  assert(state.activeCycle.lifts.bench.current1rm > 80);
  state = core.recordSession(state, session, { mainSets: [{ weight: 90, reps: 1, rpe: null }] });
  assert.strictEqual(state.activeCycle.lifts.bench.current1rm, 80);
  assert.strictEqual(state.activeCycle.loadAdjustments.bench.percentage, 0);
});

check("valid readiness schedules conditional attempts; failure revokes them", () => {
  let state = configured();
  state.activeCycle.requestedEndDate = "2026-10-03";
  const original = core.generate(state, [holidays]);
  for (const [date, weight] of [["2026-09-07", 95], ["2026-09-14", 95], ["2026-09-09", 115], ["2026-09-16", 115]]) {
    state = core.recordSession(state, original.sessions.find(x => x.date === date), {
      mainSets: [{ weight, reps: 1, rpe: 8, completed: true }]
    });
  }
  const plan = core.generate(state, [holidays], { asOfDate: "2026-09-16" });
  const test = plan.sessions.find(x => x.isTest && x.type === "push-strength");
  assert(test);
  assert.deepStrictEqual(test.workout.workSets.map(x => x.loadKg), [90, 95, 100]);
  assert.strictEqual(test.workout.accessories.length, 0);
  const failedSession = original.sessions.find(x => x.date === "2026-09-18");
  state = core.recordSession(state, failedSession, { mainSets: [{ weight: 90, reps: 0, rpe: 10, completed: false }] });
  assert(!core.generate(state, [holidays], { asOfDate: "2026-09-18" }).sessions.some(x => x.isTest && x.type === "push-strength"));
});

check("editing a measurement is independent of input order", () => {
  let forward = configured(), reverse = configured();
  const sessions = core.generate(forward, [holidays]).sessions;
  const entries = [["2026-08-03", 77.5], ["2026-08-10", 80], ["2026-08-17", 82.5]];
  for (const [date, weight] of entries) forward = core.recordSession(forward, sessions.find(x => x.date === date), { mainSets: [{ weight, reps: 1, rpe: 8 }] });
  for (const [date, weight] of entries.slice().reverse()) reverse = core.recordSession(reverse, sessions.find(x => x.date === date), { mainSets: [{ weight, reps: 1, rpe: 8 }] });
  assert.strictEqual(forward.activeCycle.lifts.bench.current1rm, reverse.activeCycle.lifts.bench.current1rm);
  const history = JSON.stringify(forward.logs);
  const plan = core.generate(forward, [holidays], { asOfDate: "2026-09-09" });
  assert.strictEqual(JSON.stringify(plan.state.logs), history);
  const snapshot = core.createPublicSnapshot(plan.state, plan);
  assert.strictEqual(snapshot.cycle.endDate, plan.cycle.endDate);
  assert.strictEqual(snapshot.cycle.requestedEndDate, "2026-10-31");
  assert(!JSON.stringify(snapshot).includes("mainSets"));
  assert(!JSON.stringify(snapshot).includes("bodyweightEntries"));
});

check("a bodyweight-only pullup maximum is a valid starting point", () => {
  const state = configured();
  state.activeCycle.lifts.pullup.current1rm = 0;
  const pull = core.generate(state, [holidays]).sessions.find(x => x.type === "pull");
  assert.strictEqual(pull.workout.needsSetup, false);
  assert(pull.workout.workSets.every(x => Number.isFinite(x.loadKg)));
});

check("legacy deferrals recover the original requested end exactly once", () => {
  const state = core.createDefaultState("2026-09-01");
  state.schemaVersion = 2;
  state.activeCycle.endDate = "2026-11-07";
  delete state.activeCycle.requestedEndDate;
  delete state.activeCycle.scheduleAdjustments;
  state.activeCycle.scheduleDeferrals = [{
    id: "legacy-deferral",
    sourceId: "legacy-session",
    fromDate: "2026-09-15",
    days: 7
  }];

  const normalized = core.normalizeState(state);
  const plan = core.generate(normalized, [holidays], { asOfDate: "2026-09-01" });
  assert.strictEqual(normalized.schemaVersion, 3);
  assert.strictEqual(normalized.activeCycle.requestedEndDate, "2026-10-31");
  assert.strictEqual(normalized.activeCycle.scheduleAdjustments.length, 1);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(normalized.activeCycle, "scheduleDeferrals"), false);
  assert.strictEqual(normalized.activeCycle.lifts.bench.current1rm, null);
  assert.strictEqual(normalized.activeCycle.lifts.bench.assessed1rm, undefined);
  assert.strictEqual(plan.cycle.endDate, "2026-11-07");
});

check("assisted pullups with negative extra load update measured capacity", () => {
  const state = configured();
  const pull = core.generate(state, [holidays]).sessions.find(x => x.type === "pull");
  const next = core.recordSession(state, pull, {
    mainSets: [{ weight: -15, reps: 1, rpe: 8, completed: true }]
  });
  assert(next.activeCycle.lifts.pullup.current1rm < 10);
  assert.strictEqual(next.logs[pull.id].mainSets[0].rpeSource, "actual");
});

check("legacy target RPE values are not reinterpreted as actual measurements", () => {
  const state = configured();
  const session = core.generate(state, [holidays]).sessions[0];
  state.schemaVersion = 2;
  state.activeCycle.lifts.bench.current1rm = 90;
  delete state.activeCycle.lifts.bench.assessed1rm;
  state.logs[session.id] = {
    status: "completed",
    completedAt: "2026-08-03T12:00:00.000Z",
    mainSets: [{ weight: 100, reps: 1, rpe: 8, completed: true }],
    accessories: [],
    notes: "legacy auto-filled target RPE",
    sessionSnapshot: session
  };

  const plan = core.generate(state, [holidays], { asOfDate: "2026-08-03" });
  assert.strictEqual(plan.state.activeCycle.lifts.bench.assessed1rm, 90);
  assert.strictEqual(plan.state.activeCycle.lifts.bench.current1rm, 90);
});

check("an unconfigured selected priority prevents an early finish", () => {
  let state = configured();
  state.activeCycle.lifts.pullup.current1rm = null;
  state.activeCycle.lifts.pullup.target1rm = null;
  state.activeCycle.priorities = ["bench", "squat", "pullup"];
  const initial = core.generate(state, [holidays]);
  for (const [date, weight] of [["2026-09-07", 95], ["2026-09-14", 95], ["2026-09-09", 115], ["2026-09-16", 115]]) {
    state = core.recordSession(state, initial.sessions.find(x => x.date === date), {
      mainSets: [{ weight, reps: 1, rpe: 8, completed: true }]
    });
  }
  const plan = core.generate(state, [holidays], { asOfDate: "2026-09-16" });
  assert.strictEqual(plan.cycle.endDate, "2026-10-31");
  assert.strictEqual(plan.cycle.schedule.readiness.pullup, false);
  assert.strictEqual(plan.cycle.schedule.provisional, true);
});

check("moving an adaptively extended tail session uses the same planning date", () => {
  const state = configured();
  const plan = core.generate(state, [holidays], { asOfDate: "2026-09-09" });
  const source = plan.sessions[plan.sessions.length - 1];
  assert(source.date > state.activeCycle.endDate);
  const occupied = new Set(plan.sessions.map(session => session.date));
  const candidates = [core.addDays(source.date, 1), core.addDays(source.date, -1)];
  const targetDate = candidates.find(date => date <= plan.cycle.endDate && !occupied.has(date));
  assert(targetDate);

  const moved = core.moveSession(state, source.id, targetDate, {
    holidayCalendars: [holidays],
    asOfDate: "2026-09-09"
  });
  const movedPlan = core.generate(moved, [holidays], { asOfDate: "2026-09-09" });
  assert.strictEqual(movedPlan.sessions.find(session => session.id === source.id).date, targetDate);
});

if (failures.length) process.exitCode = 1;
