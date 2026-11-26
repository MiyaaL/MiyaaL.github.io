"use strict";

// "Adjust plan to my training": nothing reshapes the plan until the owner asks.
const assert = require("node:assert");
const { test } = require("node:test");
const { createPlanWindow, startPlanApp, settle, logAsPrescribed, holidays } = require("./helpers/dom.js");

async function ownerPage(today, prepare) {
  const { window } = createPlanWindow({ today });
  const core = window.PlanCore;
  let state = core.createDefaultState("2026-11-02");
  Object.assign(state.activeCycle, { status: "active", endDate: "2027-01-29", requestedEndDate: "2027-01-29" });
  state.activeCycle.bodyweightEntries = [{ date: "2026-11-02", value: 72 }];
  const lifts = { bench: [90, 100], pullup: [10, 20], squat: [110, 120] };
  Object.keys(lifts).forEach((key) => {
    Object.assign(state.activeCycle.lifts[key], {
      baseline1rm: lifts[key][0], current1rm: lifts[key][0], target1rm: lifts[key][1],
      assessed1rm: lifts[key][0], assessedOn: "2026-11-01"
    });
  });
  if (prepare) state = prepare(core, state);
  const memory = window.PlanStore.createMemoryAdapter({ version: 1, state, signedIn: true });
  window.PlanStore.createSupabaseAdapter = () => memory;
  startPlanApp(window);
  await settle(window);
  return { window, core, memory, $: (selector) => window.document.querySelector(selector) };
}

function logFirstWeek(core, state) {
  const calendars = [holidays(2026), holidays(2027)];
  core.generate(state, calendars, { asOfDate: "2026-11-02" }).sessions
    .filter((session) => session.date <= "2026-11-08").forEach((session) => {
      const plan = core.generate(state, calendars, { asOfDate: session.date });
      state = logAsPrescribed(core, plan.state, plan.sessions.find((item) => item.id === session.id));
    });
  return state;
}

test("missed sessions are only labelled until the owner adjusts the plan", async () => {
  const page = await ownerPage("2026-11-30", logFirstWeek);
  const button = page.$("[data-plan-review]");
  assert.strictEqual(button.hidden, false, "the owner sees the adjust action");
  assert.ok(page.window.document.querySelectorAll(".plan-day.is-missed, .plan-agenda-session.is-missed").length > 0,
    "unlogged past sessions are shown as missed");
  const stored = await page.memory.loadPrivate();
  assert.strictEqual(stored.version, 1, "opening the page saves nothing");
  assert.strictEqual(page.core.trainingReviewDate(stored.state.activeCycle), null);

  button.click();
  const dialog = page.$("[data-plan-review-dialog]");
  assert.strictEqual(dialog.open, true);
  assert.match(page.$("[data-plan-review-summary]").textContent, /sessions are marked missed/);
  assert.ok(page.window.document.querySelectorAll("[data-plan-review-changes] tbody tr").length > 0,
    "the preview lists the sessions that would change");
  assert.strictEqual(page.$("[data-plan-review-clear]").hidden, true, "nothing to undo yet");
  assert.strictEqual((await page.memory.loadPrivate()).version, 1, "previewing saves nothing");

  page.$("[data-plan-review-apply]").click();
  await settle(page.window);
  const after = await page.memory.loadPrivate();
  assert.strictEqual(after.version, 2, "confirming saves once");
  assert.strictEqual(page.core.trainingReviewDate(after.state.activeCycle), "2026-11-30");
  assert.strictEqual(dialog.open, false);
  page.window.close();
});

test("an adjusted plan can be returned to the programmed line", async () => {
  const page = await ownerPage("2026-11-30", (core, state) => core.applyTrainingReview(logFirstWeek(core, state), "2026-11-30"));
  page.$("[data-plan-review]").click();
  assert.match(page.$("[data-plan-review-note]").textContent, /Last adjusted on/);
  assert.strictEqual(page.$("[data-plan-review-apply]").disabled, true, "adjusting again on the same day changes nothing");
  const clear = page.$("[data-plan-review-clear]");
  assert.strictEqual(clear.hidden, false);
  clear.click();
  await settle(page.window);
  const stored = await page.memory.loadPrivate();
  assert.strictEqual(page.core.trainingReviewDate(stored.state.activeCycle), null);
  page.window.close();
});

test("visitors never see the adjust action", async () => {
  const { loadPlanPage } = require("./helpers/dom.js");
  const page = await loadPlanPage({ today: "2026-11-30" });
  assert.strictEqual(page.$("[data-plan-review]").closest("[data-plan-owner-actions]").hidden, true);
  page.close();
});
