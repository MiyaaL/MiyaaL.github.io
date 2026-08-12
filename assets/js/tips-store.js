(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.TipsStore = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  function normalizeError(error) {
    var message = error && error.message ? error.message : "tips_sync_failed";
    var normalized = new Error(message);
    normalized.cause = error;
    normalized.code = error && (error.code || error.message) ? (error.code || error.message) : "tips_sync_failed";
    if (message.indexOf("not_site_owner") >= 0) {
      normalized.code = "not_site_owner";
    }
    return normalized;
  }

  function create(config, options) {
    var settings = config || {};
    var dependencies = options || {};
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
      var redirectTo = settings.redirectTo || (typeof location !== "undefined" ? location.origin + "/tips/" : undefined);
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
      getUploadToken: getUploadToken,
      onAuthChange: onAuthChange
    };
  }

  function createMemoryAdapter(initial) {
    var state = initial || {};
    var signedIn = Boolean(state.signedIn);
    var owner = Boolean(state.owner);
    return {
      kind: "memory",
      configured: true,
      getSession: async function () { return signedIn ? { user: { id: "owner" } } : null; },
      signIn: async function () { signedIn = true; },
      signOut: async function () { signedIn = false; },
      isOwner: async function () { return signedIn && owner; },
      getUploadToken: async function () {
        if (!signedIn || !owner) {
          throw normalizeError({ message: "not_site_owner" });
        }
        return { token: state.token || "test-token" };
      },
      onAuthChange: function () { return function () {}; }
    };
  }

  return {
    create: create,
    createMemoryAdapter: createMemoryAdapter,
    normalizeError: normalizeError
  };
}));
