(function () {
  "use strict";

  var root = document.querySelector("[data-tips-app]");
  if (!root || !window.TipsGitHub || !window.TipsStore) {
    return;
  }

  var elements = {
    auth: document.querySelector("[data-tips-auth]"),
    syncState: document.querySelector("[data-tips-sync-state]"),
    message: root.querySelector("[data-tips-message]"),
    categories: root.querySelector("[data-tips-categories]"),
    search: root.querySelector("[data-tips-search]"),
    upload: root.querySelector("[data-tips-upload]"),
    count: root.querySelector("[data-tips-count]"),
    workspace: root.querySelector("[data-tips-workspace]"),
    groups: root.querySelector("[data-tips-groups]"),
    reader: root.querySelector("[data-tips-reader]"),
    readerCategory: root.querySelector("[data-tips-reader-category]"),
    readerTitle: root.querySelector("[data-tips-reader-title]"),
    readerDescription: root.querySelector("[data-tips-reader-description]"),
    openSource: root.querySelector("[data-tips-open-source]"),
    closeReader: root.querySelector("[data-tips-close-reader]"),
    readerFrame: root.querySelector("[data-tips-reader-frame]"),
    readerLoading: root.querySelector("[data-tips-reader-loading]"),
    readerError: root.querySelector("[data-tips-reader-error]"),
    uploadDialog: root.querySelector("[data-tips-upload-dialog]"),
    uploadForm: root.querySelector("[data-tips-upload-form]"),
    sourceNote: root.querySelector("[data-tips-source-note]"),
    fileField: root.querySelector("[data-tips-file-field]"),
    urlField: root.querySelector("[data-tips-url-field]"),
    file: root.querySelector("[data-tips-file]"),
    url: root.querySelector("[data-tips-url]"),
    closeUpload: root.querySelector("[data-tips-close-upload]"),
    cancelUpload: root.querySelector("[data-tips-cancel-upload]"),
    submitUpload: root.querySelector("[data-tips-submit-upload]"),
    uploadError: root.querySelector("[data-tips-upload-error]")
  };

  var store = window.TipsStore.create({
    url: root.dataset.supabaseUrl,
    publishableKey: root.dataset.supabaseKey,
    redirectTo: location.origin + "/tips/"
  });
  var categories = window.TipsGitHub.CATEGORIES;
  var state = {
    documents: [],
    selectedCategory: "",
    query: "",
    activeDocument: null,
    session: null,
    owner: false,
    openingSequence: 0
  };

  function textElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    return element;
  }

  function setMessage(message) {
    elements.message.textContent = message || "";
  }

  function friendlyError(error) {
    var code = error && (error.code || error.message);
    var messages = {
      not_site_owner: "当前 GitHub 账号不是站点所有者。",
      not_configured: "Tips 管理功能尚未配置 Supabase。",
      supabase_not_configured: "Tips 管理功能尚未配置 Supabase。",
      github_app_not_configured: "GitHub App 尚未配置。",
      github_token_request_failed: "暂时无法取得 GitHub 写入凭据。",
      github_token_required: "请先登录站点所有者账号。",
      tip_file_required: "请选择 Markdown 或 HTML 文件。",
      tip_file_empty: "上传文件为空。",
      tip_file_too_large: "文件超过 2 MB 上限；图片和附件请使用外部链接。",
      tip_file_not_utf8: "文档必须使用 UTF-8 编码。",
      tip_filename_invalid: "文件名无效或过长。",
      external_url_invalid: "请输入有效的网页地址。",
      external_url_https_required: "网页链接必须是无账号密码的公开 HTTPS 地址。",
      title_required: "请填写标题。",
      title_invalid: "标题无效或过长。",
      description_required: "请填写一句话说明。",
      description_invalid: "说明无效或过长。",
      category_required: "请选择一个分类。",
      duplicate_tip: "这份文档或网页链接已经在 Tips 中。",
      repository_changed: "发布过程中仓库发生了变化，请刷新后重试。",
      tips_release_invalid: "Tips Release 状态异常，请到 GitHub 检查。",
      release_asset_invalid: "GitHub 没有返回有效的文件资产。",
      tip_content_integrity_failed: "文档内容与 GitHub 目录中的校验值不一致。",
      github_request_failed: "GitHub 暂时无法完成发布，请稍后重试。",
      catalog_invalid: "Tips 目录格式无效。",
      catalog_load_failed: "无法加载 Tips 目录。",
      tip_content_unavailable: "无法读取文档内容，请尝试查看原文件。"
    };
    return messages[code] || "操作没有完成，请稍后重试。";
  }

  function categoryFor(id) {
    return categories.find(function (category) { return category.id === id; });
  }

  function formatDate(value) {
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) {
      return "";
    }
    return new Intl.DateTimeFormat("zh-CN", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit"
    }).format(date);
  }

  function formatBytes(value) {
    var bytes = Number(value) || 0;
    if (bytes < 1024) {
      return bytes + " B";
    }
    if (bytes < 1024 * 1024) {
      return Math.round(bytes / 1024) + " KB";
    }
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatLabel(documentRecord) {
    if (documentRecord.format === "markdown") {
      return "Markdown";
    }
    if (documentRecord.format === "html") {
      return "HTML";
    }
    return "网页链接";
  }

  function visibleDocuments() {
    var query = state.query.trim().toLocaleLowerCase();
    return state.documents.filter(function (documentRecord) {
      if (state.selectedCategory && documentRecord.category !== state.selectedCategory) {
        return false;
      }
      var haystack = [
        documentRecord.title,
        documentRecord.description,
        documentRecord.filename,
        (documentRecord.tags || []).join(" ")
      ].join(" ").toLocaleLowerCase();
      return !query || haystack.indexOf(query) >= 0;
    });
  }

  function renderCategories() {
    elements.categories.replaceChildren();
    categories.forEach(function (category) {
      var count = state.documents.filter(function (documentRecord) {
        return documentRecord.category === category.id;
      }).length;
      var button = document.createElement("button");
      button.type = "button";
      button.className = "tips-category";
      button.setAttribute("aria-pressed", String(state.selectedCategory === category.id));
      button.append(
        textElement("span", "tips-category-label", category.label),
        textElement("span", "tips-category-meta", category.eyebrow + " · " + count)
      );
      button.addEventListener("click", function () {
        state.selectedCategory = state.selectedCategory === category.id ? "" : category.id;
        renderCategories();
        renderDocuments();
      });
      elements.categories.appendChild(button);
    });
  }

  function tipCard(documentRecord) {
    var element = documentRecord.source === "external" ? document.createElement("a") : document.createElement("button");
    var metaParts = [formatDate(documentRecord.addedAt), formatLabel(documentRecord)];
    if (documentRecord.source === "release") {
      metaParts.push(formatBytes(documentRecord.bytes));
    }
    if (documentRecord.tags && documentRecord.tags.length) {
      metaParts.push(documentRecord.tags.map(function (tag) { return "#" + tag; }).join("  "));
    }
    element.className = "tips-document" + (state.activeDocument && state.activeDocument.id === documentRecord.id ? " is-active" : "");
    element.append(
      textElement("span", "tips-document-title", documentRecord.title),
      textElement("span", "tips-document-description", documentRecord.description),
      textElement("span", "tips-document-meta", metaParts.filter(Boolean).join(" · "))
    );
    if (documentRecord.source === "external") {
      element.href = documentRecord.path;
      element.target = "_blank";
      element.rel = "noopener noreferrer";
    } else {
      element.type = "button";
      element.addEventListener("click", function () { openDocument(documentRecord); });
    }
    return element;
  }

  function renderDocuments() {
    var visible = visibleDocuments();
    elements.groups.replaceChildren();
    elements.count.textContent = "显示 " + visible.length + " / " + state.documents.length + " 条";
    categories.forEach(function (category) {
      if (state.selectedCategory && state.selectedCategory !== category.id) {
        return;
      }
      var records = visible.filter(function (documentRecord) {
        return documentRecord.category === category.id;
      });
      var section = document.createElement("section");
      var header = document.createElement("header");
      header.className = "tips-group-header";
      header.append(
        textElement("h2", "", category.label),
        textElement("span", "tips-group-count", records.length + " TIPS")
      );
      section.className = "tips-group";
      section.appendChild(header);
      if (!records.length) {
        section.appendChild(textElement("p", "tips-group-empty", state.query ? "没有匹配的内容。" : "暂无记录。"));
      } else {
        records.forEach(function (documentRecord) {
          section.appendChild(tipCard(documentRecord));
        });
      }
      elements.groups.appendChild(section);
    });
  }

  function updateManagementControls() {
    elements.upload.hidden = !state.owner;
  }

  async function refreshAuth() {
    try {
      state.session = await store.getSession();
      state.owner = state.session ? await store.isOwner() : false;
      elements.auth.textContent = state.session ? "Sign Out" : "Manage Tips";
      elements.syncState.textContent = state.owner ? "Owner mode" : "Public catalog";
      updateManagementControls();
    } catch (error) {
      state.owner = false;
      elements.auth.textContent = "Manage Tips";
      elements.syncState.textContent = "Public catalog";
      updateManagementControls();
      setMessage(friendlyError(error));
    }
  }

  function escapeHtml(value) {
    return String(value || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function sanitizeImportedHtml(value) {
    var parsed = new DOMParser().parseFromString(String(value || ""), "text/html");
    parsed.querySelectorAll("script,noscript,iframe,frame,object,embed,form,input,button,textarea,select,base,meta[http-equiv],link[rel~='stylesheet']").forEach(function (node) {
      node.remove();
    });
    parsed.querySelectorAll("*").forEach(function (node) {
      Array.from(node.attributes).forEach(function (attribute) {
        var name = attribute.name.toLocaleLowerCase();
        var valueText = attribute.value.trim().toLocaleLowerCase();
        if (
          name.indexOf("on") === 0 ||
          name === "srcdoc" ||
          name === "formaction" ||
          (["href", "src", "xlink:href"].indexOf(name) >= 0 && (/^javascript:/.test(valueText) || /^data:text\/html/.test(valueText)))
        ) {
          node.removeAttribute(attribute.name);
        }
      });
    });
    parsed.querySelectorAll("a").forEach(function (link) {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    });
    var styles = Array.from(parsed.querySelectorAll("style")).map(function (style) {
      style.remove();
      return style.textContent || "";
    }).join("\n");
    return { body: parsed.body.innerHTML, styles: styles };
  }

  function renderMarkdown(value) {
    if (!window.markdownit) {
      return "<pre><code>" + escapeHtml(value) + "</code></pre>";
    }
    var markdown = window.markdownit({ html: false, linkify: true, breaks: false });
    var defaultLinkOpen = markdown.renderer.rules.link_open || function (tokens, index, options, environment, self) {
      return self.renderToken(tokens, index, options);
    };
    markdown.renderer.rules.link_open = function (tokens, index, options, environment, self) {
      tokens[index].attrSet("target", "_blank");
      tokens[index].attrSet("rel", "noopener noreferrer");
      return defaultLinkOpen(tokens, index, options, environment, self);
    };
    return markdown.render(String(value || ""));
  }

  function readerDocument(body, importedStyles, sourceUrl) {
    var dark = document.documentElement.dataset.theme === "dark";
    var colors = dark
      ? { background: "#11161d", text: "#e6edf3", soft: "#a2acb7", border: "#3a434e", accent: "#78a9e6", code: "#080b0f" }
      : { background: "#ffffff", text: "#1c2128", soft: "#59636e", border: "#dfe3e8", accent: "#245da6", code: "#11161d" };
    var styles = [
      ":root{color-scheme:" + (dark ? "dark" : "light") + ";font-family:Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}",
      "*{box-sizing:border-box}",
      "body{max-width:760px;margin:0 auto;padding:42px 34px 80px;background:" + colors.background + ";color:" + colors.text + ";font-size:16px;font-weight:400;line-height:1.75;overflow-wrap:anywhere}",
      "h1,h2,h3,h4,h5,h6,strong{font-weight:600}h1{font-size:32px}h2{margin-top:2em;font-size:26px}h3{margin-top:1.8em;font-size:21px}h4{font-size:18px}",
      "p,ul,ol,blockquote,table,pre{margin:0 0 1.35em}a{color:" + colors.accent + ";text-underline-offset:.2em}img{display:block;max-width:100%;height:auto;margin:1.5em auto}",
      "blockquote{padding-left:18px;border-left:2px solid " + colors.border + ";color:" + colors.soft + "}hr{border:0;border-top:1px solid " + colors.border + "}",
      "pre{overflow:auto;padding:16px;background:" + colors.code + ";color:#dce4ed;font:13px/1.65 'SFMono-Regular',Consolas,monospace}code{font-family:'SFMono-Regular',Consolas,monospace;font-size:.88em}p code,li code{padding:.12em .3em;background:" + colors.code + ";color:#dce4ed}",
      "table{display:block;width:100%;overflow:auto;border-collapse:collapse}th,td{padding:8px 10px;border:1px solid " + colors.border + ";text-align:left}th{font-weight:600}",
      "@media(max-width:560px){body{padding:28px 20px 64px}h1{font-size:28px}h2{font-size:23px}}",
      importedStyles || ""
    ].join("");
    return "<!doctype html><html><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width,initial-scale=1\"><base href=\"" + escapeHtml(sourceUrl) + "\" target=\"_blank\"><style>" + styles + "</style></head><body><article class=\"tip-content\">" + body + "</article></body></html>";
  }

  async function verifiedResponseText(response, documentRecord) {
    var buffer = await response.arrayBuffer();
    if (
      buffer.byteLength !== Number(documentRecord.bytes) ||
      buffer.byteLength > window.TipsGitHub.MAX_FILE_SIZE ||
      await window.TipsGitHub.sha256Hex(buffer) !== documentRecord.sha256
    ) {
      throw new Error("tip_content_integrity_failed");
    }
    try {
      return new TextDecoder("utf-8", { fatal: true }).decode(buffer);
    } catch (_) {
      throw new Error("tip_content_integrity_failed");
    }
  }

  async function fetchTipContent(documentRecord) {
    try {
      var direct = await fetch(documentRecord.path, { cache: "no-store", headers: { Accept: "text/markdown, text/html, text/plain" } });
      if (direct.ok) {
        return verifiedResponseText(direct, documentRecord);
      }
    } catch (_) {
      // Release downloads do not consistently expose CORS; use the catalog-validated proxy below.
    }
    if (!root.dataset.supabaseUrl) {
      throw new Error("tip_content_unavailable");
    }
    var proxyUrl = root.dataset.supabaseUrl.replace(/\/$/, "") + "/functions/v1/tips-content?id=" + encodeURIComponent(documentRecord.id);
    var proxied = await fetch(proxyUrl, { cache: "no-store", headers: { Accept: "text/plain, text/html" } });
    if (!proxied.ok) {
      throw new Error("tip_content_unavailable");
    }
    return verifiedResponseText(proxied, documentRecord);
  }

  function updateReaderUrl(documentRecord) {
    var url = new URL(location.href);
    if (documentRecord) {
      url.searchParams.set("tip", documentRecord.id);
    } else {
      url.searchParams.delete("tip");
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  async function openDocument(documentRecord) {
    if (documentRecord.source !== "release") {
      return;
    }
    var sequence = ++state.openingSequence;
    state.activeDocument = documentRecord;
    elements.reader.hidden = false;
    elements.workspace.classList.add("is-reading");
    elements.readerCategory.textContent = categoryFor(documentRecord.category).eyebrow;
    elements.readerTitle.textContent = documentRecord.title;
    elements.readerDescription.textContent = documentRecord.description;
    elements.openSource.href = documentRecord.path;
    elements.readerLoading.hidden = false;
    elements.readerError.hidden = true;
    elements.readerFrame.srcdoc = "";
    updateReaderUrl(documentRecord);
    renderDocuments();

    try {
      var source = await fetchTipContent(documentRecord);
      if (sequence !== state.openingSequence) {
        return;
      }
      var body;
      var importedStyles = "";
      if (documentRecord.format === "markdown") {
        body = renderMarkdown(source);
      } else {
        var sanitized = sanitizeImportedHtml(source);
        body = sanitized.body;
        importedStyles = sanitized.styles;
      }
      elements.readerFrame.addEventListener("load", function frameLoaded() {
        if (sequence === state.openingSequence) {
          elements.readerLoading.hidden = true;
        }
      }, { once: true });
      elements.readerFrame.srcdoc = readerDocument(body, importedStyles, documentRecord.path);
      elements.reader.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (sequence !== state.openingSequence) {
        return;
      }
      elements.readerLoading.hidden = true;
      elements.readerError.hidden = false;
      elements.readerError.textContent = friendlyError(error);
    }
  }

  function closeReader() {
    state.openingSequence += 1;
    state.activeDocument = null;
    elements.reader.hidden = true;
    elements.workspace.classList.remove("is-reading");
    elements.readerFrame.srcdoc = "";
    elements.readerError.hidden = true;
    updateReaderUrl(null);
    renderDocuments();
  }

  function selectedSource() {
    return elements.uploadForm.elements.source.value === "external" ? "external" : "file";
  }

  function updateSourceFields() {
    var external = selectedSource() === "external";
    elements.fileField.hidden = external;
    elements.urlField.hidden = !external;
    elements.file.required = !external;
    elements.url.required = external;
    elements.sourceNote.textContent = external
      ? "只把网页标题、分类和公开 HTTPS 地址提交到 GitHub 目录。"
      : "文件会作为 GitHub Release Asset 保存；主分支只提交轻量目录元数据。";
  }

  function openUploadDialog() {
    elements.uploadError.textContent = "";
    updateSourceFields();
    if (typeof elements.uploadDialog.showModal === "function") {
      elements.uploadDialog.showModal();
    } else {
      elements.uploadDialog.setAttribute("open", "");
    }
  }

  function closeUploadDialog() {
    if (typeof elements.uploadDialog.close === "function") {
      elements.uploadDialog.close();
    } else {
      elements.uploadDialog.removeAttribute("open");
    }
  }

  async function addTip(event) {
    event.preventDefault();
    elements.uploadError.textContent = "";
    var data = new FormData(elements.uploadForm);
    var source = selectedSource();
    elements.submitUpload.disabled = true;
    elements.submitUpload.textContent = "正在发布…";
    try {
      var credentials = await store.getUploadToken();
      var common = {
        token: credentials.token,
        repository: root.dataset.repository,
        branch: root.dataset.branch,
        title: data.get("title"),
        description: data.get("description"),
        category: data.get("category"),
        tags: data.get("tags")
      };
      var result;
      if (source === "external") {
        result = await window.TipsGitHub.commitExternalTip(Object.assign(common, { url: data.get("url") }));
      } else {
        result = await window.TipsGitHub.archiveTip(Object.assign(common, { file: data.get("document") }));
      }
      state.documents = result.catalog.documents;
      renderCategories();
      renderDocuments();
      elements.uploadForm.reset();
      updateSourceFields();
      closeUploadDialog();
      setMessage(source === "external"
        ? "网页链接已提交到 GitHub，当前列表已更新。"
        : "文档已写入分片 GitHub Release；主仓库只增加了一条目录记录。");
    } catch (error) {
      elements.uploadError.textContent = friendlyError(error);
    } finally {
      elements.submitUpload.disabled = false;
      elements.submitUpload.textContent = "发布到 GitHub";
    }
  }

  async function loadCatalog() {
    var response = await fetch(root.dataset.catalogUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("catalog_load_failed");
    }
    var catalog = window.TipsGitHub.normalizeCatalog(await response.json());
    state.documents = catalog.documents;
    renderCategories();
    renderDocuments();
    elements.syncState.textContent = "Public catalog";

    var documentId = new URL(location.href).searchParams.get("tip");
    var requested = state.documents.find(function (documentRecord) {
      return documentRecord.id === documentId && documentRecord.source === "release";
    });
    if (requested) {
      openDocument(requested);
    }
  }

  elements.search.addEventListener("input", function () {
    state.query = elements.search.value;
    renderDocuments();
  });
  elements.auth.addEventListener("click", async function () {
    setMessage("");
    try {
      if (state.session) {
        await store.signOut();
        state.session = null;
        state.owner = false;
        elements.auth.textContent = "Manage Tips";
        elements.syncState.textContent = "Public catalog";
        updateManagementControls();
      } else {
        await store.signIn();
      }
    } catch (error) {
      setMessage(friendlyError(error));
    }
  });
  elements.upload.addEventListener("click", openUploadDialog);
  elements.closeUpload.addEventListener("click", closeUploadDialog);
  elements.cancelUpload.addEventListener("click", closeUploadDialog);
  elements.closeReader.addEventListener("click", closeReader);
  elements.uploadForm.addEventListener("change", function (event) {
    if (event.target && event.target.name === "source") {
      updateSourceFields();
    }
  });
  elements.uploadForm.addEventListener("submit", addTip);
  elements.uploadDialog.addEventListener("click", function (event) {
    if (event.target === elements.uploadDialog) {
      closeUploadDialog();
    }
  });
  store.onAuthChange(function () { refreshAuth(); });

  Promise.all([loadCatalog(), refreshAuth()]).catch(function (error) {
    elements.syncState.textContent = "Unavailable";
    setMessage(friendlyError(error));
  });
}());
