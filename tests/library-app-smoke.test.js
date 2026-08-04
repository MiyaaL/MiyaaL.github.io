"use strict";

const assert = require("assert");
const fs = require("fs");
const { JSDOM } = require("jsdom");

(async function () {
  const html = fs.readFileSync("/site/_site/library/index.html", "utf8");
  const catalog = {
    schemaVersion: 1,
    documents: [
      {
        id: "pdf-ml",
        title: "Attention Systems",
        filename: "attention-systems.pdf",
        path: "/assets/library/pdfs/attention-systems.pdf",
        tags: ["Machine Learning", "AI Infra"],
        bytes: 2048,
        addedAt: "2026-08-04T00:00:00.000Z"
      },
      {
        id: "pdf-quant",
        title: "Quant Research",
        filename: "quant-research.pdf",
        path: "/assets/library/pdfs/quant-research.pdf",
        tags: ["Quant"],
        bytes: 4096,
        addedAt: "2026-08-03T00:00:00.000Z"
      }
    ]
  };
  const dom = new JSDOM(html, {
    url: "https://miyaal.github.io/library/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.fetch = async () => ({ ok: true, json: async () => catalog });

  [
    "/site/assets/js/library-store.js",
    "/site/assets/js/library-github.js",
    "/site/assets/js/library-app.js"
  ].forEach((path) => window.eval(fs.readFileSync(path, "utf8")));

  await new Promise((resolve) => setTimeout(resolve, 50));

  assert.strictEqual(window.document.querySelectorAll(".library-document").length, 2);
  assert.strictEqual(window.document.querySelector("[data-library-count]").textContent, "2 documents");
  assert.strictEqual(window.document.querySelector("[data-library-upload]").hidden, true);
  assert.strictEqual(window.document.querySelector("[data-library-sync-state]").textContent, "Local only");
  assert(window.document.querySelector('a[href="/library/"]').getAttribute("aria-current") === "page");
  assert(window.document.querySelector("[data-library-pdf-viewer]").classList.contains("pdfViewer"));
  assert.strictEqual(window.document.querySelector("[data-library-canvas]"), null);
  assert.strictEqual(window.document.querySelectorAll('[name="source"]').length, 2);
  assert.strictEqual(window.document.querySelector('[name="source"]:checked').value, "repository");
  assert.strictEqual(window.document.querySelector("[data-library-url-field]").hidden, true);
  assert(window.document.querySelector('link[href*="pdf_viewer.css"]'));
  assert.strictEqual(window.LibraryGitHub.normalizeCatalog(catalog).documents[0].source, "repository");

  const search = window.document.querySelector("[data-library-search]");
  search.value = "quant";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  assert.strictEqual(window.document.querySelectorAll(".library-document").length, 1);
  assert(window.document.querySelector(".library-document-title").textContent.includes("Quant"));

  search.value = "";
  search.dispatchEvent(new window.Event("input", { bubbles: true }));
  const aiInfraTag = Array.from(window.document.querySelectorAll(".library-tag"))
    .find((button) => button.textContent.includes("AI Infra"));
  aiInfraTag.click();
  assert.strictEqual(window.document.querySelectorAll(".library-document").length, 1);

  console.log("PASS: generated Library navigation, continuous viewer, source selector, and filtering smoke test");
  window.close();
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
