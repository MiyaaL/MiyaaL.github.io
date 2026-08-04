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
  assert.strictEqual(LibraryGitHub.slugify("Scaling Laws & GPU"), "scaling-laws-gpu");

  const buffer = new TextEncoder().encode("%PDF-1.4\n%%EOF").buffer;
  const file = {
    name: "scaling.pdf",
    type: "application/pdf",
    arrayBuffer: async () => buffer
  };
  const calls = [];
  const replies = [
    response({ object: { sha: "head-sha" } }),
    response({ tree: { sha: "base-tree" } }),
    response({ content: Buffer.from('{"schemaVersion":1,"documents":[]}').toString("base64") }),
    response({ sha: "pdf-blob" }, 201),
    response({ sha: "catalog-blob" }, 201),
    response({ sha: "new-tree" }, 201),
    response({ sha: "new-commit" }, 201),
    response({ object: { sha: "new-commit" } })
  ];
  const mockFetch = async (url, options = {}) => {
    calls.push({ url, options });
    return replies.shift();
  };

  const result = await LibraryGitHub.commitDocument({
    token: "test-token",
    repository: "MiyaaL/MiyaaL.github.io",
    branch: "main",
    file,
    buffer,
    title: "Scaling Laws & GPU",
    tags: "Machine Learning, AI Infra",
    fetch: mockFetch,
    crypto
  });

  assert.strictEqual(result.document.title, "Scaling Laws & GPU");
  assert.strictEqual(result.document.source, "repository");
  assert.deepStrictEqual(result.document.tags, ["Machine Learning", "AI Infra"]);
  assert(result.document.path.startsWith("/assets/library/pdfs/scaling-laws-gpu-"));
  assert.strictEqual(result.catalog.documents.length, 1);
  assert.strictEqual(result.commitSha, "new-commit");

  const treeRequest = JSON.parse(calls[5].options.body);
  assert.deepStrictEqual(
    treeRequest.tree.map((entry) => entry.path),
    [result.document.path.slice(1), "assets/library/catalog.json"]
  );
  const refUpdate = JSON.parse(calls[7].options.body);
  assert.deepStrictEqual(refUpdate, { sha: "new-commit", force: false });

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
  assert.strictEqual(linked.catalog.schemaVersion, 2);
  assert.strictEqual(linkCalls.length, 7);
  const linkedTree = JSON.parse(linkCalls[4].options.body);
  assert.deepStrictEqual(linkedTree.tree.map((entry) => entry.path), ["assets/library/catalog.json"]);

  assert.throws(
    () => LibraryGitHub.validatePdf({ name: "notes.txt", type: "text/plain" }, buffer),
    /pdf_required/
  );

  console.log("PASS: Library GitHub archive and external-link commit tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
