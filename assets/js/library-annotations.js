(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LibraryAnnotations = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DATABASE_NAME = "miyaal-library-annotations";
  var DATABASE_VERSION = 1;
  var STORE_NAME = "documents";
  var FALLBACK_PREFIX = "miyaal-library-annotations-v1:";
  var EMPTY_DATE = new Date(0).toISOString();
  var MAX_ANNOTATIONS = 5000;
  var MAX_SERIALIZED_BYTES = 4 * 1024 * 1024;

  function cloneJson(value) {
    return JSON.parse(JSON.stringify(value, function (_, item) {
      return ArrayBuffer.isView(item) ? Array.from(item) : item;
    }));
  }

  function recordKey(documentRef) {
    return String(documentRef.documentId) + "::" + String(documentRef.documentRevision);
  }

  function normalizeDocument(documentRef) {
    var value = documentRef || {};
    var documentId = String(value.documentId || "");
    var documentRevision = String(value.documentRevision || "");
    if (!documentId || !documentRevision) {
      throw new Error("invalid_library_annotation_document");
    }
    return {
      documentId: documentId,
      documentRevision: documentRevision
    };
  }

  function normalizeAnnotations(annotations) {
    var value = Array.isArray(annotations) ? cloneJson(annotations) : [];
    if (value.length > MAX_ANNOTATIONS) {
      throw new Error("library_annotations_too_many");
    }
    if (JSON.stringify(value).length > MAX_SERIALIZED_BYTES) {
      throw new Error("library_annotations_too_large");
    }
    return value;
  }

  function normalizeRecord(value, documentRef) {
    var documentValue = normalizeDocument(documentRef || value);
    var source = value || {};
    return {
      key: recordKey(documentValue),
      documentId: documentValue.documentId,
      documentRevision: documentValue.documentRevision,
      annotations: normalizeAnnotations(source.annotations),
      version: Math.max(0, Number(source.version) || 0),
      updatedAt: source.updatedAt || EMPTY_DATE,
      dirty: source.dirty === true,
      status: source.status || "local",
      error: source.error || null
    };
  }

  function errorCode(error) {
    var code = error && (error.code || error.message);
    if (String(code).indexOf("library_annotation_conflict") >= 0) {
      return "library_annotation_conflict";
    }
    return String(code || "library_annotation_sync_failed");
  }

  function fallbackAdapter(storage) {
    var target = storage || {
      getItem: function () { return null; },
      setItem: function () {}
    };

    return {
      load: async function (documentRef) {
        try {
          var raw = target.getItem(FALLBACK_PREFIX + encodeURIComponent(recordKey(documentRef)));
          return raw ? normalizeRecord(JSON.parse(raw), documentRef) : null;
        } catch (_) {
          return null;
        }
      },
      save: async function (record) {
        try {
          target.setItem(
            FALLBACK_PREFIX + encodeURIComponent(record.key),
            JSON.stringify(record)
          );
        } catch (_) {
          // The caller still keeps the in-memory record for this page session.
        }
        return record;
      }
    };
  }

  function createIndexedDbAdapter(options) {
    var dependencies = options || {};
    var indexedDb = dependencies.indexedDB || (typeof indexedDB !== "undefined" ? indexedDB : null);
    var fallback = fallbackAdapter(dependencies.storage || (typeof localStorage !== "undefined" ? localStorage : null));
    var openPromise = null;

    function openDatabase() {
      if (!indexedDb) {
        return Promise.resolve(null);
      }
      if (openPromise) {
        return openPromise;
      }
      openPromise = new Promise(function (resolve) {
        var request;
        try {
          request = indexedDb.open(DATABASE_NAME, DATABASE_VERSION);
        } catch (_) {
          resolve(null);
          return;
        }
        request.onupgradeneeded = function () {
          if (!request.result.objectStoreNames.contains(STORE_NAME)) {
            request.result.createObjectStore(STORE_NAME, { keyPath: "key" });
          }
        };
        request.onsuccess = function () { resolve(request.result); };
        request.onerror = function () { resolve(null); };
        request.onblocked = function () { resolve(null); };
      });
      return openPromise;
    }

    async function load(documentRef) {
      var database = await openDatabase();
      if (!database) {
        return fallback.load(documentRef);
      }
      return new Promise(function (resolve) {
        var transaction;
        try {
          transaction = database.transaction(STORE_NAME, "readonly");
          var request = transaction.objectStore(STORE_NAME).get(recordKey(documentRef));
          request.onsuccess = function () {
            resolve(request.result ? normalizeRecord(request.result, documentRef) : null);
          };
          request.onerror = function () {
            fallback.load(documentRef).then(resolve);
          };
        } catch (_) {
          fallback.load(documentRef).then(resolve);
        }
      });
    }

    async function save(record) {
      var database = await openDatabase();
      if (!database) {
        return fallback.save(record);
      }
      return new Promise(function (resolve) {
        var transaction;
        try {
          transaction = database.transaction(STORE_NAME, "readwrite");
          transaction.objectStore(STORE_NAME).put(record);
          transaction.oncomplete = function () { resolve(record); };
          transaction.onerror = function () {
            fallback.save(record).then(resolve);
          };
          transaction.onabort = function () {
            fallback.save(record).then(resolve);
          };
        } catch (_) {
          fallback.save(record).then(resolve);
        }
      });
    }

    return { load: load, save: save };
  }

  function createMemoryAdapter(initial) {
    var records = Object.create(null);
    Object.keys(initial || {}).forEach(function (key) {
      records[key] = cloneJson(initial[key]);
    });
    return {
      load: async function (documentRef) {
        var value = records[recordKey(documentRef)];
        return value ? normalizeRecord(value, documentRef) : null;
      },
      save: async function (record) {
        records[record.key] = cloneJson(record);
        return record;
      }
    };
  }

  function create(options) {
    var dependencies = options || {};
    var remote = dependencies.remote || null;
    var local = dependencies.local || createIndexedDbAdapter(dependencies);
    var now = dependencies.now || function () { return new Date().toISOString(); };
    var records = Object.create(null);

    async function persist(record) {
      records[record.key] = record;
      await local.save(record);
      return record;
    }

    async function pushRemote(record) {
      var saved = await remote.saveRemoteAnnotations({
        documentId: record.documentId,
        documentRevision: record.documentRevision,
        annotations: record.annotations,
        expectedVersion: record.version
      });
      return persist(normalizeRecord({
        annotations: record.annotations,
        version: saved.version,
        updatedAt: saved.updatedAt,
        dirty: false,
        status: "synced"
      }, record));
    }

    async function load(documentRef, syncRemote) {
      var documentValue = normalizeDocument(documentRef);
      var key = recordKey(documentValue);
      var localRecord = await local.load(documentValue);
      var current = localRecord || normalizeRecord({}, documentValue);
      records[key] = current;

      if (!syncRemote || !remote || typeof remote.loadRemoteAnnotations !== "function") {
        current.status = current.dirty ? "local" : "local-only";
        return current;
      }

      try {
        var remoteRecord = normalizeRecord(
          await remote.loadRemoteAnnotations(documentValue),
          documentValue
        );
        if (current.dirty) {
          if (current.version !== remoteRecord.version) {
            current.status = "conflict";
            current.error = "library_annotation_conflict";
            return persist(current);
          }
          return await pushRemote(current);
        }
        if (remoteRecord.version >= current.version) {
          remoteRecord.status = "synced";
          return persist(remoteRecord);
        }
        return current;
      } catch (error) {
        current.status = "local";
        current.error = errorCode(error);
        return current;
      }
    }

    async function save(documentRef, annotations, syncRemote) {
      var documentValue = normalizeDocument(documentRef);
      var key = recordKey(documentValue);
      var previous = records[key] || await local.load(documentValue) || normalizeRecord({}, documentValue);
      var current = normalizeRecord({
        annotations: annotations,
        version: previous.version,
        updatedAt: now(),
        dirty: true,
        status: "local"
      }, documentValue);
      await persist(current);

      if (!syncRemote || !remote || typeof remote.saveRemoteAnnotations !== "function") {
        current.status = "local-only";
        return current;
      }

      try {
        return await pushRemote(current);
      } catch (error) {
        current.status = errorCode(error) === "library_annotation_conflict" ? "conflict" : "local";
        current.error = errorCode(error);
        return persist(current);
      }
    }

    return {
      load: load,
      save: save
    };
  }

  return {
    DATABASE_NAME: DATABASE_NAME,
    FALLBACK_PREFIX: FALLBACK_PREFIX,
    create: create,
    createIndexedDbAdapter: createIndexedDbAdapter,
    createMemoryAdapter: createMemoryAdapter,
    normalizeRecord: normalizeRecord,
    recordKey: recordKey
  };
}));
