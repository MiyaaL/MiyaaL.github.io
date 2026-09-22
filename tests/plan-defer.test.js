"use strict";

const assert = require("assert");
const PlanCore = require("../assets/js/plan-core.js");

function activeState() {
  const state = PlanCore.createDefaultState("2026-09-01");
  state.activeCycle.status = "active";
  state.activeCycle.endDate = "2026-09-30";
  state.activeCycle.requestedEndDate = "2026-09-30";
  state.activeCycle.bodyweightEntries = [{ date: "2026-09-01", value: 75 }];
  state.activeCycle.lifts.pullup.current1rm = 20;
  state.activeCycle.lifts.pullup.target1rm = 20;
  return state;
}

(function defersSkippedAndFutureSessionsWithoutAddingExtraWorkouts() {
  let state = activeState();
  state.activeCycle.endDate = "2026-10-31";
  state.activeCycle.requestedEndDate = "2026-10-31";
  const before = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const source = before.sessions.find((session) => session.date === "2026-09-15");
  const next = before.sessions.find((session) => session.date === "2026-09-16");
  const priorPull = before.sessions.find((session) => session.date === "2026-09-08");
  const untouched = before.sessions.find((session) => session.date === "2026-09-07");
  const followingPull = before.sessions.find((session) => session.date === "2026-09-22");
  state = PlanCore.recordSession(state, source, { status: "skipped", notes: "临时有事" });
  state = PlanCore.recordSession(state, next, { status: "skipped" });
  state = PlanCore.recordSession(state, priorPull, { status: "completed", mainSets: [] });
  const input = JSON.parse(JSON.stringify(state));

  const deferred = PlanCore.adjustSchedule(state, source.id, "2026-09-22", {
    holidayCalendars: [],
    asOfDate: "2026-09-20"
  });
  const after = PlanCore.generate(deferred, [], { asOfDate: "2026-09-20" });

  assert.deepStrictEqual(state, input, "schedule adjustment must not mutate its input");
  assert.strictEqual(after.sessions.find((session) => session.id === source.id).date, "2026-09-22");
  assert.strictEqual(after.sessions.find((session) => session.id === next.id).date, "2026-09-23");
  assert.strictEqual(after.sessions.find((session) => session.id === priorPull.id).date, "2026-09-08");
  assert.strictEqual(after.sessions.find((session) => session.id === source.id).status, "planned");
  assert.strictEqual(after.sessions.find((session) => session.id === next.id).status, "planned");
  assert.strictEqual(after.sessions.find((session) => session.id === source.id).phase.key, "return");
  assert.strictEqual(after.sessions.find((session) => session.id === followingPull.id).phase.key, "load-1");
  assert.deepStrictEqual(after.sessions.find((session) => session.id === untouched.id).phase, untouched.phase);
  assert.deepStrictEqual(after.sessions.find((session) => session.id === untouched.id).workout, untouched.workout);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(deferred.logs, source.id), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(deferred.logs, next.id), false);
  assert.strictEqual(after.cycle.endDate, "2026-11-07");
  assert.strictEqual(after.sessions.length, before.sessions.length);
  assert.strictEqual(new Set(after.sessions.map((session) => session.date)).size, after.sessions.length);
  assert.strictEqual(after.cycle.scheduleAdjustments.length, 1);
  assert.strictEqual(after.cycle.scheduleAdjustments[0].days, 7);
}());

(function movingAfterAdjustmentUsesTheSelectedFinalDate() {
  const state = activeState();
  const initial = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const source = initial.sessions.find((session) => session.date === "2026-09-15");
  const conflict = initial.sessions.find((session) => session.date === "2026-09-16");
  const deferred = PlanCore.adjustSchedule(state, source.id, "2026-09-22", {
    asOfDate: "2026-09-20"
  });
  const moved = PlanCore.moveSession(deferred, source.id, "2026-09-23", {
    replace: true,
    asOfDate: "2026-09-20"
  });
  const movedPlan = PlanCore.generate(moved, [], { asOfDate: "2026-09-20" });

  assert.strictEqual(movedPlan.sessions.find((session) => session.id === source.id).date, "2026-09-23");
  assert.strictEqual(movedPlan.sessions.some((session) => session.id === conflict.id), false);
  assert.strictEqual(moved.activeCycle.sessionOverrides[source.id].scheduleAdjustmentCount, 1);

  const deferredAgain = PlanCore.adjustSchedule(moved, source.id, "2026-09-25", {
    asOfDate: "2026-09-20"
  });
  const finalPlan = PlanCore.generate(deferredAgain, [], { asOfDate: "2026-09-20" });
  assert.strictEqual(finalPlan.sessions.find((session) => session.id === source.id).date, "2026-09-25");
}());

(function compoundsLaterAdjustmentsFromTheCurrentScheduledDate() {
  const state = activeState();
  const initial = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const first = initial.sessions.find((session) => session.date === "2026-09-15");
  const shifted = PlanCore.adjustSchedule(state, first.id, "2026-09-22", {
    asOfDate: "2026-09-20"
  });
  const shiftedPlan = PlanCore.generate(shifted, [], { asOfDate: "2026-09-20" });
  const second = shiftedPlan.sessions.find((session) => session.date === "2026-09-23");
  const deferredAgain = PlanCore.adjustSchedule(shifted, second.id, "2026-09-25", {
    asOfDate: "2026-09-20"
  });
  const finalPlan = PlanCore.generate(deferredAgain, [], { asOfDate: "2026-09-20" });

  assert.strictEqual(finalPlan.sessions.find((session) => session.id === first.id).date, "2026-09-22");
  assert.strictEqual(finalPlan.sessions.find((session) => session.id === second.id).date, "2026-09-25");
  assert.strictEqual(finalPlan.cycle.endDate, "2026-10-09");
  assert.strictEqual(finalPlan.sessions.length, initial.sessions.length);
}());

(function advancesRemainingSessionsAndCycleEnd() {
  const state = activeState();
  state.activeCycle.priorities = ["pullup"];
  const initial = PlanCore.generate(state, [], { asOfDate: "2026-09-01" });
  const source = initial.sessions.find((session) => session.date === "2026-09-18");
  const next = initial.sessions.find((session) => session.date === "2026-09-21");
  const advanced = PlanCore.adjustSchedule(state, source.id, "2026-09-17", {
    asOfDate: "2026-09-01"
  });
  const finalPlan = PlanCore.generate(advanced, [], { asOfDate: "2026-09-01" });

  assert.strictEqual(finalPlan.sessions.find((session) => session.id === source.id).date, "2026-09-17");
  assert.strictEqual(finalPlan.sessions.find((session) => session.id === next.id).date, "2026-09-20");
  assert.strictEqual(finalPlan.cycle.endDate, "2026-09-29");
  assert.strictEqual(finalPlan.cycle.scheduleAdjustments[0].days, -1);
  assert(finalPlan.cycle.schedule.reason.includes("已手动提前 1 天"));
}());

(function rejectsAdvanceCollisionsAndRecordedFutureSessions() {
  let state = activeState();
  let plan = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const source = plan.sessions.find((session) => session.date === "2026-09-15");
  const completed = plan.sessions.find((session) => session.date === "2026-09-18");

  assert.throws(
    () => PlanCore.adjustSchedule(state, source.id, "2026-09-14", { asOfDate: "2026-09-20" }),
    (error) => error.code === "schedule_adjust_conflict" && error.sessions.length > 0
  );

  state = PlanCore.recordSession(state, completed, { status: "completed", mainSets: [] });
  assert.throws(
    () => PlanCore.adjustSchedule(state, source.id, "2026-09-22", { asOfDate: "2026-09-20" }),
    (error) => error.code === "schedule_adjust_recorded_future" && error.sessions[0].id === completed.id
  );
  assert.throws(
    () => PlanCore.adjustSchedule(state, source.id, source.date, { asOfDate: "2026-09-20" }),
    (error) => error.code === "invalid_schedule_adjust_date"
  );
}());

console.log("PASS: PlanCore adjusts remaining workouts earlier or later and preserves completed history");
