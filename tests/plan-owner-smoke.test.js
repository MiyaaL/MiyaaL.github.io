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

  const state = window.PlanCore.createDefaultState("2026-08-03");
  state.activeCycle.endDate = "2026-10-25";
  state.activeCycle.status = "active";
  state.activeCycle.bodyweightEntries = [{ date: "2026-08-03", value: 70 }];
  state.activeCycle.lifts.bench.current1rm = 100;
  state.activeCycle.lifts.bench.target1rm = 110;
  state.activeCycle.lifts.pullup.current1rm = 30;
  state.activeCycle.lifts.pullup.target1rm = 40;
  state.activeCycle.lifts.squat.current1rm = 150;
  state.activeCycle.lifts.squat.target1rm = 165;

  const memory = window.PlanStore.createMemoryAdapter({
    version: 0,
    state,
    signedIn: true
  });
  window.PlanStore.createSupabaseAdapter = () => memory;
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));

  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.strictEqual(window.document.querySelector("[data-plan-owner-actions]").hidden, false);
  assert.strictEqual(window.document.querySelector("[data-plan-auth]").hidden, true);

  window.document.querySelector("[data-session-id]").click();
  assert(window.document.querySelector("[data-save-log]"));
  window.document.querySelector("[data-save-log]").click();
  await new Promise((resolve) => setTimeout(resolve, 50));

  const stored = await memory.loadPrivate();
  assert.strictEqual(stored.version, 1);
  assert.strictEqual(Object.keys(stored.state.logs).length, 1);
  const savedLog = stored.state.logs[Object.keys(stored.state.logs)[0]];
  assert.strictEqual(savedLog.accessories.length, 3);

  window.document.querySelector("[data-plan-edit]").click();
  assert.strictEqual(window.document.querySelector("[data-plan-settings]").open, true);

  console.log("PASS: owner login, training log save, version increment, and settings smoke test");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
