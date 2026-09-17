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
  window.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} });
  window.fetch = async () => ({ ok: true, json: async () => holidays });
  window.eval(fs.readFileSync("/site/assets/js/plan-core.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/plan-store.js", "utf8"));

  let availability = "error";
  let signIns = 0;
  window.PlanStore.createSupabaseAdapter = () => ({
    configured: true,
    getSession: async () => null,
    loadPublic: async () => {
      if (availability === "error") throw new Error("fetch failed");
      return { record: null, offline: availability === "offline" };
    },
    signIn: async () => { signIns += 1; },
    onAuthChange: () => () => {}
  });
  window.eval(fs.readFileSync("/site/assets/js/plan-app.js", "utf8"));

  await new Promise((resolve) => setTimeout(resolve, 20));
  const button = window.document.querySelector("[data-plan-auth]");
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(signIns, 0, "offline sync must not open the broken OAuth URL");
  assert.match(window.document.querySelector("[data-plan-message]").textContent, /同步服务暂不可用/);

  availability = "offline";
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(signIns, 0, "cached offline data must not open the broken OAuth URL");

  availability = "online";
  button.click();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.strictEqual(signIns, 1, "retry must open OAuth after the service recovers");

  console.log("PASS: Plan OAuth waits for a reachable sync service and retries");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
