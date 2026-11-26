"use strict";

// The feedback program: prescriptions follow what was logged, missed work is
// noticed, and the cycle ends with spaced, retryable goal tests.
const assert = require("node:assert");
const { test } = require("node:test");
const core = require("../assets/js/plan-core.js");
const { sampleState, logAsPrescribed, holidays } = require("./helpers/dom.js");

const CALENDARS = [holidays(2026), holidays(2027)];
const generate = (state, asOfDate) => core.generate(state, CALENDARS, { asOfDate });
const on = (plan, date) => plan.sessions.find((session) => session.date === date);
const loads = (session) => session.workout.workSets.map((set) => set.loadKg);

function logThrough(state, lastDate, overrides) {
  const dates = generate(state, "2026-11-02").sessions.map((session) => session.date)
    .filter((date) => date <= lastDate);
  dates.forEach((date) => {
    const plan = generate(state, date);
    const session = on(plan, date);
    state = logAsPrescribed(core, plan.state, session, overrides && overrides(session));
  });
  return state;
}

test("new cycles run the feedback program and name themselves after the template", () => {
  const state = sampleState(core);
  assert.strictEqual(state.activeCycle.programRevision, core.FEEDBACK_PROGRAM);
  assert.strictEqual(state.activeCycle.title, "Push / Pull / Squat · 5 sessions per week");
  const four = core.DEFAULT_TEMPLATE.slice(0, 4);
  assert.strictEqual(core.templateTitle(four), "Push / Pull / Squat · 4 sessions per week");
  assert.ok(generate(state, "2026-11-02").sessions.every((session) => session.program === core.FEEDBACK_PROGRAM));
});

test("the reference never runs more than 3 % ahead of the measured 1RM", () => {
  const state = sampleState(core);
  const plan = generate(state, "2026-11-02");
  plan.sessions.forEach((session) => {
    const lift = plan.cycle.lifts[session.workout.liftKey];
    const offset = session.workout.liftKey === "pullup" ? 72 : 0;
    assert.ok(session.workout.planned1rm + offset <= (lift.current1rm + offset) * 1.03 + 0.06,
      session.date + " stays within the readiness cap");
  });
  // Nothing is logged, so the late-cycle reference stops at the cap instead of the goal.
  assert.strictEqual(on(plan, "2027-01-18").workout.planned1rm, 92.7);
});

test("completing prescribed work lets the cap rise with it", () => {
  const state = logThrough(sampleState(core), "2027-01-10");
  const plan = generate(state, "2027-01-11");
  assert.ok(plan.cycle.lifts.bench.current1rm > 95, "finished sessions confirm the reference they were written from");
  assert.strictEqual(on(plan, "2027-01-25").workout.planned1rm, 100);
});

test("logging the prescription at its target RPE never lowers the estimate", () => {
  const atTarget = (session) => ({
    mainSets: session.workout.workSets.flatMap((set) => Array.from({ length: set.sets }, () => ({
      weight: set.loadKg, reps: set.reps, rpe: set.rpe
    })))
  });
  const plan = generate(logThrough(sampleState(core), "2026-12-20", atTarget), "2026-12-21");
  ["bench", "pullup", "squat"].forEach((key) => {
    const lift = plan.cycle.lifts[key];
    assert.ok(lift.current1rm >= lift.baseline1rm, key + " does not drift below its starting 1RM");
  });
  assert.ok(on(plan, "2026-12-21").workout.planned1rm > 93, "the reference keeps climbing with clean sessions");

  const grinding = (session) => ({
    mainSets: session.workout.workSets.flatMap((set) => Array.from({ length: set.sets }, () => ({
      weight: set.loadKg, reps: set.reps, rpe: 9.5
    })))
  });
  const hard = generate(logThrough(sampleState(core), "2026-11-15", grinding), "2026-11-16");
  assert.ok(hard.cycle.lifts.bench.current1rm < 90, "near-limit sets still lower the estimate");
});

test("editing the current 1RM re-anchors the remaining prescriptions", () => {
  const state = sampleState(core);
  const before = generate(state, "2026-11-30");
  const edited = core.normalizeState(state);
  Object.assign(edited.activeCycle.lifts.bench, { current1rm: 82, assessed1rm: 82, assessedOn: "2026-11-30" });
  core.reanchorLift(edited.activeCycle, "bench", 82, "2026-11-30");
  const after = generate(edited, "2026-11-30");
  assert.strictEqual(on(after, "2026-12-07").workout.planned1rm, 82.8);
  assert.ok(loads(on(after, "2026-12-07"))[1] < loads(on(before, "2026-12-07"))[1],
    "a lowered estimate lowers the next working sets");
  assert.deepStrictEqual(loads(on(after, "2026-12-02")), loads(on(before, "2026-12-02")), "other lifts are untouched");
});

test("a missed rep or a near-limit top single holds next week's increase", () => {
  const base = logThrough(sampleState(core), "2026-11-08");
  const clean = generate(logThrough(base, "2026-11-15"), "2026-11-16");
  const ground = (session) => (session.date === "2026-11-09" ? {
    mainSets: [{ weight: session.workout.workSets[0].loadKg, reps: 1, rpe: 9.5 }]
  } : null);
  const held = generate(logThrough(base, "2026-11-15", ground), "2026-11-16");
  assert.ok(on(held, "2026-11-16").workout.planned1rm < on(clean, "2026-11-16").workout.planned1rm,
    "an RPE 9.5 top single pauses the bench reference for a week");
  assert.strictEqual(on(held, "2026-11-18").workout.planned1rm, on(clean, "2026-11-18").workout.planned1rm,
    "the squat reference is unaffected");

  const failed = (session) => (session.date === "2026-11-11" ? {
    mainSets: session.workout.workSets.flatMap((set) => Array.from({ length: set.sets }, (_, index) => ({
      weight: set.loadKg, reps: index === set.sets - 1 && set.sets > 1 ? set.reps - 2 : set.reps, rpe: null,
      completed: !(index === set.sets - 1 && set.sets > 1)
    })))
  } : null);
  const afterFail = generate(logThrough(base, "2026-11-15", failed), "2026-11-16");
  assert.ok(on(afterFail, "2026-11-18").workout.planned1rm < on(clean, "2026-11-18").workout.planned1rm,
    "a set short of its reps holds the squat reference");
});

test("past unlogged sessions are missed, and a layoff steps the wave back", () => {
  const state = logThrough(sampleState(core), "2026-11-08");
  const fresh = generate(logThrough(state, "2026-11-25"), "2026-11-26");
  const back = generate(state, "2026-11-26");
  assert.strictEqual(on(back, "2026-11-09").status, "missed");
  assert.strictEqual(on(back, "2026-11-27").status, "planned");
  assert.strictEqual(on(generate(state, "2026-11-02"), "2026-11-09").status, "planned",
    "nothing is missed before its date");
  assert.strictEqual(on(fresh, "2026-11-27").phase.key, "load-3");
  assert.strictEqual(on(back, "2026-11-27").phase.key, "load-2", "the first week back repeats the previous step");
  assert.match(on(back, "2026-11-27").phase.label, /back from a layoff/);
  assert.ok(on(back, "2026-11-27").workout.planned1rm < on(fresh, "2026-11-27").workout.planned1rm,
    "the reference waited during the layoff");
});

test("the plan warns when the goal needs more than about 0.5 % a week", () => {
  const steep = generate(sampleState(core), "2026-11-02").warnings.join("\n");
  assert.match(steep, /Bench press needs \+0\.9 % per week to reach 100 kg/);
  assert.match(steep, /The training reference ends at/);
  const modest = generate(sampleState(core, { lifts: { bench: [90, 94], pullup: [10, 13], squat: [110, 115] } }),
    "2026-11-02").warnings.join("\n");
  assert.doesNotMatch(modest, /per week/);
  const short = sampleState(core, { endDate: "2026-12-13" });
  assert.match(generate(short, "2026-11-02").warnings.join("\n"), /shorter than 8 weeks/, "the length warning is kept");
});

test("goal tests are spread out, leave a retry slot, and are never on the last day", () => {
  const plan = generate(sampleState(core), "2026-11-02");
  const tests = plan.sessions.filter((session) => session.isTest);
  assert.deepStrictEqual(tests.map((session) => [session.workout.liftKey, session.date]),
    [["pullup", "2027-01-19"], ["squat", "2027-01-23"], ["bench", "2027-01-25"]]);
  const last = plan.sessions[plan.sessions.length - 1];
  assert.strictEqual(last.date, "2027-01-29");
  assert.strictEqual(plan.cycle.endDate, "2027-01-29", "the deadline itself does not move");
  tests.forEach((session, index) => {
    assert.notStrictEqual(session.date, last.date);
    tests.slice(index + 1).forEach((other) => {
      assert.ok(Math.abs(core.daysBetween(session.date, other.date)) > 1, "no two tests on adjacent days");
    });
    const retry = plan.sessions.find((candidate) => candidate.date > session.date &&
      candidate.workout.liftKey === session.workout.liftKey);
    assert.strictEqual(retry.phase.key, "retry", session.workout.liftKey + " has a later slot to retry in");
    assert.match(retry.workout.guidance, /Retry slot/);
  });
});

test("the wave is counted back from each lift's test with no deload before the taper", () => {
  const plan = generate(sampleState(core), "2026-11-02");
  ["bench", "pullup", "squat"].forEach((key) => {
    const testDate = plan.sessions.find((session) => session.isTest && session.workout.liftKey === key).date;
    const phases = plan.sessions.filter((session) => session.workout.liftKey === key &&
      !session.type.includes("volume") && session.date < testDate).map((session) => session.phase.key);
    const build = phases.filter((phase) => phase !== "opener");
    assert.strictEqual(build[build.length - 1], "load-3", key + ": the heaviest build week is the last one before the taper");
    assert.ok(!phases.join(",").includes("deload,opener"), key + ": no deload directly before the taper");
    assert.strictEqual(phases[0], "load-1", key + ": the cycle never opens with a deload");
  });
  // Every lift is unloaded in the days before its own test, not only the first one.
  plan.sessions.filter((session) => session.isTest).forEach((testSession) => {
    plan.sessions.filter((session) => session.workout.liftKey === testSession.workout.liftKey &&
      session.date < testSession.date && core.daysBetween(session.date, testSession.date) <= 6)
      .forEach((session) => assert.strictEqual(session.phase.key, "opener"));
  });
  const benchTaper = on(plan, "2027-01-22");
  assert.deepStrictEqual(benchTaper.workout.workSets.map((set) => set.label), ["Taper sets"],
    "a volume day inside the taper is light, not a second heavy single");
});

test("attempts are based on what the lifter can do, capped at the goal", () => {
  const untrained = generate(sampleState(core), "2026-11-02");
  const bench = untrained.sessions.find((session) => session.isTest && session.workout.liftKey === "bench");
  assert.deepStrictEqual(loads(bench), [85, 90, 92.5], "92/97/100 % of 1.03 × the current 90 kg");
  assert.match(bench.workout.guidance, /goal of 100 kg is above 103 %/);
  const trained = generate(logThrough(sampleState(core), "2027-01-18"), "2027-01-19");
  const ready = trained.sessions.find((session) => session.isTest && session.workout.liftKey === "bench");
  assert.deepStrictEqual(loads(ready), [92.5, 97.5, 100], "once the work is done the last attempt is the goal");
});

test("pull-up loads never go below bodyweight under the feedback program", () => {
  const plan = generate(sampleState(core, { lifts: { bench: [90, 100], pullup: [0, 5], squat: [110, 120] } }), "2026-11-02");
  plan.sessions.filter((session) => session.workout.liftKey === "pullup").forEach((session) => {
    session.workout.workSets.concat(session.workout.warmups).forEach((set) => {
      assert.ok(set.loadKg >= 0, session.date + " " + set.label + " is not an assisted load");
    });
  });
});

test("skipping the test moves it to an earlier open session of that lift", () => {
  let state = sampleState(core);
  const plan = generate(state, "2027-01-18");
  const benchTest = plan.sessions.find((session) => session.isTest && session.workout.liftKey === "bench");
  const retry = on(plan, "2027-01-29");
  state = core.recordSession(plan.state, benchTest, { status: "skipped", mainSets: [] });
  state = core.recordSession(state, retry, { status: "skipped", mainSets: [] });
  const next = generate(state, "2027-01-18").sessions.filter((session) => session.isTest &&
    session.status !== "skipped" && session.workout.liftKey === "bench");
  assert.strictEqual(next.length, 1);
  // Two open bench sessions remain (01-18 and 01-22); the earlier one becomes
  // the test so the later one is still there to retry in.
  assert.strictEqual(next[0].date, "2027-01-18");
  assert.strictEqual(next[0].status, "planned");
  assert.strictEqual(on(generate(state, "2027-01-18"), "2027-01-22").phase.key, "retry");
});

test("a test single logged without RPE counts as a max and updates the estimate", () => {
  let state = sampleState(core);
  const plan = generate(state, "2027-01-25");
  const benchTest = plan.sessions.find((session) => session.isTest && session.workout.liftKey === "bench");
  state = core.recordSession(plan.state, benchTest, {
    status: "completed",
    mainSets: [
      { weight: 85, reps: 1, rpe: null, completed: true },
      { weight: 90, reps: 1, rpe: null, completed: true },
      { weight: 92.5, reps: 0, rpe: null, completed: false }
    ]
  });
  assert.strictEqual(state.activeCycle.lifts.bench.current1rm, 90, "the heaviest completed single is the measured 1RM");
  const after = generate(state, "2027-01-26");
  assert.deepStrictEqual(after.performance.bench.slice(-1)[0], { date: benchTest.date, value: 90, isTest: true });
  assert.strictEqual(on(after, "2027-01-29").phase.key, "retry");
  assert.deepStrictEqual(loads(on(after, "2027-01-29")), [85, 90, 92.5], "the goal was not reached, so the retry is attempts");
});

test("pull-ups get a second weekly exposure on the day furthest from the pull day", () => {
  const plan = generate(sampleState(core), "2026-11-02");
  const hosts = plan.sessions.filter((session) => session.workout.secondary);
  assert.ok(hosts.length >= 6);
  hosts.forEach((session) => {
    assert.strictEqual(session.templateId, "push-volume", "Friday: three days from Tuesday, and not the squat strength day");
    assert.match(session.phase.key, /^load-/);
    const sets = session.workout.secondary.workSets;
    assert.strictEqual(sets[0].label, "Pull-up back-off sets");
    assert.ok(sets[0].loadKg >= 0 && sets[0].percentage <= 0.75);
  });
  assert.ok(!on(plan, "2027-01-15").workout.secondary, "no extra pulling inside the week before the pull-up test");
  const snapshot = core.createPublicSnapshot(plan.state, plan);
  const published = snapshot.sessions.find((session) => session.workout.secondary).workout.secondary;
  assert.ok(published.workSets.every((set) => !Object.hasOwn(set, "loadKg")), "pull-up loads stay private");
  assert.match(core.generateIcs(plan, {}), /Pull-up back-off sets 3×6/);
});

test("holiday calendars are applied per year and incomplete ones are flagged", () => {
  const plan = generate(sampleState(core), "2026-11-02");
  assert.ok(!on(plan, "2027-01-01"), "New Year's Day is a rest day");
  assert.match(plan.warnings.join("\n"), /New Year's Day/);
  assert.match(plan.warnings.join("\n"), /The 2027 holiday calendar is incomplete/);
  const without = core.generate(sampleState(core), [holidays(2026)], { asOfDate: "2026-11-02" });
  assert.ok(on(without, "2027-01-01"), "a missing year falls back to the weekly template");
  assert.match(without.warnings.join("\n"), /No public-holiday calendar is loaded for 2027/);
  assert.deepStrictEqual(holidays(2027).periods.flatMap((period) => period.daysOff), ["2027-01-01"]);
});

test("adopting the program leaves past and logged sessions exactly as they were", () => {
  let state = sampleState(core, { program: "legacy" });
  ["2026-11-02", "2026-11-03", "2026-11-04"].forEach((date) => {
    const plan = generate(state, date);
    state = logAsPrescribed(core, plan.state, on(plan, date));
  });
  const before = generate(state, "2026-11-26");
  assert.ok(before.sessions.every((session) => session.program !== core.FEEDBACK_PROGRAM));
  const adopted = core.adoptFeedbackProgram(state, "2026-11-26");
  assert.strictEqual(adopted.activeCycle.programRevisionFromDate, "2026-11-26");
  assert.strictEqual(core.adoptFeedbackProgram(adopted, "2026-12-01").activeCycle.programRevisionFromDate, "2026-11-26",
    "adoption happens once");
  const after = generate(adopted, "2026-11-26");
  const prescriptions = (plan, test) => plan.sessions.filter(test).map((session) => [session.id, session.phase, session.workout]);
  assert.deepStrictEqual(prescriptions(after, (session) => session.date < "2026-11-26"),
    prescriptions(before, (session) => session.date < "2026-11-26"));
  assert.ok(after.sessions.filter((session) => session.date >= "2026-11-26")
    .every((session) => session.program === core.FEEDBACK_PROGRAM));
  const archived = sampleState(core, { program: "legacy" });
  archived.activeCycle.status = "archived";
  assert.strictEqual(core.adoptFeedbackProgram(archived, "2026-11-26").activeCycle.programRevision, "legacy");
});

test("stored Chinese copy is shown in English", () => {
  const stored = sampleState(core, { program: "legacy" });
  stored.activeCycle.title = "推拉蹲 + 推";
  stored.activeCycle.template.forEach((item) => { item.label = { pull: "拉" }[item.type] || "推 · 强度"; });
  stored.activeCycle.lifts.bench.label = "杠铃卧推";
  const state = core.normalizeState(stored);
  assert.strictEqual(state.activeCycle.title, "Push / Pull / Squat · 5 sessions per week");
  assert.strictEqual(state.activeCycle.lifts.bench.label, "Bench press");
  assert.strictEqual(stored.activeCycle.lifts.bench.label, "杠铃卧推", "the input is not mutated");
  assert.doesNotMatch(JSON.stringify(core.createPublicSnapshot(state, generate(state, "2026-11-02"))), /[㐀-鿿]/);
  assert.strictEqual(core.localize("递进第 2 周"), "Build week 2");
  assert.strictEqual(core.localize("杠铃卧推 · 周期目标"), "Bench press · Goal test");
  assert.strictEqual(core.localize("2–3 分钟"), "2–3 min");
});
