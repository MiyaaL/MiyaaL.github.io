(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LibraryGitHub = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var MAX_FILE_SIZE = 50 * 1024 * 1024;
  var API_VERSION = "2026-03-10";
  var CATALOG_PATH = "assets/library/catalog.json";

  function parseTags(value) {
    var source = Array.isArray(value) ? value : String(value || "").split(",");
    var seen = {};
    return source.reduce(function (tags, raw) {
      var tag = String(raw || "").trim().replace(/\s+/g, " ");
      var key = tag.toLocaleLowerCase();
      if (tag && !seen[key]) {
        seen[key] = true;
        tags.push(tag.slice(0, 48));
      }
      return tags;
    }, []).slice(0, 12);
  }

  function slugify(value) {
    var slug = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 72);
    return slug || "document";
  }

  function validateRepository(value) {
    var repository = String(value || "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      throw new Error("invalid_repository");
    }
    return repository;
  }

  function bytesToBase64(buffer) {
    var bytes = new Uint8Array(buffer);
    var parts = [];
    var chunkSize = 0x8000;
    for (var index = 0; index < bytes.length; index += chunkSize) {
      parts.push(String.fromCharCode.apply(null, bytes.subarray(index, index + chunkSize)));
    }
    return btoa(parts.join(""));
  }

  function decodeBase64(value) {
    var binary = atob(String(value || "").replace(/\s/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }

  async function sha256Hex(buffer, cryptoObject) {
    var cryptoApi = cryptoObject || (typeof crypto !== "undefined" ? crypto : null);
    if (!cryptoApi || !cryptoApi.subtle) {
      throw new Error("web_crypto_unavailable");
    }
    var digest = await cryptoApi.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function validatePdf(file, buffer) {
    if (!file || !/\.pdf$/i.test(file.name || "") || file.type && file.type !== "application/pdf") {
      throw new Error("pdf_required");
    }
    if (!buffer || buffer.byteLength === 0) {
      throw new Error("pdf_empty");
    }
    if (buffer.byteLength > MAX_FILE_SIZE) {
      throw new Error("pdf_too_large");
    }
    var signature = new Uint8Array(buffer, 0, Math.min(5, buffer.byteLength));
    if (String.fromCharCode.apply(null, signature) !== "%PDF-") {
      throw new Error("invalid_pdf_signature");
    }
  }

  function normalizeCatalog(value) {
    var catalog = value && typeof value === "object" ? value : {};
    return {
      schemaVersion: 1,
      documents: Array.isArray(catalog.documents) ? catalog.documents.slice() : []
    };
  }

  function apiHeaders(token) {
    return {
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": API_VERSION
    };
  }

  async function request(fetchApi, url, options) {
    var response = await fetchApi(url, options);
    var payload = null;
    if (response.status !== 204) {
      payload = await response.json().catch(function () { return null; });
    }
    if (!response.ok) {
      var error = new Error(payload && payload.message ? payload.message : "github_request_failed");
      error.code = "github_" + response.status;
      error.status = response.status;
      error.details = payload;
      throw error;
    }
    return payload;
  }

  async function commitDocument(options) {
    var settings = options || {};
    var fetchApi = settings.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    if (!fetchApi) {
      throw new Error("fetch_unavailable");
    }

    var repository = validateRepository(settings.repository);
    var branch = String(settings.branch || "main");
    var token = String(settings.token || "");
    var title = String(settings.title || "").trim().slice(0, 160);
    if (!token) {
      throw new Error("github_token_required");
    }
    if (!title) {
      throw new Error("title_required");
    }

    var file = settings.file;
    var buffer = settings.buffer || await file.arrayBuffer();
    validatePdf(file, buffer);
    var digest = settings.sha256 || await sha256Hex(buffer, settings.crypto);
    var documentId = "pdf-" + digest.slice(0, 16);
    var pdfPath = "assets/library/pdfs/" + slugify(title) + "-" + digest.slice(0, 8) + ".pdf";
    var baseUrl = "https://api.github.com/repos/" + repository;
    var headers = apiHeaders(token);

    var reference = await request(fetchApi, baseUrl + "/git/ref/heads/" + encodeURIComponent(branch), {
      headers: headers
    });
    var headSha = reference.object.sha;
    var headCommit = await request(fetchApi, baseUrl + "/git/commits/" + headSha, {
      headers: headers
    });

    var catalogResponse = await request(fetchApi, baseUrl + "/contents/" + CATALOG_PATH + "?ref=" + encodeURIComponent(branch), {
      headers: headers
    });
    var catalog = normalizeCatalog(JSON.parse(decodeBase64(catalogResponse.content)));
    if (catalog.documents.some(function (document) { return document.id === documentId || document.sha256 === digest; })) {
      var duplicate = new Error("pdf_already_archived");
      duplicate.code = "duplicate_pdf";
      throw duplicate;
    }

    var document = {
      id: documentId,
      title: title,
      filename: String(file.name || "document.pdf").slice(0, 240),
      path: "/" + pdfPath,
      tags: parseTags(settings.tags),
      bytes: buffer.byteLength,
      sha256: digest,
      addedAt: new Date().toISOString()
    };
    catalog.documents.unshift(document);
    var catalogJson = JSON.stringify(catalog, null, 2) + "\n";

    var pdfBlob = await request(fetchApi, baseUrl + "/git/blobs", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({ content: bytesToBase64(buffer), encoding: "base64" })
    });
    var catalogBlob = await request(fetchApi, baseUrl + "/git/blobs", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({ content: catalogJson, encoding: "utf-8" })
    });
    var tree = await request(fetchApi, baseUrl + "/git/trees", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({
        base_tree: headCommit.tree.sha,
        tree: [
          { path: pdfPath, mode: "100644", type: "blob", sha: pdfBlob.sha },
          { path: CATALOG_PATH, mode: "100644", type: "blob", sha: catalogBlob.sha }
        ]
      })
    });
    var commit = await request(fetchApi, baseUrl + "/git/commits", {
      method: "POST",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({
        message: "library: archive " + title,
        tree: tree.sha,
        parents: [headSha]
      })
    });
    await request(fetchApi, baseUrl + "/git/refs/heads/" + encodeURIComponent(branch), {
      method: "PATCH",
      headers: Object.assign({ "Content-Type": "application/json" }, headers),
      body: JSON.stringify({ sha: commit.sha, force: false })
    });

    return {
      document: document,
      catalog: catalog,
      commitSha: commit.sha,
      commitUrl: "https://github.com/" + repository + "/commit/" + commit.sha
    };
  }

  return {
    API_VERSION: API_VERSION,
    CATALOG_PATH: CATALOG_PATH,
    MAX_FILE_SIZE: MAX_FILE_SIZE,
    commitDocument: commitDocument,
    normalizeCatalog: normalizeCatalog,
    parseTags: parseTags,
    sha256Hex: sha256Hex,
    slugify: slugify,
    validatePdf: validatePdf
  };
}));
