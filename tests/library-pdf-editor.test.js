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

  editor.destroy();
  console.log("PASS: Library PDF editor hydration, tools, autosave, and complete export tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
