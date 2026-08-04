(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.LibraryStore = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CACHE_KEY = "miyaal-library-progress-v1";

  function safeStorage(storage) {
    return storage || {
      getItem: function () { return null; },
      setItem: function () {}
    };
  }

  function normalizeError(error) {
    var normalized = new Error(error && error.message ? error.message : "library_sync_failed");
    normalized.cause = error;
    normalized.code = error && (error.code || error.message) ? (error.code || error.message) : "library_sync_failed";

    if (normalized.message.indexOf("not_site_owner") >= 0) {
      normalized.code = "not_site_owner";
    }
    return normalized;
  }

  function normalizeProgress(value) {
    if (!value || !value.documentId) {
      return null;
    }
    return {
      documentId: String(value.documentId),
      page: Math.max(1, Number(value.page) || 1),
      totalPages: Math.max(0, Number(value.totalPages) || 0),
      zoom: Math.min(2.5, Math.max(0.5, Number(value.zoom) || 1)),
      updatedAt: value.updatedAt || new Date(0).toISOString()
    };
  }

  function readLocal(storage) {
    try {
      var raw = storage.getItem(CACHE_KEY);
      var parsed = raw ? JSON.parse(raw) : {};
      return parsed && typeof parsed === "object" ? parsed : {};
    } catch (_) {
      return {};
    }
  }

  function writeLocal(storage, records) {
    try {
      storage.setItem(CACHE_KEY, JSON.stringify(records));
    } catch (_) {
      // Reading must still work when storage is unavailable or full.
    }
  }

  function create(config, options) {
    var settings = config || {};
    var dependencies = options || {};
    var storage = safeStorage(dependencies.storage || (typeof localStorage !== "undefined" ? localStorage : null));
    var supabaseGlobal = dependencies.supabase || (typeof globalThis !== "undefined" ? globalThis.supabase : null);
    var configured = Boolean(settings.url && settings.publishableKey && supabaseGlobal && supabaseGlobal.createClient);
    var client = configured
      ? supabaseGlobal.createClient(settings.url, settings.publishableKey, {
        auth: {
          persistSession: true,
          autoRefreshToken: true,
          detectSessionInUrl: true
        }
      })
      : null;

    function loadLocalProgress() {
      var records = readLocal(storage);
      return Object.keys(records).reduce(function (result, key) {
        var normalized = normalizeProgress(records[key]);
        if (normalized) {
          result[normalized.documentId] = normalized;
        }
        return result;
      }, {});
    }

    function saveLocalProgress(progress) {
      var normalized = normalizeProgress(progress);
      if (!normalized) {
        return null;
      }
      normalized.updatedAt = progress.updatedAt || new Date().toISOString();
      var records = loadLocalProgress();
      records[normalized.documentId] = normalized;
      writeLocal(storage, records);
      return normalized;
    }

    async function getSession() {
      if (!client) {
        return null;
      }
      var response = await client.auth.getSession();
      if (response.error) {
        throw normalizeError(response.error);
      }
      return response.data.session;
    }

    async function signIn() {
      if (!client) {
        throw normalizeError({ message: "supabase_not_configured", code: "not_configured" });
      }
      var redirectTo = settings.redirectTo || (typeof location !== "undefined"
        ? location.origin + "/library/"
        : undefined);
      var response = await client.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: redirectTo }
      });
      if (response.error) {
        throw normalizeError(response.error);
      }
      return response.data;
    }

    async function signOut() {
      if (!client) {
        return;
      }
      var response = await client.auth.signOut();
      if (response.error) {
        throw normalizeError(response.error);
      }
    }

    async function isOwner() {
      if (!client) {
        return false;
      }
      var response = await client.rpc("is_site_owner");
      if (response.error) {
        throw normalizeError(response.error);
      }
      return response.data === true;
    }

    async function loadRemoteProgress() {
      if (!client) {
        return {};
      }
      var response = await client.rpc("load_library_progress");
      if (response.error) {
        throw normalizeError(response.error);
      }
      return (response.data || []).reduce(function (result, row) {
        var normalized = normalizeProgress({
          documentId: row.document_id,
          page: row.page_number,
          totalPages: row.total_pages,
          zoom: row.zoom,
          updatedAt: row.updated_at
        });
        if (normalized) {
          result[normalized.documentId] = normalized;
        }
        return result;
      }, {});
    }

    async function saveRemoteProgress(progress) {
      if (!client) {
        return null;
      }
      var normalized = normalizeProgress(progress);
      if (!normalized) {
        throw normalizeError({ message: "invalid_library_progress", code: "invalid_progress" });
      }
      var response = await client.rpc("save_library_progress", {
        p_document_id: normalized.documentId,
        p_page_number: normalized.page,
        p_total_pages: normalized.totalPages,
        p_zoom: normalized.zoom
      });
      if (response.error) {
        throw normalizeError(response.error);
      }
      return normalized;
    }

    async function getUploadToken() {
      if (!client) {
        throw normalizeError({ message: "supabase_not_configured", code: "not_configured" });
      }
      var response = await client.functions.invoke("library-github-token", { body: {} });
      if (response.error) {
        var context = response.error.context;
        var detail = context && typeof context.json === "function"
          ? await context.json().catch(function () { return null; })
          : null;
        throw normalizeError(detail || response.error);
      }
      if (!response.data || !response.data.token) {
        throw normalizeError({ message: "upload_token_missing", code: "token_missing" });
      }
      return response.data;
    }

    function onAuthChange(callback) {
      if (!client) {
        return function () {};
      }
      var subscription = client.auth.onAuthStateChange(function (event, session) {
        callback(event, session);
      });
      return function () {
        if (subscription.data && subscription.data.subscription) {
          subscription.data.subscription.unsubscribe();
        }
      };
    }

    return {
      kind: "supabase",
      configured: configured,
      getSession: getSession,
      signIn: signIn,
      signOut: signOut,
      isOwner: isOwner,
      loadLocalProgress: loadLocalProgress,
      saveLocalProgress: saveLocalProgress,
      loadRemoteProgress: loadRemoteProgress,
      saveRemoteProgress: saveRemoteProgress,
      getUploadToken: getUploadToken,
      onAuthChange: onAuthChange
    };
  }

  function createMemoryAdapter(initial) {
    var seed = initial || {};
    var signedIn = seed.signedIn !== false;
    var owner = seed.owner !== false;
    var progress = Object.assign({}, seed.progress || {});
    var listeners = [];

    function notify(event) {
      listeners.forEach(function (listener) {
        listener(event, signedIn ? { user: { id: "memory-owner" } } : null);
      });
    }

    return {
      kind: "memory",
      configured: true,
      getSession: async function () {
        return signedIn ? { user: { id: "memory-owner" } } : null;
      },
      signIn: async function () {
        signedIn = true;
        notify("SIGNED_IN");
      },
      signOut: async function () {
        signedIn = false;
        notify("SIGNED_OUT");
      },
      isOwner: async function () {
        return signedIn && owner;
      },
      loadLocalProgress: function () {
        return Object.assign({}, progress);
      },
      saveLocalProgress: function (record) {
        var normalized = normalizeProgress(record);
        progress[normalized.documentId] = normalized;
        return normalized;
      },
      loadRemoteProgress: async function () {
        if (!signedIn || !owner) {
          throw normalizeError({ message: "not_site_owner" });
        }
        return Object.assign({}, progress);
      },
      saveRemoteProgress: async function (record) {
        if (!signedIn || !owner) {
          throw normalizeError({ message: "not_site_owner" });
        }
        var normalized = normalizeProgress(record);
        progress[normalized.documentId] = normalized;
        return normalized;
      },
      getUploadToken: async function () {
        if (!signedIn || !owner) {
          throw normalizeError({ message: "not_site_owner" });
        }
        return { token: "memory-token", expiresAt: new Date(Date.now() + 3600000).toISOString() };
      },
      onAuthChange: function (callback) {
        listeners.push(callback);
        return function () {
          listeners = listeners.filter(function (listener) { return listener !== callback; });
        };
      }
    };
  }

  return {
    CACHE_KEY: CACHE_KEY,
    create: create,
    createMemoryAdapter: createMemoryAdapter,
    normalizeProgress: normalizeProgress
  };
}));
