"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const PlanCore = require("./helpers/legacy-core.js");

function activeState() {
  const state = PlanCore.createDefaultState("2026-09-01");
  state.activeCycle.status = "active";
  state.activeCycle.endDate = "2026-09-30";
  state.activeCycle.requestedEndDate = "2026-09-30";
  state.activeCycle.bodyweightEntries = [{ date: "2026-09-01", value: 75 }];
  state.activeCycle.lifts.bench.current1rm = 100;
  state.activeCycle.lifts.bench.target1rm = 110;
  return state;
}

test("restores skipped workout without mutating history", () => {
  const initial = activeState();
  const session = PlanCore.generate(initial, [], { asOfDate: "2026-09-01" }).sessions[0];
  const skipped = PlanCore.recordSession(initial, session, {
    status: "skipped",
    mainSets: [],
    notes: "Something came up"
  });

  assert.strictEqual(skipped.logs[session.id].status, "skipped");

  const restored = PlanCore.restoreSkippedSession(skipped, session.id);
  const regenerated = PlanCore.generate(restored, [], { asOfDate: "2026-09-01" });

  assert.strictEqual(skipped.logs[session.id].status, "skipped", "restore must not mutate its input");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(restored.logs, session.id), false);
  assert.strictEqual(regenerated.sessions.find((item) => item.id === session.id).status, "planned");
  assert.throws(
    () => PlanCore.restoreSkippedSession(restored, session.id),
    /session_not_skipped/
  );

  const completed = PlanCore.recordSession(initial, session, { status: "completed", mainSets: [] });
  assert.throws(
    () => PlanCore.restoreSkippedSession(completed, session.id),
    /session_not_skipped/
  );
});
