"use strict";

// The overview above the calendar: the three lift tiles, the program note and
// the status styling of calendar cells.
const assert = require("node:assert");
const { test } = require("node:test");
const core = require("../assets/js/plan-core.js");
const { loadPlanPage, sampleState, logAsPrescribed, createMemoryAdapter } = require("./helpers/dom.js");

const TODAY = "2026-11-26";

async function ownerPage(state, options) {
  const store = createMemoryAdapter({ version: state.version || 1, state, signedIn: true });
  const page = await loadPlanPage(Object.assign({ today: TODAY, store }, options || {}));
  return page;
}

function tile(page, key) {
  return page.$('.plan-progress-item[data-plan-lift="' + key + '"]');
}

test("each lift tile leads with the estimated 1RM and says how it stands against the plan", async () => {
  const page = await ownerPage(sampleState(core));
  const bench = tile(page, "bench");
  assert.strictEqual(bench.querySelector(".plan-progress-value b").textContent, "90");
  assert.strictEqual(bench.querySelector(".plan-progress-goal").textContent, "of 100 kg goal");
  assert.strictEqual(tile(page, "pullup").querySelector(".plan-progress-value b").textContent, "+10");
  assert.match(tile(page, "pullup").querySelector(".plan-progress-value").textContent, /kg added/);
  assert.strictEqual(tile(page, "pullup").querySelector(".plan-progress-goal").textContent, "of +20 kg goal");

  // Nothing is logged, so the estimate sits at the start while the reference has moved on.
  const track = bench.querySelector(".plan-progress-track");
  assert.ok(track.classList.contains("is-at-start"), "an empty bar shows a start tick instead of nothing");
  const marker = track.querySelector("i");
  assert.ok(marker, "the programmed reference for today is marked on the bar");
  const reference = page.chart.buildSeries(page.core.generate(sampleState(core), [], { asOfDate: TODAY }), TODAY)
    .series.find((item) => item.key === "bench").today;
  assert.strictEqual(marker.style.getPropertyValue("--plan-reference"), reference.percent.toFixed(1) + "%",
    "the marker and the chart read the same reference");
  const status = bench.querySelector(".plan-progress-status");
  if (reference.value - 90 >= 0.5) {
    assert.ok(status.classList.contains("is-warn"));
    assert.match(status.textContent, /^Behind plan by [\d.]+ kg$/);
  } else {
    assert.ok(status.classList.contains("is-ok"));
    assert.strictEqual(status.textContent, "On track");
  }
  assert.match(bench.querySelector(".plan-progress-key").textContent, /Programmed reference today/);
  page.close();
});

test("a lift at its goal is reported as reached and fills the bar", async () => {
  const state = sampleState(core);
  state.activeCycle.lifts.squat.current1rm = state.activeCycle.lifts.squat.target1rm;
  const page = await ownerPage(state);
  const squat = tile(page, "squat");
  const status = squat.querySelector(".plan-progress-status");
  assert.strictEqual(status.textContent, "Goal reached");
  assert.ok(status.classList.contains("is-ok"));
  assert.strictEqual(squat.querySelector(".plan-progress-track span").style.getPropertyValue("--plan-progress"), "100.0%");
  assert.ok(!squat.querySelector(".plan-progress-track").classList.contains("is-at-start"));
  page.close();
});

test("the program description is a paragraph and other notes sit under a Note label", async () => {
  const page = await ownerPage(sampleState(core));
  const box = page.$("[data-plan-warnings]");
  assert.strictEqual(box.hidden, false);
  const about = box.querySelectorAll("p.plan-note");
  assert.strictEqual(about.length, 1);
  assert.match(about[0].textContent, /^Three build weeks/);
  assert.strictEqual(box.querySelectorAll(":scope > ul").length, 0, "a single note is not a one-item list");
  const warn = box.querySelector(".plan-note-warn");
  if (warn) {
    assert.strictEqual(warn.querySelector(".plan-note-label").textContent, "Note");
    const items = warn.querySelectorAll("li").length;
    assert.ok(items === 0 ? warn.querySelector("p") : items >= 2, "a list is used only for two or more notes");
  }
  page.close();
});

test("calendar cells carry their outcome and week type as a class and a chip", async () => {
  let state = sampleState(core);
  const first = core.generate(state, [], { asOfDate: "2026-11-02" });
  state = logAsPrescribed(core, first.state, first.sessions[0]);
  const page = await ownerPage(state);
  // Step back from late November to the month the cycle starts in if needed.
  const done = page.$('.plan-day[data-plan-date="2026-11-02"]');
  assert.ok(done.classList.contains("is-completed"));
  assert.strictEqual(done.querySelector(".plan-day-top .plan-day-status").textContent, "Done");
  assert.ok(done.querySelector(".plan-day-top .plan-day-number"), "the date and status share the top row");
  assert.strictEqual(done.tagName, "BUTTON");

  const missed = page.$$(".plan-day.is-missed");
  assert.ok(missed.length > 0, "past unlogged sessions are marked");
  assert.strictEqual(missed[0].querySelector(".plan-day-status").textContent, "Missed");

  const rest = page.$$(".plan-day.is-rest");
  assert.ok(rest.length > 0);
  rest.forEach((cell) => assert.strictEqual(cell.querySelector(".plan-day-status"), null, "rest days stay quiet"));
  assert.strictEqual(page.$$(".plan-day.is-today").length, 1);

  const planned = page.$$(".plan-day[data-session-id]").filter((cell) =>
    !/is-(completed|missed|skipped|test|deload)/.test(cell.className));
  planned.forEach((cell) => assert.strictEqual(cell.querySelector(".plan-day-status"), null,
    "plain planned sessions carry no chip"));
  page.close();
});

test("test and deload weeks are tinted before they happen, and the agenda shows the same chips", async () => {
  const state = sampleState(core);
  const plan = core.generate(state, [], { asOfDate: TODAY });
  const test1 = plan.sessions.find((session) => session.phase && session.phase.key === "test" && session.date > TODAY);
  const deload = plan.sessions.find((session) => session.phase && session.phase.key === "deload" && session.date > TODAY);
  assert.ok(test1 && deload, "the fixture has an upcoming test and deload");

  const page = await ownerPage(state, { mobile: true });
  const goTo = async (date) => {
    for (let guard = 0; guard < 20; guard += 1) {
      if (page.$('.plan-agenda-session[data-session-id="' + date.id + '"]')) return;
      page.$("[data-plan-next]").click();
    }
  };
  await goTo(deload);
  const deloadRow = page.$('.plan-agenda-session[data-session-id="' + deload.id + '"]');
  assert.ok(deloadRow.classList.contains("is-deload"));
  assert.strictEqual(deloadRow.querySelector(".plan-day-status").textContent, "Deload");
  await goTo(test1);
  const testRow = page.$('.plan-agenda-session[data-session-id="' + test1.id + '"]');
  assert.ok(testRow.classList.contains("is-test"));
  assert.strictEqual(testRow.querySelector(".plan-day-status").textContent, "Test");
  assert.ok(testRow.getAttribute("aria-label"));
  page.close();
});
