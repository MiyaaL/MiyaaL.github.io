(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LibraryImmersive = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function create(element, options) {
    var settings = options || {};
    var documentValue = settings.document || document;
    var body = settings.body || documentValue.body;
    var onChange = settings.onChange || function () {};
    var active = false;
    var requestedNativeFullscreen = false;

    function update(value) {
      active = value;
      element.classList.toggle("is-immersive", active);
      body.classList.toggle("library-immersive-active", active);
      onChange(active);
    }

    async function enter() {
      if (active) {
        return;
      }
      update(true);
      if (typeof element.requestFullscreen === "function") {
        try {
          requestedNativeFullscreen = true;
          await element.requestFullscreen({ navigationUI: "hide" });
        } catch (_) {
          requestedNativeFullscreen = false;
          // The fixed-position immersive mode remains as a browser fallback.
        }
      }
    }

    async function exit() {
      if (!active && documentValue.fullscreenElement !== element) {
        return;
      }
      update(false);
      if (documentValue.fullscreenElement === element && typeof documentValue.exitFullscreen === "function") {
        try {
          await documentValue.exitFullscreen();
        } catch (_) {}
      }
      requestedNativeFullscreen = false;
    }

    function toggle() {
      return active ? exit() : enter();
    }

    function handleFullscreenChange() {
      if (requestedNativeFullscreen && documentValue.fullscreenElement !== element) {
        requestedNativeFullscreen = false;
        update(false);
      }
    }

    function handleKeydown(event) {
      if (active && event.key === "Escape" && documentValue.fullscreenElement !== element) {
        event.preventDefault();
        exit();
      }
    }

    documentValue.addEventListener("fullscreenchange", handleFullscreenChange);
    documentValue.addEventListener("keydown", handleKeydown);

    return {
      destroy: function () {
        documentValue.removeEventListener("fullscreenchange", handleFullscreenChange);
        documentValue.removeEventListener("keydown", handleKeydown);
        update(false);
      },
      enter: enter,
      exit: exit,
      isActive: function () { return active; },
      toggle: toggle
    };
  }

  return { create: create };
}));
