(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LibraryPdfPolicy = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var RANGE_CHUNK_SIZE = 256 * 1024;
  var MAX_CANVAS_PIXELS = 2 ** 25;
  var MINIMUM_RENDER_SCALE = 1.5;
  var OUTPUT_SCALE_MARKER = "__libraryMinimumRenderScale";

  function unique(values) {
    return values.filter(function (value, index) {
      return value && values.indexOf(value) === index;
    });
  }

  function urlCandidates(documentRecord, createProxyUrl) {
    var record = documentRecord || {};
    var direct = String(record.path || "");
    var canProxy = record.source === "external" || record.source === "release";
    var proxy = canProxy && typeof createProxyUrl === "function"
      ? String(createProxyUrl(record) || "")
      : "";

    return record.proxyRequired === true
      ? unique([proxy, direct])
      : unique([direct, proxy]);
  }

  function documentOptions(url, resources) {
    var settings = resources || {};
    var options = {
      url: url,
      disableAutoFetch: false,
      rangeChunkSize: RANGE_CHUNK_SIZE,
      enableHWA: true,
      cMapUrl: settings.cMapUrl,
      cMapPacked: true,
      iccUrl: settings.iccUrl,
      standardFontDataUrl: settings.standardFontDataUrl,
      wasmUrl: settings.wasmUrl
    };
    if (settings.httpHeaders) {
      options.httpHeaders = settings.httpHeaders;
    }
    return options;
  }

  function viewerOptions() {
    return {
      maxCanvasPixels: MAX_CANVAS_PIXELS,
      maxCanvasDim: 32767,
      enableDetailCanvas: true
    };
  }

  function initializeWithDeferredData(options) {
    var settings = options || {};
    var pending;
    try {
      pending = Promise.resolve(settings.load());
    } catch (error) {
      pending = Promise.reject(error);
    }

    var target;
    try {
      target = settings.initialize();
    } catch (error) {
      pending.catch(function () {});
      throw error;
    }

    var completion = pending.then(function (value) {
      return settings.attach(target, value);
    }).catch(function (error) {
      if (typeof settings.onError === "function") {
        return settings.onError(error);
      }
      throw error;
    });
    return { completion: completion, target: target };
  }

  async function runLoadingTask(options) {
    var settings = options || {};
    var task = settings.create();
    settings.setCurrent(task);
    try {
      return await task.promise;
    } catch (error) {
      if (!task.destroyed) {
        await task.destroy().catch(function () {});
      }
      if (settings.getCurrent() === task) {
        settings.setCurrent(null);
      }
      throw error;
    }
  }

  function createSerialExecutor(operation) {
    var tail = Promise.resolve();
    return function () {
      var context = this;
      var args = arguments;
      var run = tail.then(function () {
        return operation.apply(context, args);
      });
      tail = run.catch(function () {});
      return run;
    };
  }

  function installMinimumRenderScale(pdfjs) {
    var OutputScale = pdfjs && pdfjs.OutputScale;
    if (!OutputScale) {
      return false;
    }
    if (Number(OutputScale[OUTPUT_SCALE_MARKER]) >= MINIMUM_RENDER_SCALE) {
      return true;
    }

    var descriptor = Object.getOwnPropertyDescriptor(OutputScale, "pixelRatio");
    if (!descriptor || descriptor.configurable === false) {
      return false;
    }
    var nativePixelRatio = typeof descriptor.get === "function"
      ? function () { return Number(descriptor.get.call(OutputScale)) || 1; }
      : function () {
        return Number(globalThis.devicePixelRatio) || Number(descriptor.value) || 1;
      };

    Object.defineProperty(OutputScale, "pixelRatio", {
      configurable: true,
      enumerable: descriptor.enumerable,
      get: function () {
        return Math.max(nativePixelRatio(), MINIMUM_RENDER_SCALE);
      }
    });
    Object.defineProperty(OutputScale, OUTPUT_SCALE_MARKER, {
      configurable: true,
      value: MINIMUM_RENDER_SCALE
    });
    return true;
  }

  return {
    RANGE_CHUNK_SIZE: RANGE_CHUNK_SIZE,
    MAX_CANVAS_PIXELS: MAX_CANVAS_PIXELS,
    MINIMUM_RENDER_SCALE: MINIMUM_RENDER_SCALE,
    createSerialExecutor: createSerialExecutor,
    documentOptions: documentOptions,
    initializeWithDeferredData: initializeWithDeferredData,
    installMinimumRenderScale: installMinimumRenderScale,
    runLoadingTask: runLoadingTask,
    urlCandidates: urlCandidates,
    viewerOptions: viewerOptions
  };
}));
