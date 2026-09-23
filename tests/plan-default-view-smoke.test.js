"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

(async function () {
  const html = fs.readFileSync("/site/_site/plan/index.html", "utf8");
  const holidays = JSON.parse(fs.readFileSync("/site/assets/data/holidays/cn-2026.json", "utf8"));
  const dom = new JSDOM(html, {
    url: "https://miyaal.github.io/plan/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const NativeDate = window.Date;
  const fixedNow = new NativeDate("2026-09-22T12:00:00+08:00").getTime();
  window.Date = class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [fixedNow])); }
    static now() { return fixedNow; }
  };
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  window.fetch = async () => ({ ok: true, json: async () => holidays });
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};

  window.eval(fs.readFileSync("/site/assets/js/plan-core.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-store.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-chart.js", "utf8"));

  const state = window.PlanCore.createDefaultState("2026-08-03");
  state.activeCycle.status = "active";
  state.activeCycle.endDate = "2026-10-31";
  state.activeCycle.requestedEndDate = "2026-10-31";
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  Object.keys(state.activeCycle.lifts).forEach((key) => {
    state.activeCycle.lifts[key].current1rm = key === "squat" ? 120 : 80;
    state.activeCycle.lifts[key].target1rm = key === "squat" ? 130 : 90;
  });
  const learningPlan = window.PlanCore.createDefaultLearningPlan("2026-09-01", "2026-09-30", {
    title: "学习计划"
  });
  state.learningPlans = [learningPlan];
  state.activePlanId = learningPlan.id;

  const memory = window.PlanStore.createMemoryAdapter({ version: 1, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));

  await new Promise((resolve) => setTimeout(resolve, 50));

  const fitnessTab = window.document.querySelector('[data-plan-kind="fitness"]');
  const learningTab = window.document.querySelector('[data-plan-kind="learning"]');
  assert.strictEqual(fitnessTab.getAttribute("aria-selected"), "true", "Plan must open on fitness");
  assert.strictEqual(learningTab.getAttribute("aria-selected"), "false");
  assert.strictEqual(window.document.querySelector("[data-plan-learning-selector]").hidden, true);
  assert.strictEqual(window.document.querySelector("[data-plan-title]").textContent, "推拉蹲 + 推");

  console.log("PASS: Plan always opens on fitness even when a learning plan was last active");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
