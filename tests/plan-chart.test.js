"use strict";

const assert = require("assert");
const PlanCore = require("../assets/js/plan-core.js");
const PlanChart = require("../assets/js/plan-chart.js");
const holidays2026 = require("../assets/data/holidays/cn-2026.json");

function configuredState() {
  const state = PlanCore.createDefaultState("2026-08-03");
  state.activeCycle.endDate = "2026-10-25";
  state.activeCycle.status = "active";
  state.activeCycle.bodyweightEntries = [
    { date: "2026-08-03", value: 70 },
    { date: "2026-08-10", value: 69.5 }
  ];
  state.activeCycle.lifts.bench.current1rm = 100;
  state.activeCycle.lifts.bench.target1rm = 110;
  state.activeCycle.lifts.pullup.current1rm = 30;
  state.activeCycle.lifts.pullup.target1rm = 40;
  state.activeCycle.lifts.squat.current1rm = 150;
  state.activeCycle.lifts.squat.target1rm = 165;
  return state;
}

(function ownerSeriesIncludesPrivateBodyweightAndTodayMarkers() {
  const state = configuredState();
  const plan = PlanCore.generate(state, [holidays2026]);
  const model = PlanChart.buildSeries(plan, "2026-08-20");

  assert.deepStrictEqual(
    model.series.map((series) => series.key),
    ["bodyweight", "bench", "pullup", "squat"]
  );
  model.series.forEach((series) => {
    const today = series.points.find((point) => point.date === "2026-08-20");
    assert(today && today.isToday, series.key + " must mark the current date");
  });

  const bodyweight = model.series.find((series) => series.key === "bodyweight");
  assert.strictEqual(bodyweight.points.find((point) => point.isToday).value, 69.5);
  const bench = model.series.find((series) => series.key === "bench");
  assert(Math.abs(bench.points[0].value - 100) < 0.01);
  assert.strictEqual(bench.points[bench.points.length - 1].value, 110);
}());

(function publicSeriesPreservesBodyweightPrivacy() {
  const state = configuredState();
  const generated = PlanCore.generate(state, [holidays2026]);
  const snapshot = PlanCore.createPublicSnapshot(state, generated);
  const model = PlanChart.buildSeries({
    cycle: snapshot.cycle,
    sessions: snapshot.sessions
  }, "2026-08-20");

  assert.deepStrictEqual(
    model.series.map((series) => series.key),
    ["bench", "pullup", "squat"]
  );
  assert(!JSON.stringify(model).includes("bodyweight"));
}());

console.log("PASS: PlanChart trajectories, current-date markers, and bodyweight privacy tests");
