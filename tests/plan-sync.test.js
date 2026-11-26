"use strict";

// Saving: one commit path, key-wise merging on a version conflict, and no
// unsaved state left on screen after a failure or a dismissed dialog.
const assert = require("node:assert");
const { test } = require("node:test");
const core = require("../assets/js/plan-core.js");
const { loadPlanPage, sampleState, logAsPrescribed, createMemoryAdapter, settle } = require("./helpers/dom.js");

const TODAY = "2026-11-26";
const plain = (value) => JSON.parse(JSON.stringify(value));

function baseState() {
  let state = sampleState(core);
  const plan = core.generate(state, [], { asOfDate: "2026-11-02" });
  state = logAsPrescribed(core, plan.state, plan.sessions[0]);
  state.version = 3;
  return state;
}

function sessionOn(state, date) {
  const plan = core.generate(state, [], { asOfDate: date });
  return { plan, session: plan.sessions.find((candidate) => candidate.date === date) };
}

test("mergeStates keeps logs, bodyweight entries and moves from both devices", () => {
  const base = baseState();
  const a = sessionOn(base, "2026-11-03");
  const remote = core.recordBodyweight(logAsPrescribed(core, a.plan.state, a.session), { date: "2026-11-10", value: 71.5 });
  const b = sessionOn(base, "2026-11-04");
  let local = core.recordBodyweight(logAsPrescribed(core, b.plan.state, b.session), { date: "2026-11-12", value: 71 });
  const skipped = sessionOn(local, "2026-11-06");
  local = core.recordSession(skipped.plan.state, skipped.session, { status: "skipped", mainSets: [] });
  local = core.moveSession(local, sessionOn(local, "2026-11-13").session.id, "2026-11-12", { asOfDate: "2026-11-02" });

  const merged = core.mergeStates(base, remote, local);
  assert.strictEqual(Object.keys(merged.logs).length, 4, "one shared log, one from each side, and the skip");
  assert.ok(merged.logs[a.session.id] && merged.logs[b.session.id]);
  assert.strictEqual(merged.logs[skipped.session.id].status, "skipped");
  assert.deepStrictEqual(merged.activeCycle.bodyweightEntries.map((entry) => entry.date),
    ["2026-11-02", "2026-11-10", "2026-11-12"]);
  assert.strictEqual(Object.keys(merged.activeCycle.sessionOverrides).length, 1, "the move survives");
});

test("mergeStates prefers the newer log for the same session and honours deletions", () => {
  const base = baseState();
  const target = sessionOn(base, "2026-11-03");
  const remote = logAsPrescribed(core, target.plan.state, target.session, { completedAt: "2026-11-03T12:00:00.000Z", notes: "remote" });
  const local = logAsPrescribed(core, target.plan.state, target.session, { completedAt: "2026-11-03T13:00:00.000Z", notes: "local" });
  assert.strictEqual(core.mergeStates(base, remote, local).logs[target.session.id].notes, "local");
  assert.strictEqual(core.mergeStates(base, local, remote).logs[target.session.id].notes, "local");

  const firstId = Object.keys(base.logs)[0];
  const undone = plain(base);
  delete undone.logs[firstId];
  assert.strictEqual(Object.hasOwn(core.mergeStates(base, base, undone).logs, firstId), false,
    "a log removed on this device stays removed");
});

test("mergeStates refuses to guess when both devices edited the same plan settings", () => {
  const base = baseState();
  const remote = plain(base);
  const local = plain(base);
  remote.activeCycle.requestedEndDate = remote.activeCycle.endDate = "2027-02-05";
  local.activeCycle.requestedEndDate = local.activeCycle.endDate = "2027-02-12";
  assert.throws(() => core.mergeStates(base, remote, local), { code: "merge_conflict", field: "activeCycle.endDate" });
  const oneSided = core.mergeStates(base, base, local);
  assert.strictEqual(oneSided.activeCycle.requestedEndDate, "2027-02-12", "a change on one side only is applied");
  const otherCycle = plain(base);
  otherCycle.activeCycle.id = "cycle-other";
  assert.throws(() => core.mergeStates(base, otherCycle, local), { code: "merge_conflict" });
});

async function ownerPage(state) {
  const generated = core.generate(state, [], { asOfDate: TODAY });
  const store = createMemoryAdapter({
    version: state.version, state: plain(state), snapshot: core.createPublicSnapshot(state, generated), signedIn: true
  });
  const page = await loadPlanPage({ store, today: TODAY });
  return { page, store };
}

async function logFirstPlanned(page) {
  const button = page.$$("[data-session-id]").find((element) => /Planned/.test(element.getAttribute("aria-label")));
  const id = button.dataset.sessionId;
  button.click();
  page.$("[data-save-log]").click();
  await settle(60);
  return id;
}

test("a conflicting save offers a merge that keeps the other device's log", async () => {
  const state = baseState();
  const { page, store } = await ownerPage(state);
  const other = sessionOn(state, "2026-11-03");
  const remote = logAsPrescribed(core, other.plan.state, other.session);
  store.writeRemote(remote, null);

  const localId = await logFirstPlanned(page);
  const dialog = page.$("[data-plan-conflict]");
  assert.ok(dialog.hasAttribute("open"), "the conflict dialog opens");
  assert.match(page.text("[data-plan-conflict-message]"), /Merging keeps the session logs/);
  assert.ok(page.$("[data-plan-merge]").classList.contains("plan-button-primary"), "merging is the primary action");
  assert.ok(!page.$("[data-plan-force-save]").classList.contains("plan-button"), "overwriting is a secondary text action");

  page.$("[data-plan-merge]").click();
  await settle(60);
  assert.ok(!dialog.hasAttribute("open"));
  const stored = await store.loadPrivate();
  assert.ok(stored.state.logs[other.session.id], "the other device's log is kept");
  assert.ok(stored.state.logs[localId], "this device's log is saved");
  assert.match(page.text("[data-plan-message]"), /merged and saved/);
  page.close();
});

test("dismissing the conflict dialog reverts to the last saved plan", async () => {
  const state = baseState();
  const { page, store } = await ownerPage(state);
  const other = sessionOn(state, "2026-11-03");
  store.writeRemote(logAsPrescribed(core, other.plan.state, other.session), null);
  const before = store.saves;

  const localId = await logFirstPlanned(page);
  const dialog = page.$("[data-plan-conflict]");
  assert.ok(dialog.hasAttribute("open"));
  dialog.dispatchEvent(new page.window.Event("cancel"));
  dialog.close();
  await settle();
  assert.strictEqual(store.saves, before, "nothing was written");
  assert.match(page.text("[data-plan-message]"), /unsaved change was discarded/);
  page.$("[data-plan-close-details]").click();
  const cell = page.$$("[data-session-id]").find((element) => element.dataset.sessionId === localId);
  assert.match(cell.getAttribute("aria-label"), /Planned/, "the calendar does not show the unsaved log");
  page.close();
});

test("overwriting remains available as an explicit choice", async () => {
  const state = baseState();
  const { page, store } = await ownerPage(state);
  const other = sessionOn(state, "2026-11-03");
  store.writeRemote(logAsPrescribed(core, other.plan.state, other.session), null);
  const localId = await logFirstPlanned(page);
  page.$("[data-plan-force-save]").click();
  await settle(60);
  const stored = await store.loadPrivate();
  assert.ok(stored.state.logs[localId]);
  assert.strictEqual(Object.hasOwn(stored.state.logs, other.session.id), false, "the server version was replaced");
  page.close();
});

test("a failed save rolls back logs, skips and bodyweight entries alike", async () => {
  const { page, store } = await ownerPage(baseState());
  const before = plain((await store.loadPrivate()).state);

  store.failNextSave = "network_down";
  const localId = await logFirstPlanned(page);
  assert.match(page.text("[data-plan-detail-message]"), /Saving failed; the plan was not changed/,
    "the error is announced inside the open drawer");
  page.$("[data-plan-close-details]").click();
  const cell = () => page.$$("[data-session-id]").find((element) => element.dataset.sessionId === localId);
  assert.match(cell().getAttribute("aria-label"), /Planned/);

  store.failNextSave = "network_down";
  cell().click();
  page.$("[data-skip-session]").click();
  await settle(60);
  page.$("[data-plan-close-details]").click();
  assert.match(cell().getAttribute("aria-label"), /Planned/, "a failed skip is not shown either");

  store.failNextSave = "network_down";
  page.$("[data-plan-update-bodyweight]").click();
  page.$('[data-plan-bodyweight-form] [name="bodyweight"]').value = "70.4";
  page.submit("[data-plan-bodyweight-form]");
  await settle(60);
  assert.ok(page.$("[data-plan-bodyweight-dialog]").hasAttribute("open"), "the dialog stays open to retry");
  assert.match(page.text("[data-plan-bodyweight-error]"), /Saving failed/);
  assert.deepStrictEqual(plain((await store.loadPrivate()).state), before, "the stored plan is untouched");
  page.close();
});

test("a second click while a save is in flight does not start another save", async () => {
  const { page, store } = await ownerPage(baseState());
  const realSave = store.save;
  let calls = 0;
  store.save = async (...args) => {
    calls += 1;
    await settle(40);
    return realSave(...args);
  };
  const button = page.$$("[data-session-id]").find((element) => /Planned/.test(element.getAttribute("aria-label")));
  button.click();
  const save = page.$("[data-save-log]");
  save.click();
  assert.strictEqual(save.disabled, true, "the button is disabled while saving");
  save.disabled = false;
  save.click();
  await settle(120);
  assert.strictEqual(calls, 1);
  assert.strictEqual(store.saves, 1);
  page.close();
});

test("the owner's first load adopts the feedback program without saving", async () => {
  const legacy = sampleState(core, { program: "legacy" });
  legacy.version = 4;
  const { page, store } = await ownerPage(legacy);
  assert.strictEqual(store.saves, 0, "loading never writes");
  assert.match(page.text("[data-plan-warnings]"), /only when you choose to adjust the plan/);
  await logFirstPlanned(page);
  const stored = await store.loadPrivate();
  assert.strictEqual(stored.state.activeCycle.programRevision, core.FEEDBACK_PROGRAM);
  assert.strictEqual(stored.state.activeCycle.programRevisionFromDate, TODAY);
  page.close();
});
