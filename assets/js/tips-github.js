(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TipsGitHub = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var API_VERSION = "2026-03-10";
  var CATALOG_PATH = "assets/tips/catalog.json";
  var MAX_FILE_SIZE = 2 * 1024 * 1024;
  var CATEGORIES = [
    { id: "mathematics", label: "数学", eyebrow: "MATHEMATICS" },
    { id: "machine-learning", label: "机器学习算法", eyebrow: "MACHINE LEARNING" },
    { id: "infra-chip", label: "Infra / 芯片", eyebrow: "INFRA / CHIP" }
  ];
  var CATEGORY_IDS = CATEGORIES.map(function (category) { return category.id; });

  function codedError(code, status) {
    var error = new Error(code);
    error.code = code;
    if (status) {
      error.status = status;
    }
    return error;
  }

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
    }, []).slice(0, 8);
  }

  function validateRepository(value) {
    var repository = String(value || "");
    if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
      throw codedError("invalid_repository");
    }
    return repository;
  }

  function validateCategory(value) {
    var category = String(value || "");
    if (CATEGORY_IDS.indexOf(category) < 0) {
      throw codedError("category_required");
    }
    return category;
  }

  function cleanText(value, field, maximum) {
    var text = String(value || "").trim().replace(/\s+/g, " ");
    if (!text) {
      throw codedError(field + "_required");
    }
    if (text.length > maximum || /[\u0000-\u001f\u007f]/.test(text)) {
      throw codedError(field + "_invalid");
    }
    return text;
  }

  function validateExternalUrl(value) {
    var url;
    try {
      url = new URL(String(value || "").trim());
    } catch (_) {
      throw codedError("external_url_invalid");
    }
    if (url.protocol !== "https:" || url.username || url.password) {
      throw codedError("external_url_https_required");
    }
    return url.href;
  }

  function fileType(file) {
    var name = String(file && file.name || "");
    var extension = (name.match(/\.([^.]+)$/) || [])[1];
    extension = String(extension || "").toLocaleLowerCase();
    if (extension === "md" || extension === "markdown") {
      return { format: "markdown", extension: "md", contentType: "text/markdown; charset=utf-8" };
    }
    if (extension === "html" || extension === "htm") {
      return { format: "html", extension: "html", contentType: "text/html; charset=utf-8" };
    }
    throw codedError("tip_file_required");
  }

  function validateTipFile(file, buffer) {
    var type = fileType(file);
    if (!buffer || !buffer.byteLength) {
      throw codedError("tip_file_empty");
    }
    if (buffer.byteLength > MAX_FILE_SIZE) {
      throw codedError("tip_file_too_large");
    }
    if (String(file.name || "").length > 240 || /[\u0000-\u001f\u007f]/.test(String(file.name || ""))) {
      throw codedError("tip_filename_invalid");
    }
    try {
      new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (_) {
      throw codedError("tip_file_not_utf8");
    }
    return type;
  }

  async function sha256Hex(buffer, cryptoObject) {
    var cryptoApi = cryptoObject || (typeof crypto !== "undefined" ? crypto : null);
    if (!cryptoApi || !cryptoApi.subtle) {
      throw codedError("web_crypto_unavailable");
    }
    var digest = await cryptoApi.subtle.digest("SHA-256", buffer);
    return Array.from(new Uint8Array(digest)).map(function (byte) {
      return byte.toString(16).padStart(2, "0");
    }).join("");
  }

  function decodeBase64(value) {
    var binary = atob(String(value || "").replace(/\s/g, ""));
    var bytes = new Uint8Array(binary.length);
    for (var index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return new TextDecoder().decode(bytes);
  }

  function normalizeDocument(documentRecord) {
    if (!documentRecord || typeof documentRecord !== "object") {
      return null;
    }
    var source = documentRecord.source === "release" ? "release" : documentRecord.source === "external" ? "external" : "";
    var format = source === "external" ? "link" : documentRecord.format;
    var path = String(documentRecord.path || "").trim();
    var validPath = false;
    try {
      var url = new URL(path);
      validPath = url.protocol === "https:" && !url.username && !url.password;
    } catch (_) {
      validPath = false;
    }
    if (source === "release") {
      validPath = validPath && /^https:\/\/github\.com\/MiyaaL\/MiyaaL\.github\.io\/releases\/download\/tips-assets-[a-f0-9]{2}\/[a-z0-9][a-z0-9.-]*\.(?:md|html)$/.test(path);
    }
    if (
      !/^tip-(?:file|link)-[a-f0-9]{16}$/.test(String(documentRecord.id || "")) ||
      !source ||
      (source === "release" && ["markdown", "html"].indexOf(format) < 0) ||
      (source === "external" && format !== "link") ||
      CATEGORY_IDS.indexOf(documentRecord.category) < 0 ||
      !String(documentRecord.title || "").trim() ||
      !validPath
    ) {
      return null;
    }
    return Object.assign({}, documentRecord, {
      source: source,
      format: format,
      description: String(documentRecord.description || ""),
      tags: parseTags(documentRecord.tags)
    });
  }

  function normalizeCatalog(value) {
    var catalog = value && typeof value === "object" ? value : {};
    var documents = (Array.isArray(catalog.documents) ? catalog.documents : [])
      .map(normalizeDocument)
      .filter(Boolean);
    return { schemaVersion: 1, documents: documents };
  }

  function apiHeaders(token, extra) {
    return Object.assign({
      Accept: "application/vnd.github+json",
      Authorization: "Bearer " + token,
      "X-GitHub-Api-Version": API_VERSION
    }, extra || {});
  }

  async function request(fetchApi, url, options, acceptedStatuses) {
    var response = await fetchApi(url, options || {});
    var payload = response.status === 204 ? null : await response.json().catch(function () { return null; });
    if (!response.ok && (acceptedStatuses || []).indexOf(response.status) < 0) {
      var error = codedError("github_request_failed", response.status);
      error.details = payload;
      throw error;
    }
    return { data: payload, status: response.status };
  }

  async function repositorySnapshot(settings) {
    var baseUrl = "https://api.github.com/repos/" + settings.repository;
    var headers = apiHeaders(settings.token);
    var reference = await request(settings.fetch, baseUrl + "/git/ref/heads/" + encodeURIComponent(settings.branch), { headers: headers });
    var headSha = reference.data && reference.data.object && reference.data.object.sha;
    if (!headSha) {
      throw codedError("repository_state_invalid");
    }
    var commit = await request(settings.fetch, baseUrl + "/git/commits/" + headSha, { headers: headers });
    var treeSha = commit.data && commit.data.tree && commit.data.tree.sha;
    if (!treeSha) {
      throw codedError("repository_state_invalid");
    }
    var catalogFile = await request(
      settings.fetch,
      baseUrl + "/contents/" + CATALOG_PATH + "?ref=" + encodeURIComponent(headSha),
      { headers: headers }
    );
    var catalog;
    try {
      var parsed = JSON.parse(decodeBase64(catalogFile.data && catalogFile.data.content));
      if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.documents)) {
        throw new Error("catalog_invalid");
      }
      catalog = normalizeCatalog(parsed);
      var ids = catalog.documents.map(function (documentRecord) { return documentRecord.id; });
      if (catalog.documents.length !== parsed.documents.length || new Set(ids).size !== ids.length) {
        throw new Error("catalog_invalid");
      }
    } catch (_) {
      throw codedError("catalog_invalid");
    }
    return { headSha: headSha, treeSha: treeSha, catalog: catalog };
  }

  async function publishCatalog(settings, snapshot, catalog, message) {
    var baseUrl = "https://api.github.com/repos/" + settings.repository;
    var headers = apiHeaders(settings.token, { "Content-Type": "application/json" });
    var catalogJson = JSON.stringify(catalog, null, 2) + "\n";
    var blob = await request(settings.fetch, baseUrl + "/git/blobs", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ content: catalogJson, encoding: "utf-8" })
    });
    if (!blob.data || !blob.data.sha) {
      throw codedError("repository_state_invalid");
    }
    var tree = await request(settings.fetch, baseUrl + "/git/trees", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({
        base_tree: snapshot.treeSha,
        tree: [{ path: CATALOG_PATH, mode: "100644", type: "blob", sha: blob.data.sha }]
      })
    });
    if (!tree.data || !tree.data.sha) {
      throw codedError("repository_state_invalid");
    }
    var commit = await request(settings.fetch, baseUrl + "/git/commits", {
      method: "POST",
      headers: headers,
      body: JSON.stringify({ message: message, tree: tree.data.sha, parents: [snapshot.headSha] })
    });
    if (!commit.data || !commit.data.sha) {
      throw codedError("repository_state_invalid");
    }
    try {
      await request(settings.fetch, baseUrl + "/git/refs/heads/" + encodeURIComponent(settings.branch), {
        method: "PATCH",
        headers: headers,
        body: JSON.stringify({ sha: commit.data.sha, force: false })
      });
    } catch (error) {
      if (error.status === 409 || error.status === 422) {
        throw codedError("repository_changed", error.status);
      }
      throw error;
    }
    return commit.data.sha;
  }

  function slugify(value) {
    var slug = String(value || "")
      .normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLocaleLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 54);
    return slug || "document";
  }

  function releaseTagForDigest(digest) {
    return "tips-assets-" + digest.slice(0, 2);
  }

  async function getOrCreateRelease(settings, tag, targetSha) {
    var baseUrl = "https://api.github.com/repos/" + settings.repository;
    var headers = apiHeaders(settings.token);
    var existing = await request(
      settings.fetch,
      baseUrl + "/releases/tags/" + encodeURIComponent(tag),
      { headers: headers },
      [404]
    );
    var release = existing.status === 404 ? null : existing.data;
    if (!release) {
      try {
        var created = await request(settings.fetch, baseUrl + "/releases", {
          method: "POST",
          headers: apiHeaders(settings.token, { "Content-Type": "application/json" }),
          body: JSON.stringify({
            tag_name: tag,
            target_commitish: targetSha,
            name: "Tips Assets " + tag.slice(-2).toUpperCase(),
            body: "Sharded Markdown and HTML assets used by MiyaaL Tips. These files are intentionally kept out of Git history.",
            draft: false,
            prerelease: false,
            make_latest: "false"
          })
        });
        release = created.data;
      } catch (error) {
        if (error.status !== 422) {
          throw error;
        }
        var raced = await request(settings.fetch, baseUrl + "/releases/tags/" + encodeURIComponent(tag), { headers: headers });
        release = raced.data;
      }
    }
    if (
      !release || !Number.isSafeInteger(release.id) || release.id <= 0 ||
      release.tag_name !== tag || release.immutable === true || release.draft === true
    ) {
      throw codedError("tips_release_invalid");
    }
    return release;
  }

  async function uploadAsset(settings, release, tag, assetName, contentType, buffer) {
    var url = "https://uploads.github.com/repos/" + settings.repository + "/releases/" + release.id + "/assets?name=" + encodeURIComponent(assetName);
    var uploaded = await request(settings.fetch, url, {
      method: "POST",
      headers: apiHeaders(settings.token, { "Content-Type": contentType }),
      body: buffer
    });
    var expectedUrl = "https://github.com/" + settings.repository + "/releases/download/" + tag + "/" + assetName;
    var asset = uploaded.data;
    if (
      !asset || !Number.isSafeInteger(asset.id) || asset.name !== assetName ||
      asset.browser_download_url !== expectedUrl || asset.state !== "uploaded" ||
      asset.size !== buffer.byteLength ||
      (asset.digest && asset.digest !== "sha256:" + await sha256Hex(buffer, settings.crypto))
    ) {
      throw codedError("release_asset_invalid");
    }
    return {
      tag: tag,
      releaseId: release.id,
      assetId: asset.id,
      assetName: assetName,
      downloadUrl: expectedUrl
    };
  }

  async function cleanupAsset(settings, assetId) {
    try {
      await request(
        settings.fetch,
        "https://api.github.com/repos/" + settings.repository + "/releases/assets/" + assetId,
        { method: "DELETE", headers: apiHeaders(settings.token) },
        [404]
      );
    } catch (_) {
      // A failed catalog publish remains retryable even if GitHub cannot remove the orphan immediately.
    }
  }

  function operationSettings(options) {
    var settings = options || {};
    var fetchApi = settings.fetch || (typeof fetch !== "undefined" ? fetch.bind(globalThis) : null);
    if (!fetchApi) {
      throw codedError("fetch_unavailable");
    }
    return {
      fetch: fetchApi,
      crypto: settings.crypto,
      repository: validateRepository(settings.repository),
      branch: String(settings.branch || "main"),
      token: String(settings.token || ""),
      title: cleanText(settings.title, "title", 160),
      description: cleanText(settings.description, "description", 240),
      category: validateCategory(settings.category),
      tags: parseTags(settings.tags),
      now: settings.now || function () { return new Date(); }
    };
  }

  async function commitExternalTip(options) {
    var settings = operationSettings(options);
    if (!settings.token) {
      throw codedError("github_token_required");
    }
    var externalUrl = validateExternalUrl(options.url);
    var digest = await sha256Hex(new TextEncoder().encode(externalUrl).buffer, settings.crypto);
    var documentId = "tip-link-" + digest.slice(0, 16);
    var snapshot = await repositorySnapshot(settings);
    if (snapshot.catalog.documents.some(function (documentRecord) {
      return documentRecord.id === documentId || documentRecord.source === "external" && documentRecord.path === externalUrl;
    })) {
      throw codedError("duplicate_tip");
    }
    var documentRecord = {
      id: documentId,
      source: "external",
      format: "link",
      category: settings.category,
      title: settings.title,
      description: settings.description,
      path: externalUrl,
      tags: settings.tags,
      addedAt: settings.now().toISOString()
    };
    var catalog = { schemaVersion: 1, documents: [documentRecord].concat(snapshot.catalog.documents) };
    var commitSha = await publishCatalog(settings, snapshot, catalog, "tips: link " + settings.title);
    return {
      document: documentRecord,
      catalog: catalog,
      commitSha: commitSha,
      commitUrl: "https://github.com/" + settings.repository + "/commit/" + commitSha
    };
  }

  async function archiveTip(options) {
    var settings = operationSettings(options);
    if (!settings.token) {
      throw codedError("github_token_required");
    }
    var file = options.file;
    var buffer = options.buffer || await file.arrayBuffer();
    var type = validateTipFile(file, buffer);
    var digest = await sha256Hex(buffer, settings.crypto);
    var documentId = "tip-file-" + digest.slice(0, 16);
    var snapshot = await repositorySnapshot(settings);
    if (snapshot.catalog.documents.some(function (documentRecord) {
      return documentRecord.id === documentId || documentRecord.sha256 === digest;
    })) {
      throw codedError("duplicate_tip");
    }

    var tag = releaseTagForDigest(digest);
    var assetName = digest.slice(0, 16) + "-" + slugify(settings.title) + "." + type.extension;
    var release = await getOrCreateRelease(settings, tag, snapshot.headSha);
    var releaseMetadata = await uploadAsset(settings, release, tag, assetName, type.contentType, buffer);
    var documentRecord = {
      id: documentId,
      source: "release",
      format: type.format,
      category: settings.category,
      title: settings.title,
      description: settings.description,
      filename: String(file.name || assetName),
      path: releaseMetadata.downloadUrl,
      tags: settings.tags,
      bytes: buffer.byteLength,
      sha256: digest,
      addedAt: settings.now().toISOString(),
      release: releaseMetadata
    };
    var catalog = { schemaVersion: 1, documents: [documentRecord].concat(snapshot.catalog.documents) };
    try {
      var commitSha = await publishCatalog(settings, snapshot, catalog, "tips: add " + settings.title);
      return {
        document: documentRecord,
        catalog: catalog,
        commitSha: commitSha,
        commitUrl: "https://github.com/" + settings.repository + "/commit/" + commitSha
      };
    } catch (error) {
      await cleanupAsset(settings, releaseMetadata.assetId);
      throw error;
    }
  }

  return {
    API_VERSION: API_VERSION,
    CATALOG_PATH: CATALOG_PATH,
    CATEGORIES: CATEGORIES,
    MAX_FILE_SIZE: MAX_FILE_SIZE,
    archiveTip: archiveTip,
    commitExternalTip: commitExternalTip,
    normalizeCatalog: normalizeCatalog,
    parseTags: parseTags,
    releaseTagForDigest: releaseTagForDigest,
    sha256Hex: sha256Hex,
    validateCategory: validateCategory,
    validateExternalUrl: validateExternalUrl,
    validateTipFile: validateTipFile
  };
}));
