"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const core = require("../assets/js/plan-core.js");
const chart = require("../assets/js/plan-chart.js");
const { sampleState, logAsPrescribed } = require("./helpers/dom.js");

function harness(width) {
  const legend = { innerHTML: "" };
  const empty = { hidden: true };
  const plot = {
    innerHTML: "",
    hidden: false,
    clientWidth: width || 960,
    clientHeight: 0,
    querySelector() {
      return { querySelector: () => ({ textContent: "" }), style: {}, classList: { toggle() {} }, hidden: true };
    },
    querySelectorAll: () => []
  };
  const root = {
    querySelector(selector) {
      return { "[data-plan-chart-legend]": legend, "[data-plan-chart-plot]": plot, "[data-plan-chart-empty]": empty }[selector];
    }
  };
  return { root, legend, plot, empty };
}

function loggedPlan() {
  let state = sampleState(core);
  const first = core.generate(state, [], { asOfDate: "2026-11-02" });
  ["2026-11-02", "2026-11-04", "2026-11-09"].forEach((date) => {
    const plan = core.generate(state, [], { asOfDate: date });
    const session = plan.sessions.find((candidate) => candidate.date === date);
    state = logAsPrescribed(core, plan.state, session, {
      mainSets: [{ weight: session.workout.workSets[0].loadKg, reps: 1, rpe: 8 }]
    });
  });
  assert.ok(first.sessions.length);
  return core.generate(state, [], { asOfDate: "2026-11-26" });
}

test("each lift is plotted as its share of the way from its start to its goal", () => {
  const plan = core.generate(sampleState(core), [], { asOfDate: "2026-11-02" });
  const model = chart.buildSeries(plan, "2026-11-02");
  assert.deepStrictEqual(model.series.map((item) => item.key), ["bench", "pullup", "squat"]);
  model.series.forEach((item) => {
    assert.strictEqual(item.points[0].percent, 0, item.key + " starts at 0 %");
    assert.strictEqual(item.points[0].date, "2026-11-02");
    item.points.forEach((point) => {
      const expected = (point.value - item.start) / (item.goal - item.start) * 100;
      assert.ok(Math.abs(point.percent - expected) < 0.06, item.key + " percent matches its kilograms");
    });
  });
  const bench = model.series.find((item) => item.key === "bench");
  const squat = model.series.find((item) => item.key === "squat");
  assert.notStrictEqual(bench.start, squat.start);
  assert.strictEqual(bench.points[0].percent, squat.points[0].percent,
    "lifts of different absolute load share one scale");
});

test("logged sessions appear as actual estimates, separate from the programmed line", () => {
  const plan = loggedPlan();
  const model = chart.buildSeries(plan, "2026-11-26");
  const bench = model.series.find((item) => item.key === "bench");
  assert.strictEqual(bench.actual.length, 2);
  assert.deepStrictEqual(bench.actual.map((point) => point.date), ["2026-11-02", "2026-11-09"]);
  bench.actual.forEach((point) => {
    assert.strictEqual(point.detail, "Estimated 1RM from the logged session");
    assert.ok(Number.isFinite(point.percent));
  });
  assert.strictEqual(model.series.find((item) => item.key === "pullup").actual.length, 0);
  assert.strictEqual(bench.today.date, "2026-11-26");
  assert.doesNotMatch(JSON.stringify(model), /bodyweight/i, "the chart model carries no bodyweight");
});

test("the rendered chart labels its axis by meaning and its lines directly", () => {
  const view = harness(960);
  chart.render(view.root, loggedPlan(), { today: "2026-11-26" });
  const svg = view.plot.innerHTML;
  assert.match(svg, /viewBox="0 0 960 320"/);
  assert.match(svg, />Start<\/text>/);
  assert.match(svg, />Goal<\/text>/);
  assert.match(svg, />50 %<\/text>/);
  assert.match(svg, /plan-chart-today-line/);
  assert.strictEqual((svg.match(/class="plan-chart-line /g) || []).length, 3);
  assert.strictEqual((svg.match(/class="plan-chart-end-label"/g) || []).length, 3);
  assert.match(svg, /Bench press<tspan[^>]*>[\d.]+ kg<\/tspan>/);
  assert.strictEqual((svg.match(/class="plan-chart-actual /g) || []).length, 3, "one marker per logged estimate");
  assert.match(svg, /data-kind="actual"[^>]*data-value="[\d.]+ kg" data-percent="-?\d+ %"/);
  assert.doesNotMatch(svg, /KG<\/text>/, "the shared kilogram axis is gone");
  ["Bench press", "Weighted pull-up", "Back squat", "Programmed", "Logged estimate"].forEach((label) => {
    assert.ok(view.legend.innerHTML.includes("<span>" + label + "</span>"), label + " is in the legend");
  });
});

test("a narrow plot keeps the labels inside the viewport", () => {
  const view = harness(358);
  chart.render(view.root, loggedPlan(), { today: "2026-11-26" });
  const svg = view.plot.innerHTML;
  assert.match(svg, /viewBox="0 0 358 280"/);
  assert.match(svg, />Bench<tspan/, "short lift names are used when space is tight");
  const xs = [...svg.matchAll(/class="plan-chart-end-label" x="([\d.]+)"/g)].map((match) => Number(match[1]));
  xs.forEach((x) => assert.ok(x < 358 - 80, "labels start early enough to fit their text"));
  const ys = [...svg.matchAll(/class="plan-chart-end-label" x="[\d.]+" y="([\d.]+)"/g)].map((match) => Number(match[1])).sort((a, b) => a - b);
  for (let index = 1; index < ys.length; index += 1) {
    assert.ok(ys[index] - ys[index - 1] >= 15.9, "end labels do not overlap");
  }
  assert.strictEqual((svg.match(/class="plan-chart-leader"/g) || []).length >= 1, true,
    "converging line ends are joined to their labels by leaders");
});

test("a tested max is marked as a measurement", () => {
  const plan = loggedPlan();
  plan.performance.bench.push({ date: "2027-01-20", value: 100, isTest: true });
  const view = harness(960);
  chart.render(view.root, plan, { today: "2027-01-21" });
  assert.match(view.plot.innerHTML, /class="plan-chart-actual is-bench is-test"/);
  assert.match(view.plot.innerHTML, /data-detail="Tested 1RM"/);
});

test("the all-cycles view draws one line per cycle and keeps one legend entry per lift", () => {
  const current = core.generate(sampleState(core), [], { asOfDate: "2026-11-26" });
  const archivedState = sampleState(core, { startDate: "2026-08-03", program: "legacy" });
  archivedState.activeCycle.status = "archived";
  const archived = core.generate(archivedState, []);
  archived.cycleLabel = "Cycle 01";
  current.cycleLabel = "Cycle 02";
  const model = chart.buildSeriesForPlans([archived, current], "2026-11-26");
  assert.strictEqual(model.startDate, "2026-08-03");
  assert.strictEqual(model.series.length, 6);
  assert.deepStrictEqual([...new Set(model.series.map((item) => item.cycleState))], ["archived", "current"]);
  const view = harness(960);
  chart.render(view.root, null, { today: "2026-11-26", plans: [archived, current] });
  assert.strictEqual((view.plot.innerHTML.match(/class="plan-chart-line /g) || []).length, 6);
  assert.strictEqual((view.plot.innerHTML.match(/data-cycle="archived"/g) || []).length >= 3, true);
  assert.strictEqual((view.legend.innerHTML.match(/plan-chart-legend-item/g) || []).length, 5);
  assert.doesNotMatch(view.plot.innerHTML, /plan-chart-end-label/, "overlapping cycles rely on the legend and tooltip");
});

test("a plan without goals shows the empty state", () => {
  const view = harness(960);
  const state = core.createDefaultState("2026-11-02");
  chart.render(view.root, core.generate(state, []), { today: "2026-11-02" });
  assert.strictEqual(view.empty.hidden, false);
  assert.strictEqual(view.plot.hidden, true);
  assert.deepStrictEqual(chart.buildSeries(null, "2026-11-02").series, []);
});
