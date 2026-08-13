"use strict";

const assert = require("assert");
const PlanCore = require("../assets/js/plan-core.js");
const holidays2026 = require("../assets/data/holidays/cn-2026.json");

function configuredState(start, end) {
  const state = PlanCore.createDefaultState(start);
  state.activeCycle.endDate = end;
  state.activeCycle.status = "active";
  state.activeCycle.bodyweightEntries = [{ date: start, value: 70 }];
  state.activeCycle.lifts.bench.current1rm = 100;
  state.activeCycle.lifts.bench.target1rm = 110;
  state.activeCycle.lifts.pullup.current1rm = 30;
  state.activeCycle.lifts.pullup.target1rm = 40;
  state.activeCycle.lifts.squat.current1rm = 150;
  state.activeCycle.lifts.squat.target1rm = 165;
  return state;
}

(function defaultWeekTemplateAndLoads() {
  const state = configuredState("2026-08-03", "2026-10-25");
  const plan = PlanCore.generate(state, [holidays2026]);
  assert.deepStrictEqual(
    plan.sessions.slice(0, 4).map((session) => [session.date, session.type]),
    [
      ["2026-08-03", "push-strength"],
      ["2026-08-04", "pull"],
      ["2026-08-05", "squat"],
      ["2026-08-07", "push-volume"]
    ]
  );
  plan.sessions.forEach((session) => {
    session.workout.workSets.forEach((set) => {
      assert.strictEqual(Math.abs(set.loadKg % 2.5), 0, session.id + " must use 2.5 kg increments");
    });
  });
}());

(function holidayMakeupDaysReplaceHolidaySessions() {
  const state = configuredState("2026-09-01", "2026-10-20");
  const plan = PlanCore.generate(state, [holidays2026]);
  const dates = plan.sessions.map((session) => session.date);
  assert(dates.includes("2026-09-20"), "National Day makeup workday before the holiday should receive a session");
  assert(dates.includes("2026-10-10"), "National Day makeup workday after the holiday should receive a session");
  ["2026-10-02", "2026-10-05", "2026-10-06", "2026-10-07"].forEach((date) => {
    assert(!dates.includes(date), date + " must remain holiday-free");
  });
  assert(plan.sessions.find((session) => session.date === "2026-09-20").holiday);
}());

(function customHolidayOverridesCreateMakeupSession() {
  const state = configuredState("2026-08-03", "2026-08-09");
  state.activeCycle.holidayOverrides = {
    "2026-08-03": "off",
    "2026-08-08": "work"
  };
  const plan = PlanCore.generate(state, [holidays2026]);
  assert(!plan.sessions.some((session) => session.date === "2026-08-03"));
  const makeup = plan.sessions.find((session) => session.date === "2026-08-08");
  assert.strictEqual(makeup.type, "push-strength");
  assert.strictEqual(makeup.holiday.movedFrom, "2026-08-03");
}());

(function pullupUsesTotalSystemLoad() {
  const state = configuredState("2026-08-03", "2026-08-30");
  const plan = PlanCore.generate(state, [holidays2026]);
  const pull = plan.sessions.find((session) => session.type === "pull");
  assert.strictEqual(pull.workout.liftKey, "pullup");
  assert(pull.workout.workSets[0].loadKg > 0);
  assert.strictEqual(pull.workout.workSets[0].loadKg % 2.5, 0);
}());

(function e1rmEstimationAndAdjustment() {
  const estimate = PlanCore.estimateOneRepMax(100, 1, 8);
  assert(Math.abs(estimate - 108.46) < 0.1);
  assert.deepStrictEqual(
    PlanCore.suggestAdjustment(9, 8, true),
    { percentage: -0.025, reason: "实际 RPE 高于目标" }
  );
  assert.strictEqual(PlanCore.suggestAdjustment(7, 8, true).percentage, 0.025);
  assert.strictEqual(PlanCore.suggestAdjustment(8, 8, false).percentage, -0.05);
}());

(function publicSnapshotRemovesPrivateFields() {
  const state = configuredState("2026-08-03", "2026-08-30");
  state.logs.secret = {
    status: "completed",
    rpe: 9,
    notes: "private",
    bodyweight: 70
  };
  const plan = PlanCore.generate(state, [holidays2026]);
  const snapshot = PlanCore.createPublicSnapshot(state, plan);
  const serialized = JSON.stringify(snapshot);
  assert(!serialized.includes("bodyweightEntries"));
  assert(!serialized.includes("private"));
  assert(!Object.prototype.hasOwnProperty.call(snapshot, "logs"));
  assert(!Object.prototype.hasOwnProperty.call(snapshot, "warnings"));
  assert.strictEqual(snapshot.sessions.length, plan.sessions.length);
  const publicPull = snapshot.sessions.find((session) => session.workout.liftKey === "pullup");
  assert.strictEqual(publicPull.workout.loadVisibility, "owner");
  assert(publicPull.workout.workSets.every((set) => !Object.prototype.hasOwnProperty.call(set, "loadKg")));
  const publicBench = snapshot.sessions.find((session) => session.workout.liftKey === "bench");
  assert(publicBench.workout.workSets.some((set) => Object.prototype.hasOwnProperty.call(set, "loadKg")));
}());

(function bodyweightRecordsAppendOverwriteAndRemainPrivate() {
  const state = configuredState("2026-08-03", "2026-08-30");
  let updated = PlanCore.recordBodyweight(state, { date: "2026-08-20", value: 69.8 });
  updated = PlanCore.recordBodyweight(updated, { date: "2026-08-20", value: 69.5 });
  assert.deepStrictEqual(updated.activeCycle.bodyweightEntries, [
    { date: "2026-08-03", value: 70 },
    { date: "2026-08-20", value: 69.5 }
  ]);
  assert.strictEqual(state.activeCycle.bodyweightEntries.length, 1, "recording must not mutate the input state");
  assert.strictEqual(PlanCore.latestBodyweight(updated.activeCycle), 69.5);
  const snapshot = PlanCore.createPublicSnapshot(updated, PlanCore.generate(updated, [holidays2026]));
  assert(!JSON.stringify(snapshot).includes("bodyweightEntries"));
  assert.throws(
    () => PlanCore.recordBodyweight(updated, { date: "2026-08-21", value: 0 }),
    /invalid_bodyweight_entry/
  );
}());

(function manualMoveAndRecordKeepStableSessionId() {
  const state = configuredState("2026-08-03", "2026-08-30");
  let plan = PlanCore.generate(state, [holidays2026]);
  const first = plan.sessions[0];
  state.activeCycle.sessionOverrides[first.id] = { action: "move", date: "2026-08-06" };
  plan = PlanCore.generate(state, [holidays2026]);
  const moved = plan.sessions.find((session) => session.id === first.id);
  assert.strictEqual(moved.date, "2026-08-06");
  const recorded = PlanCore.recordSession(state, moved, {
    status: "completed",
    mainSets: [{ weight: 100, reps: 1, rpe: 8, completed: true }],
    notes: "felt good"
  });
  assert.strictEqual(recorded.logs[first.id].status, "completed");
  assert(recorded.activeCycle.lifts.bench.current1rm > 100);
}());

(function completedHistorySurvivesRegenerationAndTemplateChanges() {
  let state = configuredState("2026-08-03", "2026-08-30");
  let plan = PlanCore.generate(state, [holidays2026]);
  const completed = plan.sessions[0];
  const frozenWorkout = JSON.stringify(completed.workout);
  state = PlanCore.recordSession(state, completed, {
    status: "completed",
    mainSets: [{ weight: 100, reps: 1, rpe: 8, completed: true }]
  });
  state.activeCycle.lifts.bench.current1rm = 120;
  state.activeCycle.template = state.activeCycle.template.filter((item) => item.id !== "push-strength");
  plan = PlanCore.generate(state, [holidays2026]);
  const preserved = plan.sessions.find((session) => session.id === completed.id);
  assert(preserved, "completed session must remain visible after its template day is removed");
  assert.strictEqual(preserved.status, "completed");
  assert.strictEqual(JSON.stringify(preserved.workout), frozenWorkout);
}());

(function nextSessionReceivesOneAdaptiveAdjustment() {
  let state = configuredState("2026-08-03", "2026-08-30");
  let plan = PlanCore.generate(state, [holidays2026]);
  const completed = plan.sessions.find((session) => session.type === "push-strength");
  state = PlanCore.recordSession(state, completed, {
    status: "completed",
    mainSets: [{ weight: 92.5, reps: 1, rpe: 9, completed: true }]
  });
  plan = PlanCore.generate(state, [holidays2026]);
  const adjusted = plan.sessions.find((session) =>
    session.date > completed.date &&
    session.workout.liftKey === "bench" &&
    session.status === "planned"
  );
  assert.strictEqual(adjusted.workout.adjustment.percentage, -0.025);
  assert.strictEqual(adjusted.workout.adjustment.reason, "实际 RPE 高于目标");
  assert(adjusted.workout.warmups.every((set) => set.loadKg < adjusted.workout.workSets[0].loadKg));
}());

(function accessoriesUseDoubleProgression() {
  let state = configuredState("2026-08-03", "2026-08-30");
  let plan = PlanCore.generate(state, [holidays2026]);
  const completed = plan.sessions.find((session) => session.type === "push-strength");
  state = PlanCore.recordSession(state, completed, {
    status: "completed",
    mainSets: [],
    accessories: [{ name: "站姿推举", weight: 40, reps: 8, completed: true }]
  });
  plan = PlanCore.generate(state, [holidays2026]);
  const nextPush = plan.sessions.find((session) =>
    session.date > completed.date && session.type === "push-strength"
  );
  const press = nextPush.workout.accessories.find((accessory) => accessory.name === "站姿推举");
  assert.strictEqual(press.loadKg, 42.5);
  assert.strictEqual(press.progression, "达到次数上限，下次加重");
}());

(function icsContainsTimedEventsAndAlarm() {
  const state = configuredState("2026-08-03", "2026-08-09");
  const plan = PlanCore.generate(state, [holidays2026]);
  const ics = PlanCore.generateIcs(plan, state.preferences);
  assert(ics.includes("DTSTART;TZID=Asia/Shanghai:20260803T190000"));
  assert(ics.includes("TRIGGER:-PT120M"));
  assert(ics.includes("杠铃卧推"));
}());

console.log("PASS: PlanCore schedule, holiday, load, privacy, logging, and ICS tests");
