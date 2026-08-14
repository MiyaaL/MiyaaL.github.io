"use strict";

const assert = require("assert");
const LibraryAnnotations = require("../assets/js/library-annotations.js");
const LibraryStore = require("../assets/js/library-store.js");

(async function () {
  const remote = LibraryStore.createMemoryAdapter();
  const local = LibraryAnnotations.createMemoryAdapter();
  const annotations = LibraryAnnotations.create({
    local,
    remote,
    now: () => "2026-08-14T10:00:00.000Z"
  });
  const documentRef = {
    documentId: "paper-one",
    documentRevision: "sha256:abc"
  };

  const empty = await annotations.load(documentRef, true);
  assert.strictEqual(empty.status, "synced");
  assert.strictEqual(empty.version, 0);

  const saved = await annotations.save(documentRef, [
    {
      annotationType: 9,
      pageIndex: 0,
      color: [255, 237, 0],
      quadPoints: new Float32Array([0, 1, 2, 1, 0, 0, 2, 0])
    }
  ], true);
  assert.strictEqual(saved.status, "synced");
  assert.strictEqual(saved.version, 1);
  assert.strictEqual(saved.dirty, false);
  assert(Array.isArray(saved.annotations[0].quadPoints));

  const secondDevice = LibraryAnnotations.create({
    local: LibraryAnnotations.createMemoryAdapter(),
    remote
  });
  const restored = await secondDevice.load(documentRef, true);
  assert.strictEqual(restored.annotations.length, 1);
  assert.strictEqual(restored.version, 1);

  const offlineRef = {
    documentId: "paper-offline",
    documentRevision: "external:one"
  };
  const offline = LibraryAnnotations.create({
    local: LibraryAnnotations.createMemoryAdapter()
  });
  const localOnly = await offline.save(offlineRef, [
    { annotationType: 15, pageIndex: 2, paths: { lines: [], points: [] } }
  ], false);
  assert.strictEqual(localOnly.status, "local-only");
  assert.strictEqual(localOnly.dirty, true);

  console.log("PASS: Library annotations local-first persistence and cross-device restore tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
