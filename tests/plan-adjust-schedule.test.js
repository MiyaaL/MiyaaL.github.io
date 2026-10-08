"use strict";

const assert = require("node:assert/strict");
const test = require("node:test");
const core = require("../assets/js/plan-core.js");
const holidays = require("../assets/data/holidays/cn-2026.json");

const asOfDate = "2026-09-23";
const options = { holidayCalendars: [holidays], asOfDate, allowDeadlineChange: true };
const plain = (value) => JSON.parse(JSON.stringify(value));
const generate = (state) => core.generate(state, [holidays], { asOfDate });

function fixture(skippedDate, { additionalSkippedDates = [], previousAdjustmentDays = 0 } = {}) {
  let state = core.createDefaultState("2026-09-01");
  Object.assign(state.activeCycle, {
    status: "active",
    endDate: "2026-10-31",
    requestedEndDate: "2026-10-31",
    bodyweightEntries: [{ date: "2026-09-01", value: 70 }]
  });
  for (const key of Object.keys(state.activeCycle.lifts)) {
    Object.assign(state.activeCycle.lifts[key], { current1rm: 100, target1rm: 105 });
  }

  let plan = generate(state);
  const completed = plan.sessions.find((session) => session.date === "2026-09-09");
  state = core.recordSession(state, completed, { status: "completed", notes: "保留训练历史" });
  if (skippedDate === "2026-09-15") {
    // Leave a free day before the skipped workout so advancing by one day is valid.
    const previous = plan.sessions.find((session) => session.date === "2026-09-14");
    state = core.moveSession(state, previous.id, "2026-09-13", options);
  }
  plan = generate(state);
  const skippedIds = [skippedDate].concat(additionalSkippedDates).map((date) =>
    plan.sessions.find((session) => session.date === date).id);
  if (previousAdjustmentDays) {
    state = core.adjustSchedule(state, skippedIds[0], core.addDays(skippedDate, previousAdjustmentDays), options);
    plan = generate(state);
  }
  for (const id of skippedIds) {
    const skipped = plan.sessions.find((session) => session.id === id);
    state = core.recordSession(state, skipped, { status: "skipped", notes: "出差后补训" });
  }
  state = core.replanRemaining(state, [holidays], {
    fromDate: "2026-09-25", endDate: "2026-10-31", trainOnHolidays: true, asOfDate
  });
  return { state, sourceId: skippedIds[0], completedId: completed.id };
}

function assertCalendarShift(before, after, sourceId, days) {
  const source = before.sessions.find((session) => session.id === sourceId);
  assert(source, "the selected workout must exist before the adjustment");
  assert.equal(after.sessions.length, before.sessions.length, "adjusting dates must preserve the workout count");
  for (const previous of before.sessions) {
    const current = after.sessions.find((session) => session.id === previous.id);
    assert(current, "adjusting dates must preserve workout identity: " + previous.date);
    assert.equal(current.date, previous.date >= source.date ? core.addDays(previous.date, days) : previous.date,
      "each remaining workout must move by the selected number of days: " + previous.date);
    if (previous.date >= source.date && previous.status === "skipped") {
      assert.equal(current.status, "planned", "a shifted skipped workout must become available to train");
      assert.equal(Object.hasOwn(after.state.logs, previous.id), false, "the skip record must be cleared");
    }
    if (previous.status === "completed") {
      assert.deepEqual(current, previous, "completed workout details must remain intact");
      assert.deepEqual(after.state.logs[previous.id], before.state.logs[previous.id], "completed records must remain intact");
    }
  }
  assert.equal(after.cycle.endDate, core.addDays(before.cycle.endDate, days), "the cycle end must follow the adjustment");
  assert.equal(new Set(after.sessions.map((session) => session.id)).size, after.sessions.length, "workout identities must remain unique");
  assert.equal(new Set(after.sessions.map((session) => session.date)).size, after.sessions.length, "adjusting dates must not duplicate workouts");
  assert.deepEqual(generate(plain(after.state)).sessions, after.sessions, "saving and reloading must preserve the calendar");
}

for (const skippedDate of ["2026-09-15", "2026-09-28"]) {
  for (const days of [7, -1]) {
    test("old skipped workout on " + skippedDate + " survives a " + days + " day adjustment after replanning", () => {
      const { state, sourceId } = fixture(skippedDate);
      const before = generate(state);
      const source = before.sessions.find((session) => session.id === sourceId);
      const targetDate = core.addDays(source.date, days);
      assert.throws(() => core.adjustSchedule(state, sourceId, targetDate, { holidayCalendars: [holidays], asOfDate }),
        { code: "schedule_deadline_locked" }, "changing a fixed deadline requires explicit authorization");
      const original = plain(state);
      const adjusted = core.adjustSchedule(state, sourceId, targetDate, options);
      assert.deepEqual(state, original, "previewing an adjustment must not mutate the original plan");
      assertCalendarShift(before, generate(adjusted), sourceId, days);
    });
  }
}

test("restored historical workout survives repeated adjustments across the replanning boundary", () => {
  const { state, sourceId } = fixture("2026-09-15");
  let current = state;
  for (const days of [7, 2, 2, -1]) {
    const before = generate(current);
    const source = before.sessions.find((session) => session.id === sourceId);
    current = core.adjustSchedule(current, sourceId, core.addDays(source.date, days), options);
    assertCalendarShift(before, generate(current), sourceId, days);
  }
  assert.equal(generate(current).sessions.find((session) => session.id === sourceId).date, "2026-09-25");
});

test("single-workout moves stay accurate through restoration and later whole-plan adjustments", () => {
  const { state, sourceId } = fixture("2026-09-28");
  const initial = generate(state);
  const moved = initial.sessions.find((session) => session.date === "2026-09-30");
  let current = core.moveSession(state, moved.id, "2026-10-01", options);
  let before = generate(current);
  current = core.adjustSchedule(current, sourceId, "2026-10-05", options);
  let after = generate(current);
  assertCalendarShift(before, after, sourceId, 7);
  assert.equal(after.sessions.find((session) => session.id === moved.id).date, "2026-10-08");

  current = core.moveSession(current, moved.id, "2026-10-10", options);
  before = generate(current);
  current = core.adjustSchedule(current, sourceId, "2026-10-04", options);
  after = generate(current);
  assertCalendarShift(before, after, sourceId, -1);
  assert.equal(after.sessions.find((session) => session.id === moved.id).date, "2026-10-09");
});

for (const skippedDate of ["2026-09-15", "2026-09-28"]) {
  test("a previously adjusted and skipped workout on " + skippedDate + " restores after replanning without replaying the old shift", () => {
    const { state, sourceId } = fixture(skippedDate, { previousAdjustmentDays: 7 });
    const before = generate(state);
    const source = before.sessions.find((session) => session.id === sourceId);
    assert.equal(source.date, core.addDays(skippedDate, 7));
    const current = core.adjustSchedule(state, sourceId, core.addDays(source.date, 2), options);
    assertCalendarShift(before, generate(current), sourceId, 2);
  });

  test("a skipped workout on " + skippedDate + " restores after an existing later adjustment without inheriting that shift", () => {
    const { state, sourceId } = fixture(skippedDate);
    let before = generate(state);
    const later = before.sessions.find((session) => session.date === "2026-09-30");
    let current = core.adjustSchedule(state, later.id, "2026-10-07", options);
    assertCalendarShift(before, generate(current), later.id, 7);
    before = generate(current);
    const source = before.sessions.find((session) => session.id === sourceId);
    current = core.adjustSchedule(current, sourceId, core.addDays(source.date, 21), options);
    assertCalendarShift(before, generate(current), sourceId, 21);
  });
}

test("one adjustment restores multiple skipped workouts on both sides of the replanning boundary", () => {
  const { state, sourceId } = fixture("2026-09-15", { additionalSkippedDates: ["2026-09-28", "2026-09-30"] });
  const before = generate(state);
  assert.equal(before.sessions.filter((session) => session.status === "skipped").length, 3);
  const current = core.adjustSchedule(state, sourceId, "2026-09-22", options);
  const after = generate(current);
  assertCalendarShift(before, after, sourceId, 7);
  assert.equal(after.sessions.filter((session) => session.status === "skipped").length, 0);
});

test("a restored and skipped-again workout keeps its current date during another adjustment", () => {
  const { state, sourceId } = fixture("2026-09-15");
  let current = core.adjustSchedule(state, sourceId, "2026-09-22", options);
  const restored = generate(current).sessions.find((session) => session.id === sourceId);
  current = core.recordSession(current, restored, { status: "skipped", notes: "再次改期" });
  const before = generate(current);
  current = core.adjustSchedule(current, sourceId, "2026-09-24", options);
  assertCalendarShift(before, generate(current), sourceId, 2);
});

test("a restored historical workout uses the calendar wave of its new training date", () => {
  const { state, sourceId } = fixture("2026-09-15");
  const before = generate(state);
  assert.equal(before.sessions.find((session) => session.id === sourceId).phase.key, "load-3");
  const current = core.adjustSchedule(state, sourceId, "2026-09-22", options);
  const after = generate(current);
  assert.equal(after.sessions.find((session) => session.id === sourceId).phase.key, "deload",
    "moving a workout into the deload week must update its prescription");
  for (const previous of before.sessions.filter((session) => session.date < "2026-09-15")) {
    const unchanged = after.sessions.find((session) => session.id === previous.id);
    assert.deepEqual(unchanged.workout, previous.workout, "earlier historical prescriptions must remain intact");
    assert.deepEqual(unchanged.phase, previous.phase, "earlier historical phases must remain intact");
  }
});
