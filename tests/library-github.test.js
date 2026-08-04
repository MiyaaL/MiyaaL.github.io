"use strict";

const assert = require("assert");
const crypto = require("crypto").webcrypto;

global.btoa = global.btoa || ((value) => Buffer.from(value, "binary").toString("base64"));
global.atob = global.atob || ((value) => Buffer.from(value, "base64").toString("binary"));

const LibraryGitHub = require("../assets/js/library-github.js");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

(async function () {
  assert.deepStrictEqual(
    LibraryGitHub.parseTags("Machine Learning, AI Infra, machine learning, Quant"),
    ["Machine Learning", "AI Infra", "Quant"]
  );
  assert.strictEqual(LibraryGitHub.commitDocument, undefined);
  assert.strictEqual(LibraryGitHub.deleteDocument, undefined);

  const normalized = LibraryGitHub.normalizeCatalog({
    schemaVersion: 1,
    documents: [
      { id: "pdf-legacy", path: "/assets/library/pdfs/legacy.pdf" },
      { id: "pdf-release", source: "release", path: "https://github.com/release.pdf" },
      { id: "url-external", source: "external", path: "https://example.org/paper.pdf" }
    ]
  });
  assert.strictEqual(normalized.schemaVersion, 3);
  assert.deepStrictEqual(
    normalized.documents.map((document) => document.source),
    ["repository", "release", "external"]
  );

  const buffer = new TextEncoder().encode("%PDF-1.4\n%%EOF").buffer;
  assert.strictEqual(
    LibraryGitHub.validateExternalUrl("https://example.org/papers/ml.pdf#page=3"),
    "https://example.org/papers/ml.pdf"
  );
  assert.throws(() => LibraryGitHub.validateExternalUrl("http://example.org/ml.pdf"), /external_url_https_required/);
  assert.throws(() => LibraryGitHub.validateExternalUrl("https://user:secret@example.org/ml.pdf"), /external_url_https_required/);

  const linkCalls = [];
  const linkReplies = [
    response({ object: { sha: "link-head" } }),
    response({ tree: { sha: "link-base-tree" } }),
    response({ content: Buffer.from('{"schemaVersion":1,"documents":[]}').toString("base64") }),
    response({ sha: "link-catalog-blob" }, 201),
    response({ sha: "link-tree" }, 201),
    response({ sha: "link-commit" }, 201),
    response({ object: { sha: "link-commit" } })
  ];
  const linkFetch = async (url, options = {}) => {
    linkCalls.push({ url, options });
    return linkReplies.shift();
  };
  const linked = await LibraryGitHub.commitExternalDocument({
    token: "test-token",
    repository: "MiyaaL/MiyaaL.github.io",
    branch: "main",
    url: "https://example.org/papers/ml.pdf#introduction",
    title: "External ML Paper",
    tags: "Machine Learning, AI Infra",
    fetch: linkFetch,
    crypto
  });
  assert.strictEqual(linked.document.source, "external");
  assert.strictEqual(linked.document.path, "https://example.org/papers/ml.pdf");
  assert.strictEqual(linked.document.filename, "ml.pdf");
  assert.strictEqual(linked.catalog.schemaVersion, 3);
  assert.strictEqual(linkCalls.length, 7);
  assert(linkCalls[2].url.endsWith("?ref=link-head"));
  const linkedTree = JSON.parse(linkCalls[4].options.body);
  assert.deepStrictEqual(linkedTree.tree.map((entry) => entry.path), ["assets/library/catalog.json"]);

  assert.throws(
    () => LibraryGitHub.validatePdf({ name: "notes.txt", type: "text/plain" }, buffer),
    /pdf_required/
  );

  console.log("PASS: Library schema-v3 and external-link catalog commit tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
