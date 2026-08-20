"use strict";

const assert = require("assert");
const LibraryPdfEditor = require("../assets/js/library-pdf-editor.js");

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

class EventBus {
  constructor() {
    this.listeners = Object.create(null);
  }

  on(name, callback) {
    (this.listeners[name] ||= []).push(callback);
  }

  dispatch(name, detail) {
    (this.listeners[name] || []).forEach((callback) => callback(detail));
  }
}

(async function () {
  const values = new Map();
  let savedValues = [];
  const annotationStorage = {
    get serializable() {
      return { map: new Map(values), hash: "", transfer: [] };
    },
    setValue(key, value) {
      values.set(key, value);
    },
    remove(key) {
      values.delete(key);
    }
  };
  const pdf = {
    annotationStorage,
    async saveDocument() {
      savedValues = Array.from(values.values());
      return new Uint8Array([37, 80, 68, 70]);
    }
  };
  const eventBus = new EventBus();
  let hydratedSequence = 0;
  const layer = {
    async deserialize(data) {
      return { data };
    },
    addOrRebuild(editor) {
      values.set("hydrated-" + hydratedSequence, editor.data);
      hydratedSequence += 1;
    }
  };
  let selectedMode = null;
  const viewer = {
    set annotationEditorMode(value) {
      selectedMode = value.mode;
    },
    getPageView() {
      return {
        annotationEditorLayer: {
          annotationEditorLayer: layer
        }
      };
    }
  };
  const calls = { undo: 0, redo: 0, erase: 0 };
  const uiManager = {
    commitOrRemove() {},
    undo() { calls.undo += 1; },
    redo() { calls.redo += 1; },
    delete() { calls.erase += 1; }
  };
  const changes = [];
  const editor = LibraryPdfEditor.create({
    pdf,
    viewer,
    eventBus,
    pdfjs: {
      AnnotationEditorType: {
        NONE: 0,
        FREETEXT: 3,
        HIGHLIGHT: 9,
        INK: 15
      }
    },
    annotations: [
      {
        annotationType: 9,
        pageIndex: 0,
        rect: [0, 0, 10, 10],
        quadPoints: new Float32Array([0, 1, 2, 1, 0, 0, 2, 0])
      },
      { annotationType: 15, pageIndex: 2, rect: [0, 0, 10, 10] }
    ],
    onChange: async (snapshot) => {
      changes.push(snapshot);
    }
  });

  assert.strictEqual(editor.snapshot().length, 2);
  assert(Array.isArray(editor.snapshot()[0].quadPoints));
  eventBus.dispatch("annotationeditoruimanager", { uiManager });
  eventBus.dispatch("annotationeditorlayerrendered", { pageNumber: 1 });
  await wait(10);
  assert.strictEqual(editor.snapshot().length, 2);

  assert.strictEqual(editor.setMode("ink"), true);
  assert.strictEqual(selectedMode, 15);
  eventBus.dispatch("editingstateschanged", {
    details: {
      hasSomethingToUndo: true,
      hasSomethingToRedo: true,
      hasSelectedEditor: true
    }
  });
  editor.undo();
  editor.redo();
  editor.eraseSelected();
  assert.deepStrictEqual(calls, { undo: 1, redo: 1, erase: 1 });

  values.set("new-text", {
    annotationType: 3,
    pageIndex: 0,
    rect: [1, 1, 5, 5],
    value: "note"
  });
  await wait(950);
  assert.strictEqual(changes.at(-1).length, 3);

  const originalDocument = global.document;
  const originalUrl = global.URL;
  global.document = {
    body: { appendChild() {} },
    createElement() {
      return {
        hidden: false,
        click() {},
        remove() {}
      };
    }
  };
  global.URL = {
    createObjectURL: () => "blob:annotated",
    revokeObjectURL() {}
  };
  const exported = await editor.exportPdf("paper.pdf");
  assert.strictEqual(exported.filename, "paper-annotated.pdf");
  assert.strictEqual(savedValues.length, 3);
  global.document = originalDocument;
  global.URL = originalUrl;

  const lateValues = new Map();
  const lateStates = [];
  const lateEventBus = new EventBus();
  let activeLateLayer;
  let staleLayerAdds = 0;
  const settledLateLayer = {
    async deserialize(data) {
      return { data };
    },
    addOrRebuild(lateEditor) {
      lateValues.set("late-" + lateValues.size, lateEditor.data);
    }
  };
  const staleLateLayer = {
    async deserialize(data) {
      await Promise.resolve();
      activeLateLayer = settledLateLayer;
      lateEventBus.dispatch("annotationeditorlayerrendered", { pageNumber: 1 });
      return { data };
    },
    addOrRebuild() {
      staleLayerAdds += 1;
    }
  };
  activeLateLayer = staleLateLayer;
  const lateUiManager = {
    commitOrRemove() {}
  };
  const lateEditor = LibraryPdfEditor.create({
    pdf: {
      annotationStorage: {
        get serializable() {
          return { map: lateValues };
        },
        setValue(key, value) {
          lateValues.set(key, value);
        },
        remove(key) {
          lateValues.delete(key);
        }
      }
    },
    viewer: {
      _layerProperties: {
        annotationEditorUIManager: lateUiManager
      },
      getPageView() {
        return {
          annotationEditorLayer: {
            annotationEditorLayer: activeLateLayer
          }
        };
      }
    },
    eventBus: lateEventBus,
    pdfjs: {
      AnnotationEditorType: {
        NONE: 0,
        FREETEXT: 3,
        HIGHLIGHT: 9,
        INK: 15
      }
    },
    annotations: [
      { annotationType: 9, pageIndex: 0, rect: [0, 0, 10, 10] }
    ],
    onState(state) {
      lateStates.push(state);
    }
  });
  await wait(10);
  assert.strictEqual(
    lateValues.size,
    1,
    "annotations loaded after the first page rendered must hydrate immediately"
  );
  assert.strictEqual(
    staleLayerAdds,
    0,
    "annotations must not be attached to a PDF.js page layer that was replaced mid-hydration"
  );
  assert.strictEqual(
    lateStates.at(-1).ready,
    true,
    "a late editor must reuse PDF.js's existing annotation UI manager"
  );
  lateEditor.destroy();

  editor.destroy();
  console.log("PASS: Library PDF editor hydration, tools, autosave, and complete export tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
