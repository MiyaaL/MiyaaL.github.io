(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PlanCore = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  var DAY_MS = 24 * 60 * 60 * 1000;
  var STATE_SCHEMA_VERSION = 3;
  var RECOVERY_PHASES = ["deload", "taper", "return"];
  var DEFAULT_TEMPLATE = [
    { id: "push-strength", weekday: 1, type: "push-strength", label: "推 · 强度" },
    { id: "pull", weekday: 2, type: "pull", label: "拉" },
    { id: "squat", weekday: 3, type: "squat", label: "蹲" },
    { id: "push-volume", weekday: 5, type: "push-volume", label: "推 · 容量" }
  ];
  var TYPE_LABELS = {
    "push-strength": "推 · 卧推强度",
    pull: "拉 · 负重引体",
    squat: "蹲 · 杠铃深蹲",
    "push-volume": "推 · 卧推容量"
  };
  var LIFT_LABELS = {
    bench: "杠铃卧推",
    pullup: "负重引体向上",
    squat: "杠铃深蹲"
  };
  var LEARNING_WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];
  var RPE_PERCENTAGES = {
    "10": [1, 0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739],
    "9.5": [0.978, 0.939, 0.907, 0.878, 0.85, 0.824, 0.799, 0.774, 0.751, 0.723],
    "9": [0.955, 0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707],
    "8.5": [0.939, 0.907, 0.878, 0.85, 0.824, 0.799, 0.774, 0.751, 0.723, 0.694],
    "8": [0.922, 0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68],
    "7.5": [0.907, 0.878, 0.85, 0.824, 0.799, 0.774, 0.751, 0.723, 0.694, 0.667],
    "7": [0.892, 0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68, 0.653],
    "6.5": [0.878, 0.85, 0.824, 0.799, 0.774, 0.751, 0.723, 0.694, 0.667, 0.64],
    "6": [0.863, 0.837, 0.811, 0.786, 0.762, 0.739, 0.707, 0.68, 0.653, 0.626]
  };
  var ACCESSORIES_BY_LIFT = {
    bench: {
      "push-strength": [
        exercise("站姿推举", 2, "6–8", 7.5, "2–3 分钟"),
        exercise("上斜哑铃卧推", 2, "8–10", 8, "2 分钟"),
        exercise("绳索下压", 2, "10–12", 8, "60–90 秒")
      ],
      "push-volume": [
        exercise("暂停卧推", 2, "5–6", 7, "2–3 分钟"),
        exercise("绳索下压", 2, "10–12", 8, "60–90 秒"),
        exercise("侧平举", 2, "12–15", 8, "60 秒")
      ]
    },
    pullup: {
      pull: [
        exercise("胸托划船", 3, "6–8", 8, "2 分钟"),
        exercise("面拉", 2, "12–15", 8, "60–90 秒"),
        exercise("哑铃弯举", 2, "8–12", 8, "60–90 秒")
      ]
    },
    squat: {
      squat: [
        exercise("罗马尼亚硬拉", 2, "6–8", 7.5, "2–3 分钟"),
        exercise("保加利亚分腿蹲", 2, "8–10 / 侧", 8, "2 分钟"),
        exercise("核心训练", 2, "8–12", 7.5, "60 秒")
      ]
    }
  };

  function exercise(name, sets, reps, rpe, rest) {
    return { name: name, sets: sets, reps: reps, rpe: rpe, rest: rest };
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function parseDate(value) {
    var parts = String(value).split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function isIsoDate(value) {
    var date = String(value || "");
    return /^\d{4}-\d{2}-\d{2}$/.test(date) && formatDate(parseDate(date)) === date;
  }

  function addDays(value, amount) {
    var date = value instanceof Date ? new Date(value.getTime()) : parseDate(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return formatDate(date);
  }

  function daysBetween(start, end) {
    return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
  }

  function isoWeekday(value) {
    var day = parseDate(value).getUTCDay();
    return day === 0 ? 7 : day;
  }

  function clamp(value, minimum, maximum) {
    return Math.min(maximum, Math.max(minimum, value));
  }

  function asNumber(value, fallback) {
    var number = Number(value);
    return Number.isFinite(number) ? number : fallback;
  }

  function roundLoad(value, increment) {
    var step = Math.max(0.25, asNumber(increment, 2.5));
    var rounded = Math.round(asNumber(value, 0) / step) * step;
    return Object.is(rounded, -0) ? 0 : rounded;
  }

  function todayInShanghai(now) {
    var date = now || new Date();
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(date);
    } catch (_) {
      return date.toISOString().slice(0, 10);
    }
  }

  function createDefaultState(startDate) {
    var start = startDate || todayInShanghai();
    return {
      schemaVersion: STATE_SCHEMA_VERSION,
      version: 0,
      updatedAt: null,
      preferences: {
        timezone: "Asia/Shanghai",
        locale: "zh-CN",
        unit: "kg",
        barbellIncrement: 2.5,
        pullupIncrement: 2.5,
        accessoryIncrement: 2.5,
        trainingTime: "19:00",
        durationMinutes: 90,
        reminderMinutes: 120
      },
      activeCycle: {
        id: "cycle-" + start,
        title: "推拉蹲 + 推",
        status: "draft",
        startDate: start,
        endDate: addDays(start, 83),
        requestedEndDate: null,
        priorities: ["bench", "squat"],
        experience: "advanced",
        bodyweightEntries: [],
        lifts: {
          bench: { label: LIFT_LABELS.bench, baseline1rm: null, current1rm: null, target1rm: null },
          pullup: { label: LIFT_LABELS.pullup, baseline1rm: null, current1rm: null, target1rm: null },
          squat: { label: LIFT_LABELS.squat, baseline1rm: null, current1rm: null, target1rm: null }
        },
        template: deepClone(DEFAULT_TEMPLATE),
        holidayOverrides: {},
        sessionOverrides: {},
        scheduleAdjustments: [],
        loadAdjustments: {},
        createdAt: new Date().toISOString()
      },
      archivedCycles: [],
      logs: {},
      learningPlans: [],
      activePlanId: null
    };
  }

  function createDefaultLearningPlan(startDate, endDate, options) {
    var settings = options || {};
    var start = startDate || todayInShanghai();
    var end = endDate || addDays(start, 27);
    var id = String(settings.id || ("learning-" + start + "-" + Date.now().toString(36)));
    var dailyTemplate = {};
    LEARNING_WEEKDAYS.forEach(function (weekday) {
      dailyTemplate[String(weekday)] = {
        title: settings.defaultTitle || "学习任务",
        objective: "",
        tasks: []
      };
    });
    return {
      id: id,
      type: "learning",
      title: String(settings.title || "学习计划"),
      objective: String(settings.objective || ""),
      startDate: start,
      endDate: end,
      status: "active",
      dailyTemplate: settings.dailyTemplate || dailyTemplate,
      dailyPlans: {},
      acceptanceCriteria: Array.isArray(settings.acceptanceCriteria)
        ? deepClone(settings.acceptanceCriteria)
        : [],
      logs: {},
      artifacts: [],
      createdAt: settings.createdAt || new Date().toISOString()
    };
  }

  function normalizeLearningPlan(input) {
    var fallback = createDefaultLearningPlan();
    var plan = Object.assign({}, fallback, deepClone(input || {}));
    plan.type = "learning";
    plan.id = String(plan.id || fallback.id);
    plan.title = String(plan.title || "学习计划");
    plan.objective = String(plan.objective || "");
    plan.status = ["draft", "active", "archived", "completed"].indexOf(plan.status) >= 0
      ? plan.status
      : "active";
    plan.dailyTemplate = Object.assign({}, fallback.dailyTemplate, plan.dailyTemplate || {});
    plan.dailyPlans = plan.dailyPlans && typeof plan.dailyPlans === "object" ? plan.dailyPlans : {};
    Object.keys(plan.dailyPlans).forEach(function (date) {
      var day = plan.dailyPlans[date] || {};
      plan.dailyPlans[date] = {
        title: String(day.title || "学习任务"),
        objective: String(day.objective || ""),
        tasks: Array.isArray(day.tasks)
          ? day.tasks.map(function (task) { return String(task).trim(); }).filter(Boolean)
          : String(day.tasks || "").split(/\n+/).map(function (task) { return task.trim(); }).filter(Boolean)
      };
    });
    LEARNING_WEEKDAYS.forEach(function (weekday) {
      var key = String(weekday);
      var item = plan.dailyTemplate[key] || {};
      plan.dailyTemplate[key] = {
        title: String(item.title || "学习任务"),
        objective: String(item.objective || ""),
        tasks: Array.isArray(item.tasks)
          ? item.tasks.map(function (task) { return String(task).trim(); }).filter(Boolean)
          : String(item.tasks || "").split(/\n+/).map(function (task) { return task.trim(); }).filter(Boolean)
      };
    });
    plan.acceptanceCriteria = (Array.isArray(plan.acceptanceCriteria) ? plan.acceptanceCriteria : [])
      .map(function (criterion, index) {
        if (typeof criterion === "string") {
          return { id: "criterion-" + (index + 1), title: criterion.trim(), description: "" };
        }
        return {
          id: String(criterion && criterion.id || "criterion-" + (index + 1)),
          title: String(criterion && criterion.title || "").trim(),
          description: String(criterion && criterion.description || "").trim()
        };
      }).filter(function (criterion) { return criterion.title; });
    plan.logs = plan.logs && typeof plan.logs === "object" ? plan.logs : {};
    plan.artifacts = Array.isArray(plan.artifacts) ? plan.artifacts : [];
    return plan;
  }

  function learningSessionId(plan, date) {
    return plan.id + ":day:" + date;
  }

  function generateLearningPlan(inputPlan) {
    var plan = normalizeLearningPlan(inputPlan);
    var sessions = [];
    var warnings = [];
    if (!isIsoDate(plan.startDate) || !isIsoDate(plan.endDate) || plan.endDate < plan.startDate) {
      return { plan: plan, cycle: plan, sessions: [], warnings: ["学习计划起止日期无效。"], totalDays: 0, completedDays: 0 };
    }
    var date = plan.startDate;
    while (date <= plan.endDate) {
      var template = Object.assign({}, plan.dailyTemplate[String(isoWeekday(date))] || {}, plan.dailyPlans[date] || {});
      var id = learningSessionId(plan, date);
      var log = plan.logs[id] || {};
      var snapshot = log.sessionSnapshot;
      var session = snapshot ? deepClone(snapshot) : {
        id: id,
        sourceDate: date,
        date: date,
        type: "learning",
        templateId: "weekday-" + isoWeekday(date),
        label: template.title || "学习任务",
        phase: { label: "学习日", key: "learning" },
        learning: {
          objective: template.objective || "",
          tasks: deepClone(template.tasks || []),
          acceptanceCriteria: deepClone(plan.acceptanceCriteria)
        }
      };
      session.status = log.status || "planned";
      session.learning = session.learning || {
        objective: "",
        tasks: [],
        acceptanceCriteria: deepClone(plan.acceptanceCriteria)
      };
      session.learning.objective = String(session.learning.objective || "");
      session.learning.tasks = Array.isArray(session.learning.tasks) ? session.learning.tasks : [];
      session.learning.acceptanceCriteria = deepClone(plan.acceptanceCriteria);
      session.log = log;
      sessions.push(session);
      date = addDays(date, 1);
    }
    var completedDays = sessions.filter(function (session) { return session.status === "completed"; }).length;
    if (!plan.acceptanceCriteria.length) {
      warnings.push("还没有设置验收成果；在计划设置中添加可交付成果会更容易复盘。");
    }
    return {
      plan: plan,
      cycle: plan,
      sessions: sessions,
      warnings: warnings,
      totalDays: sessions.length,
      completedDays: completedDays,
      completedCriteria: plan.acceptanceCriteria.filter(function (criterion) {
        return sessions.some(function (session) {
          return session.log && Array.isArray(session.log.criteria) && session.log.criteria.indexOf(criterion.id) >= 0;
        });
      }).length
    };
  }

  function isBodyweightDate(date) {
    return /^\d{4}-\d{2}-\d{2}$/.test(String(date || ""));
  }

  function isValidBodyweightEntry(date, value) {
    return isBodyweightDate(date) && value != null && value >= 30 && value <= 300;
  }

  function migrateLegacyBodyweights(cycle, logs) {
    if (!cycle || typeof cycle !== "object") {
      return;
    }

    var entries = Array.isArray(cycle.bodyweightEntries) ? cycle.bodyweightEntries : [];
    var datesWithEntries = Object.create(null);
    var addedEntry = false;
    cycle.bodyweightEntries = entries;
    entries.forEach(function (entry) {
      var date = String(entry && entry.date || "");
      if (isBodyweightDate(date)) {
        datesWithEntries[date] = true;
      }
    });

    Object.keys(logs || {}).forEach(function (id) {
      var log = logs[id];
      if (!log || typeof log !== "object" ||
          !Object.prototype.hasOwnProperty.call(log, "bodyweight")) {
        return;
      }

      var value = asNumber(log.bodyweight, null);
      var date = String(log.sessionSnapshot && log.sessionSnapshot.date || "");
      delete log.bodyweight;
      if (!isValidBodyweightEntry(date, value) || datesWithEntries[date]) {
        return;
      }

      entries.push({ date: date, value: value });
      datesWithEntries[date] = true;
      addedEntry = true;
    });

    if (addedEntry) {
      entries.sort(function (left, right) {
        return String(left.date).localeCompare(String(right.date));
      });
    }
  }

  function normalizeState(input) {
    var fallback = createDefaultState();
    var sourceSchemaVersion = Math.max(1, Math.floor(asNumber(input && input.schemaVersion, 1)));
    var state = deepClone(input || fallback);
    state.schemaVersion = STATE_SCHEMA_VERSION;
    state.version = Math.max(0, Math.floor(asNumber(state.version, 0)));
    state.preferences = Object.assign({}, fallback.preferences, state.preferences || {});
    state.activeCycle = Object.assign({}, fallback.activeCycle, state.activeCycle || {});
    state.activeCycle.lifts = Object.assign({}, fallback.activeCycle.lifts, state.activeCycle.lifts || {});
    Object.keys(fallback.activeCycle.lifts).forEach(function (key) {
      state.activeCycle.lifts[key] = Object.assign(
        {},
        fallback.activeCycle.lifts[key],
        state.activeCycle.lifts[key] || {}
      );
      if (state.activeCycle.lifts[key].baseline1rm == null ||
          state.activeCycle.lifts[key].baseline1rm === "" ||
          !Number.isFinite(Number(state.activeCycle.lifts[key].baseline1rm))) {
        state.activeCycle.lifts[key].baseline1rm = state.activeCycle.lifts[key].current1rm;
      }
      if (sourceSchemaVersion < STATE_SCHEMA_VERSION &&
          state.activeCycle.lifts[key].assessed1rm == null &&
          state.activeCycle.lifts[key].current1rm != null &&
          state.activeCycle.lifts[key].current1rm !== "" &&
          Number.isFinite(Number(state.activeCycle.lifts[key].current1rm))) {
        state.activeCycle.lifts[key].assessed1rm = Number(state.activeCycle.lifts[key].current1rm);
      }
    });
    state.activeCycle.template = Array.isArray(state.activeCycle.template) && state.activeCycle.template.length
      ? state.activeCycle.template
      : deepClone(DEFAULT_TEMPLATE);
    state.activeCycle.bodyweightEntries = Array.isArray(state.activeCycle.bodyweightEntries)
      ? state.activeCycle.bodyweightEntries
      : [];
    state.activeCycle.holidayOverrides = state.activeCycle.holidayOverrides || {};
    state.activeCycle.sessionOverrides = state.activeCycle.sessionOverrides || {};
    var legacyDeferrals = Array.isArray(state.activeCycle.scheduleDeferrals)
      ? state.activeCycle.scheduleDeferrals : [];
    var hasScheduleAdjustments = Boolean(input && input.activeCycle &&
      Array.isArray(input.activeCycle.scheduleAdjustments));
    var adjustmentSource = hasScheduleAdjustments
      ? state.activeCycle.scheduleAdjustments : legacyDeferrals;
    state.activeCycle.scheduleAdjustments = adjustmentSource.map(function (entry, index) {
      return {
        id: String(entry && entry.id || "schedule-adjustment-" + (index + 1)),
        sourceId: String(entry && entry.sourceId || ""),
        fromDate: String(entry && entry.fromDate || ""),
        days: Math.trunc(asNumber(entry && entry.days, 0)),
        restoredSkips: Array.isArray(entry && entry.restoredSkips)
          ? deepClone(entry.restoredSkips) : [],
        createdAt: entry && entry.createdAt ? String(entry.createdAt) : null
      };
    }).filter(function (entry) {
      return isIsoDate(entry.fromDate) && entry.days !== 0;
    });
    delete state.activeCycle.scheduleDeferrals;
    state.activeCycle.loadAdjustments = state.activeCycle.loadAdjustments || {};
    if (!state.activeCycle.requestedEndDate) {
      var legacyDeferredDays = legacyDeferrals.reduce(function (total, entry) {
        return total + Math.max(0, Math.floor(asNumber(entry && entry.days, 0)));
      }, 0);
      state.activeCycle.requestedEndDate = !hasScheduleAdjustments && legacyDeferredDays
        ? addDays(state.activeCycle.endDate, -legacyDeferredDays)
        : state.activeCycle.endDate;
    }
    state.activeCycle.priorities = Array.isArray(state.activeCycle.priorities)
      ? state.activeCycle.priorities.filter(function (key, index, keys) {
        return Boolean(LIFT_LABELS[key]) && keys.indexOf(key) === index;
      }) : ["bench", "squat"];
    if (!state.activeCycle.priorities.length) state.activeCycle.priorities = ["bench", "squat"];
    state.archivedCycles = Array.isArray(state.archivedCycles) ? state.archivedCycles : [];
    state.logs = state.logs || {};
    state.learningPlans = (Array.isArray(state.learningPlans) ? state.learningPlans : [])
      .map(normalizeLearningPlan);
    state.activePlanId = state.activePlanId && state.learningPlans.some(function (plan) {
      return plan.id === state.activePlanId;
    }) ? state.activePlanId : null;
    migrateLegacyBodyweights(state.activeCycle, state.logs);
    state.archivedCycles.forEach(function (archive) {
      if (!archive || typeof archive !== "object") {
        return;
      }
      archive.logs = archive.logs || {};
      if (archive.cycle) {
        archive.cycle.status = "archived";
      }
      migrateLegacyBodyweights(archive.cycle, archive.logs);
      if (archive.cycle && archive.overview && archive.overview.cycle) {
        archive.overview.cycle.status = "archived";
        archive.overview.cycle.bodyweightEntries = deepClone(archive.cycle.bodyweightEntries);
      }
    });
    return state;
  }

  function latestBodyweight(cycle, onOrBefore) {
    var entries = (cycle.bodyweightEntries || []).filter(function (entry) {
      return asNumber(entry.value, 0) > 0 && (!onOrBefore || entry.date <= onOrBefore);
    }).sort(function (left, right) {
      return String(left.date).localeCompare(String(right.date));
    });
    if (!entries.length) {
      return null;
    }

    var lastDate = entries[entries.length - 1].date;
    var cutoff = addDays(lastDate, -6);
    var recent = entries.filter(function (entry) {
      return entry.date >= cutoff && entry.date <= lastDate;
    });
    return recent.reduce(function (sum, entry) {
      return sum + Number(entry.value);
    }, 0) / recent.length;
  }

  function recordBodyweight(inputState, entry) {
    var state = normalizeState(inputState);
    var date = String(entry && entry.date || "");
    var value = asNumber(entry && entry.value, null);
    if (!isValidBodyweightEntry(date, value)) {
      throw new Error("invalid_bodyweight_entry");
    }
    state.activeCycle.bodyweightEntries = state.activeCycle.bodyweightEntries.filter(function (existing) {
      return existing.date !== date;
    });
    state.activeCycle.bodyweightEntries.push({ date: date, value: value });
    state.activeCycle.bodyweightEntries.sort(function (left, right) {
      return String(left.date).localeCompare(String(right.date));
    });
    return state;
  }

  // These are planning heuristics, not promises of physiological growth.
  // Measured capacity only changes from evidence. Goals never stand in for
  // demonstrated capacity when prescribing ordinary or recovery work.
  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
  }

  function isRecoveryPhase(phaseKey) {
    return RECOVERY_PHASES.indexOf(phaseKey) !== -1;
  }

  function suppressesLoadIncrease(phaseKey) {
    return isRecoveryPhase(phaseKey) || phaseKey === "assessment";
  }

  function cycleLogs(state, onOrBefore) {
    return Object.keys(state.logs).filter(function (id) {
      return id.indexOf(state.activeCycle.id + ":") === 0;
    }).map(function (id) { return state.logs[id]; }).filter(function (log) {
      return log.sessionSnapshot && (!onOrBefore || log.sessionSnapshot.date <= onOrBefore);
    }).sort(function (a, b) {
      return a.sessionSnapshot.date.localeCompare(b.sessionSnapshot.date) ||
        String(a.sessionSnapshot.id).localeCompare(String(b.sessionSnapshot.id));
    });
  }

  function performanceHistory(state, onOrBefore) {
    var result = { bench: [], squat: [], pullup: [] };
    cycleLogs(state, onOrBefore).forEach(function (log) {
      var session = log.sessionSnapshot;
      var key = session.workout && session.workout.liftKey;
      var phase = session.phase && session.phase.key;
      if (!result[key] || log.status !== "completed" || phase === "deload" || phase === "return") return;
      var bodyweight = key === "pullup" ? latestBodyweight(state.activeCycle, session.date) : 0;
      if (bodyweight == null) return;
      var sets = (log.mainSets || []).filter(function (set) {
        var weight = asNumber(set.weight, null);
        var validLoad = key === "pullup" ? weight != null && weight + bodyweight > 0 : weight > 0;
        return set.completed !== false && validLoad && set.reps >= 1 && set.reps <= 5 &&
          set.rpeSource === "actual" && set.rpe != null && set.rpe >= 7 && set.rpe <= 10;
      });
      if (!sets.length) return;
      var fewestReps = Math.min.apply(Math, sets.map(function (set) { return set.reps; }));
      var estimates = sets.filter(function (set) { return set.reps === fewestReps; }).map(function (set) {
        return estimateOneRepMax(Number(set.weight) + bodyweight, set.reps, set.rpe) - bodyweight;
      });
      var value = median(estimates);
      if (value + bodyweight <= 0) return;
      result[key].push({ date: session.date, value: value, bodyweight: bodyweight });
    });
    // Multiple sessions on one day are one observation, not independent evidence.
    Object.keys(result).forEach(function (key) {
      var days = {};
      result[key].forEach(function (entry) { days[entry.date] = entry; });
      result[key] = Object.keys(days).sort().map(function (date) { return days[date]; });
    });
    return result;
  }

  function refreshPerformance(state, onOrBefore) {
    var history = performanceHistory(state, onOrBefore);
    Object.keys(history).forEach(function (key) {
      var lift = state.activeCycle.lifts[key];
      var observations = history[key].filter(function (entry) {
        return !lift.assessedOn || entry.date > lift.assessedOn;
      });
      if (!observations.length) {
        if (lift.assessed1rm != null) lift.current1rm = Number(lift.assessed1rm);
        return;
      }
      var anchor = asNumber(lift.assessed1rm, asNumber(lift.baseline1rm, lift.current1rm));
      var recent = observations.slice(-3);
      var estimate = recent.length === 1
        ? anchor * 0.7 + recent[0].value * 0.3
        : median(recent.map(function (entry) { return entry.value; }));
      lift.current1rm = Math.round(estimate * 10) / 10;
    });
    return history;
  }

  function planningDate(state, options) {
    var logs = cycleLogs(state);
    return options && isIsoDate(options.asOfDate) ? options.asOfDate :
      (logs.length ? logs[logs.length - 1].sessionSnapshot.date : state.activeCycle.startDate);
  }

  function readyForTarget(state, history, key, asOfDate) {
    var lift = state.activeCycle.lifts[key];
    var offset = key === "pullup" ? latestBodyweight(state.activeCycle, asOfDate) : 0;
    if (offset == null || lift.target1rm == null || Number(lift.current1rm) + offset < (Number(lift.target1rm) + offset) * 0.98) return false;
    var entries = history[key].filter(function (entry) {
      return entry.date >= addDays(asOfDate, -28) && (!lift.assessedOn || entry.date > lift.assessedOn);
    });
    var logs = cycleLogs(state, asOfDate).filter(function (log) {
      return log.sessionSnapshot.workout && log.sessionSnapshot.workout.liftKey === key && (log.mainSets || []).length;
    });
    var latest = logs[logs.length - 1];
    if (latest && latest.mainSets.some(function (set) { return set.completed === false; })) return false;
    return entries.length >= 2 && entries.slice(-2).every(function (entry) {
      return entry.value + offset >= (Number(lift.target1rm) + offset) * 0.98;
    });
  }

  function adaptCycle(state, history, asOfDate) {
    var cycle = state.activeCycle;
    if (cycle.status === "archived" || cycle.status === "completed") return;
    var reference = cycle.requestedEndDate;
    var anchor = asOfDate < cycle.startDate ? cycle.startDate : asOfDate;
    var bodyweight = latestBodyweight(cycle, anchor);
    var readiness = {};
    var neededWeeks = 0;
    var configuredPriorities = 0;
    var allReady = true;
    cycle.priorities.forEach(function (key) {
      var lift = cycle.lifts[key];
      var offset = key === "pullup" ? bodyweight : 0;
      if (offset == null || lift.current1rm == null || lift.target1rm == null) {
        readiness[key] = false;
        allReady = false;
        return;
      }
      var current = Number(lift.current1rm) + offset;
      var target = Number(lift.target1rm) + offset;
      if (current <= 0 || target <= 0) {
        readiness[key] = false;
        allReady = false;
        return;
      }
      configuredPriorities += 1;
      var entries = history[key].filter(function (entry) { return entry.date >= addDays(anchor, -28); });
      var ready = readyForTarget(state, history, key, anchor);
      readiness[key] = ready;
      allReady = allReady && ready;
      var rate = 0.005;
      if (entries.length >= 2) {
        var first = entries[0], last = entries[entries.length - 1];
        var weeks = daysBetween(first.date, last.date) / 7;
        if (weeks >= 2) rate = clamp(Math.pow((last.value + offset) / (first.value + offset), 1 / weeks) - 1, 0.0025, 0.01);
      }
      neededWeeks = Math.max(neededWeeks, ready ? 2 : Math.max(2, Math.ceil(Math.log(Math.max(1, target / current)) / Math.log(1 + rate)) + 2));
    });
    var projected = configuredPriorities
      ? addDays(anchor, Math.min(52, neededWeeks) * 7)
      : null;
    var end = reference;
    var adjustmentDays = cycle.scheduleAdjustments.reduce(function (total, entry) {
      return total + entry.days;
    }, 0);
    end = addDays(end, adjustmentDays);
    // Never move a recorded workout outside its cycle or rewrite its date.
    cycleLogs(state).forEach(function (log) {
      if (log.status === "completed" && log.sessionSnapshot.date > end) {
        end = log.sessionSnapshot.date;
      }
    });
    var shift = daysBetween(reference, end);
    cycle.endDate = end;
    var reason = !configuredPriorities
      ? "优先目标尚未完整配置；计划仍按设定结束日期执行。"
      : (allReady
        ? "近期有效表现支持目标测试；计划仍按设定结束日期执行。"
        : (projected > reference
          ? "按当前能力估算，目标可能无法在设定周期内完成；计划仍按设定结束日期执行，不会自动延长。"
          : "计划按设定结束日期执行；每两周结合有效训练表现复评。"));
    if (neededWeeks > 52) {
      reason += "目标跨度较大，当前仅安排阶段评估，尚不预测达标日期。";
    }
    if (adjustmentDays) {
      reason += adjustmentDays > 0
        ? " 已手动顺延 " + adjustmentDays + " 天。"
        : " 已手动提前 " + Math.abs(adjustmentDays) + " 天。";
    }
    cycle.schedule = {
      assessedAt: anchor,
      shiftDays: shift,
      readiness: readiness,
      provisional: !allReady,
      reason: reason
    };
  }

  function accessoriesFor(liftKey, type, phase) {
    if (phase.key === "test" || phase.key === "assessment" || isRecoveryPhase(phase.key)) return [];
    var templates = ACCESSORIES_BY_LIFT[liftKey] || {};
    var items = deepClone(templates[type] || []);
    items.forEach(function (item) { item.liftKey = liftKey; });
    return items;
  }

  function compileHolidayCalendar(calendars, overrides) {
    var result = { off: {}, work: {}, periods: [] };
    (calendars || []).forEach(function (calendar) {
      (calendar.periods || []).forEach(function (period) {
        var normalized = {
          id: String(calendar.year) + ":" + period.id,
          name: period.name,
          daysOff: (period.daysOff || []).slice(),
          workdays: (period.workdays || []).slice()
        };
        result.periods.push(normalized);
        normalized.daysOff.forEach(function (date) {
          result.off[date] = { name: period.name, periodId: normalized.id, source: "official" };
        });
        normalized.workdays.forEach(function (date) {
          result.work[date] = { name: period.name + "调休", periodId: normalized.id, source: "official" };
        });
      });
    });

    Object.keys(overrides || {}).forEach(function (date) {
      var type = overrides[date];
      delete result.off[date];
      delete result.work[date];
      if (type === "off") {
        result.off[date] = { name: "自定义休息日", periodId: "override:" + date, source: "override" };
      } else if (type === "work") {
        result.work[date] = { name: "自定义训练日", periodId: "override:" + date, source: "override" };
      }
    });
    return result;
  }

  function sessionId(cycle, template, date) {
    var revision = cycle.replannedSchedule ? ":replan-" + cycle.replannedSchedule.revision : "";
    return cycle.id + ":" + template.id + revision + ":" + date;
  }

  function buildBaseSessions(cycle, holidays, warnings) {
    var sessions = [];
    var missed = {};
    var occupied = {};
    var date = cycle.replannedSchedule ? cycle.replannedSchedule.fromDate : cycle.startDate;
    var adjustmentDays = (cycle.scheduleAdjustments || []).reduce(function (total, entry) {
      return total + entry.days;
    }, 0);
    var sourceEndDate = addDays(cycle.endDate, -adjustmentDays);

    while (date <= sourceEndDate) {
      var weekday = isoWeekday(date);
      cycle.template.filter(function (item) {
        return Number(item.weekday) === weekday;
      }).forEach(function (template) {
        var session = {
          id: sessionId(cycle, template, date),
          sourceDate: date,
          date: date,
          templateId: template.id,
          type: template.type,
          label: template.label || TYPE_LABELS[template.type],
          holiday: null
        };
        if (holidays.off[date]) {
          var periodId = holidays.off[date].periodId;
          missed[periodId] = missed[periodId] || [];
          missed[periodId].push(session);
        } else if (!occupied[date]) {
          sessions.push(session);
          occupied[date] = session.id;
        } else {
          warnings.push("日期 " + date + " 存在多个周模板训练，只保留第一个。");
        }
      });
      date = addDays(date, 1);
    }

    holidays.periods.forEach(function (period) {
      var queue = (missed[period.id] || []).sort(byDate);
      queue.forEach(function (session) {
        var override = cycle.sessionOverrides[session.id] || {};
        if (override.action === "move" && override.date) {
          sessions.push(session);
          return;
        }
        warnings.push(
          session.sourceDate + " 的" + session.label + "因" + period.name + "跳过；官方补班日不自动安排补训。"
        );
      });
    });

    var customQueue = [];
    Object.keys(missed).filter(function (periodId) {
      return !holidays.periods.some(function (period) { return period.id === periodId; });
    }).forEach(function (periodId) {
      customQueue = customQueue.concat(missed[periodId]);
    });
    customQueue.sort(byDate);
    var customWorkdays = Object.keys(holidays.work).filter(function (workday) {
      return holidays.work[workday].source === "override" &&
        workday >= (cycle.replannedSchedule ? cycle.replannedSchedule.fromDate : cycle.startDate) &&
        workday <= sourceEndDate &&
        !occupied[workday];
    }).sort();

    customQueue.slice(0, customWorkdays.length).forEach(function (session, index) {
      session.date = customWorkdays[index];
      session.holiday = {
        name: "自定义调休",
        movedFrom: session.sourceDate,
        kind: "makeup"
      };
      sessions.push(session);
      occupied[session.date] = session.id;
    });
    customQueue.slice(customWorkdays.length).forEach(function (session) {
      warnings.push(session.sourceDate + " 的" + session.label + "因自定义休息日跳过，未找到可用调休工作日。");
    });

    return sessions;
  }

  function byDate(left, right) {
    return left.date.localeCompare(right.date) || left.id.localeCompare(right.id);
  }

  function applySessionOverrides(sessions, overrides, warnings) {
    var result = [];
    var occupied = {};
    sessions.forEach(function (session) {
      var override = overrides[session.id] || {};
      if (override.action === "skip") {
        return;
      }
      var next = Object.assign({}, session);
      if (override.action === "move" && override.date) {
        next.originalDate = session.date;
        next.date = override.date;
        next.manualMove = true;
      }
      if (override.label) {
        next.label = override.label;
      }
      if (occupied[next.date]) {
        warnings.push("日期 " + next.date + " 存在训练冲突：" + next.label + "。");
      } else {
        occupied[next.date] = next.id;
      }
      result.push(next);
    });
    return result.sort(byDate);
  }

  function applyScheduleAdjustments(sessions, adjustments, overrides) {
    var entries = adjustments || [];
    return sessions.map(function (session) {
      var next = Object.assign({}, session);
      var override = (overrides || {})[session.id] || {};
      var recordedAdjustmentCount = override.scheduleAdjustmentCount == null
        ? override.scheduleDeferralCount : override.scheduleAdjustmentCount;
      var firstAdjustment = override.action === "move"
        ? Math.max(0, Math.min(entries.length, Math.floor(asNumber(recordedAdjustmentCount, 0))))
        : 0;
      var adjustedDays = 0;
      next.programDate = next.date;
      entries.slice(firstAdjustment).forEach(function (entry) {
        if (next.date >= entry.fromDate) {
          if (!next.originalDate) next.originalDate = next.date;
          next.date = addDays(next.date, entry.days);
          adjustedDays += entry.days;
        }
      });
      if (adjustedDays) {
        next.adjustedDays = adjustedDays;
        next.manualScheduleAdjustment = true;
      }
      return next;
    }).sort(byDate);
  }

  function liftKeyForType(type) {
    if (type === "pull") {
      return "pullup";
    }
    if (type === "squat") {
      return "squat";
    }
    return "bench";
  }

  function phaseFor(session, cycle, totalWeeks, asOfDate) {
    var phaseDate = session.programDate || session.date;
    var weekIndex = Math.max(0, Math.floor(daysBetween(cycle.startDate, phaseDate) / 7));
    if (session.isReturn) {
      return { key: "return", label: "恢复训练", weekIndex: weekIndex, blockWeek: null };
    }
    if (session.isTest || session.isAssessment) {
      var plannedTest = daysBetween(asOfDate, session.date) > 21;
      return {
        key: session.isTest || plannedTest ? "test" : "assessment",
        label: session.isTest ? "目标测试" : (plannedTest ? "目标测试 · 计划" : "阶段评估 · 未就绪"),
        weekIndex: weekIndex, blockWeek: null
      };
    }
    var daysToTest = session.testDate ? daysBetween(session.date, session.testDate) : null;
    if (daysToTest != null && daysToTest > 0 && daysToTest <= 7) {
      return { key: "taper", label: "减量准备", weekIndex: weekIndex, blockWeek: null };
    }
    var blockWeek = session.trainingWeek == null ? weekIndex % 4 : session.trainingWeek % 4;
    if (blockWeek === 3) {
      return { key: "deload", label: "减量周", weekIndex: weekIndex, blockWeek: blockWeek };
    }
    return {
      key: "load-" + (blockWeek + 1),
      label: "递进第 " + (blockWeek + 1) + " 周",
      weekIndex: weekIndex,
      blockWeek: blockWeek
    };
  }

  function programmedOneRepMax(lift) {
    return asNumber(lift.current1rm, 0);
  }

  function makeWorkSet(label, sets, reps, loadKg, rpe, rest, percentage) {
    return {
      label: label,
      sets: sets,
      reps: reps,
      loadKg: loadKg,
      rpe: rpe,
      rest: rest,
      percentage: percentage
    };
  }

  function prescribedLoad(liftKey, oneRepMax, percentage, bodyweight, preferences) {
    if (liftKey === "pullup") {
      var totalLoad = Math.max(0, bodyweight + oneRepMax) * percentage;
      return roundLoad(totalLoad - bodyweight, preferences.pullupIncrement);
    }
    return Math.max(20, roundLoad(oneRepMax * percentage, preferences.barbellIncrement));
  }

  function workingSets(type, liftKey, phase, oneRepMax, targetOneRepMax, bodyweight, preferences) {
    var strength = type === "push-strength" || type === "squat";
    var load = function (percentage, useTarget) {
      return prescribedLoad(
        liftKey,
        useTarget ? targetOneRepMax : oneRepMax,
        percentage,
        bodyweight,
        preferences
      );
    };

    if (phase.key === "test") {
      var attempts = [
        makeWorkSet("尝试 1", 1, 1, load(0.9, true), 8, "4–5 分钟", 0.9),
        makeWorkSet("尝试 2 · 首把稳定后", 1, 1, load(0.95, true), 9, "5 分钟", 0.95),
        makeWorkSet("目标尝试 · 仍有余力时", 1, 1, load(1, true), 10, "5 分钟", 1)
      ];
      return attempts.filter(function (set, index) { return !index || set.loadKg > attempts[index - 1].loadKg; });
    }
    if (phase.key === "assessment") {
      return [makeWorkSet("评估组 · 不追求极限", 2, 3, load(0.8), 7, "3 分钟", 0.8)];
    }
    if (phase.key === "return") {
      return [makeWorkSet("恢复组 · 热身后可再下调", 2, 5, load(0.65), 6, "3 分钟", 0.65)];
    }

    if (phase.key === "taper") {
      if (type === "push-volume") {
        return [makeWorkSet("减量组", 3, 3, load(0.6), 6, "2 分钟", 0.6)];
      }
      return [makeWorkSet(strength ? "校准单次" : "校准三次", 1, strength ? 1 : 3, load(0.85), 7, "3 分钟", 0.85)];
    }

    if (phase.key === "deload") {
      return [makeWorkSet("减量组", 3, 5, load(0.625), 6, "2 分钟", 0.625)];
    }

    var week = phase.blockWeek;
    if (type === "push-volume") {
      var volume = [
        { sets: 4, reps: 8, percentage: 0.65, rpe: 7 },
        { sets: 5, reps: 6, percentage: 0.7, rpe: 7.5 },
        { sets: 5, reps: 5, percentage: 0.75, rpe: 8 }
      ][week];
      return [makeWorkSet("容量组", volume.sets, volume.reps, load(volume.percentage), volume.rpe, "2–3 分钟", volume.percentage)];
    }

    if (type === "pull") {
      var pullMain = [
        { sets: 4, reps: 6, percentage: 0.7 },
        { sets: 5, reps: 5, percentage: 0.75 },
        { sets: 5, reps: 4, percentage: 0.8 }
      ][week];
      return [makeWorkSet("主训练组", pullMain.sets, pullMain.reps, load(pullMain.percentage), 8, "2–3 分钟", pullMain.percentage)];
    }

    var main = [
      { sets: 4, reps: 5, percentage: 0.725 },
      { sets: 4, reps: 4, percentage: 0.775 },
      { sets: 5, reps: 3, percentage: 0.825 }
    ][week];
    return [makeWorkSet("主训练组", main.sets, main.reps, load(main.percentage), 8, "2–3 分钟", main.percentage)];
  }

  function warmupsFor(liftKey, workSets, preferences) {
    if (!workSets.length) {
      return [];
    }
    var workingLoad = workSets[0].loadKg;
    var increment = liftKey === "pullup" ? preferences.pullupIncrement : preferences.barbellIncrement;
    var result = [];

    if (liftKey === "pullup") {
      result.push({ label: "自重热身", sets: 1, reps: 5, loadKg: 0 });
      if (workingLoad > increment) {
        result.push({ label: "递增热身", sets: 1, reps: 3, loadKg: roundLoad(workingLoad * 0.5, increment) });
      }
      if (workingLoad > increment * 2) {
        result.push({ label: "递增热身", sets: 1, reps: 1, loadKg: roundLoad(workingLoad * 0.75, increment) });
      }
      return uniqueWarmups(result, workingLoad);
    }

    [
      { percentage: 0, reps: 8, fixed: 20 },
      { percentage: 0.4, reps: 5 },
      { percentage: 0.55, reps: 3 },
      { percentage: 0.7, reps: 2 },
      { percentage: 0.82, reps: 1 },
      { percentage: 0.92, reps: 1 }
    ].forEach(function (step) {
      var load = step.fixed || roundLoad(workingLoad * step.percentage, increment);
      if (load < workingLoad) {
        result.push({ label: load === 20 ? "空杆热身" : "递增热身", sets: 1, reps: step.reps, loadKg: Math.max(20, load) });
      }
    });
    return uniqueWarmups(result, workingLoad);
  }

  function uniqueWarmups(items, workingLoad) {
    var seen = {};
    return items.filter(function (item) {
      var key = String(item.loadKg);
      if (seen[key] || item.loadKg >= workingLoad) {
        return false;
      }
      seen[key] = true;
      return true;
    });
  }

  function workoutFor(session, state, phase, totalWeeks) {
    var cycle = state.activeCycle;
    var preferences = state.preferences;
    var liftKey = liftKeyForType(session.type);
    var lift = cycle.lifts[liftKey];
    var bodyweight = latestBodyweight(cycle);
    var offset = liftKey === "pullup" ? bodyweight : 0;
    var configured = lift.current1rm != null && lift.target1rm != null && offset != null &&
      Number(lift.current1rm) + offset > 0 && Number(lift.target1rm) + offset > 0;

    if (!configured) {
      return {
        liftKey: liftKey,
        mainExercise: LIFT_LABELS[liftKey],
        needsSetup: true,
        warmups: [],
        workSets: [],
        accessories: accessoriesFor(liftKey, session.type, phase)
      };
    }

    var planned = programmedOneRepMax(lift);
    var target = asNumber(lift.target1rm, planned);
    var workSets = workingSets(
      session.type,
      liftKey,
      phase,
      planned,
      target,
      bodyweight || 0,
      preferences
    );
    return {
      liftKey: liftKey,
      mainExercise: LIFT_LABELS[liftKey],
      needsSetup: false,
      planned1rm: Math.round(planned * 10) / 10,
      guidance: phase.key === "test"
        ? "计划按 90% → 95% → 目标逐级尝试，临近测试须确认近期表现；热身吃力时降重，任何卡顿或失败都结束加重。使用保护杆或可靠保护者。"
        : (phase.key === "assessment" ? "近期表现尚不支持目标测试，先按当前能力完成评估组；目标保持不变，待有效记录确认后再尝试。"
          : "训练重量依据当前估算 1RM，能力只由实际记录更新；目标 RPE 是上限，热身吃力时降重，未恢复时延长组间休息。"),
      warmups: warmupsFor(liftKey, workSets, preferences),
      workSets: workSets,
      accessories: accessoriesFor(liftKey, session.type, phase)
    };
  }

  function markTestSessions(sessions, state, history, asOfDate) {
    ["bench", "pullup", "squat"].forEach(function (key) {
      var candidates = sessions.filter(function (session) {
        return liftKeyForType(session.type) === key;
      });
      if (!candidates.length) return;
      var last = candidates[candidates.length - 1];
      candidates.forEach(function (session) { session.testDate = last.date; });
      var ready = readyForTarget(state, history, key, asOfDate);
      last.label = LIFT_LABELS[key] + " · 周期目标";
      // Goal attempts more than 21 days away are provisional, not confirmed tests.
      last.isTest = ready && daysBetween(asOfDate, last.date) <= 21 && last.date >= asOfDate;
      last.isAssessment = !last.isTest;
    });
  }

  function goalWarnings(state, totalWeeks) {
    var warnings = [];
    if (totalWeeks < 8) {
      warnings.push("计划少于 8 周，完整波浪周期会被压缩。");
    } else if (totalWeeks > 24) {
      warnings.push("计划超过 24 周，建议中途重新评估一次 1RM。");
    }

    if (state.activeCycle.schedule) warnings.push(state.activeCycle.schedule.reason);
    return warnings;
  }

  function applyNextAdjustments(sessions, state) {
    var cycle = state.activeCycle;
    var bodyweight = latestBodyweight(cycle) || 0;
    Object.keys(cycle.loadAdjustments || {}).forEach(function (liftKey) {
      var adjustment = cycle.loadAdjustments[liftKey];
      var candidate = sessions.filter(function (session) {
        return session.status === "planned" &&
          (!cycle.replannedSchedule || session.date >= cycle.replannedSchedule.fromDate) &&
          session.workout &&
          session.workout.liftKey === liftKey &&
          (adjustment.percentage < 0 || /^load-/.test(session.phase.key)) &&
          session.date > adjustment.afterDate;
      }).sort(byDate)[0];
      if (!candidate || !adjustment.percentage) {
        return;
      }
      var increment = liftKey === "pullup"
        ? state.preferences.pullupIncrement
        : state.preferences.barbellIncrement;
      candidate.workout.workSets.forEach(function (set) {
        if (liftKey === "pullup") {
          set.loadKg = roundLoad(
            (bodyweight + set.loadKg) * (1 + adjustment.percentage) - bodyweight,
            increment
          );
        } else {
          set.loadKg = Math.max(20, roundLoad(set.loadKg * (1 + adjustment.percentage), increment));
        }
      });
      candidate.workout.warmups = warmupsFor(liftKey, candidate.workout.workSets, state.preferences);
      candidate.workout.adjustment = deepClone(adjustment);
    });
  }

  function repetitionCeiling(value) {
    var matches = String(value || "").match(/\d+/g);
    if (!matches || !matches.length) {
      return null;
    }
    return Math.max.apply(Math, matches.map(Number));
  }

  function applyAccessoryProgression(sessions, state) {
    var history = Object.keys(state.logs).map(function (id) {
      return state.logs[id];
    }).filter(function (log) {
      return log.status === "completed" &&
        log.sessionSnapshot &&
        Array.isArray(log.accessories);
    }).sort(function (left, right) {
      return left.sessionSnapshot.date.localeCompare(right.sessionSnapshot.date);
    });

    sessions.forEach(function (session) {
      if (session.status !== "planned" || !session.workout || !session.workout.accessories ||
          (state.activeCycle.replannedSchedule && session.date < state.activeCycle.replannedSchedule.fromDate)) {
        return;
      }
      session.workout.accessories.forEach(function (accessory) {
        var previous = null;
        history.forEach(function (log) {
          if (log.sessionSnapshot.date >= session.date) {
            return;
          }
          var match = log.accessories.find(function (entry) {
            return entry.name === accessory.name && entry.completed !== false;
          });
          if (match) {
            previous = match;
          }
        });
        if (!previous || asNumber(previous.weight, 0) <= 0) {
          return;
        }
        var ceiling = repetitionCeiling(accessory.reps);
        var qualityConfirmed = previous.qualityConfirmed === true || previous.allSetsCompleted === true;
        var qualified = qualityConfirmed &&
          Number(previous.sets) >= accessory.sets && ceiling && Number(previous.reps) >= ceiling &&
          previous.rpe != null && Number(previous.rpe) <= accessory.rpe;
        var weight = Number(previous.weight);
        var step = Number(previous.incrementKg) > 0 ? Number(previous.incrementKg) : state.preferences.accessoryIncrement;
        var increase = qualified && step / weight <= 0.1 ? step : 0;
        accessory.loadKg = Math.round((weight + increase) * 10) / 10;
        accessory.progression = increase > 0 ? "全组达到上限且余力足够，下次加重" : "保持重量；全组达标后再按可用最小增量加重";
      });
    });
  }

  function generate(inputState, holidayCalendars, options) {
    var state = normalizeState(inputState);
    var cycle = state.activeCycle;
    var asOfDate = planningDate(state, options);
    var history = refreshPerformance(state, asOfDate);
    if (cycle.startDate && cycle.endDate && cycle.endDate >= cycle.startDate) adaptCycle(state, history, asOfDate);
    var warnings = [];
    if (!cycle.startDate || !cycle.endDate || cycle.endDate < cycle.startDate) {
      return { state: state, cycle: cycle, sessions: [], warnings: ["计划起止日期无效。"], totalWeeks: 0 };
    }

    var holidays = compileHolidayCalendar(holidayCalendars, cycle.holidayOverrides);
    var sessions = buildBaseSessions(cycle, holidays, warnings);
    if (cycle.replannedSchedule) {
      var recordedDates = {};
      cycleLogs(state).forEach(function (log) { recordedDates[log.sessionSnapshot.date] = true; });
      sessions = sessions.filter(function (session) {
        return !recordedDates[session.date] || Boolean(state.logs[session.id]);
      }).concat(deepClone(cycle.replannedSchedule.retainedSessions));
    }
    sessions = applySessionOverrides(sessions, cycle.sessionOverrides, warnings);
    sessions = applyScheduleAdjustments(sessions, cycle.scheduleAdjustments, cycle.sessionOverrides);
    var sessionMap = sessions.reduce(function (map, session) {
      map[session.id] = session;
      return map;
    }, {});
    Object.keys(state.logs).forEach(function (id) {
      var log = state.logs[id];
      if (id.indexOf(cycle.id + ":") !== 0 || !log.sessionSnapshot) {
        return;
      }
      if (!sessionMap[id]) {
        sessionMap[id] = deepClone(log.sessionSnapshot);
        sessions.push(sessionMap[id]);
      } else {
        Object.assign(sessionMap[id], deepClone(log.sessionSnapshot));
      }
      sessionMap[id].status = log.status;
    });
    sessions.sort(byDate);
    markTestSessions(sessions, state, history, asOfDate);

    var adjustmentDays = (cycle.scheduleAdjustments || []).reduce(function (total, entry) {
      return total + entry.days;
    }, 0);
    var programEndDate = addDays(cycle.endDate, -adjustmentDays);
    var totalWeeks = Math.max(1, Math.ceil((daysBetween(cycle.startDate, programEndDate) + 1) / 7));
    var previousDates = {};
    var trainingWeeks = {};
    sessions.forEach(function (session) {
      var log = state.logs[session.id];
      var key = liftKeyForType(session.type);
      var countsAsTraining = log ? log.status === "completed" : session.date >= asOfDate;
      if (countsAsTraining) {
        if (previousDates[key] && daysBetween(previousDates[key], session.date) > 10) {
          session.isReturn = true;
          session.isTest = false;
          trainingWeeks[session.type] = 0;
        }
        session.trainingWeek = trainingWeeks[session.type] || 0;
        trainingWeeks[session.type] = session.isReturn ? 0 : session.trainingWeek + 1;
        previousDates[key] = session.date;
        // A replan starts from the work actually performed, including a recent
        // recovery session, rather than replaying a wave from sparse log counts.
        if (cycle.replannedSchedule && log && log.status === "completed" &&
            session.date < cycle.replannedSchedule.fromDate) {
          var recordedPhase = log.sessionSnapshot.phase || {};
          if (recordedPhase.key === "deload" || recordedPhase.key === "return") {
            Object.keys(TYPE_LABELS).forEach(function (type) {
              if (liftKeyForType(type) === key) trainingWeeks[type] = 0;
            });
          } else if (/^load-[123]$/.test(recordedPhase.key)) {
            trainingWeeks[session.type] = Number(recordedPhase.key.slice(-1));
          }
        }
      }
      if (log && log.sessionSnapshot) {
        var frozen = deepClone(log.sessionSnapshot);
        Object.keys(frozen).forEach(function (key) {
          session[key] = frozen[key];
        });
      } else if (!(cycle.replannedSchedule && session.date < cycle.replannedSchedule.fromDate && session.workout)) {
        session.phase = phaseFor(session, cycle, totalWeeks, asOfDate);
        session.workout = workoutFor(session, state, session.phase, totalWeeks);
      }
      session.status = log && log.status ? log.status : "planned";
      delete session.programDate;
    });
    applyNextAdjustments(sessions, state);
    applyAccessoryProgression(sessions, state);

    warnings = goalWarnings(state, totalWeeks).concat(warnings);
    for (var year = Number(cycle.startDate.slice(0, 4)); year <= Number(cycle.endDate.slice(0, 4)); year += 1) {
      if (!(holidayCalendars || []).some(function (calendar) { return Number(calendar.year) === year; })) {
        warnings.push(year + " 年节假日数据尚未载入，暂按周模板排课；可在设置中覆盖休息日。");
      }
    }
    return {
      state: state,
      cycle: cycle,
      sessions: sessions,
      warnings: warnings,
      totalWeeks: totalWeeks,
      bodyweight: latestBodyweight(cycle),
      holidayCalendarAvailable: (holidayCalendars || []).some(function (calendar) {
        return Number(calendar.year) === Number(cycle.startDate.slice(0, 4));
      })
    };
  }

  function sessionMoveError(code, details) {
    var error = new Error(code);
    error.code = code;
    Object.keys(details || {}).forEach(function (key) {
      error[key] = details[key];
    });
    return error;
  }

  function replanRemaining(inputState, holidayCalendars, options) {
    var settings = options || {};
    var fromDate = String(settings.fromDate || "");
    var endDate = String(settings.endDate || "");
    var state = normalizeState(inputState);
    var cycle = state.activeCycle;
    if (!isIsoDate(fromDate) || !isIsoDate(endDate) || fromDate < cycle.startDate || endDate < fromDate) {
      throw sessionMoveError("invalid_replan_dates");
    }
    var template = deepClone(settings.template || cycle.template);
    var weekdays = {};
    if (!template.length || template.some(function (item) {
      var day = Number(item.weekday);
      if (!TYPE_LABELS[item.type] || day < 1 || day > 7 || day % 1 || weekdays[day]) return true;
      weekdays[day] = true;
      return false;
    })) throw sessionMoveError("invalid_replan_template");
    if (cycleLogs(state).some(function (log) { return log.sessionSnapshot.date > endDate; })) {
      throw sessionMoveError("replan_recorded_after_deadline");
    }

    var previous = generate(state, holidayCalendars, { asOfDate: settings.asOfDate });
    state = previous.state;
    cycle = state.activeCycle;
    var revision = cycle.replannedSchedule ? Number(cycle.replannedSchedule.revision) + 1 : 1;
    cycle.replannedSchedule = {
      fromDate: fromDate,
      revision: revision,
      retainedSessions: previous.sessions.filter(function (session) {
        return session.date < fromDate && !state.logs[session.id];
      }).map(deepClone)
    };
    cycle.requestedEndDate = endDate;
    cycle.endDate = endDate;
    cycle.scheduleAdjustments = [];
    cycle.sessionOverrides = {};
    cycle.schedule = null;
    cycle.template = template;
    cycle.holidayOverrides = deepClone(settings.holidayOverrides || cycle.holidayOverrides);
    if (settings.trainOnHolidays) {
      (holidayCalendars || []).forEach(function (calendar) {
        (calendar.periods || []).forEach(function (period) {
          (period.daysOff || []).forEach(function (date) {
            if (date >= fromDate && date <= endDate && cycle.holidayOverrides[date] !== "off") {
              cycle.holidayOverrides[date] = "work";
            }
          });
        });
      });
    }
    return state;
  }

  function moveSession(inputState, sourceId, targetDate, options) {
    var settings = options || {};
    var state = normalizeState(inputState);
    var date = String(targetDate || "");
    var plan = generate(state, settings.holidayCalendars || [], { asOfDate: settings.asOfDate });
    state = plan.state;
    var cycle = state.activeCycle;
    if (!isIsoDate(date) || date < cycle.startDate || date > cycle.endDate) {
      throw sessionMoveError("invalid_session_move_date", { date: date });
    }

    var source = plan.sessions.find(function (session) {
      return session.id === sourceId;
    });
    if (!source) {
      throw sessionMoveError("invalid_session_move_source", { sourceId: sourceId });
    }
    if (source.date === date) {
      return state;
    }

    var conflicts = plan.sessions.filter(function (session) {
      return session.id !== source.id && session.date === date;
    });
    var recordedConflicts = conflicts.filter(function (session) {
      return Boolean(state.logs[session.id]);
    });
    if (recordedConflicts.length) {
      throw sessionMoveError("session_move_recorded_target", {
        source: deepClone(source),
        date: date,
        conflicts: deepClone(recordedConflicts)
      });
    }
    if (conflicts.length && settings.replace !== true) {
      throw sessionMoveError("session_move_conflict", {
        source: deepClone(source),
        date: date,
        conflicts: deepClone(conflicts)
      });
    }

    conflicts.forEach(function (session) {
      state.activeCycle.sessionOverrides[session.id] = {
        action: "skip",
        replacedBy: source.id
      };
    });
    state.activeCycle.sessionOverrides[source.id] = {
      action: "move",
      date: date,
      scheduleAdjustmentCount: cycle.scheduleAdjustments.length
    };

    var log = state.logs[source.id];
    if (log && log.sessionSnapshot) {
      var previousDate = log.sessionSnapshot.date;
      log.sessionSnapshot.date = date;
      var liftKey = log.sessionSnapshot.workout && log.sessionSnapshot.workout.liftKey;
      var adjustment = liftKey && state.activeCycle.loadAdjustments[liftKey];
      if (adjustment && adjustment.afterDate === previousDate &&
          (!adjustment.updatedAt || !log.completedAt || adjustment.updatedAt === log.completedAt)) {
        adjustment.afterDate = date;
      }
    }

    return state;
  }

  function adjustSchedule(inputState, sourceId, targetDate, options) {
    if (inputState.activeCycle && inputState.activeCycle.replannedSchedule) {
      throw sessionMoveError("schedule_deadline_locked");
    }
    var settings = options || {};
    var state = normalizeState(inputState);
    var plan = generate(state, settings.holidayCalendars || [], { asOfDate: settings.asOfDate });
    state = plan.state;
    var cycle = state.activeCycle;
    var date = String(targetDate || "");
    var source = plan.sessions.find(function (session) {
      return session.id === sourceId;
    });
    if (!source || source.status === "completed") {
      throw sessionMoveError("invalid_schedule_adjust_source", { sourceId: sourceId });
    }
    var days = isIsoDate(date) ? daysBetween(source.date, date) : 0;
    if (!isIsoDate(date) || date < cycle.startDate || days === 0 || Math.abs(days) > 365) {
      throw sessionMoveError("invalid_schedule_adjust_date", { date: date });
    }

    var candidates = plan.sessions.filter(function (session) {
      return session.date >= source.date;
    });
    var recorded = candidates.filter(function (session) {
      var log = state.logs[session.id];
      return log && log.status !== "skipped";
    });
    if (recorded.length) {
      throw sessionMoveError("schedule_adjust_recorded_future", {
        source: deepClone(source),
        date: date,
        sessions: deepClone(recorded)
      });
    }

    if (days < 0) {
      var earlierSessions = plan.sessions.filter(function (session) {
        return session.date < source.date;
      });
      var previousSession = earlierSessions[earlierSessions.length - 1];
      if (previousSession && date <= previousSession.date) {
        throw sessionMoveError("schedule_adjust_conflict", {
          source: deepClone(source),
          date: date,
          sessions: [deepClone(previousSession)]
        });
      }
    }

    var restoredSkips = [];
    candidates.forEach(function (session) {
      var log = state.logs[session.id];
      if (log && log.status === "skipped") {
        restoredSkips.push({
          sessionId: session.id,
          notes: log.notes || "",
          recordedAt: log.completedAt || null
        });
        delete state.logs[session.id];
      }
    });
    cycle.scheduleAdjustments.push({
      id: "schedule-adjustment-" + Date.now().toString(36) + "-" + (cycle.scheduleAdjustments.length + 1),
      sourceId: source.id,
      fromDate: source.date,
      days: days,
      restoredSkips: restoredSkips,
      createdAt: new Date().toISOString()
    });
    cycle.endDate = addDays(cycle.endDate, days);
    cycle.schedule = null;
    return state;
  }

  function deferSessions(inputState, sourceId, targetDate, options) {
    return adjustSchedule(inputState, sourceId, targetDate, options);
  }

  function estimateOneRepMax(weight, reps, rpe) {
    var load = asNumber(weight, 0);
    var repetitions = Math.round(asNumber(reps, 0));
    if (load <= 0 || repetitions < 1) {
      return null;
    }
    if (rpe == null || rpe === "") {
      return load * (1 + repetitions / 30);
    }
    var roundedRpe = clamp(Math.round(asNumber(rpe, 10) * 2) / 2, 6, 10);
    var row = RPE_PERCENTAGES[String(roundedRpe)];
    if (!row || repetitions > row.length) {
      return load * (1 + repetitions / 30);
    }
    return load / row[repetitions - 1];
  }

  function suggestAdjustment(actualRpe, targetRpe, completed) {
    if (!completed) {
      return { percentage: -0.05, reason: "未完成规定次数" };
    }
    var difference = asNumber(actualRpe, targetRpe) - asNumber(targetRpe, 8);
    if (difference >= 1) {
      return { percentage: -0.025, reason: "实际 RPE 高于目标" };
    }
    if (difference <= -1) {
      return { percentage: 0.025, reason: "实际 RPE 低于目标" };
    }
    return { percentage: 0, reason: "表现符合计划" };
  }

  function restoreSkippedSession(inputState, sessionId) {
    var state = normalizeState(inputState);
    var id = String(sessionId || "");
    var log = state.logs[id];
    if (!log || log.status !== "skipped") {
      throw new Error("session_not_skipped");
    }
    delete state.logs[id];
    return state;
  }

  function restoreSkippedLearningSession(inputState, planId, sessionId) {
    var state = normalizeState(inputState);
    var plan = state.learningPlans.find(function (candidate) {
      return candidate.id === planId;
    });
    if (!plan) {
      throw new Error("learning_plan_not_found");
    }
    var log = plan.logs[String(sessionId || "")];
    if (!log || log.status !== "skipped") {
      throw new Error("learning_session_not_skipped");
    }
    log.status = "planned";
    delete log.completedAt;
    delete log.sessionSnapshot;
    return state;
  }

  function recordSession(inputState, session, log) {
    var state = normalizeState(inputState);
    var recordedLift = session.workout && session.workout.liftKey;
    if (recordedLift && state.activeCycle.lifts[recordedLift].assessed1rm == null) {
      var hasHistory = cycleLogs(state).some(function (entry) {
        return entry.sessionSnapshot.workout && entry.sessionSnapshot.workout.liftKey === recordedLift;
      });
      state.activeCycle.lifts[recordedLift].assessed1rm = hasHistory
        ? state.activeCycle.lifts[recordedLift].baseline1rm : state.activeCycle.lifts[recordedLift].current1rm;
    }
    var nextLog = {
      status: log.status || "completed",
      completedAt: log.completedAt || new Date().toISOString(),
      mainSets: (log.mainSets || []).map(function (set) {
        var hasActualRpe = set.rpe != null && set.rpe !== "";
        return {
          weight: asNumber(set.weight, null),
          reps: asNumber(set.reps, null),
          rpe: hasActualRpe ? asNumber(set.rpe, null) : null,
          rpeSource: hasActualRpe ? "actual" : null,
          completed: set.completed !== false
        };
      }),
      accessories: deepClone(log.accessories || []),
      notes: String(log.notes || "").slice(0, 2000),
      sessionSnapshot: {
        id: session.id,
        sourceDate: session.sourceDate,
        date: session.date,
        templateId: session.templateId,
        type: session.type,
        label: session.label,
        holiday: deepClone(session.holiday),
        phase: deepClone(session.phase),
        workout: deepClone(session.workout),
        isTest: Boolean(session.isTest)
      }
    };
    state.logs[session.id] = nextLog;

    var liftKey = session.workout && session.workout.liftKey;
    var previousAdjustment = state.activeCycle.loadAdjustments[liftKey];
    if (liftKey && nextLog.mainSets.length && (!previousAdjustment || session.date >= previousAdjustment.afterDate)) {
      var targets = [];
      (session.workout.workSets || []).forEach(function (set) {
        for (var i = 0; i < set.sets; i += 1) targets.push(set.rpe);
      });
      var differences = nextLog.mainSets.map(function (set, index) {
        return set.rpe == null || targets[index] == null ? null : set.rpe - targets[index];
      });
      var failed = nextLog.mainSets.some(function (set) { return !set.completed; });
      var hard = differences.some(function (value) { return value != null && value >= 1; });
      var easy = differences.length && differences.every(function (value) { return value != null && value <= -1; });
      var light = suppressesLoadIncrease(session.phase && session.phase.key);
      var percentage = failed ? -0.05 : (hard ? -0.025 : (easy && !light ? 0.025 : 0));
      state.activeCycle.loadAdjustments[liftKey] = {
        percentage: percentage,
        reason: failed ? "未完成规定次数" : (hard ? "实际 RPE 超出对应组目标" : (easy && !light ? "各组均有充足余力" : "保持当前负荷")),
        afterDate: session.date,
        updatedAt: nextLog.completedAt
      };
    }
    refreshPerformance(state);

    return state;
  }

  function recordLearningSession(inputState, planId, session, log) {
    var state = normalizeState(inputState);
    var plan = state.learningPlans.find(function (candidate) { return candidate.id === planId; });
    if (!plan) {
      throw new Error("learning_plan_not_found");
    }
    var source = session || {};
    var nextLog = {
      status: log && log.status || "completed",
      completedAt: log && log.completedAt || new Date().toISOString(),
      reflection: String(log && (log.reflection != null ? log.reflection : log.notes) || "").slice(0, 10000),
      notes: String(log && log.notes || "").slice(0, 2000),
      criteria: Array.isArray(log && log.criteria) ? log.criteria.map(String) : [],
      artifacts: Array.isArray(log && log.artifacts) ? deepClone(log.artifacts).slice(0, 12) : [],
      dailyPlan: log && log.dailyPlan ? deepClone(log.dailyPlan) : null,
      sessionSnapshot: {
        id: source.id,
        sourceDate: source.sourceDate || source.date,
        date: source.date,
        templateId: source.templateId,
        type: "learning",
        label: source.label || "学习任务",
        phase: deepClone(source.phase || { label: "学习日", key: "learning" }),
        learning: deepClone(source.learning || {})
      }
    };
    if (nextLog.dailyPlan) {
      plan.dailyPlans[source.date] = {
        title: String(nextLog.dailyPlan.title || source.label || "学习任务"),
        objective: String(nextLog.dailyPlan.objective || ""),
        tasks: Array.isArray(nextLog.dailyPlan.tasks) ? nextLog.dailyPlan.tasks.map(String).filter(Boolean) : []
      };
      nextLog.sessionSnapshot.learning = Object.assign({}, nextLog.sessionSnapshot.learning, {
        objective: plan.dailyPlans[source.date].objective,
        tasks: deepClone(plan.dailyPlans[source.date].tasks)
      });
    }
    plan.logs[source.id] = nextLog;
    nextLog.artifacts.forEach(function (artifact) {
      if (!artifact || !artifact.id) {
        return;
      }
      var exists = plan.artifacts.some(function (existing) { return existing.id === artifact.id; });
      if (!exists) {
        plan.artifacts.push(deepClone(artifact));
      }
    });
    plan.artifacts = plan.artifacts.slice(-50);
    state.activePlanId = plan.id;
    return state;
  }

  function createLearningPublicSnapshot(inputState) {
    var state = normalizeState(inputState);
    return state.learningPlans.map(function (inputPlan) {
      var generated = generateLearningPlan(inputPlan);
      return {
        id: inputPlan.id,
        type: "learning",
        title: inputPlan.title,
        objective: inputPlan.objective,
        status: inputPlan.status,
        startDate: inputPlan.startDate,
        endDate: inputPlan.endDate,
        acceptanceCriteria: deepClone(inputPlan.acceptanceCriteria),
        sessions: generated.sessions.map(function (session) {
          return {
            id: session.id,
            date: session.date,
            sourceDate: session.sourceDate,
            type: "learning",
            label: session.label,
            status: session.status,
            phase: deepClone(session.phase),
            learning: {
              objective: session.learning.objective,
              tasks: deepClone(session.learning.tasks)
            }
          };
        }),
        totalDays: generated.totalDays,
        completedDays: generated.completedDays
      };
    });
  }

  function publicWorkout(workout) {
    var result = {
      liftKey: workout.liftKey,
      mainExercise: workout.mainExercise,
      needsSetup: workout.needsSetup,
      planned1rm: workout.planned1rm,
      guidance: workout.guidance,
      warmups: deepClone(workout.warmups),
      workSets: deepClone(workout.workSets),
      accessories: deepClone(workout.accessories)
    };
    if (result.liftKey === "pullup") {
      result.loadVisibility = "owner";
      result.warmups.forEach(function (set) { delete set.loadKg; });
      result.workSets.forEach(function (set) { delete set.loadKg; });
    }
    return result;
  }

  function createPublicSnapshot(inputState, generated) {
    var state = normalizeState(inputState);
    var plan = generated || generate(state, []);
    var cycle = plan.cycle;
    return {
      schemaVersion: 2,
      version: state.version,
      updatedAt: state.updatedAt,
      cycle: {
        id: cycle.id,
        title: cycle.title,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
        requestedEndDate: cycle.requestedEndDate,
        priorities: deepClone(cycle.priorities),
        schedule: deepClone(cycle.schedule),
        lifts: {
          bench: deepClone(cycle.lifts.bench),
          pullup: deepClone(cycle.lifts.pullup),
          squat: deepClone(cycle.lifts.squat)
        }
      },
      totalWeeks: plan.totalWeeks,
      sessions: plan.sessions.map(function (session) {
        return {
          id: session.id,
          date: session.date,
          sourceDate: session.sourceDate,
          type: session.type,
          label: session.label,
          status: session.status,
          holiday: deepClone(session.holiday),
          phase: deepClone(session.phase),
          workout: publicWorkout(session.workout)
        };
      }),
      learningPlans: createLearningPublicSnapshot(state)
    };
  }

  function filterLegacyOfficialMakeups(sessions, holidayCalendars) {
    return (sessions || []).filter(function (session) {
      if (session.status !== "planned" ||
          !session.holiday ||
          session.holiday.kind !== "makeup") {
        return true;
      }
      var isOfficialMakeup = (holidayCalendars || []).some(function (calendar) {
        return (calendar.periods || []).some(function (period) {
          return session.holiday.name === period.name &&
            (period.daysOff || []).indexOf(session.sourceDate) !== -1 &&
            (period.workdays || []).indexOf(session.date) !== -1;
        });
      });
      return !isOfficialMakeup;
    });
  }

  function escapeIcs(value) {
    return String(value || "")
      .replace(/\\/g, "\\\\")
      .replace(/\n/g, "\\n")
      .replace(/,/g, "\\,")
      .replace(/;/g, "\\;");
  }

  function compactDate(date) {
    return String(date).replace(/-/g, "");
  }

  function addMinutesToClock(clock, minutes) {
    var parts = String(clock || "19:00").split(":").map(Number);
    var total = parts[0] * 60 + parts[1] + minutes;
    var hours = Math.floor(total / 60) % 24;
    var mins = total % 60;
    return String(hours).padStart(2, "0") + String(mins).padStart(2, "0");
  }

  function compactClock(clock) {
    return String(clock || "19:00").replace(":", "") + "00";
  }

  function generateIcs(generated, preferences) {
    var prefs = Object.assign({
      timezone: "Asia/Shanghai",
      trainingTime: "19:00",
      durationMinutes: 90,
      reminderMinutes: 120
    }, preferences || {});
    var endTime = addMinutesToClock(prefs.trainingTime, prefs.durationMinutes);
    var lines = [
      "BEGIN:VCALENDAR",
      "VERSION:2.0",
      "PRODID:-//MiyaaL//Plan//ZH-CN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:MiyaaL " + (generated && generated.cycle && generated.cycle.type === "learning" ? "学习计划" : "健身计划"),
      "X-WR-TIMEZONE:" + prefs.timezone
    ];

    (generated.sessions || []).forEach(function (session) {
      var main = session.workout && session.workout.mainExercise ? session.workout.mainExercise : session.label;
      var work = session.workout && session.workout.workSets ? session.workout.workSets.map(function (set) {
        var load = Object.prototype.hasOwnProperty.call(set, "loadKg")
          ? " @ " + formatLoad(set.loadKg, session.workout.liftKey)
          : "";
        return set.label + " " + set.sets + "×" + set.reps + load;
      }).join("；") : "";
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + escapeIcs(session.id) + "@miyaal.github.io");
      lines.push("DTSTART;TZID=" + prefs.timezone + ":" + compactDate(session.date) + "T" + compactClock(prefs.trainingTime));
      lines.push("DTEND;TZID=" + prefs.timezone + ":" + compactDate(session.date) + "T" + compactClock(endTime));
      lines.push("SUMMARY:" + escapeIcs(session.label + " · " + main));
      lines.push("DESCRIPTION:" + escapeIcs(work));
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-PT" + Math.max(0, prefs.reminderMinutes) + "M");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:" + escapeIcs("训练提醒：" + session.label));
      lines.push("END:VALARM");
      lines.push("END:VEVENT");
    });
    lines.push("END:VCALENDAR");
    return lines.join("\r\n") + "\r\n";
  }

  function formatLoad(value, liftKey) {
    var load = asNumber(value, 0);
    if (liftKey === "pullup") {
      if (load > 0) {
        return "额外 +" + load + " kg";
      }
      if (load < 0) {
        return "辅助 " + Math.abs(load) + " kg";
      }
      return "自重";
    }
    return load + " kg";
  }

  return {
    DEFAULT_TEMPLATE: deepClone(DEFAULT_TEMPLATE),
    TYPE_LABELS: deepClone(TYPE_LABELS),
    LIFT_LABELS: deepClone(LIFT_LABELS),
    createDefaultState: createDefaultState,
    createDefaultLearningPlan: createDefaultLearningPlan,
    normalizeLearningPlan: normalizeLearningPlan,
    generateLearningPlan: generateLearningPlan,
    normalizeState: normalizeState,
    generate: generate,
    replanRemaining: replanRemaining,
    moveSession: moveSession,
    adjustSchedule: adjustSchedule,
    deferSessions: deferSessions,
    recordSession: recordSession,
    recordLearningSession: recordLearningSession,
    restoreSkippedSession: restoreSkippedSession,
    restoreSkippedLearningSession: restoreSkippedLearningSession,
    recordBodyweight: recordBodyweight,
    estimateOneRepMax: estimateOneRepMax,
    suggestAdjustment: suggestAdjustment,
    createPublicSnapshot: createPublicSnapshot,
    createLearningPublicSnapshot: createLearningPublicSnapshot,
    filterLegacyOfficialMakeups: filterLegacyOfficialMakeups,
    generateIcs: generateIcs,
    roundLoad: roundLoad,
    formatLoad: formatLoad,
    addDays: addDays,
    daysBetween: daysBetween,
    isoWeekday: isoWeekday,
    latestBodyweight: latestBodyweight
  };
}));
