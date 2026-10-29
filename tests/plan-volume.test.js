"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../assets/js/plan-core.js");

const moderateVolume = "moderate-volume-v1";
const asOfDate = "2026-10-29";
const clone = (value) => JSON.parse(JSON.stringify(value));
const generate = (state) => core.generate(state, [], { asOfDate });

function fixture(prescription = moderateVolume) {
  const state = core.createDefaultState("2026-11-02");
  Object.assign(state.activeCycle, {
    status: "active",
    endDate: "2027-01-29",
    requestedEndDate: "2027-01-29"
  });
  if (prescription === null) delete state.activeCycle.volumePrescription;
  else state.activeCycle.volumePrescription = prescription;
  state.activeCycle.bodyweightEntries = [{ date: "2026-11-02", value: 70 }];
  for (const [key, current, target] of [["bench", 90, 100], ["squat", 110, 120], ["pullup", 15, 20]]) {
    Object.assign(state.activeCycle.lifts[key], {
      current1rm: current, assessed1rm: current, baseline1rm: current, target1rm: target
    });
  }
  return state;
}

function sessionAt(plan, date) {
  const session = plan.sessions.find((candidate) => candidate.date === date);
  assert(session, "missing session on " + date);
  return session;
}

function firstLoadingWeeks(plan, type) {
  return plan.sessions.filter((session) => session.type === type && /^load-/.test(session.phase.key)).slice(0, 3);
}

test("new cycles opt in while existing cycles without a marker retain their prescription", () => {
  assert.equal(core.MODERATE_VOLUME_PRESCRIPTION, moderateVolume);
  assert.equal(core.createDefaultState("2026-11-02").activeCycle.volumePrescription, moderateVolume);
  assert.equal(core.normalizeState().activeCycle.volumePrescription, moderateVolume);
  for (const marker of [null, "legacy", "unknown-future-scheme"]) {
    const state = fixture(marker);
    const before = clone(state);
    const normalized = core.normalizeState(state);
    assert.equal(normalized.activeCycle.volumePrescription, "legacy");
    assert.deepEqual(state, before, "normalization must not mutate stored input");
    assert.deepEqual(core.normalizeState(normalized), normalized, "normalization must be idempotent");
  }
  assert.equal(core.normalizeState(fixture()).activeCycle.volumePrescription, moderateVolume);
  const invalidDate = fixture();
  invalidDate.activeCycle.volumePrescriptionFromDate = "not-a-date";
  assert.equal(Object.hasOwn(core.normalizeState(invalidDate).activeCycle, "volumePrescriptionFromDate"), false);
});

test("moderate volume separates bench and squat loading prescriptions from legacy volume", () => {
  const state = fixture();
  const before = clone(state);
  const plan = generate(state);
  const legacy = generate(fixture(null));
  const bench = firstLoadingWeeks(plan, "push-volume");
  const squat = firstLoadingWeeks(plan, "squat-volume");
  assert.deepEqual(bench.map((session) => {
    const set = session.workout.workSets[0];
    return [set.sets, set.reps, set.percentage];
  }), [[4, 10, 0.65], [4, 9, 0.675], [4, 8, 0.7]]);
  assert.deepEqual(squat.map((session) => {
    const set = session.workout.workSets[0];
    return [set.sets, set.reps, set.percentage];
  }), [[3, 8, 0.675], [3, 8, 0.7], [3, 8, 0.7]]);
  for (const session of bench.concat(squat)) {
    const old = legacy.sessions.find((candidate) => candidate.id === session.id);
    assert.equal(session.workout.workSets.length, 1, "volume sessions have no top single");
    const set = session.workout.workSets[0];
    assert.equal(set.rpe, 7.5, "planned effort is a target rather than measured performance");
    assert.equal(set.label, "容量组 · 余力 2–3 次");
    assert(set.loadKg < old.workout.workSets[0].loadKg, "higher repetitions start with lighter weights");
    assert.equal(set.loadKg % 2.5, 0);
    assert.deepEqual(session.workout.accessories, old.workout.accessories, "accessories remain unchanged");
  }
  for (const type of ["push-volume", "squat-volume"]) {
    assert.deepEqual(firstLoadingWeeks(legacy, type).map((session) => {
      const set = session.workout.workSets[0];
      return [set.sets, set.reps, set.percentage];
    }), [[4, 6, 0.75], [4, 5, 0.775], [4, 4, 0.8]], "unmarked historical cycles retain the original wave");
  }
  assert.deepEqual(state, before, "generation must not mutate input");
});

test("an explicit start date adopts the new scheme only for future planned volume", () => {
  const state = fixture();
  state.activeCycle.volumePrescriptionFromDate = "2026-11-16";
  const plan = generate(state);
  const legacy = generate(fixture(null));
  for (const previous of legacy.sessions.filter((session) => session.date < "2026-11-16")) {
    assert.deepEqual(sessionAt(plan, previous.date), previous, "earlier planned prescriptions stay intact");
  }
  assert.equal(sessionAt(plan, "2026-11-20").workout.workSets[0].reps, 8);
  assert.equal(sessionAt(plan, "2026-11-21").workout.workSets[0].sets, 3);
  const normalized = core.normalizeState(state);
  assert.equal(normalized.activeCycle.volumePrescriptionFromDate, "2026-11-16");
  assert.deepEqual(generate(clone(plan.state)).sessions, plan.sessions);
  assert.equal(core.createPublicSnapshot(state, plan).cycle.volumePrescriptionFromDate, "2026-11-16");
});

test("the new volume scheme keeps strength days, deloads, openers, and test attempts intact", () => {
  const plan = generate(fixture());
  const legacy = generate(fixture(null));
  assert.deepEqual(plan.sessions.map((session) => [session.id, session.date, session.phase]),
    legacy.sessions.map((session) => [session.id, session.date, session.phase]), "the schedule and phases remain unchanged");
  for (const session of plan.sessions) {
    const old = legacy.sessions.find((candidate) => candidate.id === session.id);
    if (!/volume$/.test(session.type) || !/^load-/.test(session.phase.key)) {
      assert.deepEqual(session, old, "only loading volume sessions may change: " + session.date);
    }
  }
  for (const phase of ["deload", "opener", "test"]) {
    assert(plan.sessions.some((session) => session.phase.key === phase), "fixture must exercise " + phase);
  }
  assert.deepEqual(generate(clone(plan.state)).sessions, plan.sessions, "saving and reloading preserves prescriptions");
});

test("changing a cycle scheme preserves completed and skipped session snapshots and actual RPE data", () => {
  let state = fixture(null);
  const legacy = generate(state);
  const completed = sessionAt(legacy, "2026-11-06");
  const skipped = sessionAt(legacy, "2026-11-07");
  state = core.recordSession(state, completed, {
    mainSets: [{ weight: 67.5, reps: 6, completed: true }], notes: "retained record"
  });
  state = core.recordSession(state, skipped, { status: "skipped", notes: "retained skip" });
  const logs = clone(state.logs);
  state.activeCycle.volumePrescription = moderateVolume;
  const plan = generate(state);
  assert.deepEqual(plan.state.logs, logs);
  for (const previous of [completed, skipped]) {
    assert.deepEqual(sessionAt(plan, previous.date).workout, previous.workout, "stored prescriptions stay frozen");
  }
  assert.equal(plan.state.logs[completed.id].mainSets[0].rpe, null, "a planned RPE cannot become reported effort");
  assert.equal(plan.state.logs[completed.id].mainSets[0].rpeSource, null);
  assert.equal(sessionAt(plan, "2026-11-13").workout.workSets[0].reps, 9, "unrecorded future sessions adopt the new scheme");
  assert.deepEqual(generate(clone(plan.state)).sessions, plan.sessions);
});

test("replanning retains existing prescriptions while future volume uses the cycle's explicit scheme", () => {
  const original = fixture(null);
  const before = generate(original);
  const revised = core.replanRemaining(original, [], {
    fromDate: "2026-11-16", endDate: "2027-01-29", asOfDate
  });
  revised.activeCycle.volumePrescription = moderateVolume;
  const plan = generate(revised);
  for (const previous of before.sessions.filter((session) => session.date < "2026-11-16")) {
    assert.deepEqual(sessionAt(plan, previous.date).workout, previous.workout, "retained prescription stays frozen");
  }
  assert.equal(sessionAt(plan, "2026-11-20").workout.workSets[0].reps, 8);
  const again = core.replanRemaining(plan.state, [], {
    fromDate: "2026-11-16", endDate: "2027-01-29", asOfDate
  });
  const withoutRevisionId = (sessions) => sessions.map(({ id, ...session }) => session);
  assert.deepEqual(withoutRevisionId(generate(again).sessions), withoutRevisionId(plan.sessions),
    "a repeated replan preserves both old and new prescriptions");
});

test("a dated migration refreshes retained future volume without rewriting retained history or records", () => {
  let state = fixture(null);
  const before = generate(state);
  const recorded = sessionAt(before, "2026-11-13");
  state = core.recordSession(state, recorded, { mainSets: [], notes: "keep this future record" });
  state = core.replanRemaining(state, [], {
    fromDate: "2026-11-23", endDate: "2027-01-29", asOfDate
  });
  state.activeCycle.volumePrescription = moderateVolume;
  state.activeCycle.volumePrescriptionFromDate = "2026-11-09";
  const plan = generate(state);
  for (const previous of before.sessions.filter((session) => session.date < "2026-11-23")) {
    const current = sessionAt(plan, previous.date);
    assert.equal(current.id, previous.id, "retained workout identities remain unchanged");
    assert.deepEqual(current.phase, previous.phase, "retained phases remain unchanged");
    if (previous.date < "2026-11-09" || !/volume$/.test(previous.type) || previous.id === recorded.id) {
      assert.deepEqual(current.workout, previous.workout, "history, strength, and recorded prescriptions stay frozen");
    }
  }
  assert.equal(sessionAt(plan, "2026-11-20").workout.workSets[0].reps, 8, "future retained bench adopts the new scheme");
  assert.equal(sessionAt(plan, "2026-11-21").workout.workSets[0].sets, 3, "future retained squat adopts the new scheme");
  assert.equal(sessionAt(plan, "2026-11-14").workout.workSets[0].reps, 8);
  assert.deepEqual(plan.state.logs, state.logs);
  assert.deepEqual(generate(clone(plan.state)).sessions, plan.sessions);
});

test("refreshing retained volume preserves its reference strength across a changed deadline", () => {
  const state = fixture(null);
  state.activeCycle.lifts.bench.target1rm = 95;
  state.activeCycle.lifts.squat.target1rm = 115;
  const before = generate(state);
  const revised = core.replanRemaining(state, [], {
    fromDate: "2026-11-23", endDate: "2026-12-18", asOfDate
  });
  revised.activeCycle.volumePrescription = moderateVolume;
  revised.activeCycle.volumePrescriptionFromDate = "2026-11-09";
  const plan = generate(revised);
  for (const date of ["2026-11-20", "2026-11-21"]) {
    const previous = sessionAt(before, date);
    const current = sessionAt(plan, date);
    assert.equal(current.workout.planned1rm, previous.workout.planned1rm,
      "a dated volume revision retains the workout's prior strength reference");
    const set = current.workout.workSets[0];
    assert.equal(set.loadKg, core.roundLoad(previous.workout.planned1rm * set.percentage, 2.5));
  }
});

test("moving volume follows the new date's wave and remains stable after persistence", () => {
  const state = fixture();
  const original = sessionAt(generate(state), "2026-11-06");
  const moved = core.moveSession(state, original.id, "2026-11-12", { asOfDate });
  const plan = generate(moved);
  const session = plan.sessions.find((candidate) => candidate.id === original.id);
  assert.equal(session.type, "push-volume");
  assert.equal(session.phase.key, "load-2");
  assert.equal(session.workout.workSets[0].reps, 9);
  assert.equal(session.workout.workSets[0].percentage, 0.675);
  assert.deepEqual(session.workout.accessories, original.workout.accessories);
  assert.deepEqual(generate(clone(plan.state)).sessions, plan.sessions);
});

test("legacy archive regeneration stays isolated from the active cycle's new scheme", () => {
  const legacy = fixture(null);
  const old = generate(legacy);
  const state = fixture();
  state.archivedCycles = [{ cycle: clone(legacy.activeCycle), logs: {}, overview: clone(old) }];
  const normalized = core.normalizeState(state);
  const archive = normalized.archivedCycles[0];
  assert.equal(archive.cycle.volumePrescription, undefined, "normalization does not opt an archive into the new scheme");
  assert.deepEqual(archive.overview.sessions, old.sessions);
  const archivedState = core.createDefaultState(archive.cycle.startDate);
  archivedState.activeCycle = clone(archive.cycle);
  archivedState.logs = clone(archive.logs);
  assert.deepEqual(generate(archivedState).sessions, old.sessions, "rebuilding an old archive retains its original workouts");
});

test("public snapshots include the selected scheme and the same work prescriptions", () => {
  for (const marker of [moderateVolume, null]) {
    const state = fixture(marker);
    const plan = generate(state);
    const snapshot = core.createPublicSnapshot(state, plan);
    assert.equal(snapshot.cycle.volumePrescription, marker || "legacy");
    assert.equal(snapshot.cycle.volumePrescriptionFromDate, null);
    for (const type of ["push-volume", "squat-volume"]) {
      const publicSessions = snapshot.sessions.filter((session) => session.type === type);
      const privateSessions = plan.sessions.filter((session) => session.type === type);
      assert.deepEqual(clone(publicSessions.map((session) => session.workout)),
        clone(privateSessions.map((session) => session.workout)));
    }
    assert.equal(Object.hasOwn(snapshot, "logs"), false);
    assert.equal(Object.hasOwn(snapshot.cycle, "bodyweightEntries"), false);
  }
});
