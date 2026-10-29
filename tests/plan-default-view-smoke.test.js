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
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
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
  const savedLearningPlans = JSON.parse(JSON.stringify(state.learningPlans));

  const memory = window.PlanStore.createMemoryAdapter({ version: 1, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(window.document.querySelector(".plan-kind-toolbar"), null, "single-plan view has no mode toolbar");
  assert.strictEqual(window.document.querySelector("[data-plan-kind]"), null, "plan kind tabs are removed");
  assert.strictEqual(window.document.querySelector("[data-plan-learning-selector]"), null);
  assert.strictEqual(window.document.querySelector("[data-plan-new-learning]"), null);
  assert.strictEqual(window.document.querySelector("[data-plan-title]").textContent, "推拉蹲 + 推");

  window.document.querySelector("[data-plan-update-bodyweight]").click();
  const bodyweightForm = window.document.querySelector("[data-plan-bodyweight-form]");
  assert.strictEqual(bodyweightForm.closest("dialog").open, true, "fitness actions remain available");
  bodyweightForm.elements.date.value = "2026-09-22";
  bodyweightForm.elements.bodyweight.value = "69.5";
  bodyweightForm.dispatchEvent(new window.Event("submit", { bubbles: true, cancelable: true }));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 2, "fitness updates still save");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(stored.state.activeCycle.bodyweightEntries.slice(-1)[0])),
    { date: "2026-09-22", value: 69.5 }
  );
  assert.deepStrictEqual(JSON.parse(JSON.stringify(stored.state.learningPlans)), savedLearningPlans,
    "removing learning UI must preserve saved learning plans during fitness updates");
  assert.strictEqual(stored.state.activePlanId, learningPlan.id, "saved learning selection remains intact");

  console.log("PASS: fitness-only Plan UI remains editable and preserves saved learning plans");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
