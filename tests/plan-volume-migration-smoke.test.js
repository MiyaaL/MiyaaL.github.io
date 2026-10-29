"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const page = fs.readFileSync("/site/_site/plan/index.html", "utf8");
const holidays = JSON.parse(fs.readFileSync("/site/assets/data/holidays/cn-2026.json", "utf8"));
const plain = (value) => JSON.parse(JSON.stringify(value));
const waitForRender = () => new Promise((resolve) => setTimeout(resolve, 50));
const revision = {
  id: "moderate-volume-v1",
  cycleId: "cycle-2026-11-02-mvsbg0jk",
  fromDate: "2026-11-02"
};

function configureLifts(cycle, bench, squat, pullup) {
  for (const [key, current, target] of [["bench", bench, 100], ["squat", squat, 120], ["pullup", pullup, 20]]) {
    Object.assign(cycle.lifts[key], {
      baseline1rm: current, assessed1rm: current, current1rm: current, target1rm: target
    });
  }
}

function removeVolumeRevision(cycle) {
  delete cycle.volumePrescription;
  delete cycle.volumePrescriptionFromDate;
}

function legacyState(core, today) {
  let state = core.createDefaultState("2026-11-02");
  removeVolumeRevision(state.activeCycle);
  Object.assign(state.activeCycle, {
    id: revision.cycleId,
    status: "active",
    endDate: "2027-01-29",
    requestedEndDate: "2027-01-29",
    scheduleRevision: "existing-schedule-revision",
    progression: {
      kind: "linear-wave", anchorDate: "2026-11-02",
      anchor1rm: { bench: 90, squat: 110, pullup: 10 }
    },
    bodyweightEntries: [{ date: "2026-11-02", value: 70 }]
  });
  configureLifts(state.activeCycle, 90, 110, 10);
  state.activeCycle.template = state.activeCycle.template.map((item) => ({
    ...item, id: item.type === "squat-volume" ? "session-mvt8kbaw" : item.id
  }));
  for (let pass = 0; pass < 2; pass += 1) {
    state = core.replanRemaining(state, [holidays], {
      fromDate: "2026-11-02", endDate: "2027-01-29", asOfDate: today, trainOnHolidays: true
    });
  }
  const planned = core.generate(state, [holidays], { asOfDate: today });
  const completed = planned.sessions.find((session) => session.date === "2026-11-02");
  state = core.recordSession(state, completed, {
    status: "completed",
    mainSets: [{ weight: 70, reps: 5, rpe: null, completed: true }],
    notes: "Preserve the recorded prescription and private notes."
  });
  const moved = core.generate(state, [holidays], { asOfDate: today }).sessions
    .find((session) => session.date === "2026-11-16" && session.type === "push-strength");
  state = core.moveSession(state, moved.id, "2026-11-19", {
    holidayCalendars: [holidays], asOfDate: today
  });

  const archived = core.createDefaultState("2026-08-03");
  removeVolumeRevision(archived.activeCycle);
  Object.assign(archived.activeCycle, {
    status: "archived", endDate: "2026-10-31", requestedEndDate: "2026-10-31",
    bodyweightEntries: [{ date: "2026-08-03", value: 70 }]
  });
  configureLifts(archived.activeCycle, 85, 100, 10);
  const archivedPlan = core.generate(archived, [holidays], { asOfDate: today });
  state.archivedCycles = [{
    cycle: plain(archivedPlan.cycle), logs: {},
    overview: { cycle: plain(archivedPlan.cycle), sessions: plain(archivedPlan.sessions), totalWeeks: archivedPlan.totalWeeks },
    archivedAt: "2026-11-01T00:00:00.000Z"
  }];
  const learning = core.createDefaultLearningPlan("2026-10-01", "2026-10-31", {
    id: "learning-preserved", title: "CS336", acceptanceCriteria: ["Preserve coursework"]
  });
  state.learningPlans = [learning];
  state = core.recordLearningSession(state, learning.id, core.generateLearningPlan(learning).sessions[0], {
    reflection: "Private learning reflection must remain private.",
    criteria: ["criterion-1"],
    artifacts: [{ id: "notes", name: "notes.md", size: 1, dataUrl: "data:text/plain;base64,eA==" }]
  });
  return core.generate(state, [holidays], { asOfDate: today }).state;
}

async function boot(options = {}) {
  const dom = new JSDOM(page, {
    url: "https://miyaal.github.io/plan/", runScripts: "outside-only", pretendToBeVisual: true
  });
  const { window } = dom;
  const NativeDate = window.Date;
  let today = options.today || "2026-10-29";
  let now = new NativeDate(`${today}T12:00:00+08:00`).getTime();
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
  const app = window.document.querySelector("[data-plan-app]");
  app.dataset.scheduleRevision = "null";
  app.dataset.volumeRevision = Object.prototype.hasOwnProperty.call(options, "revisionText")
    ? options.revisionText : JSON.stringify(revision);
  for (const script of ["plan-core", "plan-store", "plan-chart"]) {
    window.eval(fs.readFileSync(`/site/assets/js/${script}.js`, "utf8"));
  }
  const core = window.PlanCore;
  const state = legacyState(core, today);
  if (options.changeState) options.changeState(state, core);
  state.version = 127;
  const snapshot = core.createPublicSnapshot(state, core.generate(state, [holidays], { asOfDate: today }));
  const originalState = plain(state);
  const originalSnapshot = plain(snapshot);
  const replanCalls = [];
  const replan = core.replanRemaining;
  core.replanRemaining = (...args) => {
    replanCalls.push(plain(args));
    return replan(...args);
  };
  const memory = window.PlanStore.createMemoryAdapter({
    version: 127, state, snapshot, signedIn: options.signedIn !== false
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
    window, core, memory, calls, replanCalls, originalState, originalSnapshot,
    clearSaveError() { saveError = null; },
    holdNextSave() {
      let started;
      let release;
      const signal = new Promise((resolve) => { started = resolve; });
      const released = new Promise((resolve) => { release = resolve; });
      nextSaveGate = { started, released };
      return { started: signal, release };
    },
    setToday(date) {
      today = date;
      now = new NativeDate(`${date}T12:00:00+08:00`).getTime();
    },
    async reload() {
      window.dispatchEvent(new window.Event("online"));
      await waitForRender();
    },
    message() { return window.document.querySelector("[data-plan-message]").textContent; },
    close() { window.close(); }
  };
}

function preservedState(state) {
  const cycle = plain(state.activeCycle);
  delete cycle.volumePrescription;
  delete cycle.volumePrescriptionFromDate;
  return plain({
    cycle, logs: state.logs, archivedCycles: state.archivedCycles,
    learningPlans: state.learningPlans, activePlanId: state.activePlanId, preferences: state.preferences
  });
}

async function unchanged(app) {
  const stored = await app.memory.loadPrivate();
  assert.strictEqual(stored.version, 127);
  assert.deepStrictEqual(plain(stored.state), app.originalState, "rejected migration preserves private state");
  assert.deepStrictEqual(plain((await app.memory.loadPublic()).record.snapshot), app.originalSnapshot,
    "rejected migration preserves the published snapshot");
}

function sessionAt(snapshot, date) {
  const session = snapshot.sessions.find((candidate) => candidate.date === date);
  assert(session, "missing session on " + date);
  return session;
}

const failures = [];
async function check(name, options, run) {
  let app;
  try {
    app = await boot(options);
    await run(app);
    console.log("PASS:", name);
  } catch (error) {
    failures.push(name);
    console.error("FAIL:", name, error.stack);
  } finally {
    if (app) app.close();
  }
}

(async function () {
  await check("owner boot updates only the agreed volume prescription and publishes once", {}, async (app) => {
    const stored = await app.memory.loadPrivate();
    assert.strictEqual(app.core.MODERATE_VOLUME_PRESCRIPTION, revision.id);
    assert.strictEqual(stored.version, 128, "owner boot must persist the revision");
    assert.strictEqual(app.calls.length, 1);
    assert.strictEqual(app.calls[0][0], 127, "save uses the loaded version");
    assert.strictEqual(stored.state.activeCycle.volumePrescription, revision.id);
    assert.strictEqual(stored.state.activeCycle.volumePrescriptionFromDate, "2026-11-02");
    assert.deepStrictEqual(preservedState(stored.state), preservedState(app.originalState),
      "prescription changes cannot replan, rebase, or edit private history");
    assert.strictEqual(app.replanCalls.length, 0);
    assert.strictEqual(stored.state.activeCycle.replannedSchedule.revision, 2);
    const published = (await app.memory.loadPublic()).record;
    assert.strictEqual(published.version, 128);
    assert.strictEqual(published.snapshot.cycle.volumePrescription, revision.id);
    assert.strictEqual(published.snapshot.cycle.volumePrescriptionFromDate, "2026-11-02");
    assert.deepStrictEqual(plain(published.snapshot.sessions.map((session) => [session.id, session.date])),
      app.originalSnapshot.sessions.map((session) => [session.id, session.date]), "every calendar identity stays stable");
    for (const before of app.originalSnapshot.sessions) {
      if (!/volume$/.test(before.type) || !/^load-/.test(before.phase.key)) {
        const after = published.snapshot.sessions.find((session) => session.id === before.id);
        assert.deepStrictEqual(plain(after), before, "only loading volume days change: " + before.date);
      }
    }
    for (const [date, sets, reps, percentage] of [
      ["2026-11-06", 4, 10, 0.65], ["2026-11-13", 4, 9, 0.675], ["2026-11-20", 4, 8, 0.7],
      ["2026-11-07", 3, 8, 0.675], ["2026-11-14", 3, 8, 0.7], ["2026-11-21", 3, 8, 0.7]
    ]) {
      const work = sessionAt(published.snapshot, date).workout.workSets[0];
      assert.deepStrictEqual([work.sets, work.reps, work.percentage, work.rpe], [sets, reps, percentage, 7.5]);
      assert(work.label.includes("余力"), "volume guidance preserves repetitions in reserve");
    }
    assert(!JSON.stringify(published.snapshot).includes("Preserve the recorded prescription and private notes."));
    assert(!JSON.stringify(published.snapshot).includes("Private learning reflection"));
    assert(!JSON.stringify(published.snapshot).includes("bodyweightEntries"));
    const firstState = plain(stored.state);
    app.setToday("2026-11-09");
    await app.reload();
    await app.reload();
    assert.strictEqual(app.calls.length, 1, "refreshing an applied revision does not save again");
    assert.deepStrictEqual(plain((await app.memory.loadPrivate()).state), firstState);
  });

  await check("a later login applies from today and retains past and recorded prescriptions", {
    today: "2026-11-09",
    changeState(state, core) {
      const planned = core.generate(state, [holidays], { asOfDate: "2026-11-09" });
      const recorded = planned.sessions.find((session) => session.date === "2026-11-13");
      Object.assign(state, core.recordSession(state, recorded, {
        status: "completed", mainSets: [{ weight: 70, reps: 5, rpe: null, completed: true }]
      }));
    }
  }, async (app) => {
    const stored = await app.memory.loadPrivate();
    assert.strictEqual(stored.state.activeCycle.volumePrescriptionFromDate, "2026-11-09");
    assert.deepStrictEqual(preservedState(stored.state), preservedState(app.originalState));
    const published = (await app.memory.loadPublic()).record.snapshot;
    for (const date of ["2026-11-06", "2026-11-07", "2026-11-13"]) {
      assert.deepStrictEqual(plain(sessionAt(published, date)), sessionAt(app.originalSnapshot, date),
        "past or recorded prescription is frozen on " + date);
    }
    const future = sessionAt(published, "2026-11-14").workout.workSets[0];
    assert.deepStrictEqual([future.sets, future.reps], [3, 8]);
  });

  await check("anonymous viewers keep the saved snapshot and receive a volume login notice", {
    signedIn: false
  }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    const record = (await app.memory.loadPublic()).record;
    assert.strictEqual(record.version, 127);
    assert.deepStrictEqual(plain(record.snapshot), app.originalSnapshot);
    assert(app.message().includes("容量") && app.message().includes("登录"));
  });

  await check("failed migration leaves both saved states intact and can retry", {
    saveError: "offline_test"
  }, async (app) => {
    assert.strictEqual(app.calls.length, 1);
    await unchanged(app);
    assert(app.message().length > 0);
    app.clearSaveError();
    await app.reload();
    assert.strictEqual(app.calls.length, 2);
    const stored = await app.memory.loadPrivate();
    assert.strictEqual(stored.version, 128);
    assert.strictEqual(stored.state.activeCycle.volumePrescription, revision.id);
    assert.deepStrictEqual(preservedState(stored.state), preservedState(app.originalState));
  });

  await check("overlapping online reloads share a single pending migration save", {
    saveError: "offline_test"
  }, async (app) => {
    await unchanged(app);
    assert.strictEqual(app.calls.length, 1);
    app.clearSaveError();
    const gate = app.holdNextSave();
    const firstReload = app.reload();
    let startTimeout;
    try {
      await Promise.race([
        gate.started,
        new Promise((_, reject) => { startTimeout = setTimeout(() => reject(new Error("volume migration save never started")), 1000); })
      ]);
    } finally {
      clearTimeout(startTimeout);
    }
    const secondReload = app.reload();
    try {
      await waitForRender();
      assert.strictEqual(app.calls.length, 2, "the two reloads must share one new save");
    } finally {
      gate.release();
      await Promise.all([firstReload, secondReload]);
      await waitForRender();
    }
    assert.strictEqual((await app.memory.loadPrivate()).version, 128);
    assert.strictEqual(app.calls.length, 2);
  });

  await check("version conflicts cannot automatically overwrite server state", {
    saveError: "version_conflict"
  }, async (app) => {
    assert.strictEqual(app.calls.length, 1);
    assert.strictEqual(app.calls[0][0], 127);
    await unchanged(app);
    assert(app.message().length > 0 || app.window.document.querySelector("[data-plan-conflict]").open);
    assert.strictEqual(app.calls.length, 1);
  });

  await check("failure to load the configured calendar prevents incomplete publication", {
    holidaysUnavailable: true
  }, async (app) => {
    assert.strictEqual(app.calls.length, 0);
    await unchanged(app);
    assert(app.message().length > 0);
  });

  for (const [name, changeState] of [
    ["another cycle", (state) => { state.activeCycle.id = "cycle-unrelated"; }],
    ["an inactive cycle", (state) => { state.activeCycle.status = "completed"; }],
    ["an already applied cycle", (state) => {
      state.activeCycle.volumePrescription = revision.id;
      state.activeCycle.volumePrescriptionFromDate = "2026-11-02";
    }]
  ]) {
    await check(name + " is not automatically migrated", { changeState }, async (app) => {
      assert.strictEqual(app.calls.length, 0);
      await unchanged(app);
    });
  }

  for (const [name, revisionText] of [
    ["missing", "null"],
    ["malformed", "{"],
    ["unknown", JSON.stringify({ ...revision, id: "unknown-volume-v99" })],
    ["invalid start date", JSON.stringify({ ...revision, fromDate: "2026-11-99" })],
    ["different cycle", JSON.stringify({ ...revision, cycleId: "cycle-unrelated" })]
  ]) {
    await check(name + " rollout configuration cannot write saved plans", { revisionText }, async (app) => {
      assert.strictEqual(app.calls.length, 0);
      await unchanged(app);
    });
  }

  if (failures.length) throw new Error(`${failures.length} volume migration regressions failed: ${failures.join(", ")}`);
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
