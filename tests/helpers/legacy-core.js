"use strict";

// Cycles saved before the feedback program run the calendar-anchored wave.
// Tests of that behaviour build their fixtures through this wrapper, so they
// keep describing what an archived or not-yet-adopted cycle does.
const core = require("../../assets/js/plan-core.js");

module.exports = Object.assign({}, core, {
  createDefaultState(startDate) {
    const state = core.createDefaultState(startDate);
    delete state.activeCycle.programRevision;
    return state;
  }
});
