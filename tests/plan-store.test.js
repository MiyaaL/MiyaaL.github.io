"use strict";

const assert = require("node:assert");
const { test } = require("node:test");
const PlanStore = require("../assets/js/plan-store.js");
const { createMemoryAdapter } = require("./helpers/memory-store.js");

test("the shipped store exposes only the Supabase adapter", () => {
  assert.strictEqual(typeof PlanStore.createSupabaseAdapter, "function");
  assert.strictEqual(PlanStore.createMemoryAdapter, undefined, "the test double is not shipped to browsers");
  const unconfigured = PlanStore.createSupabaseAdapter({}, { storage: null, supabase: null });
  assert.strictEqual(unconfigured.configured, false);
});

test("errors are normalised to the codes the app branches on", () => {
  assert.strictEqual(PlanStore.normalizeError({ message: "P0001 version_conflict" }).code, "version_conflict");
  assert.strictEqual(PlanStore.normalizeError({ message: "not_plan_owner" }).code, "not_plan_owner");
  assert.strictEqual(PlanStore.normalizeError({}).message, "Sync failed");
});

test("the memory adapter mirrors the adapter interface and its optimistic lock", async () => {
  const adapter = createMemoryAdapter({ version: 2, state: { value: "private" }, snapshot: { value: "public" } });
  const real = PlanStore.createSupabaseAdapter({}, { storage: null, supabase: null });
  Object.keys(real).filter((key) => typeof real[key] === "function").forEach((key) => {
    assert.strictEqual(typeof adapter[key], "function", key + " exists on the test double");
  });

  const publicRecord = await adapter.loadPublic();
  assert.strictEqual(publicRecord.record.version, 2);
  assert.strictEqual(publicRecord.record.snapshot.value, "public");
  assert.strictEqual((await adapter.loadPrivate()).state.value, "private");
  assert.strictEqual((await adapter.save(2, { value: "next" }, { value: "next-public" })).version, 3);
  await assert.rejects(adapter.save(2, { value: "stale" }, { value: "stale" }),
    (error) => error.code === "version_conflict");
  await adapter.signOut();
  await assert.rejects(adapter.loadPrivate(), (error) => error.code === "not_plan_owner");
});
