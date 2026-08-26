"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

function waitForRender() {
  return new Promise((resolve) => setTimeout(resolve, 50));
}

function drag(window, source, target) {
  const values = {};
  const dataTransfer = {
    effectAllowed: "",
    dropEffect: "",
    setData(type, value) {
      values[type] = value;
    },
    getData(type) {
      return values[type] || "";
    }
  };
  ["dragstart", "dragover", "drop"].forEach((type) => {
    const event = new window.Event(type, { bubbles: true, cancelable: true });
    Object.defineProperty(event, "dataTransfer", { value: dataTransfer });
    (type === "dragstart" ? source : target).dispatchEvent(event);
  });
  const dragend = new window.Event("dragend", { bubbles: true, cancelable: true });
  Object.defineProperty(dragend, "dataTransfer", { value: dataTransfer });
  source.dispatchEvent(dragend);
}

(async function () {
  const page = fs.readFileSync("/site/_site/plan/index.html", "utf8");
  const holidays = JSON.parse(fs.readFileSync("/site/assets/data/holidays/cn-2026.json", "utf8"));
  const dom = new JSDOM(page, {
    url: "https://miyaal.github.io/plan/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  const NativeDate = window.Date;
  const fixedNow = new NativeDate("2026-08-26T12:00:00+08:00").getTime();
  window.Date = class FixedDate extends NativeDate {
    constructor(...args) {
      super(...(args.length ? args : [fixedNow]));
    }
    static now() {
      return fixedNow;
    }
  };
  window.matchMedia = () => ({
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  });
  window.fetch = async () => ({ ok: true, json: async () => holidays });
  window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};

  window.eval(fs.readFileSync("/site/assets/js/plan-core.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-store.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-chart.js", "utf8"));

  let state = window.PlanCore.createDefaultState("2026-08-03");
  state.activeCycle.endDate = "2026-10-25";
  state.activeCycle.status = "active";
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  state.activeCycle.lifts.bench.current1rm = 100;
  state.activeCycle.lifts.bench.target1rm = 110;
  state.activeCycle.lifts.pullup.current1rm = 30;
  state.activeCycle.lifts.pullup.target1rm = 40;
  state.activeCycle.lifts.squat.current1rm = 150;
  state.activeCycle.lifts.squat.target1rm = 165;
  const initial = window.PlanCore.generate(state, [holidays]);
  const completedSource = initial.sessions.find((session) => session.date === "2026-08-24");
  const completedTarget = initial.sessions.find((session) => session.date === "2026-08-26");
  state = window.PlanCore.recordSession(state, completedSource, {
    status: "completed",
    mainSets: [{ weight: 95, reps: 1, rpe: 8, completed: true }]
  });
  state = window.PlanCore.recordSession(state, completedTarget, {
    status: "completed",
    mainSets: [{ weight: 140, reps: 1, rpe: 8, completed: true }]
  });

  const memory = window.PlanStore.createMemoryAdapter({ version: 0, state, signedIn: true });
  const save = memory.save;
  let rejectNextSave = false;
  memory.save = async function (...args) {
    if (rejectNextSave) {
      rejectNextSave = false;
      throw new Error("simulated_save_failure");
    }
    return save(...args);
  };
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));
  await waitForRender();

  const cell = (date) => window.document.querySelector(`[data-plan-date="${date}"]`);
  const replacementSourceId = initial.sessions.find((session) => session.date === "2026-08-28").id;
  const replacementTargetId = initial.sessions.find((session) => session.date === "2026-08-25").id;
  assert.strictEqual(cell("2026-08-28").draggable, true);
  assert.strictEqual(cell("2026-08-24").draggable, true, "completed sessions must support correcting their date");
  const originalPlannedX = window.document.querySelector(
    '[data-chart-point][data-series="Bench Press"][data-date="2026-08-28"]'
  ).dataset.x;
  const originalCompletedX = window.document.querySelector(
    '[data-chart-point][data-series="Bench Press"][data-date="2026-08-24"]'
  ).dataset.x;
  const confirmDialog = window.document.querySelector("[data-plan-move-confirm]");

  drag(window, cell("2026-08-28"), cell("2026-08-26"));
  assert.strictEqual(confirmDialog.open, false);
  assert(window.document.querySelector("[data-plan-message]").textContent.includes("已有训练记录"));
  assert.strictEqual((await memory.loadPrivate()).version, 0);
  assert.strictEqual(cell("2026-08-26").dataset.sessionId, completedTarget.id);
  await new Promise((resolve) => setTimeout(resolve, 0));

  cell("2026-08-28").click();
  const drawer = window.document.querySelector("[data-plan-drawer]");
  assert.strictEqual(drawer.hidden, false);
  drawer.querySelector("[data-move-date]").value = "2026-08-25";
  drawer.querySelector("[data-move-session]").click();
  assert.strictEqual(confirmDialog.open, true, "detail rescheduling must use the same replacement confirmation");
  window.document.dispatchEvent(new window.KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  assert.strictEqual(drawer.hidden, false, "Escape for a modal must not close the detail drawer behind it");
  confirmDialog.querySelector("[data-plan-cancel-move]").click();
  window.document.querySelector("[data-plan-close-details]").click();

  const firstDraggedCell = cell("2026-08-28");
  drag(window, firstDraggedCell, cell("2026-08-25"));
  firstDraggedCell.click();
  assert.strictEqual(window.document.querySelector("[data-plan-drawer]").hidden, true);
  assert.strictEqual(confirmDialog.open, true);
  assert(confirmDialog.querySelector("[data-plan-move-confirm-message]").textContent.includes("2026年8月25日"));
  assert(confirmDialog.querySelector("[data-plan-move-confirm-message]").textContent.includes("拉"));
  const beforeConfirmation = await memory.loadPrivate();
  assert.strictEqual(beforeConfirmation.version, 0, "opening confirmation must not save early");
  assert.deepStrictEqual(
    JSON.parse(JSON.stringify(beforeConfirmation.state.activeCycle.sessionOverrides)),
    {},
    "opening confirmation must not mutate overrides"
  );

  confirmDialog.querySelector("[data-plan-cancel-move]").click();
  assert.strictEqual(confirmDialog.open, false);
  assert.strictEqual(cell("2026-08-28").dataset.sessionId, replacementSourceId);
  assert.strictEqual(cell("2026-08-25").dataset.sessionId, replacementTargetId);

  drag(window, cell("2026-08-28"), cell("2026-08-25"));
  confirmDialog.querySelector("[data-plan-confirm-move]").click();
  await waitForRender();
  let stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 1);
  assert.strictEqual(cell("2026-08-28").dataset.sessionId, undefined);
  assert.strictEqual(cell("2026-08-25").dataset.sessionId, replacementSourceId);
  assert.strictEqual(window.document.querySelector(`[data-session-id="${replacementTargetId}"]`), null);
  const movedPlannedPoint = window.document.querySelector(
    '[data-chart-point][data-series="Bench Press"][data-date="2026-08-25"]'
  );
  assert(movedPlannedPoint);
  assert.notStrictEqual(movedPlannedPoint.dataset.x, originalPlannedX);
  assert.strictEqual(
    window.document.querySelector('[data-chart-point][data-series="Bench Press"][data-date="2026-08-28"]'),
    null
  );
  assert.strictEqual(
    window.document.querySelector('[data-chart-point][data-series="Weighted Pull-up"][data-date="2026-08-25"]'),
    null
  );
  let publicRecord = await memory.loadPublic();
  assert.strictEqual(
    publicRecord.record.snapshot.sessions.find((session) => session.id === replacementSourceId).date,
    "2026-08-25"
  );
  assert.strictEqual(
    publicRecord.record.snapshot.sessions.some((session) => session.id === replacementTargetId),
    false
  );

  drag(window, cell("2026-08-24"), cell("2026-08-27"));
  await waitForRender();
  stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(stored.state.logs[completedSource.id].sessionSnapshot.date, "2026-08-27");
  assert.strictEqual(cell("2026-08-24").dataset.sessionId, undefined);
  assert.strictEqual(cell("2026-08-27").dataset.sessionId, completedSource.id);
  const movedCompletedPoint = window.document.querySelector(
    '[data-chart-point][data-series="Bench Press"][data-date="2026-08-27"]'
  );
  assert(movedCompletedPoint);
  assert.notStrictEqual(movedCompletedPoint.dataset.x, originalCompletedX);
  assert.strictEqual(
    window.document.querySelector('[data-chart-point][data-series="Bench Press"][data-date="2026-08-24"]'),
    null
  );
  publicRecord = await memory.loadPublic();
  assert.strictEqual(
    publicRecord.record.snapshot.sessions.find((session) => session.id === completedSource.id).date,
    "2026-08-27"
  );

  rejectNextSave = true;
  drag(window, cell("2026-08-27"), cell("2026-08-29"));
  await waitForRender();
  stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 2);
  assert.strictEqual(stored.state.logs[completedSource.id].sessionSnapshot.date, "2026-08-27");
  assert.strictEqual(cell("2026-08-27").dataset.sessionId, completedSource.id);
  assert.strictEqual(cell("2026-08-29").dataset.sessionId, undefined);
  assert(window.document.querySelector("[data-plan-message]").textContent.includes("保存失败"));

  drag(window, cell("2026-08-27"), cell("2026-08-30"));
  await waitForRender();
  stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 3);
  assert.strictEqual(stored.state.logs[completedSource.id].sessionSnapshot.date, "2026-08-30");
  assert.strictEqual(stored.state.activeCycle.sessionOverrides[completedSource.id].date, "2026-08-30");
  assert.strictEqual(cell("2026-08-29").dataset.sessionId, undefined, "failed move must not leak into a later save");

  console.log("PASS: owner calendar drag moves, confirms replacements, and updates Progress Overview dates");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
