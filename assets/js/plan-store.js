(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PlanStore = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var CACHE_KEY = "miyaal-plan-public-v1";

  function safeStorage(storage) {
    return storage || {
      getItem: function () { return null; },
      setItem: function () {},
      removeItem: function () {}
    };
  }

  function normalizeError(error) {
    var normalized = new Error(error && error.message ? error.message : "同步失败");
    normalized.cause = error;
    normalized.code = error && error.code ? error.code : "sync_error";
    if (normalized.message.indexOf("version_conflict") >= 0) {
      normalized.code = "version_conflict";
    }
    if (normalized.message.indexOf("not_plan_owner") >= 0) {
      normalized.code = "not_plan_owner";
    }
    return normalized;
  }

  function createSupabaseAdapter(config, options) {
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

    function cachedPublic() {
      try {
        var value = storage.getItem(CACHE_KEY);
        return value ? JSON.parse(value) : null;
      } catch (_) {
        return null;
      }
    }

    function cachePublic(record) {
      if (!record) {
        return;
      }
      try {
        storage.setItem(CACHE_KEY, JSON.stringify(record));
      } catch (_) {
        // A failed cache must never block the live plan.
      }
    }

    async function loadPublic() {
      if (!client) {
        return { record: cachedPublic(), offline: true, configured: false };
      }
      try {
        var response = await client
          .from("fitness_plan_public")
          .select("version,snapshot,updated_at")
          .eq("plan_key", "fitness")
          .maybeSingle();
        if (response.error) {
          throw response.error;
        }
        var record = response.data ? {
          version: response.data.version,
          snapshot: response.data.snapshot,
          updatedAt: response.data.updated_at
        } : null;
        cachePublic(record);
        return { record: record, offline: false, configured: true };
      } catch (error) {
        var cached = cachedPublic();
        if (cached) {
          return { record: cached, offline: true, configured: true, error: normalizeError(error) };
        }
        throw normalizeError(error);
      }
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
        ? location.origin + "/plan/"
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

    async function loadPrivate() {
      if (!client) {
        throw normalizeError({ message: "supabase_not_configured", code: "not_configured" });
      }
      var response = await client.rpc("load_private_fitness_plan");
      if (response.error) {
        throw normalizeError(response.error);
      }
      var row = Array.isArray(response.data) ? response.data[0] : response.data;
      if (!row) {
        return null;
      }
      return {
        version: Number(row.version || 0),
        state: row.state,
        updatedAt: row.updated_at
      };
    }

    async function save(expectedVersion, state, snapshot) {
      if (!client) {
        throw normalizeError({ message: "supabase_not_configured", code: "not_configured" });
      }
      var response = await client.rpc("save_fitness_plan", {
        p_expected_version: Number(expectedVersion || 0),
        p_state: state,
        p_snapshot: snapshot
      });
      if (response.error) {
        throw normalizeError(response.error);
      }
      var version = Array.isArray(response.data) ? response.data[0] : response.data;
      var record = {
        version: Number(version),
        snapshot: Object.assign({}, snapshot, { version: Number(version) }),
        updatedAt: new Date().toISOString()
      };
      cachePublic(record);
      return record;
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
      loadPublic: loadPublic,
      loadPrivate: loadPrivate,
      save: save,
      getSession: getSession,
      signIn: signIn,
      signOut: signOut,
      onAuthChange: onAuthChange,
      cachedPublic: cachedPublic
    };
  }

  function createMemoryAdapter(initial) {
    var seed = initial || {};
    var version = Number(seed.version || 0);
    var state = seed.state || null;
    var snapshot = seed.snapshot || null;
    var signedIn = seed.signedIn !== false;
    var listeners = [];

    function notify(event) {
      listeners.forEach(function (listener) {
        listener(event, signedIn ? { user: { id: "memory-owner" } } : null);
      });
    }

    return {
      kind: "memory",
      configured: true,
      loadPublic: async function () {
        return {
          record: snapshot ? { version: version, snapshot: snapshot, updatedAt: null } : null,
          offline: false,
          configured: true
        };
      },
      loadPrivate: async function () {
        if (!signedIn) {
          throw normalizeError({ message: "not_plan_owner" });
        }
        return state ? { version: version, state: state, updatedAt: null } : null;
      },
      save: async function (expectedVersion, nextState, nextSnapshot) {
        if (!signedIn) {
          throw normalizeError({ message: "not_plan_owner" });
        }
        if (Number(expectedVersion) !== version) {
          throw normalizeError({ message: "version_conflict" });
        }
        version += 1;
        state = JSON.parse(JSON.stringify(nextState));
        snapshot = JSON.parse(JSON.stringify(nextSnapshot));
        return { version: version, snapshot: snapshot, updatedAt: null };
      },
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
      onAuthChange: function (callback) {
        listeners.push(callback);
        return function () {
          listeners = listeners.filter(function (listener) {
            return listener !== callback;
          });
        };
      },
      cachedPublic: function () {
        return snapshot ? { version: version, snapshot: snapshot, updatedAt: null } : null;
      }
    };
  }

  return {
    createSupabaseAdapter: createSupabaseAdapter,
    createMemoryAdapter: createMemoryAdapter,
    normalizeError: normalizeError,
    CACHE_KEY: CACHE_KEY
  };
}));
