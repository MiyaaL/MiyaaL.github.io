"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const page = fs.readFileSync("/site/_site/plan/index.html", "utf8");
const holidays = JSON.parse(fs.readFileSync("/site/assets/data/holidays/cn-2026.json", "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 50));
const revision = {
  id: "linear-wave-2026-09-23",
  cycleId: "cycle-2026-08-03",
  fromDate: "2026-09-25",
  anchorDate: "2026-09-28",
  endDate: "2026-10-31",
  targets: { bench: 100, squat: 120, pullup: 20 }
};

function legacyState(core) {
  let state = core.createDefaultState("2026-08-03");
  Object.assign(state.activeCycle, {
    status: "active",
    endDate: "2026-10-31",
    requestedEndDate: "2026-10-31",
    bodyweightEntries: [
      { date: "2026-08-03", value: 70 },
      { date: "2026-09-14", value: 70.5 }
    ]
  });
  for (const [key, current, target] of [["bench", 85, 100], ["squat", 100, 120], ["pullup", 2.5, 20]]) {
    Object.assign(state.activeCycle.lifts[key], {
      baseline1rm: current, assessed1rm: current, current1rm: current, target1rm: target
    });
  }
  const sessions = core.generate(state, [holidays], { asOfDate: "2026-09-23" }).sessions;
  for (const [date, weight] of [["2026-09-14", 85], ["2026-09-09", 100]]) {
    const session = sessions.find((candidate) => candidate.date === date);
    const mainSets = [{ weight, reps: 1, rpe: null, completed: true }];
    if (date === "2026-09-14") {
      session.workout.workSets = [
        { label: "顶组", sets: 1, reps: 1, loadKg: 85 },
        { label: "主训练", sets: 5, reps: 3, loadKg: 75 }
      ];
      mainSets.push(...Array.from({ length: 5 }, () => ({ weight: 75, reps: 3, rpe: null, completed: true })));
    }
    state = core.recordSession(state, session, {
      status: "completed",
      mainSets,
      notes: "保留实际完成重量，未记录 RPE"
    });
  }
  state.activeCycle.scheduleAdjustments = [{
    id: "legacy-week-deferral", fromDate: "2026-09-15", days: 7
  }];
  const learning = core.createDefaultLearningPlan("2026-09-01", "2026-09-30", {
    id: "learning-preserved", title: "CS336", acceptanceCriteria: ["完成笔记"]
  });
  state.learningPlans = [learning];
  state = core.recordLearningSession(state, learning.id, core.generateLearningPlan(learning).sessions[0], {
    reflection: "学习反思不应被健身排期修改",
    criteria: ["criterion-1"],
    artifacts: [{ id: "notes", name: "notes.md", size: 1, dataUrl: "data:text/plain;base64,eA==" }]
  });
  return core.generate(state, [holidays], { asOfDate: "2026-09-23" }).state;
}

async function boot(options = {}) {
  const dom = new JSDOM(page, {
    url: "https://miyaal.github.io/plan/", runScripts: "outside-only", pretendToBeVisual: true
  });
  const { window } = dom;
  const NativeDate = window.Date;
  let now = new NativeDate("2026-09-23T12:00:00+08:00").getTime();
  window.Date = class FixedDate extends NativeDate {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  };
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = async () => ({ ok: !options.holidaysUnavailable, json: async () => holidays });
  window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};
  window.document.querySelector("[data-plan-app]").dataset.scheduleRevision = JSON.stringify(revision);
  for (const script of ["plan-core", "plan-store", "plan-chart"]) {
    window.eval(fs.readFileSync(`/site/assets/js/${script}.js`, "utf8"));
  }
  const core = window.PlanCore;
  const state = legacyState(core);
  if (options.changeState) options.changeState(state, core);
  state.version = 74;
  const snapshot = core.createPublicSnapshot(state, core.generate(state, [holidays], { asOfDate: "2026-09-23" }));
  const originalState = plain(state);
  const originalSnapshot = plain(snapshot);
  const memory = window.PlanStore.createMemoryAdapter({
    version: 74, state, snapshot, signedIn: options.signedIn !== false
  });
  const save = memory.save;
  const calls = [];
  let saveError = options.saveError;
  let nextSaveGate = null;
  memory.save = async (...args) => {
    calls.push(plain(args));
    if (saveError) throw Object.assign(new Error(saveError), { code: saveError });
    const gate = nextSaveGate;
    nextSaveGate = null;
    if (gate) {
      gate.started();
      await gate.released;
    }
    return save(...args);
  };
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));
  await waitForRender();
  return {
    window, core, memory, calls, originalState, originalSnapshot,
    clearSaveError() { saveError = null; },
    holdNextSave() {
      let started;
      let release;
      const signal = new Promise((resolve) => { started = resolve; });
      const released = new Promise((resolve) => { release = resolve; });
      nextSaveGate = { started, released };
      return { started: signal, release };
    },
    setToday(date) { now = new NativeDate(`${date}T12:00:00+08:00`).getTime(); },
    async reload() {
      window.dispatchEvent(new window.Event("online"));
      await waitForRender();
    },
    message() { return window.document.querySelector("[data-plan-message]").textContent; },
    close() { window.close(); }
  };
}

function preservedState(state) {
  return plain({
    logs: state.logs,
    bodyweightEntries: state.activeCycle.bodyweightEntries,
    learningPlans: state.learningPlans,
    archivedCycles: state.archivedCycles,
    targets: Object.fromEntries(Object.entries(state.activeCycle.lifts).map(([key, lift]) => [key, lift.target1rm]))
  });
}

async function unchanged(app) {
  const record = await app.memory.loadPrivate();
  assert.strictEqual(record.version, 74);
  assert.deepStrictEqual(plain(record.state), app.originalState, "a rejected migration must not mutate stored owner data");
  assert.deepStrictEqual(plain((await app.memory.loadPublic()).record.snapshot), app.originalSnapshot);
  assert(!app.window.document.querySelector("[data-plan-settings]").open);
}

const failures = [];
async function check(name, options, run) {
  const app = await boot(options);
  try {
    await run(app);
    console.log("PASS:", name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL:", name, error.stack);
  } finally {
    app.close();
  }
}

(async function () {
  await check("opening the owner plan applies and publishes the agreed schedule once", {}, async (app) => {
    let stored = await app.memory.loadPrivate();
    assert.strictEqual(stored.version, 75, "opening the plan must persist the authorized revision without editing settings");
    assert.strictEqual(app.calls.length, 1);
    assert.strictEqual(app.calls[0][0], 74, "migration uses optimistic version checking");
    assert.strictEqual(stored.state.activeCycle.endDate, "2026-10-31");
    assert.strictEqual(stored.state.activeCycle.requestedEndDate, "2026-10-31");
    assert.strictEqual(stored.state.activeCycle.scheduleRevision, revision.id);
    assert.strictEqual(stored.state.activeCycle.progression.kind, "linear-wave");
    assert.strictEqual(stored.state.activeCycle.progression.anchorDate, revision.anchorDate);
    assert.deepStrictEqual(plain(stored.state.activeCycle.progression.anchor1rm), { bench: 85, squat: 100, pullup: 2.5 });
    assert.deepStrictEqual(preservedState(stored.state), preservedState(app.originalState));
    const historicalCard = app.window.document.querySelector('[data-plan-date="2026-09-14"][data-session-id]');
    assert.strictEqual(historicalCard.querySelector(".plan-day-load").textContent, "5×3 · 75 kg", "calendar summaries show the main work instead of a single heavy top set");
    historicalCard.click();
    const detailGroups = Array.from(app.window.document.querySelectorAll("[data-plan-detail-body] .plan-session-section:first-of-type .plan-set-list li"), (item) => item.textContent);
    assert.deepStrictEqual(detailGroups, ["顶组1×1 · 85 kg", "主训练5×3 · 75 kg"], "details preserve both the recorded top set and main work");
    app.window.document.querySelector("[data-plan-close-details]").click();
    const generated = app.core.generate(stored.state, [holidays], { asOfDate: "2026-09-23" });
    assert(generated.sessions.some((session) => session.date === "2026-09-25"));
    assert(app.window.document.querySelector('[data-plan-date="2026-09-25"][data-session-id]'), "the resumed session is visible immediately");
    assert(app.window.document.querySelector("[data-plan-cycle-select]").textContent.includes("2026.10.31"));
    assert.deepStrictEqual(plain(generated.sessions
      .filter((session) => session.date >= "2026-10-05" && session.date <= "2026-10-11")
      .map((session) => session.date)), ["2026-10-05", "2026-10-06", "2026-10-07", "2026-10-09"]);
    assert(generated.sessions.every((session) => session.date <= "2026-10-31"));
    const published = (await app.memory.loadPublic()).record.snapshot;
    assert.strictEqual(published.cycle.endDate, "2026-10-31");
    assert.deepStrictEqual(plain(published.sessions.map((session) => session.date)), plain(generated.sessions.map((session) => session.date)));
    assert(!JSON.stringify(published).includes("学习反思不应被健身排期修改"));
    assert(!JSON.stringify(published).includes("data:text/plain"));
    assert(!app.window.document.querySelector("[data-plan-settings]").open);

    const firstProgression = plain(stored.state.activeCycle.progression);
    const firstSchedule = plain(stored.state.activeCycle.replannedSchedule);
    app.setToday("2026-09-29");
    await app.reload();
    await app.reload();
    stored = await app.memory.loadPrivate();
    assert.strictEqual(stored.version, 75);
    assert.strictEqual(app.calls.length, 1, "reloading an applied revision must not save again");
    assert.deepStrictEqual(plain(stored.state.activeCycle.progression), firstProgression);
    assert.deepStrictEqual(plain(stored.state.activeCycle.replannedSchedule), firstSchedule);
    assert.strictEqual(published.cycle.scheduleRevision, revision.id);
  });

  await check("an older replan cannot freeze pending recovery sessions after the revision", { changeState: (state, core) => {
    Object.assign(state, core.replanRemaining(state, [holidays], {
      fromDate: "2026-09-25", endDate: "2026-10-31", trainOnHolidays: true, asOfDate: "2026-09-23"
    }));
    for (const [type, date] of [["pull", "2026-09-23"], ["squat", "2026-09-24"]]) {
      const retained = state.activeCycle.replannedSchedule.retainedSessions.find((session) => session.type === type && session.date >= "2026-09-22");
      assert(retained, `legacy retained ${type} session exists`);
      retained.date = date;
    }
    for (const date of ["2026-09-23", "2026-09-24"]) {
      const retained = state.activeCycle.replannedSchedule.retainedSessions.find((session) => session.date === date);
      assert(retained, `legacy retained session exists on ${date}`);
      retained.phase = { key: "return", label: "恢复训练", weekIndex: 0, blockWeek: 0 };
      retained.isReturn = true;
      retained.trainingWeek = 0;
      retained.testReady = false;
      retained.testProvisional = false;
      retained.isTest = false;
      retained.workout.workSets = [{ label: "恢复组", sets: 2, reps: 5, loadKg: date === "2026-09-24" ? 67.5 : -17.5 }];
    }
    const old = core.generate(state, [holidays], { asOfDate: "2026-09-23" });
    assert(old.sessions.filter((session) => ["2026-09-23", "2026-09-24"].includes(session.date)).every((session) => session.phase.key === "return"), "fixture reproduces the frozen old recovery prescriptions");
  } }, async (app) => {
    const stored = await app.memory.loadPrivate();
    assert.strictEqual(stored.version, 75);
    assert.strictEqual(stored.state.activeCycle.scheduleRevision, revision.id);
    assert.deepStrictEqual(preservedState(stored.state), preservedState(app.originalState));
    const generated = app.core.generate(stored.state, [holidays], { asOfDate: "2026-09-23" });
    for (const date of ["2026-09-23", "2026-09-24"]) {
      const original = app.originalState.activeCycle.replannedSchedule.retainedSessions.find((session) => session.date === date);
      const session = generated.sessions.find((candidate) => candidate.date === date);
      assert.strictEqual(session.id, original.id, "pending sessions keep their calendar identity");
      assert.strictEqual(session.phase.key, "deload", `the agreed wave recalculates the pending session on ${date}`);
      assert(!session.isReturn, "legacy recovery markers are removed before publishing the revision");
      assert(!session.workout.workSets.some((set) => set.label === "恢复组"));
    }
    const published = (await app.memory.loadPublic()).record.snapshot;
    assert.strictEqual(published.cycle.scheduleRevision, revision.id);
    assert(published.sessions.filter((session) => ["2026-09-23", "2026-09-24"].includes(session.date)).every((session) => session.phase.key === "deload"));
  });

  await check("failed automatic save preserves the plan and can retry on reload", { saveError: "offline_test" }, async (app) => {
    assert.strictEqual(app.calls.length, 1, "owner boot attempts the migration");
    await unchanged(app);
    assert(app.message().includes("失败"), "show the owner that the agreed schedule has not been saved");
    app.clearSaveError();
    await app.reload();
    const stored = await app.memory.loadPrivate();
    assert.strictEqual(stored.version, 75);
    assert.strictEqual(stored.state.activeCycle.scheduleRevision, revision.id);
    assert.deepStrictEqual(preservedState(stored.state), preservedState(app.originalState));
  });

  await check("simultaneous online reloads share one migration save", { saveError: "offline_test" }, async (app) => {
    await unchanged(app);
    assert.strictEqual(app.calls.length, 1);
    app.clearSaveError();
    const gate = app.holdNextSave();
    const firstReload = app.reload();
    let startTimeout;
    try {
      await Promise.race([
        gate.started,
        new Promise((_, reject) => { startTimeout = setTimeout(() => reject(new Error("migration save never started")), 1000); })
      ]);
    } finally {
      clearTimeout(startTimeout);
    }
    const secondReload = app.reload();
    try {
      await waitForRender();
      assert.strictEqual(app.calls.length, 2, "overlapping loads must share the pending migration instead of writing twice");
    } finally {
      gate.release();
      await Promise.all([firstReload, secondReload]);
      await waitForRender();
    }
    const stored = await app.memory.loadPrivate();
    assert.strictEqual(stored.version, 75);
    assert.strictEqual(app.calls.length, 2);
    assert.strictEqual(stored.state.activeCycle.scheduleRevision, revision.id);
    assert.deepStrictEqual(preservedState(stored.state), preservedState(app.originalState));
  });

  await check("automatic migration never force-saves a version conflict", { saveError: "version_conflict" }, async (app) => {
    assert.strictEqual(app.calls.length, 1);
    assert.strictEqual(app.calls[0][0], 74);
    await unchanged(app);
    assert(app.message().length > 0 || app.window.document.querySelector("[data-plan-conflict]").open, "version conflicts must be visible");
  });

  await check("a missing holiday calendar prevents incomplete migration", { holidaysUnavailable: true }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    await unchanged(app);
    assert(app.message().length > 0, "explain why automatic scheduling could not run");
  });

  await check("the migration does not alter a different cycle", { changeState: (state) => {
    state.activeCycle.id = "cycle-unrelated";
  } }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    await unchanged(app);
  });

  await check("the migration does not alter an inactive cycle", { changeState: (state) => {
    state.activeCycle.status = "completed";
  } }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    await unchanged(app);
  });

  await check("a later user deadline is not overwritten by the site revision", { changeState: (state) => {
    state.activeCycle.requestedEndDate = "2026-11-30";
    state.activeCycle.endDate = "2026-11-30";
  } }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    await unchanged(app);
  });

  await check("a later user goal is not overwritten by the site revision", { changeState: (state) => {
    state.activeCycle.lifts.bench.target1rm = 105;
  } }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    await unchanged(app);
  });

  await check("anonymous viewers retain the public snapshot and receive an owner-login notice", { signedIn: false }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    const published = await app.memory.loadPublic();
    assert.strictEqual(published.record.version, 74);
    assert.deepStrictEqual(plain(published.record.snapshot), app.originalSnapshot);
    assert(app.message().includes("登录") && app.message().includes("自动"), "the public view must explain that owner login applies the revision");
  });

  if (failures.length) throw new Error(`${failures.length} migration regressions failed: ${failures.join(", ")}`);
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
