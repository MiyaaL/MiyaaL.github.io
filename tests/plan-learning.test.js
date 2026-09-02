"use strict";

const assert = require("assert");
const PlanCore = require("../assets/js/plan-core.js");

(function learningPlansGenerateEveryDayAndUseWeekdayTemplates() {
  const plan = PlanCore.createDefaultLearningPlan("2026-09-01", "2026-09-03", {
    title: "CS336 复习",
    dailyTemplate: {
      "2": { title: "阅读并行训练", tasks: ["读讲义", "写两条总结"] }
    },
    acceptanceCriteria: ["一页总结", { id: "criterion-2", title: "可运行练习" }]
  });
  const generated = PlanCore.generateLearningPlan(plan);
  assert.strictEqual(generated.sessions.length, 3);
  assert.deepStrictEqual(generated.sessions[0].learning.tasks, ["读讲义", "写两条总结"]);
  assert.strictEqual(generated.sessions[0].learning.acceptanceCriteria.length, 2);
}());

(function learningLogsKeepArtifactsPrivateAndSupportDateOverrides() {
  const plan = PlanCore.createDefaultLearningPlan("2026-09-01", "2026-09-03", {
    acceptanceCriteria: ["完成总结"]
  });
  const state = PlanCore.createDefaultState("2026-09-01");
  state.learningPlans = [plan];
  const session = PlanCore.generateLearningPlan(plan).sessions[0];
  const recorded = PlanCore.recordLearningSession(state, plan.id, session, {
    reflection: "今天理解了训练数据管线。",
    criteria: ["criterion-1"],
    dailyPlan: { tasks: ["补做一个实验"] },
    artifacts: [{ id: "artifact-1", name: "summary.md", size: 128, dataUrl: "data:text/plain;base64,eA==" }]
  });
  const next = PlanCore.generateLearningPlan(recorded.learningPlans[0]);
  assert.strictEqual(next.sessions[0].status, "completed");
  assert.deepStrictEqual(next.sessions[0].learning.tasks, ["补做一个实验"]);
  const snapshot = PlanCore.createPublicSnapshot(recorded, PlanCore.generate(recorded, []));
  const serialized = JSON.stringify(snapshot);
  assert(!serialized.includes("今天理解了训练数据管线"));
  assert(!serialized.includes("data:text/plain"));
  assert.strictEqual(snapshot.learningPlans[0].completedDays, 1);
}());

console.log("PASS: learning plan daily tasks, acceptance criteria, reflections, and artifacts");
