"use strict";

const assert = require("assert");
const LibraryImmersive = require("../assets/js/library-immersive.js");

function classList() {
  const values = new Set();
  return {
    contains: (name) => values.has(name),
    toggle(name, force) {
      if (force) {
        values.add(name);
      } else {
        values.delete(name);
      }
    }
  };
}

function fakeDocument() {
  const listeners = Object.create(null);
  return {
    body: { classList: classList() },
    fullscreenElement: null,
    addEventListener(name, callback) {
      (listeners[name] ||= []).push(callback);
    },
    removeEventListener(name, callback) {
      listeners[name] = (listeners[name] || []).filter((item) => item !== callback);
    },
    dispatch(name, event = {}) {
      (listeners[name] || []).forEach((callback) => callback(event));
    },
    async exitFullscreen() {
      this.fullscreenElement = null;
      this.dispatch("fullscreenchange");
    }
  };
}

(async function () {
  const documentValue = fakeDocument();
  const element = { classList: classList() };
  element.requestFullscreen = async function () {
    documentValue.fullscreenElement = element;
    documentValue.dispatch("fullscreenchange");
  };
  const immersive = LibraryImmersive.create(element, {
    document: documentValue,
    body: documentValue.body
  });

  await immersive.enter();
  assert.strictEqual(immersive.isActive(), true);
  assert.strictEqual(element.classList.contains("is-immersive"), true);
  assert.strictEqual(documentValue.body.classList.contains("library-immersive-active"), true);
  await immersive.exit();
  assert.strictEqual(immersive.isActive(), false);

  const fallbackDocument = fakeDocument();
  const fallbackElement = { classList: classList() };
  const fallback = LibraryImmersive.create(fallbackElement, {
    document: fallbackDocument,
    body: fallbackDocument.body
  });
  await fallback.enter();
  let prevented = false;
  fallbackDocument.dispatch("keydown", {
    key: "Escape",
    preventDefault() { prevented = true; }
  });
  assert.strictEqual(prevented, true);
  assert.strictEqual(fallback.isActive(), false);

  immersive.destroy();
  fallback.destroy();
  console.log("PASS: Library native fullscreen and fixed-position fallback tests");
}()).catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
