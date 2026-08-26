"use strict";

const assert = require("assert");
const PlanCore = require("../assets/js/plan-core.js");
const PlanChart = require("../assets/js/plan-chart.js");
const holidays2026 = require("../assets/data/holidays/cn-2026.json");

function chartHarness() {
  const legend = { innerHTML: "" };
  const empty = { hidden: true };
  const tooltipFields = {
    "[data-chart-tooltip-name]": { textContent: "" },
    "[data-chart-tooltip-value]": { textContent: "" },
    "[data-chart-tooltip-detail]": { textContent: "" }
  };
  const tooltip = {
    hidden: true,
    querySelector(selector) {
      return tooltipFields[selector];
    }
  };
  const plot = {
    clientWidth: 960,
    clientHeight: 300,
    hidden: false,
    innerHTML: "",
    querySelector(selector) {
      return selector === "[data-chart-tooltip]" ? tooltip : null;
    },
    querySelectorAll() {
      return [];
    }
  };
  const nodes = {
    "[data-plan-chart-legend]": legend,
    "[data-plan-chart-plot]": plot,
    "[data-plan-chart-empty]": empty
  };
  return {
    plot,
    root: {
      querySelector(selector) {
        return nodes[selector];
      }
    }
  };
}

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
  const bodyweightToday = bodyweight.points.find((point) => point.isToday);
  assert.strictEqual(bodyweight.interpolation, "step");
  assert.strictEqual(bodyweightToday.value, 69.5);
  assert.strictEqual(bodyweightToday.isEndpoint, true);
  assert.strictEqual(bodyweightToday.isCarried, true);
  const bench = model.series.find((series) => series.key === "bench");
  assert(Math.abs(bench.points[0].value - 100) < 0.01);
  assert.strictEqual(bench.points[bench.points.length - 1].value, 110);
}());

(function futureBodyweightUpdateDoesNotChangeTheCurrentValueEarly() {
  const state = configuredState();
  state.activeCycle.bodyweightEntries.push({ date: "2026-09-01", value: 67 });
  const plan = PlanCore.generate(state, [holidays2026]);
  const model = PlanChart.buildSeries(plan, "2026-08-20");
  const bodyweight = model.series.find((series) => series.key === "bodyweight");

  assert.deepStrictEqual(
    bodyweight.points.map((point) => [point.date, point.value]),
    [
      ["2026-08-03", 70],
      ["2026-08-10", 69.5],
      ["2026-08-20", 69.5]
    ]
  );
  assert.strictEqual(bodyweight.points.some((point) => point.isInterpolated), false);
}());

(function bodyweightCarriesFromBeforeAnEditedCycleStart() {
  const state = configuredState();
  state.activeCycle.startDate = "2026-08-07";
  const plan = PlanCore.generate(state, [holidays2026]);
  const model = PlanChart.buildSeries(plan, "2026-08-20");
  const bodyweight = model.series.find((series) => series.key === "bodyweight");

  assert.deepStrictEqual(
    bodyweight.points.map((point) => [point.date, point.value]),
    [
      ["2026-08-07", 70],
      ["2026-08-10", 69.5],
      ["2026-08-20", 69.5]
    ]
  );
  assert.strictEqual(bodyweight.points[0].isCarried, true);
  assert(bodyweight.points[0].detail.includes("2026-08-03"));
}());

(function bodyweightStillRendersWhenEditedCycleStartsAfterTheLastUpdate() {
  const state = configuredState();
  state.activeCycle.startDate = "2026-08-12";
  const plan = PlanCore.generate(state, [holidays2026]);
  const model = PlanChart.buildSeries(plan, "2026-08-20");
  const bodyweight = model.series.find((series) => series.key === "bodyweight");

  assert.deepStrictEqual(
    bodyweight.points.map((point) => [point.date, point.value]),
    [
      ["2026-08-12", 69.5],
      ["2026-08-20", 69.5]
    ]
  );
  assert.strictEqual(bodyweight.points[0].isBoundary, true);
}());

(function carriedEndpointKeepsTheLastExplicitUpdateDate() {
  const state = configuredState();
  state.activeCycle.bodyweightEntries = [
    { date: "2026-08-03", value: 70, carriedFrom: "2026-07-30" }
  ];
  const plan = PlanCore.generate(state, [holidays2026]);
  const model = PlanChart.buildSeries(plan, "2026-08-20");
  const bodyweight = model.series.find((series) => series.key === "bodyweight");
  const endpoint = bodyweight.points.find((point) => point.isToday);

  assert.strictEqual(endpoint.value, 70);
  assert.strictEqual(endpoint.carriedFrom, "2026-07-30");
  assert(endpoint.detail.includes("2026-07-30"));
}());

(function bodyweightPathUsesStepsWithoutCreatingGuideMarkers() {
  const state = configuredState();
  const plan = PlanCore.generate(state, [holidays2026]);
  const harness = chartHarness();
  const model = PlanChart.render(harness.root, plan, { today: "2026-08-20" });
  const bodyweight = model.series.find((series) => series.key === "bodyweight");
  const pathMatch = harness.plot.innerHTML.match(
    /<path class="plan-chart-line is-bodyweight" d="([^"]+)"/
  );
  const bodyweightMarkers = harness.plot.innerHTML.match(
    /data-chart-point data-series="Bodyweight"/g
  ) || [];

  assert(pathMatch, "bodyweight path must render");
  assert(pathMatch[1].includes("H"), "bodyweight path must hold the previous value horizontally");
  assert(pathMatch[1].includes("V"), "bodyweight path must jump at the update date");
  assert.strictEqual(bodyweightMarkers.length, bodyweight.points.length);
}());

(function archivedBodyweightCarriesForwardToTheCycleEnd() {
  const state = configuredState();
  state.activeCycle.status = "archived";
  const plan = PlanCore.generate(state, [holidays2026]);
  const model = PlanChart.buildSeries(plan, "2026-08-20");
  const bodyweight = model.series.find((series) => series.key === "bodyweight");
  const endpoint = bodyweight.points[bodyweight.points.length - 1];

  assert.deepStrictEqual(
    { date: endpoint.date, value: endpoint.value },
    { date: state.activeCycle.endDate, value: 69.5 }
  );
  assert.strictEqual(endpoint.isEndpoint, true);
  assert.strictEqual(endpoint.isToday, undefined);
  assert.strictEqual(
    bodyweight.points.some((point) => point.date > state.activeCycle.endDate),
    false
  );
}());

(function cycleBaselineDoesNotMoveWithAdaptiveCurrentEstimate() {
  const state = configuredState();
  state.activeCycle.lifts.bench.baseline1rm = 95;
  state.activeCycle.lifts.bench.current1rm = 104;
  const plan = PlanCore.generate(state, [holidays2026]);
  const model = PlanChart.buildSeries(plan, "2026-08-20");
  const bench = model.series.find((series) => series.key === "bench");

  assert.strictEqual(bench.points[0].date, state.activeCycle.startDate);
  assert.strictEqual(bench.points[0].value, 95);
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
