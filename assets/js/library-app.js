(function () {
  "use strict";

  var root = document.querySelector("[data-library-app]");
  if (!root ||
      !window.LibraryStore ||
      !window.LibraryGitHub ||
      !window.LibraryAnnotations ||
      !window.LibraryPdfEditor ||
      !window.LibraryImmersive) {
    return;
  }

  var elements = {
    auth: document.querySelector("[data-library-auth]"),
    syncState: document.querySelector("[data-library-sync-state]"),
    message: root.querySelector("[data-library-message]"),
    search: root.querySelector("[data-library-search]"),
    upload: root.querySelector("[data-library-upload]"),
    deleteTrigger: root.querySelector("[data-library-delete]"),
    tags: root.querySelector("[data-library-tags]"),
    count: root.querySelector("[data-library-count]"),
    empty: root.querySelector("[data-library-empty]"),
    list: root.querySelector("[data-library-list]"),
    workspace: root.querySelector(".library-workspace"),
    reader: root.querySelector("[data-library-reader]"),
    readerTitle: root.querySelector("[data-library-reader-title]"),
    readerTags: root.querySelector("[data-library-reader-tags]"),
    openNative: root.querySelector("[data-library-open-native]"),
    fullscreen: root.querySelector("[data-library-fullscreen]"),
    closeReader: root.querySelector("[data-library-close-reader]"),
    previousPage: root.querySelector("[data-library-previous-page]"),
    nextPage: root.querySelector("[data-library-next-page]"),
    page: root.querySelector("[data-library-page]"),
    pageCount: root.querySelector("[data-library-page-count]"),
    zoomOut: root.querySelector("[data-library-zoom-out]"),
    zoomIn: root.querySelector("[data-library-zoom-in]"),
    zoom: root.querySelector("[data-library-zoom]"),
    viewport: root.querySelector("[data-library-reader-viewport]"),
    pdfViewer: root.querySelector("[data-library-pdf-viewer]"),
    loading: root.querySelector("[data-library-reader-loading]"),
    readerError: root.querySelector("[data-library-reader-error]"),
    annotationTools: root.querySelector("[data-library-annotation-tools]"),
    annotationModes: Array.from(root.querySelectorAll("[data-library-annotation-mode]")),
    annotationUndo: root.querySelector("[data-library-annotation-undo]"),
    annotationRedo: root.querySelector("[data-library-annotation-redo]"),
    annotationErase: root.querySelector("[data-library-annotation-erase]"),
    annotationState: root.querySelector("[data-library-annotation-state]"),
    exportAnnotations: root.querySelector("[data-library-export-annotations]"),
    uploadDialog: root.querySelector("[data-library-upload-dialog]"),
    uploadForm: root.querySelector("[data-library-upload-form]"),
    sourcePicker: root.querySelector("[data-library-source-picker]"),
    sourceNote: root.querySelector("[data-library-source-note]"),
    fileField: root.querySelector("[data-library-file-field]"),
    urlField: root.querySelector("[data-library-url-field]"),
    consentText: root.querySelector("[data-library-consent-text]"),
    closeUpload: root.querySelector("[data-library-close-upload]"),
    cancelUpload: root.querySelector("[data-library-cancel-upload]"),
    submitUpload: root.querySelector("[data-library-submit-upload]"),
    uploadError: root.querySelector("[data-library-upload-error]"),
    file: root.querySelector("[data-library-file]"),
    url: root.querySelector("[data-library-url]"),
    deleteDialog: root.querySelector("[data-library-delete-dialog]"),
    deleteForm: root.querySelector("[data-library-delete-form]"),
    deleteTitle: root.querySelector("[data-library-delete-title]"),
    deleteNote: root.querySelector("[data-library-delete-note]"),
    deleteError: root.querySelector("[data-library-delete-error]"),
    closeDelete: root.querySelector("[data-library-close-delete]"),
    cancelDelete: root.querySelector("[data-library-cancel-delete]"),
    confirmDelete: root.querySelector("[data-library-confirm-delete]")
  };

  var store = window.LibraryStore.create({
    url: root.dataset.supabaseUrl,
    publishableKey: root.dataset.supabaseKey,
    redirectTo: location.origin + "/library/"
  });
  var annotationStore = window.LibraryAnnotations.create({ remote: store });

  var state = {
    documents: [],
    selectedTag: "",
    query: "",
    progress: store.loadLocalProgress(),
    session: null,
    owner: false,
    activeDocument: null,
    pdfjs: null,
    viewerModule: null,
    loadingTask: null,
    pdf: null,
    viewer: null,
    linkService: null,
    viewerAbort: null,
    pdfEditor: null,
    annotationRef: null,
    annotationUiState: null,
    annotationStatus: "",
    exportingAnnotations: false,
    page: 1,
    zoom: 1,
    openingSequence: 0,
    saveTimer: null,
    pendingDeletion: null,
    deleting: false
  };

  var immersive = window.LibraryImmersive.create(elements.reader, {
    onChange: function (active) {
      elements.fullscreen.textContent = active ? "Exit Full Screen" : "Full Screen";
      elements.fullscreen.setAttribute("aria-pressed", String(active));
      if (state.viewer) {
        requestAnimationFrame(function () { state.viewer.update(); });
      }
    }
  });

  function setMessage(message) {
    elements.message.textContent = message || "";
  }

  function friendlyError(error) {
    var code = error && (error.code || error.message);
    var messages = {
      duplicate_pdf: "This PDF is already present in the archive.",
      pdf_already_archived: "This PDF is already present in the archive.",
      duplicate_external_document: "This external PDF link is already present in the archive.",
      external_document_exists: "This external PDF link is already present in the archive.",
      external_url_required: "Add a public PDF URL.",
      external_url_invalid: "Add a valid public PDF URL.",
      external_url_https_required: "External documents require a public HTTPS URL without embedded credentials.",
      external_pdf_unavailable: "The external PDF could not be read here. Confirm that it is a direct public PDF URL and that the source permits cross-origin reading.",
      document_not_found: "This document is no longer present in the current Library catalog. Refresh the page.",
      duplicate_document_id: "The catalog contains a duplicate document ID. Resolve it before deleting either entry.",
      document_changed: "This document changed after you opened the confirmation dialog. Review it again before deleting.",
      document_revision_required: "The delete confirmation is incomplete. Close it and try again.",
      document_revision_invalid: "The delete confirmation is invalid. Close it and try again.",
      legacy_repository_requires_migration: "This legacy Git-backed PDF must be migrated before it can be permanently deleted.",
      release_asset_invalid: "The Release asset metadata is incomplete, so deletion was stopped safely.",
      release_metadata_invalid: "The Release asset metadata is incomplete, so deletion was stopped safely.",
      release_unavailable: "The Library Release could not be accessed. Try again shortly.",
      library_release_invalid: "The Library Release configuration is invalid.",
      library_release_ref_invalid: "The Library Release tag is not pinned to the approved clean commit.",
      library_release_immutable: "The Library Release is immutable and cannot accept deletions.",
      release_asset_list_invalid: "GitHub returned an invalid Release asset list. Try again shortly.",
      release_asset_list_too_large: "The Library Release contains too many assets to verify safely.",
      release_asset_name_conflict: "A different Release asset already uses this archive name. Remove the conflicting asset before retrying.",
      release_asset_state_uncertain: "GitHub could not confirm whether the Release asset was deleted. Nothing else was removed; try again shortly.",
      release_asset_delete_failed: "GitHub confirmed that the Release asset still exists after retrying. Try again shortly.",
      archive_state_uncertain: "GitHub could not confirm whether this PDF was archived. Refresh the Library before trying again.",
      catalog_state_uncertain: "GitHub could not confirm whether the Library catalog changed. Refresh before trying again.",
      catalog_publish_failed: "The Library catalog could not be updated after a safe retry.",
      repository_changed: "The repository changed during this operation. Refresh the page and try again.",
      github_request_failed: "GitHub could not complete the Library operation. Try again shortly.",
      library_operation_failed: "The Library operation could not be completed. Try again shortly.",
      pdf_required: "Choose a PDF file.",
      invalid_pdf_signature: "The selected file does not contain a valid PDF signature.",
      pdf_too_large: "The PDF exceeds the 50 MB upload limit.",
      title_required: "Add a display title.",
      invalid_library_annotation_document: "This document revision cannot be used for synchronized notes.",
      invalid_library_annotations: "The saved notes are invalid and were not synchronized.",
      library_annotations_too_many: "This document has too many annotations to synchronize safely.",
      library_annotations_too_large: "These annotations exceed the 4 MB synchronization limit. Export the PDF before continuing.",
      library_annotation_conflict: "Notes changed on another device. This device kept its local copy; reload before editing further.",
      library_annotation_sync_failed: "Notes were saved on this device but could not be synchronized.",
      library_annotation_export_failed: "The annotated PDF could not be exported.",
      not_site_owner: "This GitHub account does not have permission to manage the library.",
      not_configured: "Library synchronization is not configured.",
      supabase_not_configured: "Library synchronization is not configured.",
      github_409: "The repository changed during this operation. Refresh the page and try again.",
      github_422: "The repository changed during this operation. Refresh the page and try again.",
      github_app_not_configured: "Library changes are not configured yet."
    };
    return messages[code] || (error && error.message) || "The operation could not be completed.";
  }

  function formatBytes(bytes) {
    var value = Number(bytes) || 0;
    if (!value) {
      return "";
    }
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
        documentRecord.source === "external" ? "External source" : formatBytes(documentRecord.bytes)
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

  function stableHash(value) {
    var hash = 2166136261;
    var text = String(value || "");
    for (var index = 0; index < text.length; index += 1) {
      hash ^= text.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function annotationReference(documentRecord) {
    var revision;
    if (/^[a-f0-9]{64}$/i.test(documentRecord.sha256 || "")) {
      revision = "sha256:" + documentRecord.sha256.toLowerCase();
    } else if (documentRecord.release && Number.isSafeInteger(documentRecord.release.assetId)) {
      revision = "release:" + documentRecord.release.assetId;
    } else {
      revision = (documentRecord.source || "repository") + ":" + stableHash([
        documentRecord.id,
        documentRecord.path,
        documentRecord.addedAt
      ].join("|"));
    }
    return {
      documentId: documentRecord.id,
      documentRevision: revision
    };
  }

  function sameAnnotationReference(left, right) {
    return Boolean(left && right &&
      left.documentId === right.documentId &&
      left.documentRevision === right.documentRevision);
  }

  function annotationStatusText(record) {
    if (!record) {
      return "Notes unavailable";
    }
    if (record.status === "synced") {
      return "Notes synced";
    }
    if (record.status === "conflict") {
      return "Sync conflict · local copy kept";
    }
    if (record.status === "local-only") {
      return "Notes on this device";
    }
    if (record.error) {
      return "Saved locally · sync unavailable";
    }
    return "Saved locally";
  }

  function updateAnnotationControls(editorState) {
    if (editorState) {
      state.annotationUiState = editorState;
    }
    var current = state.annotationUiState || {};
    var enabled = Boolean(state.owner && state.pdfEditor && current.ready);
    elements.annotationModes.forEach(function (button) {
      var selected = button.dataset.libraryAnnotationMode === (current.mode || "read");
      button.disabled = !enabled;
      button.setAttribute("aria-pressed", String(selected));
    });
    elements.annotationUndo.disabled = !enabled || !current.canUndo;
    elements.annotationRedo.disabled = !enabled || !current.canRedo;
    elements.annotationErase.disabled = !enabled || !current.hasSelection;
    elements.exportAnnotations.disabled = !enabled || !current.hasAnnotations || state.exportingAnnotations;
    elements.annotationState.textContent = state.annotationStatus || (enabled ? "Notes ready" : "Loading notes");
  }

  async function saveAnnotations(documentRef, annotations) {
    if (!documentRef) {
      return null;
    }
    if (sameAnnotationReference(documentRef, state.annotationRef)) {
      state.annotationStatus = "Saving locally";
      updateAnnotationControls();
    }
    try {
      var record = await annotationStore.save(documentRef, annotations, state.owner);
      if (sameAnnotationReference(documentRef, state.annotationRef)) {
        state.annotationStatus = annotationStatusText(record);
        updateAnnotationControls();
        if (record.status === "conflict") {
          setMessage(friendlyError(new Error("library_annotation_conflict")));
        }
      }
      return record;
    } catch (error) {
      if (sameAnnotationReference(documentRef, state.annotationRef)) {
        state.annotationStatus = "Notes not saved";
        updateAnnotationControls();
        setMessage(friendlyError(error));
      }
      throw error;
    }
  }

  async function loadAnnotations(documentRecord) {
    var documentRef = annotationReference(documentRecord);
    state.annotationRef = documentRef;
    state.annotationStatus = "Loading notes";
    state.annotationUiState = null;
    updateAnnotationControls();
    if (!state.owner) {
      return { annotations: [], status: "local-only" };
    }
    var record = await annotationStore.load(documentRef, true);
    state.annotationStatus = annotationStatusText(record);
    if (record.status === "conflict") {
      setMessage(friendlyError(new Error("library_annotation_conflict")));
    }
    updateAnnotationControls();
    return record;
  }

  function updateManagementControls() {
    elements.upload.hidden = !state.owner;
    elements.deleteTrigger.hidden = !(state.owner && state.activeDocument);
    elements.annotationTools.hidden = !(state.owner && state.activeDocument);
    updateAnnotationControls();
  }

  async function refreshAuth() {
    try {
      var wasOwner = state.owner;
      state.session = await store.getSession();
      state.owner = state.session ? await store.isOwner() : false;
      if (wasOwner && !state.owner && state.activeDocument) {
        await closeReader();
      }
      updateManagementControls();
      elements.auth.textContent = state.session ? "Sign Out" : "Manage Library";
      elements.syncState.textContent = state.owner
        ? "Syncing"
        : (store.configured ? "Local progress" : "Local only");
      if (state.owner) {
        await syncProgress();
      }
    } catch (error) {
      var lostOwnerAccess = wasOwner && state.activeDocument;
      state.owner = false;
      if (lostOwnerAccess) {
        await closeReader();
      }
      updateManagementControls();
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

  async function loadPdfModules() {
    if (!state.pdfjs) {
      state.pdfjs = await import(root.dataset.pdfjsUrl);
      state.pdfjs.GlobalWorkerOptions.workerSrc = root.dataset.pdfWorkerUrl;
      globalThis.pdfjsLib = state.pdfjs;
    }
    if (!state.viewerModule) {
      state.viewerModule = await import(root.dataset.pdfViewerUrl);
    }
    return { pdfjs: state.pdfjs, viewer: state.viewerModule };
  }

  function proxyUrl(documentRecord) {
    if (!root.dataset.supabaseUrl || !root.dataset.supabaseKey) {
      return "";
    }
    var url = new URL("/functions/v1/library-pdf-proxy", root.dataset.supabaseUrl);
    url.searchParams.set("id", documentRecord.id);
    return url.href;
  }

  function pdfOptions(url, useProxy) {
    var assetRoot = root.dataset.pdfAssetsUrl;
    var options = {
      url: url,
      disableAutoFetch: true,
      cMapUrl: assetRoot + "cmaps/",
      cMapPacked: true,
      iccUrl: assetRoot + "iccs/",
      standardFontDataUrl: assetRoot + "standard_fonts/",
      wasmUrl: assetRoot + "wasm/"
    };
    if (useProxy) {
      options.httpHeaders = {
        apikey: root.dataset.supabaseKey,
        Authorization: "Bearer " + root.dataset.supabaseKey
      };
    }
    return options;
  }

  async function loadPdfAt(url, useProxy) {
    state.loadingTask = state.pdfjs.getDocument(pdfOptions(url, useProxy));
    try {
      return await state.loadingTask.promise;
    } catch (error) {
      await state.loadingTask.destroy().catch(function () {});
      state.loadingTask = null;
      throw error;
    }
  }

  async function releaseDocument() {
    clearTimeout(state.saveTimer);
    if (state.pdfEditor) {
      try {
        await state.pdfEditor.flush();
      } catch (_) {
        // The annotation module has already kept the latest successful local snapshot.
      }
      state.pdfEditor.destroy();
      state.pdfEditor = null;
    }
    if (state.viewer) {
      state.viewer.setDocument(null);
    }
    if (state.linkService) {
      state.linkService.setDocument(null);
    }
    if (state.viewerAbort) {
      state.viewerAbort.abort();
    }
    if (state.loadingTask) {
      await state.loadingTask.destroy().catch(function () {});
    } else if (state.pdf) {
      await state.pdf.destroy().catch(function () {});
    }
    state.loadingTask = null;
    state.pdf = null;
    state.viewer = null;
    state.linkService = null;
    state.viewerAbort = null;
    state.annotationRef = null;
    state.annotationUiState = null;
    state.annotationStatus = "";
    elements.pdfViewer.replaceChildren();
    updateAnnotationControls();
  }

  function initializeContinuousViewer(sequence, sourceUrl, annotationRecord, annotationRef) {
    var viewerModule = state.viewerModule;
    var eventBus = new viewerModule.EventBus();
    var linkService = new viewerModule.PDFLinkService({
      eventBus: eventBus,
      externalLinkTarget: viewerModule.LinkTarget.BLANK
    });
    var abortController = new AbortController();
    var viewer = new viewerModule.PDFViewer({
      container: elements.viewport,
      viewer: elements.pdfViewer,
      eventBus: eventBus,
      linkService: linkService,
      annotationEditorMode: state.pdfjs.AnnotationEditorType.NONE,
      imageResourcesPath: root.dataset.pdfAssetsUrl + "web/images/",
      abortSignal: abortController.signal
    });
    linkService.setViewer(viewer);
    state.viewer = viewer;
    state.linkService = linkService;
    state.viewerAbort = abortController;
    state.pdfEditor = window.LibraryPdfEditor.create({
      pdf: state.pdf,
      viewer: viewer,
      eventBus: eventBus,
      pdfjs: state.pdfjs,
      annotations: annotationRecord.annotations,
      onChange: function (annotations) {
        return saveAnnotations(annotationRef, annotations);
      },
      onState: function (editorState) {
        if (sequence === state.openingSequence) {
          updateAnnotationControls(editorState);
        }
      }
    });
    updateAnnotationControls();

    eventBus.on("pagesinit", function () {
      if (sequence !== state.openingSequence || !state.pdf) {
        return;
      }
      viewer.scrollMode = viewerModule.ScrollMode.VERTICAL;
      viewer.currentScale = state.zoom;
      state.page = Math.min(state.page, state.pdf.numPages);
      viewer.currentPageNumber = state.page;
      viewer.scrollPageIntoView({ pageNumber: state.page });
      updateReaderControls();
      persistProgress();
      updateReaderUrl();
      elements.viewport.focus({ preventScroll: true });
    });
    eventBus.on("pagechanging", function (event) {
      if (sequence !== state.openingSequence) {
        return;
      }
      state.page = event.pageNumber;
      updateReaderControls();
      persistProgress();
      updateReaderUrl();
    });
    eventBus.on("scalechanging", function (event) {
      if (sequence !== state.openingSequence) {
        return;
      }
      state.zoom = event.scale;
      updateReaderControls();
      persistProgress();
    });
    eventBus.on("pagerendered", function () {
      if (sequence === state.openingSequence) {
        elements.loading.hidden = true;
      }
    });

    viewer.setDocument(state.pdf);
    linkService.setDocument(state.pdf, sourceUrl);
  }

  async function openDocument(documentRecord) {
    var sequence = ++state.openingSequence;
    await releaseDocument();
    if (sequence !== state.openingSequence) {
      return;
    }

    state.activeDocument = documentRecord;
    updateManagementControls();
    var saved = state.progress[documentRecord.id];
    var pageUrl = new URL(location.href);
    var requestedPage = pageUrl.searchParams.get("doc") === documentRecord.id
      ? Number(pageUrl.searchParams.get("page"))
      : 0;
    state.page = Math.max(1, requestedPage || (saved && saved.page) || 1);
    state.zoom = Math.min(2.5, Math.max(0.5, (saved && saved.zoom) || 1));
    elements.reader.hidden = false;
    elements.workspace.classList.add("is-reading");
    elements.readerTitle.textContent = documentRecord.title;
    elements.readerTags.textContent = (documentRecord.tags || []).map(function (tag) { return "#" + tag; }).join("  ");
    elements.openNative.href = documentRecord.path;
    elements.loading.hidden = false;
    elements.readerError.hidden = true;
    elements.pdfViewer.replaceChildren();
    renderDocuments();
    updateReaderControls();

    try {
      await loadPdfModules();
      if (sequence !== state.openingSequence) {
        return;
      }
      try {
        state.pdf = await loadPdfAt(documentRecord.path, false);
      } catch (directError) {
        var proxiedSource = documentRecord.source === "external" || documentRecord.source === "release";
        var fallback = proxiedSource ? proxyUrl(documentRecord) : "";
        if (!fallback) {
          if (proxiedSource) {
            throw new Error("external_pdf_unavailable");
          }
          throw directError;
        }
        try {
          state.pdf = await loadPdfAt(fallback, true);
        } catch (_) {
          throw new Error("external_pdf_unavailable");
        }
      }
      if (sequence !== state.openingSequence) {
        return;
      }
      state.page = Math.min(state.page, state.pdf.numPages);
      var annotationRecord = await loadAnnotations(documentRecord);
      if (sequence !== state.openingSequence) {
        return;
      }
      var annotationRef = state.annotationRef;
      initializeContinuousViewer(sequence, documentRecord.path, annotationRecord, annotationRef);
      elements.reader.scrollIntoView({ behavior: "smooth", block: "start" });
    } catch (error) {
      if (sequence !== state.openingSequence) {
        return;
      }
      elements.loading.hidden = true;
      elements.readerError.textContent = friendlyError(error);
      elements.readerError.hidden = false;
    }
  }

  async function closeReader() {
    state.openingSequence += 1;
    await immersive.exit();
    try {
      await releaseDocument();
    } finally {
      state.activeDocument = null;
      elements.reader.hidden = true;
      elements.workspace.classList.remove("is-reading");
      updateManagementControls();
      updateReaderUrl();
      renderDocuments();
    }
  }

  function goToPage(value) {
    if (!state.pdf || !state.viewer) {
      return;
    }
    var page = Math.min(state.pdf.numPages, Math.max(1, Number(value) || 1));
    state.viewer.currentPageNumber = page;
  }

  function setZoom(value) {
    if (!state.viewer) {
      return;
    }
    var zoom = Math.min(2.5, Math.max(0.5, Math.round(value * 10) / 10));
    state.viewer.currentScale = zoom;
  }

  async function exportAnnotatedPdf() {
    if (!state.owner || !state.activeDocument || !state.pdfEditor || state.exportingAnnotations) {
      return;
    }
    state.exportingAnnotations = true;
    var previousStatus = state.annotationStatus;
    state.annotationStatus = "Preparing PDF";
    updateAnnotationControls();
    try {
      var result = await state.pdfEditor.exportPdf(
        state.activeDocument.filename || state.activeDocument.title
      );
      setMessage("Annotated PDF exported as " + result.filename + ". The archived original was not changed.");
      state.annotationStatus = previousStatus;
    } catch (_) {
      setMessage(friendlyError(new Error("library_annotation_export_failed")));
      state.annotationStatus = "Export failed";
    } finally {
      state.exportingAnnotations = false;
      updateAnnotationControls();
    }
  }

  function selectedSource() {
    var selected = elements.uploadForm.elements.source;
    return selected && selected.value === "external" ? "external" : "release";
  }

  function updateSourceFields() {
    var external = selectedSource() === "external";
    elements.fileField.hidden = external;
    elements.urlField.hidden = !external;
    elements.file.required = !external;
    elements.url.required = external;
    elements.sourceNote.textContent = external
      ? "Only the catalog entry is committed to GitHub. Reading remains inside this site while the PDF stays at its source."
      : "The PDF will be stored as a deletable GitHub Release asset. Only its catalog entry enters Git history.";
    elements.consentText.textContent = external
      ? "I confirm that this public link may be indexed here and that I am permitted to access the document."
      : "I confirm that this document may be stored publicly and that I have the right to archive it.";
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

  async function addDocument(event) {
    event.preventDefault();
    elements.uploadError.textContent = "";
    var data = new FormData(elements.uploadForm);
    var source = selectedSource();
    var title = String(data.get("title") || "").trim();
    var tags = String(data.get("tags") || "");

    elements.submitUpload.disabled = true;
    elements.submitUpload.textContent = "Adding...";
    try {
      var result;
      if (source === "external") {
        var credentials = await store.getUploadToken();
        result = await window.LibraryGitHub.commitExternalDocument({
          token: credentials.token,
          repository: root.dataset.repository,
          branch: root.dataset.branch,
          title: title,
          tags: tags,
          url: String(data.get("url") || "")
        });
      } else {
        var file = data.get("pdf");
        var buffer = await file.arrayBuffer();
        window.LibraryGitHub.validatePdf(file, buffer);
        result = await store.archiveDocument({
          file: file,
          title: title,
          tags: tags
        });
      }
      state.documents = result.catalog.documents;
      renderTags();
      renderDocuments();
      elements.uploadForm.reset();
      updateSourceFields();
      closeUploadDialog();
      setMessage(source === "external"
        ? "External PDF link added. Its reading progress will sync like an archived document."
        : "PDF stored as a GitHub Release asset. It can be deleted without remaining in Git history.");
    } catch (error) {
      elements.uploadError.textContent = friendlyError(error);
    } finally {
      elements.submitUpload.disabled = false;
      elements.submitUpload.textContent = "Add Document";
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
        if (state.pdfEditor) {
          await state.pdfEditor.flush();
        }
        await store.signOut();
        state.session = null;
        state.owner = false;
        updateManagementControls();
        closeDeleteDialog(true);
        if (state.activeDocument) {
          await closeReader();
        }
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
  elements.uploadForm.addEventListener("submit", addDocument);
  elements.deleteTrigger.addEventListener("click", openDeleteDialog);
  elements.closeDelete.addEventListener("click", function () { closeDeleteDialog(false); });
  elements.cancelDelete.addEventListener("click", function () { closeDeleteDialog(false); });
  elements.deleteForm.addEventListener("submit", deleteSelectedDocument);
  elements.deleteDialog.addEventListener("cancel", function (event) {
    if (state.deleting) {
      event.preventDefault();
      return;
    }
    state.pendingDeletion = null;
    elements.deleteError.textContent = "";
  });
  elements.sourcePicker.addEventListener("change", updateSourceFields);
  elements.file.addEventListener("change", function () {
    var title = elements.uploadForm.elements.title;
    if (elements.file.files[0] && !title.value) {
      title.value = elements.file.files[0].name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ");
    }
  });
  elements.url.addEventListener("change", function () {
    var title = elements.uploadForm.elements.title;
    if (!title.value) {
      try {
        title.value = window.LibraryGitHub.externalFilename(elements.url.value)
          .replace(/\.pdf$/i, "")
          .replace(/[-_]+/g, " ");
      } catch (_) {}
    }
  });
  elements.closeReader.addEventListener("click", closeReader);
  elements.fullscreen.addEventListener("click", function () {
    immersive.toggle();
  });
  elements.annotationModes.forEach(function (button) {
    button.addEventListener("click", function () {
      if (state.pdfEditor) {
        state.pdfEditor.setMode(button.dataset.libraryAnnotationMode);
      }
    });
  });
  elements.annotationUndo.addEventListener("click", function () {
    state.pdfEditor?.undo();
  });
  elements.annotationRedo.addEventListener("click", function () {
    state.pdfEditor?.redo();
  });
  elements.annotationErase.addEventListener("click", function () {
    state.pdfEditor?.eraseSelected();
  });
  elements.exportAnnotations.addEventListener("click", exportAnnotatedPdf);
  elements.previousPage.addEventListener("click", function () { goToPage(state.page - 1); });
  elements.nextPage.addEventListener("click", function () { goToPage(state.page + 1); });
  elements.page.addEventListener("change", function () { goToPage(elements.page.value); });
  elements.zoomOut.addEventListener("click", function () { setZoom(state.zoom - 0.1); });
  elements.zoomIn.addEventListener("click", function () { setZoom(state.zoom + 0.1); });
  document.addEventListener("keydown", function (event) {
    if (event.defaultPrevented ||
        !state.activeDocument ||
        elements.deleteDialog.hasAttribute("open") ||
        /INPUT|TEXTAREA|SELECT/.test(event.target.tagName)) {
      return;
    }
    if (event.key === "ArrowLeft") {
      goToPage(state.page - 1);
    } else if (event.key === "ArrowRight") {
      goToPage(state.page + 1);
    } else if (event.key === "Escape") {
      if (immersive.isActive()) {
        immersive.exit();
      } else {
        closeReader();
      }
    }
  });
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "hidden" && state.pdfEditor) {
      state.pdfEditor.flush().catch(function () {});
    }
  });
  window.addEventListener("pagehide", function () {
    if (state.pdfEditor) {
      state.pdfEditor.flush().catch(function () {});
    }
  });

  store.onAuthChange(function () {
    setTimeout(refreshAuth, 0);
  });
  updateSourceFields();
  refreshAuth().then(loadCatalog).catch(function (error) {
    setMessage(friendlyError(error));
    elements.syncState.textContent = "Local progress";
  });

  function deletionRequest(documentRecord) {
    var release = documentRecord.release;
    return {
      documentId: documentRecord.id,
      revision: {
        source: documentRecord.source || "repository",
        path: String(documentRecord.path || ""),
        sha256: typeof documentRecord.sha256 === "string" ? documentRecord.sha256 : null,
        assetId: release && Number.isSafeInteger(release.assetId) ? release.assetId : null
      }
    };
  }

  function openDeleteDialog() {
    if (!state.owner || !state.activeDocument || state.deleting) {
      return;
    }
    var documentRecord = state.activeDocument;
    state.pendingDeletion = {
      id: documentRecord.id,
      title: documentRecord.title,
      source: documentRecord.source || "repository",
      request: deletionRequest(documentRecord)
    };
    elements.deleteError.textContent = "";
    elements.deleteTitle.textContent = documentRecord.title;
    elements.confirmDelete.disabled = documentRecord.source === "repository";
    if (documentRecord.source === "release") {
      elements.deleteNote.textContent = "The GitHub Release asset and its Library catalog entry will be permanently removed. The PDF is not retained in Git history.";
    } else if (documentRecord.source === "external") {
      elements.deleteNote.textContent = "Only this Library catalog entry will be removed. The remote PDF remains unchanged at its source.";
    } else {
      elements.deleteNote.textContent = "This legacy PDF is stored in Git history and cannot be permanently removed from the browser. Migrate it to Release storage before deleting it.";
    }
    if (typeof elements.deleteDialog.showModal === "function") {
      elements.deleteDialog.showModal();
    } else {
      elements.deleteDialog.setAttribute("open", "");
    }
    if (!elements.confirmDelete.disabled) {
      elements.confirmDelete.focus();
    }
  }

  function closeDeleteDialog(force) {
    if (state.deleting && !force) {
      return;
    }
    if (typeof elements.deleteDialog.close === "function") {
      elements.deleteDialog.close();
    } else {
      elements.deleteDialog.removeAttribute("open");
    }
    state.pendingDeletion = null;
    elements.deleteError.textContent = "";
  }

  async function deleteSelectedDocument(event) {
    event.preventDefault();
    if (state.deleting) {
      return;
    }
    if (!state.owner || !state.pendingDeletion) {
      elements.deleteError.textContent = friendlyError(new Error("not_site_owner"));
      return;
    }
    if (state.pendingDeletion.source === "repository") {
      elements.deleteError.textContent = friendlyError(new Error("legacy_repository_requires_migration"));
      return;
    }

    var documentRecord = state.pendingDeletion;
    state.deleting = true;
    elements.closeDelete.disabled = true;
    elements.cancelDelete.disabled = true;
    elements.confirmDelete.disabled = true;
    elements.confirmDelete.textContent = "Deleting...";
    elements.deleteError.textContent = "";
    try {
      var result = await store.deleteDocument(documentRecord.request);
      state.documents = result.catalog.documents;
      if (state.selectedTag && !state.documents.some(function (candidate) {
        return (candidate.tags || []).indexOf(state.selectedTag) >= 0;
      })) {
        state.selectedTag = "";
      }
      renderTags();
      renderDocuments();
      if (state.activeDocument && state.activeDocument.id === documentRecord.id) {
        await closeReader().catch(function () {});
      }
      closeDeleteDialog(true);
      if (documentRecord.source === "external") {
        setMessage("Library entry deleted. The remote PDF was not changed. GitHub Pages may take a minute to publish the catalog update.");
      } else {
        setMessage("PDF and Library entry deleted. No PDF copy remains in Git history. GitHub Pages may take a minute to publish the catalog update.");
      }
    } catch (error) {
      elements.deleteError.textContent = friendlyError(error);
    } finally {
      state.deleting = false;
      elements.closeDelete.disabled = false;
      elements.cancelDelete.disabled = false;
      elements.confirmDelete.disabled = Boolean(state.pendingDeletion && state.pendingDeletion.source === "repository");
      elements.confirmDelete.textContent = "Delete Document";
    }
  }

}());
