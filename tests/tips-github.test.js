"use strict";

const assert = require("assert");
const crypto = require("crypto").webcrypto;

global.btoa = global.btoa || ((value) => Buffer.from(value, "binary").toString("base64"));
global.atob = global.atob || ((value) => Buffer.from(value, "base64").toString("binary"));

const TipsGitHub = require("../assets/js/tips-github.js");

function response(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload
  };
}

function snapshotReplies() {
  return [
    response({ object: { sha: "a".repeat(40) } }),
    response({ tree: { sha: "b".repeat(40) } }),
    response({
      content: Buffer.from('{"schemaVersion":1,"documents":[]}').toString("base64")
    })
  ];
}

function publishReplies(commitSha) {
  return [
    response({ sha: "c".repeat(40) }, 201),
    response({ sha: "d".repeat(40) }, 201),
    response({ sha: commitSha }, 201),
    response({ object: { sha: commitSha } })
  ];
}

(async function () {
  assert.deepStrictEqual(
    TipsGitHub.parseTags("CUDA, Math, cuda, Transformer"),
    ["CUDA", "Math", "Transformer"]
  );
  assert.strictEqual(TipsGitHub.CATEGORIES.length, 3);
  assert.strictEqual(TipsGitHub.MAX_FILE_SIZE, 2 * 1024 * 1024);
  assert.strictEqual(
    TipsGitHub.validateExternalUrl("https://example.org/notes#attention"),
    "https://example.org/notes#attention"
  );
  assert.throws(
    () => TipsGitHub.validateExternalUrl("http://example.org/notes"),
    /external_url_https_required/
  );

  const linkCalls = [];
  const linkReplies = snapshotReplies().concat(publishReplies("e".repeat(40)));
  const linked = await TipsGitHub.commitExternalTip({
    token: "test-token",
    repository: "MiyaaL/MiyaaL.github.io",
    branch: "main",
    title: "Scaled dot-product attention",
    description: "A concise derivation of attention scaling.",
    category: "machine-learning",
    tags: "Transformer, Attention",
    url: "https://example.org/notes#attention",
    crypto,
    now: () => new Date("2026-08-12T08:00:00.000Z"),
    fetch: async (url, options = {}) => {
      linkCalls.push({ url, options });
      return linkReplies.shift();
    }
  });
  assert.strictEqual(linked.document.source, "external");
  assert.strictEqual(linked.document.format, "link");
  assert.strictEqual(linked.document.category, "machine-learning");
  assert.strictEqual(linked.catalog.documents.length, 1);
  assert.strictEqual(linkCalls.length, 7);
  const linkTree = JSON.parse(linkCalls[4].options.body);
  assert.deepStrictEqual(linkTree.tree.map((entry) => entry.path), ["assets/tips/catalog.json"]);

  const bytes = new TextEncoder().encode("# Warp specialization\n\nA short explanation.\n");
  const digest = await TipsGitHub.sha256Hex(bytes.buffer, crypto);
  const tag = TipsGitHub.releaseTagForDigest(digest);
  const assetName = digest.slice(0, 16) + "-warp-specialization.md";
  const downloadUrl = `https://github.com/MiyaaL/MiyaaL.github.io/releases/download/${tag}/${assetName}`;
  const fileReplies = snapshotReplies().concat([
    response({ id: 42, tag_name: tag, immutable: false }),
    response({
      id: 84,
      name: assetName,
      browser_download_url: downloadUrl,
      state: "uploaded",
      size: bytes.byteLength,
      digest: `sha256:${digest}`
    }, 201)
  ], publishReplies("f".repeat(40)));
  const fileCalls = [];
  const archived = await TipsGitHub.archiveTip({
    token: "test-token",
    repository: "MiyaaL/MiyaaL.github.io",
    branch: "main",
    title: "Warp specialization",
    description: "Explains producer and consumer warps.",
    category: "infra-chip",
    tags: "CUDA, GPU",
    file: { name: "warp.md", type: "text/markdown", arrayBuffer: async () => bytes.buffer },
    buffer: bytes.buffer,
    crypto,
    now: () => new Date("2026-08-12T08:00:00.000Z"),
    fetch: async (url, options = {}) => {
      fileCalls.push({ url, options });
      return fileReplies.shift();
    }
  });
  assert.strictEqual(archived.document.format, "markdown");
  assert.strictEqual(archived.document.release.tag, tag);
  assert.strictEqual(archived.document.path, downloadUrl);
  assert.strictEqual(fileCalls.length, 9);
  assert(fileCalls[3].url.endsWith(`/releases/tags/${tag}`));
  assert(fileCalls[4].url.startsWith("https://uploads.github.com/"));

  assert.throws(
    () => TipsGitHub.validateTipFile({ name: "notes.pdf" }, bytes.buffer),
    /tip_file_required/
  );
  assert.throws(() => TipsGitHub.validateCategory("other"), /category_required/);

  const normalized = TipsGitHub.normalizeCatalog({
    documents: [
      archived.document,
      {
        id: "tip-link-0123456789abcdef",
        source: "external",
        format: "link",
        category: "mathematics",
        title: "Unsafe",
        path: "javascript:alert(1)"
      }
    ]
  });
  assert.strictEqual(normalized.documents.length, 1);

  console.log("PASS: Tips catalog, external link, and sharded Release publishing tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
