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
  const media = {
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  };
  window.matchMedia = () => media;
  window.fetch = async () => ({ ok: true, json: async () => holidays });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};

  window.eval(fs.readFileSync("/site/assets/js/plan-core.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-store.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-chart.js", "utf8"));

  // Two cycles that overlap in August: the archived cycle is still running when the
  // current one starts, which is exactly the case the all view has to show.
  const state = window.PlanCore.createDefaultState("2026-08-10");
  state.activeCycle.endDate = "2026-10-25";
  state.activeCycle.status = "active";
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-10", value: 70 }];
  const archivedState = window.PlanCore.createDefaultState("2026-07-06");
  archivedState.activeCycle.endDate = "2026-09-13";
  archivedState.activeCycle.status = "archived";
  archivedState.activeCycle.bodyweightEntries = [{ date: "2026-07-06", value: 71 }];
  archivedState.activeCycle.lifts.bench.current1rm = 95;
  archivedState.activeCycle.lifts.bench.target1rm = 100;
  state.activeCycle.lifts.bench.current1rm = 100;
  state.activeCycle.lifts.bench.target1rm = 110;
  const archivedCycle = {
    cycle: archivedState.activeCycle,
    logs: {},
    archivedAt: "2026-07-20T00:00:00.000Z"
  };
  const withArchive = JSON.parse(JSON.stringify(state));
  withArchive.archivedCycles = [archivedCycle];

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state: withArchive, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));
  await new Promise((resolve) => setTimeout(resolve, 50));

  const document = window.document;
  const cycleSelect = document.querySelector("[data-plan-cycle-select]");
  assert.strictEqual(cycleSelect.options[0].value, "all");

  cycleSelect.value = "all";
  cycleSelect.dispatchEvent(new window.Event("change"));

  // Bodyweight-only lines would still render, but the lift overlap needs configured lifts.
  const archivedPlan = window.PlanCore.generate(archivedState, [holidays]);
  const currentPlan = window.PlanCore.generate(state, [holidays]);
  const sharedDates = currentPlan.sessions
    .map((session) => session.date)
    .filter((date) => archivedPlan.sessions.some((session) => session.date === date));
  assert(sharedDates.length, "the fixture needs an overlapping training date");

  function sharedCellFor() {
    return sharedDates
      .map((date) => document.querySelector('[data-plan-date="' + date + '"]'))
      .find((cell) => cell && cell.querySelectorAll(".plan-day-session").length === 2);
  }

  // A month grid also renders the tail of the neighbouring months, so stepping back
  // far enough guarantees the first overlap lands inside the visible grid.
  for (let step = 0; step < 6 && !sharedCellFor(); step += 1) {
    document.querySelector("[data-plan-previous]").click();
  }
  const sharedCell = sharedCellFor();
  assert(sharedCell, "a date holding sessions from both cycles stacks them in one cell");
  const tags = [...sharedCell.querySelectorAll(".plan-day-cycle")].map((node) => node.textContent);
  assert.deepStrictEqual(tags.sort(), ["Cycle 01", "Cycle 02"]);
  assert.strictEqual(sharedCell.dataset.sessionId, undefined, "a stacked day is opened through its entries");
  assert.strictEqual(document.querySelectorAll('[draggable="true"]').length, 0,
    "the all view never allows dragging");

  const archivedEntry = sharedCell.querySelector('.plan-day-session[data-session-id^="cycle-2026-07-06:"]');
  assert(archivedEntry, "the archived cycle's session is reachable");
  archivedEntry.click();
  assert.strictEqual(document.querySelector("[data-plan-drawer]").hidden, false,
    "a historical session opens its details from the all view");
  assert.strictEqual(document.querySelector("[data-save-log]"), null,
    "archived sessions stay read-only");
  document.querySelector("[data-plan-close-details]").click();

  const benchLines = [...document.querySelectorAll(".plan-chart-line.is-bench")];
  assert.strictEqual(benchLines.length, 2, "every cycle gets its own bench line");
  assert.strictEqual(benchLines.filter((line) => line.dataset.cycle === "archived").length, 1);

  const startDates = [...document.querySelectorAll("[data-chart-point]")]
    .map((point) => point.dataset.date)
    .sort();
  assert.strictEqual(startDates[0], "2026-07-06", "the x domain starts with the oldest cycle");
  assert(document.querySelector('[data-chart-point][data-date="2026-10-25"]'),
    "the x domain ends with the newest cycle");

  console.log("PASS: the all-cycles view overlays every cycle on the chart and calendar without editing");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
