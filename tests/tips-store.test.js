"use strict";

const assert = require("assert");
const TipsStore = require("../assets/js/tips-store.js");

(async function () {
  const owner = TipsStore.createMemoryAdapter({
    signedIn: true,
    owner: true,
    token: "installation-token"
  });
  assert.strictEqual((await owner.getUploadToken()).token, "installation-token");
  await owner.signOut();
  await assert.rejects(owner.getUploadToken(), (error) => error.code === "not_site_owner");

  const visitor = TipsStore.createMemoryAdapter({ signedIn: true, owner: false });
  assert.strictEqual(await visitor.isOwner(), false);
  await assert.rejects(visitor.getUploadToken(), (error) => error.code === "not_site_owner");

  console.log("PASS: Tips owner authentication adapter tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
