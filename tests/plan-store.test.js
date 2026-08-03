"use strict";

const assert = require("assert");
const PlanStore = require("../assets/js/plan-store.js");

(async function () {
  const adapter = PlanStore.createMemoryAdapter({
    version: 2,
    state: { value: "private" },
    snapshot: { value: "public" }
  });

  const publicRecord = await adapter.loadPublic();
  assert.strictEqual(publicRecord.record.version, 2);
  assert.strictEqual(publicRecord.record.snapshot.value, "public");

  const privateRecord = await adapter.loadPrivate();
  assert.strictEqual(privateRecord.state.value, "private");

  const saved = await adapter.save(2, { value: "next-private" }, { value: "next-public" });
  assert.strictEqual(saved.version, 3);

  await assert.rejects(
    adapter.save(2, { value: "stale" }, { value: "stale" }),
    (error) => error.code === "version_conflict"
  );

  await adapter.signOut();
  await assert.rejects(
    adapter.loadPrivate(),
    (error) => error.code === "not_plan_owner"
  );

  console.log("PASS: PlanStore shared adapter interface and optimistic locking tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
