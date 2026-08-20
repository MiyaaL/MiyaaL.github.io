(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LibraryPdfEditor = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value, function (_, item) {
      return ArrayBuffer.isView(item) ? Array.from(item) : item;
    }));
  }

  function normalizeFilename(filename) {
    var value = String(filename || "document.pdf").replace(/[\\/:*?"<>|]+/g, "-");
    value = value.replace(/\.pdf$/i, "");
    return (value || "document") + "-annotated.pdf";
  }

  function create(options) {
    var settings = options || {};
    var pdf = settings.pdf;
    var viewer = settings.viewer;
    var eventBus = settings.eventBus;
    var pdfjs = settings.pdfjs;
    var onChange = settings.onChange || function () {};
    var onState = settings.onState || function () {};
    var annotations = Array.isArray(settings.annotations) ? cloneJson(settings.annotations) : [];
    var uiManager = viewer && viewer._layerProperties
      ? viewer._layerProperties.annotationEditorUIManager
      : null;
    var currentMode = "read";
    var editingState = {
      canUndo: false,
      canRedo: false,
      hasSelection: false
    };
    var hydratedPages = new Set();
    var hydratingPages = new Map();
    var queuedHydrationPages = new Set();
    var pendingByPage = new Map();
    var abortController = new AbortController();
    var destroyed = false;
    var suppressChanges = 0;
    var changePromise = null;
    var queuedSnapshot = null;
    var temporaryKeySequence = 0;

    var modes = {
      read: pdfjs.AnnotationEditorType.NONE,
      highlight: pdfjs.AnnotationEditorType.HIGHLIGHT,
      ink: pdfjs.AnnotationEditorType.INK,
      freetext: pdfjs.AnnotationEditorType.FREETEXT
    };
    var supportedTypes = new Set([
      modes.highlight,
      modes.ink,
      modes.freetext
    ]);

    annotations.forEach(function (annotation) {
      if (!annotation || !supportedTypes.has(annotation.annotationType) || !Number.isInteger(annotation.pageIndex)) {
        return;
      }
      var pageAnnotations = pendingByPage.get(annotation.pageIndex) || [];
      pageAnnotations.push(annotation);
      pendingByPage.set(annotation.pageIndex, pageAnnotations);
    });

    function comparableSnapshot(snapshot) {
      return snapshot.slice().sort(function (left, right) {
        var pageDifference = Number(left.pageIndex) - Number(right.pageIndex);
        return pageDifference || JSON.stringify(left).localeCompare(JSON.stringify(right));
      });
    }

    function snapshot() {
      var result = [];
      var serializable = pdf.annotationStorage.serializable;
      if (serializable.map) {
        serializable.map.forEach(function (value) {
          if (value && supportedTypes.has(value.annotationType) && Number.isInteger(value.pageIndex)) {
            result.push(cloneJson(value));
          }
        });
      }
      pendingByPage.forEach(function (pageAnnotations) {
        pageAnnotations.forEach(function (annotation) {
          result.push(cloneJson(annotation));
        });
      });
      return comparableSnapshot(result);
    }

    var lastFingerprint = JSON.stringify(comparableSnapshot(annotations.filter(function (annotation) {
      return annotation && supportedTypes.has(annotation.annotationType) && Number.isInteger(annotation.pageIndex);
    })));

    function emitState() {
      onState({
        ready: Boolean(uiManager),
        mode: currentMode,
        canUndo: editingState.canUndo,
        canRedo: editingState.canRedo,
        hasSelection: editingState.hasSelection,
        hasAnnotations: snapshot().length > 0
      });
    }

    function checkForChanges(force) {
      if (destroyed || suppressChanges) {
        return Promise.resolve(null);
      }
      var value = snapshot();
      var fingerprint = JSON.stringify(value);
      var queuedFingerprint = queuedSnapshot ? JSON.stringify(queuedSnapshot) : "";
      if (!force && (fingerprint === lastFingerprint || fingerprint === queuedFingerprint)) {
        return changePromise || Promise.resolve(null);
      }
      emitState();
      queuedSnapshot = value;
      if (!changePromise) {
        changePromise = (async function () {
          while (queuedSnapshot) {
            var nextSnapshot = queuedSnapshot;
            queuedSnapshot = null;
            await onChange(nextSnapshot);
            lastFingerprint = JSON.stringify(nextSnapshot);
          }
        }()).finally(function () {
          changePromise = null;
        });
      }
      return changePromise;
    }

    function annotationLayer(pageIndex) {
      var pageView = viewer.getPageView(pageIndex);
      return pageView && pageView.annotationEditorLayer &&
        pageView.annotationEditorLayer.annotationEditorLayer;
    }

    function hydratePage(pageNumber) {
      var pageIndex = Number(pageNumber) - 1;
      if (destroyed || hydratedPages.has(pageIndex)) {
        return Promise.resolve();
      }
      var activeHydration = hydratingPages.get(pageIndex);
      if (activeHydration) {
        queuedHydrationPages.add(pageIndex);
        return activeHydration;
      }

      var hydration = (async function () {
        do {
          queuedHydrationPages.delete(pageIndex);
          if (destroyed || hydratedPages.has(pageIndex)) {
            return;
          }
          var layer = annotationLayer(pageIndex);
          if (!layer) {
            return;
          }
          var pageAnnotations = pendingByPage.get(pageIndex) || [];
          if (!pageAnnotations.length) {
            hydratedPages.add(pageIndex);
            return;
          }

          suppressChanges += 1;
          try {
            var remaining = [];
            for (var index = 0; index < pageAnnotations.length; index += 1) {
              try {
                var editor = await layer.deserialize(cloneJson(pageAnnotations[index]));
                if (destroyed || annotationLayer(pageIndex) !== layer) {
                  remaining.push(pageAnnotations[index]);
                  queuedHydrationPages.add(pageIndex);
                } else if (editor) {
                  layer.addOrRebuild(editor);
                } else {
                  remaining.push(pageAnnotations[index]);
                }
              } catch (_) {
                remaining.push(pageAnnotations[index]);
              }
            }
            if (remaining.length) {
              pendingByPage.set(pageIndex, remaining);
            } else {
              pendingByPage.delete(pageIndex);
              hydratedPages.add(pageIndex);
            }
            lastFingerprint = JSON.stringify(snapshot());
          } finally {
            suppressChanges -= 1;
          }
          emitState();
        } while (queuedHydrationPages.has(pageIndex));
      }()).finally(function () {
        if (hydratingPages.get(pageIndex) === hydration) {
          hydratingPages.delete(pageIndex);
        }
      });
      hydratingPages.set(pageIndex, hydration);
      return hydration;
    }

    function setMode(modeName) {
      if (!uiManager || !Object.prototype.hasOwnProperty.call(modes, modeName)) {
        return false;
      }
      currentMode = modeName;
      viewer.annotationEditorMode = { mode: modes[modeName] };
      emitState();
      return true;
    }

    function undo() {
      if (uiManager && editingState.canUndo) {
        uiManager.undo();
      }
    }

    function redo() {
      if (uiManager && editingState.canRedo) {
        uiManager.redo();
      }
    }

    function eraseSelected() {
      if (uiManager && editingState.hasSelection) {
        uiManager.delete();
      }
    }

    async function flush() {
      uiManager?.commitOrRemove();
      await checkForChanges(false);
      if (changePromise) {
        await changePromise;
      }
      return snapshot();
    }

    async function exportPdf(filename) {
      uiManager?.commitOrRemove();
      await checkForChanges(false).catch(function () {
        // Export remains the recovery path when local or remote persistence is full.
      });
      var temporaryKeys = [];
      suppressChanges += 1;
      pendingByPage.forEach(function (pageAnnotations) {
        pageAnnotations.forEach(function (annotation) {
          var key = "library_pending_annotation_" + temporaryKeySequence;
          temporaryKeySequence += 1;
          temporaryKeys.push(key);
          pdf.annotationStorage.setValue(key, cloneJson(annotation));
        });
      });

      try {
        var data = await pdf.saveDocument();
        var blob = new Blob([data], { type: "application/pdf" });
        var urlApi = URL;
        var url = urlApi.createObjectURL(blob);
        var link = document.createElement("a");
        link.href = url;
        link.download = normalizeFilename(filename);
        link.hidden = true;
        document.body.appendChild(link);
        link.click();
        link.remove();
        setTimeout(function () { urlApi.revokeObjectURL(url); }, 1000);
        return { filename: link.download, bytes: data.byteLength };
      } finally {
        temporaryKeys.forEach(function (key) {
          pdf.annotationStorage.remove(key);
        });
        suppressChanges -= 1;
      }
    }

    function destroy() {
      destroyed = true;
      clearInterval(changeTimer);
      abortController.abort();
      if (uiManager) {
        uiManager.commitOrRemove();
      }
      uiManager = null;
    }

    eventBus.on("annotationeditoruimanager", function (event) {
      uiManager = event.uiManager;
      emitState();
    }, { signal: abortController.signal });

    eventBus.on("annotationeditorlayerrendered", function (event) {
      hydratePage(event.pageNumber).catch(function () {});
    }, { signal: abortController.signal });

    eventBus.on("annotationeditormodechanged", function (event) {
      var matchingMode = Object.keys(modes).find(function (name) {
        return modes[name] === event.mode;
      });
      currentMode = matchingMode || "read";
      emitState();
    }, { signal: abortController.signal });

    eventBus.on("editingstateschanged", function (event) {
      var details = event.details || {};
      editingState.canUndo = details.hasSomethingToUndo === true;
      editingState.canRedo = details.hasSomethingToRedo === true;
      editingState.hasSelection = details.hasSelectedEditor === true;
      emitState();
    }, { signal: abortController.signal });

    pendingByPage.forEach(function (_, pageIndex) {
      hydratePage(pageIndex + 1).catch(function () {});
    });
    emitState();

    var changeTimer = setInterval(function () {
      checkForChanges(false).catch(function () {});
    }, 900);

    return {
      destroy: destroy,
      eraseSelected: eraseSelected,
      exportPdf: exportPdf,
      flush: flush,
      redo: redo,
      setMode: setMode,
      snapshot: snapshot,
      undo: undo
    };
  }

  return {
    create: create,
    normalizeFilename: normalizeFilename
  };
}));
