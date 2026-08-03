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
  const media = {
    matches: false,
    addEventListener() {},
    removeEventListener() {}
  };
  window.matchMedia = () => media;
  window.fetch = async () => ({
    ok: true,
    json: async () => holidays
  });
  window.URL.createObjectURL = () => "blob:test";
  window.URL.revokeObjectURL = () => {};

  [
    "/site/assets/js/plan-core.js",
    "/site/assets/js/plan-store.js",
    "/site/assets/js/plan-app.js"
  ].forEach((path) => window.eval(fs.readFileSync(path, "utf8")));

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(window.document.querySelector("[data-plan-sync-state]").textContent, "同步未配置");
  assert.strictEqual(window.document.querySelector("[data-plan-view]").hidden, false);
  assert.strictEqual(window.document.querySelectorAll(".plan-day").length, 42);
  assert(window.document.querySelector("[data-session-id]"));

  window.document.querySelector("[data-session-id]").click();
  assert.strictEqual(window.document.querySelector("[data-plan-drawer]").hidden, false);
  assert(window.document.querySelector("[data-plan-detail-body]").textContent.includes("主动作"));
  assert(window.document.querySelector('a[href="/plan/"]').getAttribute("aria-current") === "page");

  console.log("PASS: generated Plan page preview, calendar, navigation, and detail drawer smoke test");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
