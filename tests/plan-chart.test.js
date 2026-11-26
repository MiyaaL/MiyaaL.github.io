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

test("a single cycle is drawn as one panel per lift", () => {
  const view = harness(960);
  chart.render(view.root, loggedPlan(), { today: "2026-11-26" });
  const html = view.plot.innerHTML;
  const panels = html.split('<figure class="plan-chart-panel ').slice(1);
  assert.deepStrictEqual(panels.map((panel) => panel.match(/data-chart-panel="(\w+)"/)[1]),
    ["bench", "pullup", "squat"]);
  assert.match(html, /<div class="plan-chart-panels">/, "wide plots put the panels side by side");
  panels.forEach((panel) => {
    assert.match(panel, /viewBox="0 0 304 190"/, "three equal columns share the plot width");
    assert.match(panel, />Start<\/text>/);
    assert.match(panel, />Goal<\/text>/);
    assert.match(panel, />50 %<\/text>/);
    assert.strictEqual((panel.match(/plan-chart-today-line/g) || []).length, 1);
    assert.strictEqual((panel.match(/class="plan-chart-line [^"]*is-programmed"/g) || []).length, 1,
      "the programmed reference is one muted line");
    assert.strictEqual((panel.match(/class="plan-chart-axis-label"[^>]*y="184"/g) || []).length, 3,
      "start, middle and end dates sit under each panel");
  });
  assert.match(panels[0], /plan-chart-panel-name[^>]*>.*Bench press<\/span><span class="plan-chart-panel-range">90 → 100 kg</);
  assert.match(panels[1], /plan-chart-panel-range">10 → \+20 kg added</);
  assert.strictEqual((html.match(/class="plan-chart-actual /g) || []).length, 3, "one marker per logged estimate");
  assert.match(panels[0], /class="plan-chart-latest-label is-bench"[^>]*>[\d.]+ kg<\/text>/,
    "the newest logged estimate is labelled in kilograms");
  assert.doesNotMatch(panels[0], /No 1RM estimate logged yet/);
  assert.match(panels[1], /class="plan-chart-none-label"[^>]*>No 1RM estimate logged yet<\/text>/);
  assert.doesNotMatch(panels[1], /plan-chart-latest-label/);
  assert.match(html, /data-kind="actual"[^>]*data-value="[\d.]+ kg" data-percent="-?\d+ %"/);
  assert.match(html, /tabindex="0"[^>]*data-kind="actual"/, "logged points stay keyboard reachable");
  assert.doesNotMatch(html, /plan-chart-end-label/, "panel titles replace the colliding end labels");
  assert.doesNotMatch(html, /KG<\/text>/, "there is no shared kilogram axis");
  ["Programmed reference", "Logged estimate", "Tested 1RM"].forEach((label) => {
    assert.ok(view.legend.innerHTML.includes("<span>" + label + "</span>"), label + " is in the legend");
  });
  assert.doesNotMatch(view.legend.innerHTML, /Bench press/, "lift names live in the panel titles");
  assert.match(html, /data-chart-tooltip /, "one tooltip serves every panel");
});

test("a narrow plot stacks the panels and keeps their labels inside", () => {
  const view = harness(358);
  chart.render(view.root, loggedPlan(), { today: "2026-11-26" });
  const html = view.plot.innerHTML;
  assert.match(html, /<div class="plan-chart-panels is-stacked">/);
  assert.strictEqual((html.match(/viewBox="0 0 358 190"/g) || []).length, 3, "each panel takes the full width");
  const panel = html.split('<figure class="plan-chart-panel ')[1];
  assert.strictEqual((panel.match(/class="plan-chart-axis-label"[^>]*y="184"/g) || []).length, 2,
    "only the start and end dates are shown when space is tight");
  [...html.matchAll(/class="plan-chart-latest-label[^"]*" x="([\d.]+)" y="([\d.]+)" text-anchor="(\w+)"/g)]
    .forEach((match) => {
      const x = Number(match[1]);
      assert.ok(match[3] === "end" ? x > 60 : x < 358 - 70, "the estimate label fits inside its panel");
      assert.ok(Number(match[2]) > 10 && Number(match[2]) < 170);
    });
});

test("the caption explains the view that is drawn", () => {
  const caption = { textContent: "" };
  const view = harness(960);
  const original = view.root.querySelector;
  view.root.querySelector = (selector) => selector === "[data-plan-chart-caption]" ? caption : original(selector);
  chart.render(view.root, loggedPlan(), { today: "2026-11-26" });
  assert.match(caption.textContent, /grey line is the programmed reference/);
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
