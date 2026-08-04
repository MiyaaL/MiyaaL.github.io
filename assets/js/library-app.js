(function () {
  "use strict";

  var root = document.querySelector("[data-library-app]");
  if (!root || !window.LibraryStore || !window.LibraryGitHub) {
    return;
  }

  var elements = {
    auth: document.querySelector("[data-library-auth]"),
    syncState: document.querySelector("[data-library-sync-state]"),
    message: root.querySelector("[data-library-message]"),
    search: root.querySelector("[data-library-search]"),
    upload: root.querySelector("[data-library-upload]"),
    tags: root.querySelector("[data-library-tags]"),
    count: root.querySelector("[data-library-count]"),
    empty: root.querySelector("[data-library-empty]"),
    list: root.querySelector("[data-library-list]"),
    workspace: root.querySelector(".library-workspace"),
    reader: root.querySelector("[data-library-reader]"),
    readerTitle: root.querySelector("[data-library-reader-title]"),
    readerTags: root.querySelector("[data-library-reader-tags]"),
    openNative: root.querySelector("[data-library-open-native]"),
    closeReader: root.querySelector("[data-library-close-reader]"),
    previousPage: root.querySelector("[data-library-previous-page]"),
    nextPage: root.querySelector("[data-library-next-page]"),
    page: root.querySelector("[data-library-page]"),
    pageCount: root.querySelector("[data-library-page-count]"),
    zoomOut: root.querySelector("[data-library-zoom-out]"),
    zoomIn: root.querySelector("[data-library-zoom-in]"),
    zoom: root.querySelector("[data-library-zoom]"),
    viewport: root.querySelector("[data-library-reader-viewport]"),
    loading: root.querySelector("[data-library-reader-loading]"),
    canvas: root.querySelector("[data-library-canvas]"),
    readerError: root.querySelector("[data-library-reader-error]"),
    uploadDialog: root.querySelector("[data-library-upload-dialog]"),
    uploadForm: root.querySelector("[data-library-upload-form]"),
    closeUpload: root.querySelector("[data-library-close-upload]"),
    cancelUpload: root.querySelector("[data-library-cancel-upload]"),
    submitUpload: root.querySelector("[data-library-submit-upload]"),
    uploadError: root.querySelector("[data-library-upload-error]"),
    file: root.querySelector("[data-library-file]")
  };

  var store = window.LibraryStore.create({
    url: root.dataset.supabaseUrl,
    publishableKey: root.dataset.supabaseKey,
    redirectTo: location.origin + "/library/"
  });

  var state = {
    documents: [],
    selectedTag: "",
    query: "",
    progress: store.loadLocalProgress(),
    session: null,
    owner: false,
    activeDocument: null,
    pdfjs: null,
    pdf: null,
    page: 1,
    zoom: 1,
    renderTask: null,
    renderSequence: 0,
    saveTimer: null
  };

  function setMessage(message) {
    elements.message.textContent = message || "";
  }

  function friendlyError(error) {
    var code = error && (error.code || error.message);
    var messages = {
      duplicate_pdf: "This PDF is already present in the archive.",
      pdf_already_archived: "This PDF is already present in the archive.",
      pdf_required: "Choose a PDF file.",
      invalid_pdf_signature: "The selected file does not contain a valid PDF signature.",
      pdf_too_large: "The PDF exceeds the 50 MB upload limit.",
      title_required: "Add a display title.",
      not_site_owner: "This GitHub account does not have permission to manage the library.",
      not_configured: "Library synchronization is not configured.",
      supabase_not_configured: "Library synchronization is not configured.",
      github_409: "The repository changed during upload. Refresh the page and try again.",
      github_app_not_configured: "PDF upload is not configured yet."
    };
    return messages[code] || (error && error.message) || "The operation could not be completed.";
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (value < 1024 * 1024) {
      return Math.max(1, Math.round(value / 1024)) + " KB";
    }
    return (value / (1024 * 1024)).toFixed(1) + " MB";
  }

  function formatDate(value) {
    var date = new Date(value);
    return Number.isNaN(date.getTime())
      ? ""
      : new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
  }

  function textElement(tag, className, text) {
    var element = document.createElement(tag);
    if (className) {
      element.className = className;
    }
    element.textContent = text;
    return element;
  }

  function tagCounts() {
    return state.documents.reduce(function (counts, documentRecord) {
      (documentRecord.tags || []).forEach(function (tag) {
        counts[tag] = (counts[tag] || 0) + 1;
      });
      return counts;
    }, {});
  }

  function renderTags() {
    var counts = tagCounts();
    elements.tags.replaceChildren();
    Object.keys(counts).sort(function (left, right) {
      return left.localeCompare(right, undefined, { sensitivity: "base" });
    }).forEach(function (tag) {
      var button = textElement("button", "library-tag", tag);
      var count = textElement("span", "library-tag-count", String(counts[tag]));
      button.type = "button";
      button.setAttribute("aria-pressed", String(state.selectedTag === tag));
      button.appendChild(count);
      button.addEventListener("click", function () {
        state.selectedTag = state.selectedTag === tag ? "" : tag;
        renderTags();
        renderDocuments();
      });
      elements.tags.appendChild(button);
    });
  }

  function visibleDocuments() {
    var query = state.query.trim().toLocaleLowerCase();
    return state.documents.filter(function (documentRecord) {
      var matchesTag = !state.selectedTag || (documentRecord.tags || []).indexOf(state.selectedTag) >= 0;
      var haystack = [
        documentRecord.title,
        documentRecord.filename,
        (documentRecord.tags || []).join(" ")
      ].join(" ").toLocaleLowerCase();
      return matchesTag && (!query || haystack.indexOf(query) >= 0);
    });
  }

  function documentProgress(documentRecord) {
    var progress = state.progress[documentRecord.id];
    if (!progress || !progress.totalPages) {
      return 0;
    }
    return Math.min(100, Math.round((progress.page / progress.totalPages) * 100));
  }

  function renderDocuments() {
    var visible = visibleDocuments();
    elements.list.replaceChildren();
    elements.empty.hidden = visible.length !== 0;
    elements.count.textContent = visible.length + (visible.length === 1 ? " document" : " documents");

    visible.forEach(function (documentRecord) {
      var button = document.createElement("button");
      var title = textElement("span", "library-document-title", documentRecord.title);
      var meta = textElement("span", "library-document-meta", [
        formatDate(documentRecord.addedAt),
        documentRecord.filename,
        formatBytes(documentRecord.bytes)
      ].filter(Boolean).join(" · "));
      var tags = textElement("span", "library-document-tags", (documentRecord.tags || []).map(function (tag) {
        return "#" + tag;
      }).join("  "));
      var progress = document.createElement("span");
      var progressBar = document.createElement("span");
      var progressValue = documentProgress(documentRecord);

      button.type = "button";
      button.className = "library-document" + (state.activeDocument && state.activeDocument.id === documentRecord.id ? " is-active" : "");
      button.dataset.documentId = documentRecord.id;
      button.append(title, meta);
      if (documentRecord.tags && documentRecord.tags.length) {
        button.appendChild(tags);
      }
      progress.className = "library-progress";
      progress.style.setProperty("--progress", progressValue + "%");
      progress.setAttribute("aria-label", progressValue + "% read");
      progress.appendChild(progressBar);
      button.appendChild(progress);
      button.addEventListener("click", function () {
        openDocument(documentRecord);
      });
      elements.list.appendChild(button);
    });
  }

  function mergeProgress(local, remote) {
    var merged = Object.assign({}, local);
    Object.keys(remote || {}).forEach(function (documentId) {
      var localRecord = merged[documentId];
      var remoteRecord = remote[documentId];
      if (!localRecord || new Date(remoteRecord.updatedAt).getTime() > new Date(localRecord.updatedAt).getTime()) {
        merged[documentId] = remoteRecord;
        store.saveLocalProgress(remoteRecord);
      }
    });
    return merged;
  }

  async function syncProgress() {
    if (!state.owner) {
      return;
    }
    var local = store.loadLocalProgress();
    var remote = await store.loadRemoteProgress();
    state.progress = mergeProgress(local, remote);

    await Promise.all(Object.keys(local).map(function (documentId) {
      var localRecord = local[documentId];
      var remoteRecord = remote[documentId];
      if (!remoteRecord || new Date(localRecord.updatedAt).getTime() > new Date(remoteRecord.updatedAt).getTime()) {
        return store.saveRemoteProgress(localRecord);
      }
      return null;
    }));
    elements.syncState.textContent = "Synced";
    renderDocuments();
  }

  async function refreshAuth() {
    try {
      state.session = await store.getSession();
      state.owner = state.session ? await store.isOwner() : false;
      elements.upload.hidden = !state.owner;
      elements.auth.textContent = state.session ? "Sign Out" : "Manage Library";
      elements.syncState.textContent = state.owner
        ? "Syncing"
        : (store.configured ? "Local progress" : "Local only");
      if (state.owner) {
        await syncProgress();
      }
    } catch (error) {
      state.owner = false;
      elements.upload.hidden = true;
      elements.syncState.textContent = "Local progress";
      setMessage(friendlyError(error));
    }
  }

  function updateReaderControls() {
    var totalPages = state.pdf ? state.pdf.numPages : 0;
    elements.page.value = String(state.page);
    elements.page.max = String(totalPages || 1);
    elements.pageCount.textContent = totalPages ? String(totalPages) : "—";
    elements.zoom.textContent = Math.round(state.zoom * 100) + "%";
    elements.previousPage.disabled = !totalPages || state.page <= 1;
    elements.nextPage.disabled = !totalPages || state.page >= totalPages;
  }

  function persistProgress() {
    if (!state.activeDocument || !state.pdf) {
      return;
    }
    var record = store.saveLocalProgress({
      documentId: state.activeDocument.id,
      page: state.page,
      totalPages: state.pdf.numPages,
      zoom: state.zoom,
      updatedAt: new Date().toISOString()
    });
    state.progress[record.documentId] = record;
    renderDocuments();

    clearTimeout(state.saveTimer);
    if (state.owner) {
      state.saveTimer = setTimeout(function () {
        store.saveRemoteProgress(record).then(function () {
          elements.syncState.textContent = "Synced";
        }).catch(function () {
          elements.syncState.textContent = "Saved locally";
        });
      }, 650);
    }
  }

  function updateReaderUrl() {
    var url = new URL(location.href);
    if (state.activeDocument) {
      url.searchParams.set("doc", state.activeDocument.id);
      url.searchParams.set("page", String(state.page));
    } else {
      url.searchParams.delete("doc");
      url.searchParams.delete("page");
    }
    history.replaceState(null, "", url.pathname + url.search + url.hash);
  }

  async function renderPage() {
    if (!state.pdf) {
      return;
    }
    var sequence = ++state.renderSequence;
    if (state.renderTask) {
      state.renderTask.cancel();
    }

    updateReaderControls();
    elements.loading.hidden = false;
    elements.readerError.hidden = true;
    elements.canvas.hidden = true;

    try {
      var page = await state.pdf.getPage(state.page);
      if (sequence !== state.renderSequence) {
        return;
      }
      var viewport = page.getViewport({ scale: state.zoom });
      var ratio = Math.min(window.devicePixelRatio || 1, 2);
      var context = elements.canvas.getContext("2d", { alpha: false });
      elements.canvas.width = Math.floor(viewport.width * ratio);
      elements.canvas.height = Math.floor(viewport.height * ratio);
      elements.canvas.style.width = Math.floor(viewport.width) + "px";
      elements.canvas.style.height = Math.floor(viewport.height) + "px";

      state.renderTask = page.render({
        canvasContext: context,
        viewport: viewport,
        transform: ratio === 1 ? null : [ratio, 0, 0, ratio, 0, 0]
      });
      await state.renderTask.promise;
      if (sequence !== state.renderSequence) {
        return;
      }
      elements.canvas.hidden = false;
      elements.viewport.scrollTo({ top: 0, left: 0 });
      persistProgress();
      updateReaderUrl();
    } catch (error) {
      if (error && error.name === "RenderingCancelledException") {
        return;
      }
      elements.readerError.textContent = "This page could not be rendered. " + friendlyError(error);
      elements.readerError.hidden = false;
    } finally {
      if (sequence === state.renderSequence) {
        elements.loading.hidden = true;
      }
    }
  }

  async function loadPdfJs() {
    if (!state.pdfjs) {
      state.pdfjs = await import(root.dataset.pdfjsUrl);
      state.pdfjs.GlobalWorkerOptions.workerSrc = root.dataset.pdfWorkerUrl;
    }
    return state.pdfjs;
  }

  async function openDocument(documentRecord) {
    state.activeDocument = documentRecord;
    state.renderSequence += 1;
    if (state.renderTask) {
      state.renderTask.cancel();
    }
    if (state.pdf) {
      await state.pdf.destroy().catch(function () {});
      state.pdf = null;
    }

    var saved = state.progress[documentRecord.id];
    var requestedPage = Number(new URL(location.href).searchParams.get("page"));
    state.page = Math.max(1, (saved && saved.page) || requestedPage || 1);
    state.zoom = Math.min(2.5, Math.max(0.5, (saved && saved.zoom) || 1));
    elements.reader.hidden = false;
    elements.workspace.classList.add("is-reading");
    elements.readerTitle.textContent = documentRecord.title;
    elements.readerTags.textContent = (documentRecord.tags || []).map(function (tag) { return "#" + tag; }).join("  ");
    elements.openNative.href = documentRecord.path;
    elements.loading.hidden = false;
    elements.readerError.hidden = true;
    elements.canvas.hidden = true;
    renderDocuments();
    updateReaderControls();

    try {
      var pdfjs = await loadPdfJs();
      var assetRoot = root.dataset.pdfAssetsUrl;
      var loadingTask = pdfjs.getDocument({
        url: documentRecord.path,
        cMapUrl: assetRoot + "cmaps/",
        cMapPacked: true,
        iccUrl: assetRoot + "iccs/",
        standardFontDataUrl: assetRoot + "standard_fonts/",
        wasmUrl: assetRoot + "wasm/"
      });
      state.pdf = await loadingTask.promise;
      state.page = Math.min(state.page, state.pdf.numPages);
      await renderPage();
      elements.reader.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      elements.loading.hidden = true;
      elements.readerError.textContent = "The PDF is not available yet or could not be loaded. " + friendlyError(error);
      elements.readerError.hidden = false;
    }
  }

  async function closeReader() {
    state.activeDocument = null;
    state.renderSequence += 1;
    clearTimeout(state.saveTimer);
    if (state.renderTask) {
      state.renderTask.cancel();
    }
    if (state.pdf) {
      await state.pdf.destroy().catch(function () {});
    }
    state.pdf = null;
    elements.reader.hidden = true;
    elements.workspace.classList.remove("is-reading");
    updateReaderUrl();
    renderDocuments();
  }

  function goToPage(value) {
    if (!state.pdf) {
      return;
    }
    state.page = Math.min(state.pdf.numPages, Math.max(1, Number(value) || 1));
    renderPage();
  }

  function setZoom(value) {
    state.zoom = Math.min(2.5, Math.max(0.5, Math.round(value * 10) / 10));
    renderPage();
  }

  function openUploadDialog() {
    elements.uploadError.textContent = "";
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

  async function uploadDocument(event) {
    event.preventDefault();
    elements.uploadError.textContent = "";
    var data = new FormData(elements.uploadForm);
    var file = data.get("pdf");
    var title = String(data.get("title") || "").trim();
    var tags = String(data.get("tags") || "");

    elements.submitUpload.disabled = true;
    elements.submitUpload.textContent = "Committing...";
    try {
      var buffer = await file.arrayBuffer();
      window.LibraryGitHub.validatePdf(file, buffer);
      var credentials = await store.getUploadToken();
      var result = await window.LibraryGitHub.commitDocument({
        token: credentials.token,
        repository: root.dataset.repository,
        branch: root.dataset.branch,
        file: file,
        buffer: buffer,
        title: title,
        tags: tags
      });
      state.documents = result.catalog.documents;
      renderTags();
      renderDocuments();
      elements.uploadForm.reset();
      closeUploadDialog();
      setMessage("PDF committed to GitHub. GitHub Pages may take a minute to publish the new file.");
    } catch (error) {
      elements.uploadError.textContent = friendlyError(error);
    } finally {
      elements.submitUpload.disabled = false;
      elements.submitUpload.textContent = "Commit to GitHub";
    }
  }

  async function loadCatalog() {
    var response = await fetch(root.dataset.catalogUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("catalog_load_failed");
    }
    var catalog = window.LibraryGitHub.normalizeCatalog(await response.json());
    state.documents = catalog.documents;
    renderTags();
    renderDocuments();

    var documentId = new URL(location.href).searchParams.get("doc");
    var requestedDocument = state.documents.find(function (documentRecord) {
      return documentRecord.id === documentId;
    });
    if (requestedDocument) {
      openDocument(requestedDocument);
    }
  }

  elements.search.addEventListener("input", function () {
    state.query = elements.search.value;
    renderDocuments();
  });
  elements.auth.addEventListener("click", async function () {
    try {
      if (state.session) {
        await store.signOut();
        state.session = null;
        state.owner = false;
        elements.upload.hidden = true;
        elements.auth.textContent = "Manage Library";
        elements.syncState.textContent = "Local progress";
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
  elements.uploadForm.addEventListener("submit", uploadDocument);
  elements.file.addEventListener("change", function () {
    var title = elements.uploadForm.elements.title;
    if (elements.file.files[0] && !title.value) {
      title.value = elements.file.files[0].name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
    }
  });
  elements.closeReader.addEventListener("click", closeReader);
  elements.previousPage.addEventListener("click", function () { goToPage(state.page - 1); });
  elements.nextPage.addEventListener("click", function () { goToPage(state.page + 1); });
  elements.page.addEventListener("change", function () { goToPage(elements.page.value); });
  elements.zoomOut.addEventListener("click", function () { setZoom(state.zoom - 0.1); });
  elements.zoomIn.addEventListener("click", function () { setZoom(state.zoom + 0.1); });
  document.addEventListener("keydown", function (event) {
    if (!state.activeDocument || /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) {
      return;
    }
    if (event.key === "ArrowLeft") {
      goToPage(state.page - 1);
    } else if (event.key === "ArrowRight") {
      goToPage(state.page + 1);
    } else if (event.key === "Escape") {
      closeReader();
    }
  });

  store.onAuthChange(function () {
    setTimeout(refreshAuth, 0);
  });

  refreshAuth().then(loadCatalog).catch(function (error) {
    setMessage(friendlyError(error));
    elements.syncState.textContent = "Local progress";
  });
}());
