"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

const wait = (milliseconds = 50) => new Promise((resolve) => setTimeout(resolve, milliseconds));

(async function () {
  const html = fs.readFileSync("/site/_site/library/index.html", "utf8");
  const documentRecord = {
    id: "pdf-f8e51cc0bd8cdcad",
    title: "Mathematics for Machine Learning",
    filename: "mml-book.pdf",
    path: "https://github.com/MiyaaL/MiyaaL.github.io/releases/download/library-assets-v1/mathematics-for-machine-learning-f8e51cc0.pdf",
    tags: ["Machine Learning"],
    bytes: 19544796,
    sha256: "f8e51cc0bd8cdcad342d85ce4fef2595cea62fbbe44d579ef01e54a5ddfeb673",
    addedAt: "2026-08-04T07:46:43.049Z",
    source: "release",
    release: {
      tag: "library-assets-v1",
      releaseId: 364927245,
      assetId: 501435061,
      assetName: "mathematics-for-machine-learning-f8e51cc0.pdf",
      downloadUrl: "https://github.com/MiyaaL/MiyaaL.github.io/releases/download/library-assets-v1/mathematics-for-machine-learning-f8e51cc0.pdf"
    }
  };
  const catalog = { schemaVersion: 3, documents: [documentRecord] };
  const dom = new JSDOM(html, {
    url: "https://miyaal.github.io/library/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.HTMLElement.prototype.scrollIntoView = function () {};
  window.fetch = async () => ({ ok: true, json: async () => catalog });

  window.eval(fs.readFileSync("/site/assets/js/library-store.js", "utf8"));
  const memoryStore = window.LibraryStore.createMemoryAdapter({
    signedIn: true,
    owner: true,
    deleteResult: {
      document: documentRecord,
      catalog: { schemaVersion: 3, documents: [] }
    }
  });
  window.LibraryStore.create = function () { return memoryStore; };
  window.eval(fs.readFileSync("/site/assets/js/library-github.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/library-annotations.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/library-pdf-editor.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/library-immersive.js", "utf8"));
  window.eval(fs.readFileSync("/site/assets/js/library-app.js", "utf8"));

  await wait();
  const card = window.document.querySelector(".library-document");
  assert(card, "the document card should render before deletion");
  card.click();
  await wait();

  const deleteTrigger = window.document.querySelector("[data-library-delete]");
  assert.strictEqual(deleteTrigger.hidden, false);
  deleteTrigger.click();

  const pdfViewer = window.document.querySelector("[data-library-pdf-viewer]");
  pdfViewer.replaceChildren = function () {
    throw new Error("reader_teardown_failed");
  };
  window.document.querySelector("[data-library-delete-form]").dispatchEvent(
    new window.Event("submit", { bubbles: true, cancelable: true })
  );
  await wait();

  assert.strictEqual(
    window.document.querySelectorAll(".library-document").length,
    0,
    "a committed deletion must remove the stale card even if reader teardown fails"
  );
  assert.strictEqual(
    window.document.querySelector("[data-library-delete-dialog]").hasAttribute("open"),
    false,
    "a committed deletion must close the confirmation dialog"
  );
  assert.strictEqual(window.document.querySelector("[data-library-delete-error]").textContent, "");

  console.log("PASS: committed Library deletion wins over reader teardown failures");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
