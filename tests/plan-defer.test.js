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
  const before = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const source = before.sessions.find((session) => session.date === "2026-09-15");
  const next = before.sessions.find((session) => session.date === "2026-09-16");
  const prior = before.sessions.find((session) => session.date === "2026-09-14");
  const untouched = before.sessions.find((session) => session.date === "2026-09-08");
  state = PlanCore.recordSession(state, source, { status: "skipped", notes: "临时有事" });
  state = PlanCore.recordSession(state, next, { status: "skipped" });
  state = PlanCore.recordSession(state, prior, { status: "completed", mainSets: [] });
  const input = JSON.parse(JSON.stringify(state));

  const deferred = PlanCore.deferSessions(state, source.id, "2026-09-22", {
    holidayCalendars: [],
    asOfDate: "2026-09-20"
  });
  const after = PlanCore.generate(deferred, [], { asOfDate: "2026-09-20" });

  assert.deepStrictEqual(state, input, "deferring must not mutate its input");
  assert.strictEqual(after.sessions.find((session) => session.id === source.id).date, "2026-09-22");
  assert.strictEqual(after.sessions.find((session) => session.id === next.id).date, "2026-09-23");
  assert.strictEqual(after.sessions.find((session) => session.id === prior.id).date, "2026-09-14");
  assert.strictEqual(after.sessions.find((session) => session.id === source.id).status, "planned");
  assert.strictEqual(after.sessions.find((session) => session.id === next.id).status, "planned");
  assert.deepStrictEqual(after.sessions.find((session) => session.id === source.id).phase, source.phase);
  assert.deepStrictEqual(after.sessions.find((session) => session.id === source.id).workout, source.workout);
  assert.deepStrictEqual(after.sessions.find((session) => session.id === next.id).phase, next.phase);
  assert.deepStrictEqual(after.sessions.find((session) => session.id === next.id).workout, next.workout);
  assert.deepStrictEqual(after.sessions.find((session) => session.id === untouched.id).phase, untouched.phase);
  assert.deepStrictEqual(after.sessions.find((session) => session.id === untouched.id).workout, untouched.workout);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(deferred.logs, source.id), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(deferred.logs, next.id), false);
  assert.strictEqual(after.cycle.endDate, "2026-10-07");
  assert.strictEqual(after.sessions.length, before.sessions.length);
  assert.strictEqual(new Set(after.sessions.map((session) => session.date)).size, after.sessions.length);
  assert.strictEqual(after.cycle.scheduleDeferrals.length, 1);
  assert.strictEqual(after.cycle.scheduleDeferrals[0].days, 7);
}());

(function movingAfterDeferralUsesTheSelectedFinalDate() {
  const state = activeState();
  const initial = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const source = initial.sessions.find((session) => session.date === "2026-09-15");
  const conflict = initial.sessions.find((session) => session.date === "2026-09-16");
  const deferred = PlanCore.deferSessions(state, source.id, "2026-09-22", {
    asOfDate: "2026-09-20"
  });
  const moved = PlanCore.moveSession(deferred, source.id, "2026-09-23", {
    replace: true,
    asOfDate: "2026-09-20"
  });
  const movedPlan = PlanCore.generate(moved, [], { asOfDate: "2026-09-20" });

  assert.strictEqual(movedPlan.sessions.find((session) => session.id === source.id).date, "2026-09-23");
  assert.strictEqual(movedPlan.sessions.some((session) => session.id === conflict.id), false);
  assert.strictEqual(moved.activeCycle.sessionOverrides[source.id].scheduleDeferralCount, 1);

  const deferredAgain = PlanCore.deferSessions(moved, source.id, "2026-09-25", {
    asOfDate: "2026-09-20"
  });
  const finalPlan = PlanCore.generate(deferredAgain, [], { asOfDate: "2026-09-20" });
  assert.strictEqual(finalPlan.sessions.find((session) => session.id === source.id).date, "2026-09-25");
}());

(function compoundsLaterDeferralsFromTheCurrentScheduledDate() {
  const state = activeState();
  const initial = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const first = initial.sessions.find((session) => session.date === "2026-09-15");
  const shifted = PlanCore.deferSessions(state, first.id, "2026-09-22", {
    asOfDate: "2026-09-20"
  });
  const shiftedPlan = PlanCore.generate(shifted, [], { asOfDate: "2026-09-20" });
  const second = shiftedPlan.sessions.find((session) => session.date === "2026-09-23");
  const deferredAgain = PlanCore.deferSessions(shifted, second.id, "2026-09-25", {
    asOfDate: "2026-09-20"
  });
  const finalPlan = PlanCore.generate(deferredAgain, [], { asOfDate: "2026-09-20" });

  assert.strictEqual(finalPlan.sessions.find((session) => session.id === first.id).date, "2026-09-22");
  assert.strictEqual(finalPlan.sessions.find((session) => session.id === second.id).date, "2026-09-25");
  assert.strictEqual(finalPlan.cycle.endDate, "2026-10-09");
  assert.strictEqual(finalPlan.sessions.length, initial.sessions.length);
}());

(function rejectsDeferralAcrossACompletedLaterSession() {
  let state = activeState();
  let plan = PlanCore.generate(state, [], { asOfDate: "2026-09-20" });
  const source = plan.sessions.find((session) => session.date === "2026-09-15");
  const completed = plan.sessions.find((session) => session.date === "2026-09-18");
  state = PlanCore.recordSession(state, completed, { status: "completed", mainSets: [] });

  assert.throws(
    () => PlanCore.deferSessions(state, source.id, "2026-09-22", { asOfDate: "2026-09-20" }),
    (error) => error.code === "session_defer_recorded_future" && error.sessions[0].id === completed.id
  );
  assert.throws(
    () => PlanCore.deferSessions(state, source.id, source.date, { asOfDate: "2026-09-20" }),
    (error) => error.code === "invalid_session_defer_date"
  );
}());

console.log("PASS: PlanCore defers remaining workouts and preserves completed history");
