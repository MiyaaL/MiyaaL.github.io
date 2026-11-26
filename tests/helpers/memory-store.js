"use strict";

// In-memory stand-in for the Supabase adapter in assets/js/plan-store.js. It
// keeps the same version check as save_fitness_plan so conflict handling can
// be exercised without a network.
function conflict(message) {
  const error = new Error(message);
  error.code = message;
  return error;
}

function createMemoryAdapter(initial) {
  const seed = initial || {};
  let version = Number(seed.version || 0);
  let state = seed.state || null;
  let snapshot = seed.snapshot || null;
  let signedIn = seed.signedIn !== false;
  let listeners = [];
  const adapter = {
    kind: "memory",
    configured: true,
    saves: 0,
    failNextSave: null,
    async loadPublic() {
      return {
        record: snapshot ? { version, snapshot, updatedAt: null } : null,
        offline: false,
        configured: true
      };
    },
    async loadPrivate() {
      if (!signedIn) throw conflict("not_plan_owner");
      return state ? { version, state: JSON.parse(JSON.stringify(state)), updatedAt: null } : null;
    },
    async save(expectedVersion, nextState, nextSnapshot) {
      if (!signedIn) throw conflict("not_plan_owner");
      if (adapter.failNextSave) {
        const failure = adapter.failNextSave;
        adapter.failNextSave = null;
        throw conflict(failure);
      }
      if (Number(expectedVersion) !== version) throw conflict("version_conflict");
      version += 1;
      adapter.saves += 1;
      state = JSON.parse(JSON.stringify(nextState));
      snapshot = JSON.parse(JSON.stringify(nextSnapshot));
      return { version, snapshot, updatedAt: null };
    },
    // Simulates another device saving behind this page's back.
    writeRemote(nextState, nextSnapshot) {
      version += 1;
      state = JSON.parse(JSON.stringify(nextState));
      if (nextSnapshot) snapshot = JSON.parse(JSON.stringify(nextSnapshot));
      return version;
    },
    async getSession() {
      return signedIn ? { user: { id: "memory-owner" } } : null;
    },
    async signIn() {
      signedIn = true;
      listeners.forEach((listener) => listener("SIGNED_IN", { user: { id: "memory-owner" } }));
    },
    async signOut() {
      signedIn = false;
      listeners.forEach((listener) => listener("SIGNED_OUT", null));
    },
    onAuthChange(callback) {
      listeners.push(callback);
      return () => {
        listeners = listeners.filter((listener) => listener !== callback);
      };
    },
    cachedPublic() {
      return snapshot ? { version, snapshot, updatedAt: null } : null;
    }
  };
  return adapter;
}

module.exports = { createMemoryAdapter };
