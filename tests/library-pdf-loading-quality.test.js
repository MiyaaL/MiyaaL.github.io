"use strict";

const assert = require("assert");
const fs = require("fs");
const path = require("path");

const siteRoot = path.resolve(__dirname, "..");
const policyPath = path.join(siteRoot, "assets/js/library-pdf-policy.js");

(async function () {
assert(
  fs.existsSync(policyPath),
  "PDF loading/rendering policy must live in a directly testable module"
);

const LibraryPdfPolicy = require(policyPath);
const proxyUrl = (documentRecord) => "https://proxy.example.test/?id=" + documentRecord.id;
const externalDocument = {
  id: "mit-notes",
  source: "external",
  proxyRequired: true,
  path: "https://diffusion.csail.mit.edu/docs/lecture_notes.pdf"
};
const corsCapableExternalDocument = {
  id: "arxiv-paper",
  source: "external",
  path: "https://arxiv.org/pdf/2403.18103"
};
const repositoryDocument = {
  id: "release-paper",
  source: "repository",
  path: "https://github.com/example/releases/download/library/paper.pdf"
};

assert.deepStrictEqual(
  LibraryPdfPolicy.urlCandidates(externalDocument, proxyUrl),
  [proxyUrl(externalDocument), externalDocument.path],
  "PDFs explicitly known to reject CORS must avoid a failed direct request"
);
assert.deepStrictEqual(
  LibraryPdfPolicy.urlCandidates(corsCapableExternalDocument, proxyUrl),
  [corsCapableExternalDocument.path, proxyUrl(corsCapableExternalDocument)],
  "CORS-capable external PDFs must retain their faster direct path"
);
assert.deepStrictEqual(
  LibraryPdfPolicy.urlCandidates(repositoryDocument, proxyUrl),
  [repositoryDocument.path],
  "repository PDFs should keep their fast direct path"
);

const documentOptions = LibraryPdfPolicy.documentOptions("https://example.test/paper.pdf", {
  cMapUrl: "/assets/pdfjs/cmaps/",
  iccUrl: "/assets/pdfjs/iccs/",
  standardFontDataUrl: "/assets/pdfjs/standard_fonts/",
  wasmUrl: "/assets/pdfjs/wasm/"
});
assert.strictEqual(
  documentOptions.disableAutoFetch,
  false,
  "PDF.js must be allowed to fetch upcoming ranges while the reader is idle"
);
assert(
  documentOptions.rangeChunkSize >= 262144,
  "remote PDFs should not pay a round trip for every tiny default range"
);
assert.strictEqual(
  documentOptions.enableHWA,
  true,
  "PDF rendering should use the accelerated canvas path when available"
);

const viewerOptions = LibraryPdfPolicy.viewerOptions();
assert(
  viewerOptions.maxCanvasPixels >= 2 ** 25,
  "high-DPI rendering must not inherit PDF.js's low mobile canvas budget"
);

const originalDevicePixelRatio = Object.getOwnPropertyDescriptor(globalThis, "devicePixelRatio");
Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 1 });
class OutputScale {
  static get pixelRatio() {
    return globalThis.devicePixelRatio || 1;
  }
}
assert.strictEqual(
  LibraryPdfPolicy.installMinimumRenderScale({ OutputScale }),
  true
);
assert.strictEqual(
  OutputScale.pixelRatio,
  1.5,
  "standard-DPI displays must render more than one backing pixel per CSS pixel"
);
Object.defineProperty(globalThis, "devicePixelRatio", { configurable: true, value: 2 });
assert.strictEqual(
  OutputScale.pixelRatio,
  2,
  "the quality floor must preserve a device's higher native pixel ratio"
);
if (originalDevicePixelRatio) {
  Object.defineProperty(globalThis, "devicePixelRatio", originalDevicePixelRatio);
} else {
  delete globalThis.devicePixelRatio;
}

let resolveAnnotations;
const annotationEvents = [];
const deferredAnnotations = LibraryPdfPolicy.initializeWithDeferredData({
  load() {
    annotationEvents.push("load-started");
    return new Promise((resolve) => {
      resolveAnnotations = resolve;
    });
  },
  initialize() {
    annotationEvents.push("viewer-initialized");
    return { id: "viewer" };
  },
  attach(viewer, annotations) {
    annotationEvents.push("annotations-attached:" + viewer.id + ":" + annotations.length);
  }
});
assert.deepStrictEqual(
  annotationEvents,
  ["load-started", "viewer-initialized"],
  "a pending annotation request must not delay viewer initialization"
);
resolveAnnotations([{ id: "highlight" }]);
await deferredAnnotations.completion;
assert.deepStrictEqual(
  annotationEvents,
  ["load-started", "viewer-initialized", "annotations-attached:viewer:1"]
);

function controlledTask() {
  let resolve;
  let reject;
  let destroyCalls = 0;
  return {
    task: {
      promise: new Promise((taskResolve, taskReject) => {
        resolve = taskResolve;
        reject = taskReject;
      }),
      async destroy() {
        destroyCalls += 1;
      }
    },
    destroyCalls: () => destroyCalls,
    reject,
    resolve
  };
}
let currentLoadingTask = null;
const firstLoadingTask = controlledTask();
const secondLoadingTask = controlledTask();
const taskSettings = (controlled) => ({
  create: () => controlled.task,
  getCurrent: () => currentLoadingTask,
  setCurrent: (task) => {
    currentLoadingTask = task;
  }
});
const firstLoading = LibraryPdfPolicy.runLoadingTask(taskSettings(firstLoadingTask));
const secondLoading = LibraryPdfPolicy.runLoadingTask(taskSettings(secondLoadingTask));
firstLoadingTask.reject(new Error("stale request failed"));
await assert.rejects(firstLoading, /stale request failed/);
assert.strictEqual(currentLoadingTask, secondLoadingTask.task);
assert.strictEqual(firstLoadingTask.destroyCalls(), 1);
assert.strictEqual(secondLoadingTask.destroyCalls(), 0);
secondLoadingTask.resolve({ id: "current-pdf" });
assert.deepStrictEqual(await secondLoading, { id: "current-pdf" });
assert.strictEqual(
  currentLoadingTask,
  secondLoadingTask.task,
  "the successful loading task must remain available to close its worker and document"
);

let releaseFirstTeardown;
const teardownEvents = [];
const serializedTeardown = LibraryPdfPolicy.createSerialExecutor(async (name) => {
  teardownEvents.push("start:" + name);
  if (name === "first") {
    await new Promise((resolve) => {
      releaseFirstTeardown = resolve;
    });
  }
  teardownEvents.push("finish:" + name);
});
const firstTeardown = serializedTeardown("first");
const secondTeardown = serializedTeardown("second");
await Promise.resolve();
assert.deepStrictEqual(
  teardownEvents,
  ["start:first"],
  "a second document teardown must wait while the first editor flush is pending"
);
releaseFirstTeardown();
await Promise.all([firstTeardown, secondTeardown]);
assert.deepStrictEqual(
  teardownEvents,
  ["start:first", "finish:first", "start:second", "finish:second"]
);

const appSource = fs.readFileSync(
  path.join(siteRoot, "assets/js/library-app.js"),
  "utf8"
);
assert(
  appSource.includes("LibraryPdfPolicy.urlCandidates("),
  "the reader must use the tested URL routing policy"
);
assert(
  appSource.includes("LibraryPdfPolicy.documentOptions("),
  "the reader must use the tested document loading policy"
);
assert(
  appSource.includes("LibraryPdfPolicy.viewerOptions("),
  "the reader must use the tested high-DPI rendering policy"
);
assert(
  appSource.includes("LibraryPdfPolicy.installMinimumRenderScale("),
  "the reader must install the tested backing-resolution floor"
);
assert(
  appSource.includes("LibraryPdfPolicy.initializeWithDeferredData("),
  "the reader must use the tested non-blocking annotation sequence"
);
assert(
  appSource.includes("LibraryPdfPolicy.runLoadingTask("),
  "the reader must use identity-safe PDF loading tasks"
);
assert(
  appSource.includes("LibraryPdfPolicy.createSerialExecutor("),
  "document teardown must be serialized while annotation flush is pending"
);
assert(
  appSource.includes("state.pdf && state.pdf.loadingTask"),
  "reader teardown must recover the successful PDFLoadingTask from the document proxy"
);
assert(
  !appSource.includes("state.pdf.destroy("),
  "PDFDocumentProxy has no destroy method; teardown must destroy its loading task"
);

const openDocumentStart = appSource.indexOf("async function openDocument(");
const nextFunctionStart = appSource.indexOf("\n  function ", openDocumentStart);
const openDocumentSource = appSource.slice(openDocumentStart, nextFunctionStart);
const initializeViewerAt = openDocumentSource.indexOf("initializeContinuousViewer(");
const blockingAnnotationsAt = openDocumentSource.indexOf("await loadAnnotations(");
assert(initializeViewerAt >= 0, "openDocument must initialize the PDF viewer");
assert(
  blockingAnnotationsAt < 0 || initializeViewerAt < blockingAnnotationsAt,
  "remote annotations must not block creation and rendering of the first PDF page"
);

console.log("PASS: Library PDF loading latency and high-DPI rendering policy tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
