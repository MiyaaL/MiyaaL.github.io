"use strict";

const assert = require("assert");
const LibraryStore = require("../assets/js/library-store.js");

(async function () {
  const adapter = LibraryStore.createMemoryAdapter({
    progress: {
      "pdf-one": {
        documentId: "pdf-one",
        page: 7,
        totalPages: 20,
        zoom: 1.2,
        updatedAt: "2026-08-04T01:00:00.000Z"
      }
    }
  });

  const loaded = adapter.loadLocalProgress();
  assert.strictEqual(loaded["pdf-one"].page, 7);
  assert.strictEqual(loaded["pdf-one"].zoom, 1.2);

  await adapter.saveRemoteProgress({
    documentId: "pdf-one",
    page: 8,
    totalPages: 20,
    zoom: 1.3,
    updatedAt: "2026-08-04T02:00:00.000Z"
  });
  const remote = await adapter.loadRemoteProgress();
  assert.strictEqual(remote["pdf-one"].page, 8);

  const deletionRequest = {
    documentId: "pdf-one",
    revision: {
      source: "external",
      path: "https://example.org/paper.pdf",
      sha256: null,
      assetId: null
    }
  };
  const deleted = await adapter.deleteDocument(deletionRequest);
  assert.strictEqual(deleted.document.id, "pdf-one");

  await adapter.signOut();
  await assert.rejects(adapter.loadRemoteProgress(), (error) => error.code === "not_site_owner");
  await assert.rejects(adapter.getUploadToken(), (error) => error.code === "not_site_owner");
  await assert.rejects(adapter.deleteDocument(deletionRequest), (error) => error.code === "not_site_owner");

  const normalized = LibraryStore.normalizeProgress({
    documentId: "pdf-two",
    page: -4,
    totalPages: 0,
    zoom: 9
  });
  assert.strictEqual(normalized.page, 1);
  assert.strictEqual(normalized.zoom, 2.5);

  console.log("PASS: LibraryStore local progress, remote sync, and owner authorization tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
