"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const { createPlanWindow, startPlanApp, settle } = require("./helpers/dom.js");

test("owner sign-in waits for a reachable sync service and retries", async () => {
  const { window } = createPlanWindow();
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
  startPlanApp(window);
  await settle();

  const button = window.document.querySelector("[data-plan-auth]");
  assert.strictEqual(button.textContent, "Owner sign-in");
  assert.ok(!button.classList.contains("plan-button-primary"), "visitors do not get a primary call to action");
  button.click();
  await settle();
  assert.strictEqual(signIns, 0, "offline sync must not open the broken OAuth URL");
  assert.match(window.document.querySelector("[data-plan-message]").textContent, /sync service is unavailable/);

  availability = "offline";
  button.click();
  await settle();
  assert.strictEqual(signIns, 0, "cached offline data must not open the broken OAuth URL");

  availability = "online";
  button.click();
  await settle();
  assert.strictEqual(signIns, 1, "retry must open OAuth after the service recovers");
  window.close();
});
