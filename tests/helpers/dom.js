"use strict";

// Loads the Plan page straight from the repository sources, so the browser
// tests need neither a Jekyll build nor fixed filesystem paths.
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");
const { createMemoryAdapter } = require("./memory-store");

const ROOT = path.resolve(__dirname, "..", "..");
const SCRIPTS = ["plan-core.js", "plan-store.js", "plan-chart.js", "plan-app.js"];

function readSource(relative) {
  return fs.readFileSync(path.join(ROOT, relative), "utf8");
}

function holidays(year) {
  return JSON.parse(readSource("assets/data/holidays/cn-" + year + ".json"));
}

// The page body is a Liquid template; only its data attributes use Liquid.
function pageHtml(values) {
  const source = readSource("plan/index.html").replace(/^---\n[\s\S]*?\n---\n/, "");
  const html = source.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (match, expression) => {
    if (expression.includes("supabase_url")) return values.supabaseUrl;
    if (expression.includes("supabase_publishable_key")) return values.supabaseKey;
    if (expression.includes("/assets/data/holidays/")) return "/assets/data/holidays/";
    throw new Error("Unhandled Liquid expression in plan/index.html: " + match);
  });
  if (/\{%|\{\{/.test(html)) {
    throw new Error("plan/index.html contains Liquid this helper does not render");
  }
  return '<!doctype html><html lang="en"><head><title>Plan</title></head><body><main id="main-content">' +
    html + "</main></body></html>";
}

function settle(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms == null ? 30 : ms));
}

// options.today pins the page's clock ("YYYY-MM-DD", Asia/Shanghai);
// options.store is a memory adapter, or omitted for the unconfigured preview;
// options.mobile switches the calendar to the agenda layout.
async function loadPlanPage(options) {
  const settings = options || {};
  const dom = new JSDOM(pageHtml({
    supabaseUrl: settings.store ? "https://example.supabase.co" : "",
    supabaseKey: settings.store ? "test-key" : ""
  }), {
    url: "https://miyaal.github.io/plan/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (settings.today) {
    const fixed = new Date(settings.today + "T04:00:00Z").getTime();
    const RealDate = window.Date;
    class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(fixed);
      }
      static now() { return fixed; }
    }
    window.Date = FixedDate;
  }
  const media = { matches: Boolean(settings.mobile), addEventListener() {}, removeEventListener() {} };
  window.matchMedia = () => media;
  const requested = [];
  window.fetch = async (url) => {
    requested.push(String(url));
    const match = String(url).match(/cn-(\d{4})\.json$/);
    const file = match && path.join(ROOT, "assets/data/holidays/cn-" + match[1] + ".json");
    if (settings.holidays === false || !file || !fs.existsSync(file)) {
      return { ok: false, status: 404, json: async () => ({}) };
    }
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  // jsdom implements neither modal dialogs nor object URLs.
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new window.Event("close"));
  };
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};

  SCRIPTS.slice(0, 3).forEach((name) => window.eval(readSource("assets/js/" + name)));
  if (settings.store) {
    window.PlanStore.createSupabaseAdapter = () => settings.store;
  }
  window.eval(readSource("assets/js/plan-app.js"));
  await settle();

  const document = window.document;
  return {
    window,
    document,
    core: window.PlanCore,
    chart: window.PlanChart,
    requested,
    settle,
    $: (selector) => document.querySelector(selector),
    $$: (selector) => Array.from(document.querySelectorAll(selector)),
    text: (selector) => (document.querySelector(selector) || { textContent: "" }).textContent,
    submit(selector) {
      document.querySelector(selector).dispatchEvent(
        new window.Event("submit", { bubbles: true, cancelable: true }));
    },
    close() { window.close(); }
  };
}

// A configured, active cycle. `program: "legacy"` builds one saved before the
// feedback program existed, as archived cycles and old backups still are.
function sampleState(core, overrides) {
  const options = overrides || {};
  const start = options.startDate || "2026-11-02";
  const state = core.createDefaultState(start);
  const cycle = state.activeCycle;
  // 13 weeks ending on a Friday, like the cycle this plan was built around.
  cycle.endDate = options.endDate || core.addDays(start, 88);
  cycle.requestedEndDate = cycle.endDate;
  cycle.status = "active";
  cycle.bodyweightEntries = [{ date: start, value: options.bodyweight || 72 }];
  const lifts = options.lifts || { bench: [90, 100], pullup: [10, 20], squat: [110, 120] };
  Object.keys(lifts).forEach((key) => {
    Object.assign(cycle.lifts[key], {
      baseline1rm: lifts[key][0], current1rm: lifts[key][0], target1rm: lifts[key][1]
    });
  });
  if (options.program === "legacy") delete cycle.programRevision;
  return state;
}

// Logs a session exactly as prescribed, optionally overriding sets.
function logAsPrescribed(core, state, session, overrides) {
  const sets = [];
  session.workout.workSets.forEach((prescription) => {
    for (let index = 0; index < prescription.sets; index += 1) {
      sets.push({ weight: prescription.loadKg, reps: prescription.reps, rpe: null });
    }
  });
  return core.recordSession(state, session, Object.assign({ status: "completed", mainSets: sets }, overrides));
}

module.exports = {
  ROOT, readSource, holidays, loadPlanPage, sampleState, logAsPrescribed, settle, createMemoryAdapter
};

// Two-step variant for tests that build their state with the page's own
// PlanCore before the app starts: createPlanWindow() loads everything except
// plan-app.js, startPlanApp() runs it.
function createPlanWindow(options) {
  const settings = options || {};
  const dom = new JSDOM(pageHtml({ supabaseUrl: "https://example.supabase.co", supabaseKey: "test-key" }), {
    url: "https://miyaal.github.io/plan/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  if (settings.today) {
    const fixed = new Date(settings.today + "T04:00:00Z").getTime();
    const RealDate = window.Date;
    window.Date = class FixedDate extends RealDate {
      constructor(...args) {
        if (args.length) super(...args);
        else super(fixed);
      }
      static now() { return fixed; }
    };
  }
  const media = { matches: Boolean(settings.mobile), addEventListener() {}, removeEventListener() {} };
  window.matchMedia = () => media;
  window.fetch = async (url) => {
    const match = String(url).match(/cn-(\d{4})\.json$/);
    const file = match && path.join(ROOT, "assets/data/holidays/cn-" + match[1] + ".json");
    if (!file || !fs.existsSync(file)) return { ok: false, status: 404, json: async () => ({}) };
    return { ok: true, json: async () => JSON.parse(fs.readFileSync(file, "utf8")) };
  };
  window.HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  window.HTMLDialogElement.prototype.close = function () {
    if (!this.hasAttribute("open")) return;
    this.removeAttribute("open");
    this.dispatchEvent(new window.Event("close"));
  };
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};
  SCRIPTS.slice(0, 3).forEach((name) => window.eval(readSource("assets/js/" + name)));
  window.PlanStore.createMemoryAdapter = createMemoryAdapter;
  return { window, holidays: holidays(2026) };
}

function startPlanApp(window) {
  window.eval(readSource("assets/js/plan-app.js"));
}

module.exports.createPlanWindow = createPlanWindow;
module.exports.startPlanApp = startPlanApp;
