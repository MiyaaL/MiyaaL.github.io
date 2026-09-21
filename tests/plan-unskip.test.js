"use strict";

const assert = require("assert");
const PlanCore = require("../assets/js/plan-core.js");

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

(function restoresSkippedWorkoutWithoutMutatingHistory() {
  const initial = activeState();
  const session = PlanCore.generate(initial, [], { asOfDate: "2026-09-01" }).sessions[0];
  const skipped = PlanCore.recordSession(initial, session, {
    status: "skipped",
    mainSets: [],
    notes: "临时有事"
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
}());

(function restoresSkippedLearningDayAndKeepsItsDraft() {
  const initial = activeState();
  const learningPlan = PlanCore.createDefaultLearningPlan("2026-09-01", "2026-09-02", {
    title: "学习计划"
  });
  initial.learningPlans = [learningPlan];
  const session = PlanCore.generateLearningPlan(learningPlan).sessions[0];
  const skipped = PlanCore.recordLearningSession(initial, learningPlan.id, session, {
    status: "skipped",
    reflection: "仍需复习",
    dailyPlan: { title: "补课", objective: "补齐知识点", tasks: ["重读笔记"] },
    artifacts: [{ id: "artifact-1", name: "notes.md", size: 12 }]
  });

  const restored = PlanCore.restoreSkippedLearningSession(skipped, learningPlan.id, session.id);
  const restoredLog = restored.learningPlans[0].logs[session.id];
  const regenerated = PlanCore.generateLearningPlan(restored.learningPlans[0]);

  assert.strictEqual(skipped.learningPlans[0].logs[session.id].status, "skipped", "restore must not mutate its input");
  assert.strictEqual(restoredLog.status, "planned");
  assert.strictEqual(restoredLog.reflection, "仍需复习");
  assert.strictEqual(Object.prototype.hasOwnProperty.call(restoredLog, "completedAt"), false);
  assert.strictEqual(Object.prototype.hasOwnProperty.call(restoredLog, "sessionSnapshot"), false);
  assert.deepStrictEqual(regenerated.sessions[0].learning.tasks, ["重读笔记"]);
  assert.strictEqual(regenerated.sessions[0].status, "planned");
  assert.throws(
    () => PlanCore.restoreSkippedLearningSession(restored, learningPlan.id, session.id),
    /learning_session_not_skipped/
  );
}());

console.log("PASS: skipped workouts and learning days can be restored safely");
