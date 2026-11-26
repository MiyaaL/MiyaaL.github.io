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
  // A deadline can demand a jump the body cannot make. Prescriptions follow the
  // straight line to the goal only while it stays within this weekly gain of the
  // starting capacity; the goal itself still stands on the test days.
  var MAX_WEEKLY_GAIN_RATE = 0.01;
  // Cycles created or adopted under this revision close the loop between
  // logged performance and the next prescription. Older cycles keep the
  // calendar-only wave so archived plans regenerate exactly as they were run.
  var FEEDBACK_PROGRAM = "feedback-v2";
  // Loads never assume more than this margin over the measured capacity.
  var READINESS_CAP = 1.03;
  var GOAL_RATE_WARNING = 0.005;
  var DEFAULT_TEMPLATE = [
    { id: "push-strength", weekday: 1, type: "push-strength", label: "Push · Strength" },
    { id: "pull", weekday: 2, type: "pull", label: "Pull" },
    { id: "squat", weekday: 3, type: "squat", label: "Squat · Strength" },
    { id: "push-volume", weekday: 5, type: "push-volume", label: "Push · Volume" },
    { id: "squat-volume", weekday: 6, type: "squat-volume", label: "Squat · Volume" }
  ];
  var TYPE_LABELS = {
    "push-strength": "Push · Bench strength",
    pull: "Pull · Weighted pull-up",
    squat: "Squat · Back squat strength",
    "push-volume": "Push · Bench volume",
    "squat-volume": "Squat · Back squat volume"
  };
  // Keep a cycle's volume scheme explicit so new prescriptions never silently
  // rewrite older cycles. Both volume days omit the strength-day top single.
  var MODERATE_VOLUME_PRESCRIPTION = "moderate-volume-v1";
  var VOLUME_TYPES = { "push-volume": true, "squat-volume": true };
  var LIFT_LABELS = {
    bench: "Bench press",
    pullup: "Weighted pull-up",
    squat: "Back squat"
  };
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
        exercise("Overhead press", 2, "6–8", 7.5, "2–3 min"),
        exercise("Incline dumbbell press", 2, "8–10", 8, "2 min"),
        exercise("Cable pushdown", 2, "10–12", 8, "60–90 s")
      ],
      "push-volume": [
        exercise("Paused bench press", 2, "5–6", 7, "2–3 min"),
        exercise("Cable pushdown", 2, "10–12", 8, "60–90 s"),
        exercise("Lateral raise", 2, "12–15", 8, "60 s")
      ]
    },
    pullup: {
      pull: [
        exercise("Chest-supported row", 3, "6–8", 8, "2 min"),
        exercise("Face pull", 2, "12–15", 8, "60–90 s"),
        exercise("Dumbbell curl", 2, "8–12", 8, "60–90 s")
      ]
    },
    squat: {
      squat: [
        exercise("Romanian deadlift", 2, "6–8", 7.5, "2–3 min"),
        exercise("Bulgarian split squat", 2, "8–10 / side", 8, "2 min"),
        exercise("Core work", 2, "8–12", 7.5, "60 s")
      ],
      "squat-volume": [
        exercise("Leg curl", 2, "10–12", 8, "90 s"),
        exercise("Leg extension", 2, "10–12", 8, "90 s"),
        exercise("Core work", 2, "10–12", 7.5, "60 s")
      ]
    }
  };
  // Saved logs, archived cycles and the published snapshot still carry the
  // Chinese copy the page used to ship; translate it when it is displayed.
  var LEGACY_TEXT = {
    "推 · 强度": "Push · Strength", "拉": "Pull", "蹲 · 强度": "Squat · Strength",
    "推 · 容量": "Push · Volume", "蹲 · 容量": "Squat · Volume",
    "推 · 卧推强度": "Push · Bench strength", "拉 · 负重引体": "Pull · Weighted pull-up",
    "蹲 · 杠铃深蹲强度": "Squat · Back squat strength", "推 · 卧推容量": "Push · Bench volume",
    "蹲 · 杠铃深蹲容量": "Squat · Back squat volume",
    "杠铃卧推": "Bench press", "负重引体向上": "Weighted pull-up", "杠铃深蹲": "Back squat",
    "站姿推举": "Overhead press", "上斜哑铃卧推": "Incline dumbbell press", "绳索下压": "Cable pushdown",
    "暂停卧推": "Paused bench press", "侧平举": "Lateral raise", "胸托划船": "Chest-supported row",
    "面拉": "Face pull", "哑铃弯举": "Dumbbell curl", "罗马尼亚硬拉": "Romanian deadlift",
    "保加利亚分腿蹲": "Bulgarian split squat", "核心训练": "Core work", "腿弯举": "Leg curl",
    "腿屈伸": "Leg extension",
    "目标测试": "Goal test", "测试周开把": "Test-week opener", "减量周": "Deload week",
    "尝试 1": "Attempt 1", "尝试 2 · 首把稳定后": "Attempt 2 · if the opener was solid",
    "目标尝试 · 仍有余力时": "Goal attempt · only with room to spare",
    "减量组": "Deload sets", "开把单次": "Opener single", "确认组": "Confirmation sets",
    "容量组 · 余力 2–3 次": "Volume sets · 2–3 reps in reserve", "容量组": "Volume sets",
    "非极限顶组": "Submaximal top single", "主训练组": "Main work sets",
    "递增热身": "Ramp-up", "自重热身": "Bodyweight warm-up", "空杆热身": "Empty-bar warm-up",
    "自定义调休": "Custom make-up day", "自定义休息日": "Custom rest day", "自定义训练日": "Custom training day",
    "元旦": "New Year's Day", "春节": "Spring Festival", "清明节": "Qingming Festival",
    "劳动节": "Labour Day", "端午节": "Dragon Boat Festival", "中秋节": "Mid-Autumn Festival",
    "国庆节": "National Day", "国庆节、中秋节": "National Day and Mid-Autumn Festival",
    "推拉蹲 + 推": ""
  };
  var LEGACY_GUIDANCE = "计划按 90% → 95% → 目标逐级尝试";
  var LEGACY_REASON = "按日历周执行";

  function localize(value) {
    if (typeof value !== "string" || !/[㐀-鿿]/.test(value)) {
      return value;
    }
    if (Object.prototype.hasOwnProperty.call(LEGACY_TEXT, value)) {
      return LEGACY_TEXT[value];
    }
    var match = value.match(/^递进第 (\d+) 周$/);
    if (match) return "Build week " + match[1];
    match = value.match(/^(.+) · 周期目标$/);
    if (match) return localize(match[1]) + " · Goal test";
    match = value.match(/^(.+)调休$/);
    if (match) return localize(match[1]) + " make-up day";
    match = value.match(/^(.+?) ?分钟$/);
    if (match) return match[1] + " min";
    match = value.match(/^(.+?) ?秒$/);
    if (match) return match[1] + " s";
    match = value.match(/^(.+) \/ 侧$/);
    if (match) return match[1] + " / side";
    if (value.indexOf(LEGACY_GUIDANCE) === 0) return TEST_GUIDANCE_LEGACY;
    if (value.indexOf(LEGACY_REASON) === 0) {
      var shift = value.match(/已手动(顺延|提前) (\d+) 天/);
      return LEGACY_SCHEDULE_REASON + (shift
        ? " Manually moved " + (shift[1] === "顺延" ? "back" : "forward") + " by " + shift[2] + " days."
        : "");
    }
    return value;
  }

  var TEST_GUIDANCE_LEGACY = "Work up 90 % → 95 % → goal. Confirm recent form before test day, drop the load " +
    "if the warm-ups feel heavy, and stop adding weight after any grind or miss. Use safeties or a reliable spotter.";
  var LEGACY_SCHEDULE_REASON = "Three build weeks then a deload on calendar weeks; the training reference " +
    "rises linearly toward the goal and measured strength is tracked separately.";
  var FEEDBACK_SCHEDULE_REASON = "Three build weeks then a deload, counted back from each lift's goal test. " +
    "Loads follow the programmed line; missed or failed sessions change it only when you choose to adjust the plan.";

  function localizeSets(items) {
    (items || []).forEach(function (item) {
      if (!item) return;
      ["label", "name", "rest", "reps"].forEach(function (field) {
        if (typeof item[field] === "string") item[field] = localize(item[field]);
      });
    });
  }

  function localizeSession(session) {
    if (!session) return session;
    session.label = localize(session.label);
    if (session.phase) session.phase.label = localize(session.phase.label);
    if (session.holiday) session.holiday.name = localize(session.holiday.name);
    var workout = session.workout;
    if (workout) {
      workout.mainExercise = localize(workout.mainExercise);
      if (workout.guidance) workout.guidance = localize(workout.guidance);
      localizeSets(workout.workSets);
      localizeSets(workout.warmups);
      localizeSets(workout.accessories);
      if (workout.secondary) localizeSets(workout.secondary.workSets);
    }
    return session;
  }

  function templateTitle(template) {
    var items = Array.isArray(template) && template.length ? template : DEFAULT_TEMPLATE;
    var groups = [];
    items.slice().sort(function (left, right) {
      return Number(left.weekday) - Number(right.weekday);
    }).forEach(function (item) {
      var group = item.type === "pull" ? "Pull" : (liftKeyForType(item.type) === "squat" ? "Squat" : "Push");
      if (groups.indexOf(group) < 0) groups.push(group);
    });
    return groups.join(" / ") + " · " + items.length + (items.length === 1 ? " session" : " sessions") + " per week";
  }

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
        locale: "en",
        unit: "kg",
        barbellIncrement: 2.5,
        pullupIncrement: 2.5,
        trainingTime: "19:00",
        durationMinutes: 90,
        reminderMinutes: 120
      },
      activeCycle: {
        id: "cycle-" + start,
        title: templateTitle(DEFAULT_TEMPLATE),
        status: "draft",
        startDate: start,
        endDate: addDays(start, 83),
        requestedEndDate: null,
        volumePrescription: MODERATE_VOLUME_PRESCRIPTION,
        programRevision: FEEDBACK_PROGRAM,
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
        createdAt: new Date().toISOString()
      },
      archivedCycles: [],
      logs: {}
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
    // Old stored cycles predate this opt-in. Merging the new default alone
    // would otherwise replace all their unrecorded volume prescriptions.
    var sourceCycle = input ? input.activeCycle || {} : fallback.activeCycle;
    state.activeCycle.volumePrescription = sourceCycle.volumePrescription === MODERATE_VOLUME_PRESCRIPTION
      ? MODERATE_VOLUME_PRESCRIPTION : "legacy";
    if (!isIsoDate(state.activeCycle.volumePrescriptionFromDate)) {
      delete state.activeCycle.volumePrescriptionFromDate;
    }
    state.activeCycle.programRevision = sourceCycle.programRevision === FEEDBACK_PROGRAM
      ? FEEDBACK_PROGRAM : "legacy";
    if (!isIsoDate(state.activeCycle.programRevisionFromDate)) {
      delete state.activeCycle.programRevisionFromDate;
    }
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
    localizeCycle(state.activeCycle);
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
    if (!state.activeCycle.requestedEndDate) {
      var legacyDeferredDays = legacyDeferrals.reduce(function (total, entry) {
        return total + Math.max(0, Math.floor(asNumber(entry && entry.days, 0)));
      }, 0);
      state.activeCycle.requestedEndDate = !hasScheduleAdjustments && legacyDeferredDays
        ? addDays(state.activeCycle.endDate, -legacyDeferredDays)
        : state.activeCycle.endDate;
    }
    state.archivedCycles = Array.isArray(state.archivedCycles) ? state.archivedCycles : [];
    state.logs = state.logs || {};
    delete state.activeCycle.loadAdjustments;
    delete state.activeCycle.priorities;
    delete state.activeCycle.experience;
    delete state.preferences.accessoryIncrement;
    migrateLegacyBodyweights(state.activeCycle, state.logs);
    state.archivedCycles.forEach(function (archive) {
      if (!archive || typeof archive !== "object") {
        return;
      }
      archive.logs = archive.logs || {};
      if (archive.cycle) {
        archive.cycle.status = "archived";
        localizeCycle(archive.cycle);
      }
      migrateLegacyBodyweights(archive.cycle, archive.logs);
      if (archive.cycle && archive.overview && archive.overview.cycle) {
        archive.overview.cycle.status = "archived";
        archive.overview.cycle.bodyweightEntries = deepClone(archive.cycle.bodyweightEntries);
      }
    });
    return state;
  }

  function localizeCycle(cycle) {
    (cycle.template || []).forEach(function (item) {
      item.label = localize(item.label) || TYPE_LABELS[item.type] || item.type;
    });
    Object.keys(cycle.lifts || {}).forEach(function (key) {
      if (cycle.lifts[key]) cycle.lifts[key].label = localize(cycle.lifts[key].label) || LIFT_LABELS[key];
    });
    cycle.title = localize(cycle.title) || templateTitle(cycle.template);
    if (cycle.schedule && cycle.schedule.reason) cycle.schedule.reason = localize(cycle.schedule.reason);
  }

  function usesFeedback(cycle, date) {
    return cycle.programRevision === FEEDBACK_PROGRAM &&
      (!cycle.programRevisionFromDate || !date || date >= cycle.programRevisionFromDate);
  }

  // Move a saved cycle onto the feedback program from a given day. Sessions
  // before that day, and everything already logged, keep their prescriptions.
  function adoptFeedbackProgram(inputState, fromDate) {
    var state = normalizeState(inputState);
    var cycle = state.activeCycle;
    if (cycle.programRevision === FEEDBACK_PROGRAM || cycle.status !== "active" || !isIsoDate(fromDate) ||
        fromDate > cycle.endDate) {
      return state;
    }
    cycle.programRevision = FEEDBACK_PROGRAM;
    cycle.programRevisionFromDate = fromDate < cycle.startDate ? cycle.startDate : fromDate;
    cycle.schedule = null;
    return state;
  }

  function trainingReviewDate(cycle) {
    var review = cycle && cycle.trainingReview;
    return review && isIsoDate(review.date) ? review.date : null;
  }

  // "Adjust plan to my training": take what has been logged up to `date` as
  // the truth and let it reshape the sessions from that day on. Until the
  // owner does this again, later misses and failed sets change nothing.
  function applyTrainingReview(inputState, date) {
    var state = normalizeState(inputState);
    var cycle = state.activeCycle;
    if (cycle.programRevision !== FEEDBACK_PROGRAM || cycle.status !== "active" || !isIsoDate(date)) {
      var error = new Error("training_review_unavailable");
      error.code = "training_review_unavailable";
      throw error;
    }
    refreshPerformance(state, date);
    var estimates = {};
    ["bench", "pullup", "squat"].forEach(function (key) {
      var value = asNumber(cycle.lifts[key] && cycle.lifts[key].current1rm, null);
      if (value != null) estimates[key] = value;
    });
    cycle.trainingReview = { date: date, estimates: estimates };
    return state;
  }

  // Back to the programmed line: forget the last review.
  function clearTrainingReview(inputState) {
    var state = normalizeState(inputState);
    delete state.activeCycle.trainingReview;
    return state;
  }

  // An edited "current" 1RM is a fresh assessment: the reference line restarts
  // from that value on that day instead of from the cycle baseline.
  function reanchorLift(cycle, liftKey, value, date) {
    cycle.progression = cycle.progression || {};
    cycle.progression.liftAnchors = cycle.progression.liftAnchors || {};
    cycle.progression.liftAnchors[liftKey] = { date: date, value: Number(value) };
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

  // Measured capacity only changes from evidence; the fixed linear training
  // reference is a separate planning value and never updates current1rm.
  function median(values) {
    var sorted = values.slice().sort(function (a, b) { return a - b; });
    var middle = Math.floor(sorted.length / 2);
    return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
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
      var isTest = phase === "test" || phase === "retry";
      // Work logged before the cycle adopted the feedback program counts too:
      // finishing a prescription confirms its reference whichever program wrote it.
      var feedback = session.program === FEEDBACK_PROGRAM ||
        state.activeCycle.programRevision === FEEDBACK_PROGRAM;
      var mainSets = log.mainSets || [];
      var sets = mainSets.map(function (set) {
        var rpe = set.rpeSource === "actual" && set.rpe != null ? set.rpe : null;
        // A max attempt is a 10 by definition, and so is a set that fell short
        // of its prescribed reps; neither needs the lifter to type it in.
        if (rpe == null && (isTest || (feedback && set.completed === false))) rpe = 10;
        return { weight: asNumber(set.weight, null), reps: set.reps, rpe: rpe, completed: set.completed };
      }).filter(function (set) {
        var validLoad = key === "pullup" ? set.weight != null && set.weight + bodyweight > 0 : set.weight > 0;
        return (set.completed !== false || ((feedback || isTest) && set.rpe === 10)) && validLoad && set.reps >= 1 && set.reps <= 5 &&
          set.rpe != null && set.rpe >= 7 && set.rpe <= 10;
      });
      var value;
      if (sets.length && isTest) {
        value = Math.max.apply(Math, sets.map(function (set) { return Number(set.weight); }));
      } else if (sets.length) {
        var fewestReps = Math.min.apply(Math, sets.map(function (set) { return set.reps; }));
        value = median(sets.filter(function (set) { return set.reps === fewestReps; }).map(function (set) {
          return estimateOneRepMax(Number(set.weight) + bodyweight, set.reps, set.rpe) - bodyweight;
        }));
      } else if (feedback && !VOLUME_TYPES[session.type] && /^load-/.test(String(phase)) && mainSets.length &&
          session.workout.planned1rm != null && mainSets.every(function (set) {
            return set.completed !== false;
          })) {
        // Finishing a strength day without an RPE confirms the reference it
        // was written from. Volume days say little about a 1RM and are left out.
        value = Number(session.workout.planned1rm);
      } else {
        return;
      }
      // The prescribed percentages sit below the RPE table (a top single at
      // 88 % is written as RPE 8), so a clean session logged at its target RPE
      // would read as a weaker lifter and drag the readiness cap down week by
      // week. Work finished without a near-limit set confirms at least the
      // reference it was written from.
      if (feedback && !VOLUME_TYPES[session.type] && /^load-/.test(String(phase)) &&
          session.workout.planned1rm != null && mainSets.length &&
          mainSets.every(function (set) {
            return set.completed !== false && !(set.rpe != null && Number(set.rpe) >= 9);
          })) {
        value = Math.max(value, Number(session.workout.planned1rm));
      }
      if (value + bodyweight <= 0) return;
      result[key].push({ date: session.date, value: value, bodyweight: bodyweight, isTest: isTest });
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
      var latest = observations[observations.length - 1];
      if (latest.isTest) {
        // A max single is a measurement, not an estimate to be averaged.
        lift.current1rm = Math.round(latest.value * 10) / 10;
        return;
      }
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

  function applyCycleDates(state, asOfDate) {
    var cycle = state.activeCycle;
    if (cycle.status === "archived" || cycle.status === "completed") return;
    var reference = cycle.requestedEndDate;
    var adjustmentDays = cycle.scheduleAdjustments.reduce(function (total, entry) {
      return total + entry.days;
    }, 0);
    var end = addDays(reference, adjustmentDays);
    // Retain recorded sessions when importing older manually shifted cycles.
    cycleLogs(state).forEach(function (log) {
      if (log.status === "completed" && log.sessionSnapshot.date > end) end = log.sessionSnapshot.date;
    });
    cycle.endDate = end;
    var reason = cycle.programRevision === FEEDBACK_PROGRAM ? FEEDBACK_SCHEDULE_REASON : LEGACY_SCHEDULE_REASON;
    if (adjustmentDays) {
      reason += " Manually moved " + (adjustmentDays > 0 ? "back" : "forward") + " by " +
        Math.abs(adjustmentDays) + " days.";
    }
    cycle.schedule = {
      assessedAt: asOfDate < cycle.startDate ? cycle.startDate : asOfDate,
      shiftDays: daysBetween(reference, end),
      reason: reason
    };
  }

  function accessoriesFor(liftKey, type, phase) {
    if (phase.key === "test" || phase.key === "deload" || phase.key === "opener" || phase.key === "retry") return [];
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
          name: localize(period.name),
          daysOff: (period.daysOff || []).slice(),
          workdays: (period.workdays || []).slice()
        };
        result.periods.push(normalized);
        normalized.daysOff.forEach(function (date) {
          result.off[date] = { name: normalized.name, periodId: normalized.id, source: "official" };
        });
        normalized.workdays.forEach(function (date) {
          result.work[date] = { name: normalized.name + " make-up day", periodId: normalized.id, source: "official" };
        });
      });
    });

    Object.keys(overrides || {}).forEach(function (date) {
      var type = overrides[date];
      delete result.off[date];
      delete result.work[date];
      if (type === "off") {
        result.off[date] = { name: "Custom rest day", periodId: "override:" + date, source: "override" };
      } else if (type === "work") {
        result.work[date] = { name: "Custom training day", periodId: "override:" + date, source: "override" };
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
          warnings.push(date + " has more than one templated session; only the first is kept.");
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
          session.label + " on " + session.sourceDate + " is skipped for " + period.name +
            "; official make-up workdays are not used for training."
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
        name: "Custom make-up day",
        movedFrom: session.sourceDate,
        kind: "makeup"
      };
      sessions.push(session);
      occupied[session.date] = session.id;
    });
    customQueue.slice(customWorkdays.length).forEach(function (session) {
      warnings.push(session.label + " on " + session.sourceDate +
        " is skipped for a custom rest day; no custom training day was free to take it.");
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
        warnings.push(next.date + " has a scheduling conflict: " + next.label + ".");
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
    if (type === "squat" || type === "squat-volume") {
      return "squat";
    }
    return "bench";
  }

  function progressionAnchor(cycle) {
    var progression = cycle.progression || {};
    return isIsoDate(progression.anchorDate) ? progression.anchorDate : cycle.startDate;
  }

  // Measure the wave from the Monday of the session's own week so a strength day
  // and its weekend volume day always share one phase.
  function phaseFor(session, cycle, testWeekIndex) {
    var anchor = progressionAnchor(cycle);
    var weekStart = addDays(session.date, 1 - isoWeekday(session.date));
    var anchorWeekStart = addDays(anchor, 1 - isoWeekday(anchor));
    var weekIndex = Math.floor(daysBetween(anchorWeekStart, weekStart) / 7);
    var blockWeek = ((weekIndex % 4) + 4) % 4;
    if (session.isTest) {
      return { key: "test", label: "Goal test", weekIndex: weekIndex, blockWeek: blockWeek };
    }
    // Loading work in the testing week would arrive as fatigue on the attempts.
    if (testWeekIndex != null && weekIndex === testWeekIndex) {
      return { key: "opener", label: "Test-week opener", weekIndex: weekIndex, blockWeek: blockWeek };
    }
    return {
      key: blockWeek === 3 ? "deload" : "load-" + (blockWeek + 1),
      label: blockWeek === 3 ? "Deload week" : "Build week " + (blockWeek + 1),
      weekIndex: weekIndex,
      blockWeek: blockWeek
    };
  }

  function programmedOneRepMax(lift, liftKey, cycle, date, offset, holdWeeks) {
    var progression = cycle.progression || {};
    var anchors = progression.anchor1rm || {};
    var liftAnchor = holdWeeks != null && progression.liftAnchors ? progression.liftAnchors[liftKey] : null;
    var initial = anchors[liftKey] == null
      ? asNumber(lift.baseline1rm, asNumber(lift.current1rm, 0))
      : asNumber(anchors[liftKey], asNumber(lift.baseline1rm, 0));
    var anchorDate = progressionAnchor(cycle);
    if (liftAnchor && isIsoDate(liftAnchor.date) && Number.isFinite(Number(liftAnchor.value))) {
      initial = Number(liftAnchor.value);
      anchorDate = liftAnchor.date;
    }
    var target = asNumber(lift.target1rm, initial);
    var steps = Math.max(0, Math.floor(daysBetween(anchorDate, cycle.endDate) / 7));
    // Held weeks do not advance the line: a missed lift or a layoff pauses it.
    var week = Math.max(0, Math.floor(daysBetween(anchorDate, date) / 7) - Math.max(0, asNumber(holdWeeks, 0)));
    var progress = steps > 0 ? clamp(week / steps, 0, 1) : 0;
    var linear = initial + (target - initial) * progress;
    if (linear <= initial) {
      return linear;
    }
    // Pull-ups move the whole system, so the ceiling grows on bodyweight plus
    // added load rather than on the added load alone.
    var base = asNumber(offset, 0);
    var rate = Math.max(0, asNumber(progression.maxWeeklyGain, MAX_WEEKLY_GAIN_RATE));
    var ceiling = (initial + base) * (1 + rate * week) - base;
    return Math.min(linear, ceiling);
  }

  // The plan may only run ahead of what the lifter has shown by a small margin.
  function readinessCap(lift, offset) {
    var current = asNumber(lift.current1rm, null);
    return current == null ? Infinity : (current + asNumber(offset, 0)) * READINESS_CAP - asNumber(offset, 0);
  }

  // The cap is a statement about now. Measured strength only moves when work
  // is logged, so holding every future week to today's number would flatten
  // the rest of the cycle; each week further out is allowed one more weekly
  // step, and the cap tightens again as that week arrives without the work.
  function readinessCapOn(lift, liftKey, cycle, date, feedback, offset) {
    var asOfDate = feedback && feedback.reviewedOn;
    // Without a manual review the measured-strength cap does not apply at all.
    if (!isIsoDate(asOfDate)) return Infinity;
    var reviewed = feedback.reviewed1rm && feedback.reviewed1rm[liftKey];
    var cap = readinessCap(reviewed != null ? { current1rm: reviewed } : lift, offset);
    if (!Number.isFinite(cap) || date <= asOfDate) return cap;
    var weeksAhead = Math.max(0, Math.floor(daysBetween(mondayOf(asOfDate), mondayOf(date)) / 7));
    if (!weeksAhead) return cap;
    var base = asNumber(offset, 0);
    var rate = Math.max(0, asNumber((cycle.progression || {}).maxWeeklyGain, MAX_WEEKLY_GAIN_RATE));
    return (cap + base) * (1 + rate * weeksAhead) - base;
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

  function prescribedLoad(liftKey, oneRepMax, percentage, bodyweight, preferences, floorAtBodyweight) {
    if (liftKey === "pullup") {
      var totalLoad = Math.max(0, bodyweight + oneRepMax) * percentage;
      var added = roundLoad(totalLoad - bodyweight, preferences.pullupIncrement);
      // A negative load would need a band or an assist machine; the feedback
      // program prescribes bodyweight instead.
      return floorAtBodyweight ? Math.max(0, added) : added;
    }
    return Math.max(20, roundLoad(oneRepMax * percentage, preferences.barbellIncrement));
  }

  function attemptSets(load, labels, percentages) {
    var attempts = [
      makeWorkSet(labels[0], 1, 1, load(percentages[0]), 8, "4–5 min", percentages[0]),
      makeWorkSet(labels[1], 1, 1, load(percentages[1]), 9, "5 min", percentages[1]),
      makeWorkSet(labels[2], 1, 1, load(percentages[2]), 10, "5 min", percentages[2])
    ];
    return attempts.filter(function (set, index) { return !index || set.loadKg > attempts[index - 1].loadKg; });
  }

  function workingSets(type, liftKey, phase, oneRepMax, targetOneRepMax, bodyweight, preferences, volumePrescription, feedback) {
    var load = function (percentage, useTarget) {
      return prescribedLoad(
        liftKey,
        useTarget ? targetOneRepMax : oneRepMax,
        percentage,
        bodyweight,
        preferences,
        Boolean(feedback)
      );
    };
    var deloadSets = function (label) {
      // A percentage of bodyweight plus added load always resolves below
      // bodyweight here, which would demand a band or an assist machine;
      // pull-ups deload by dropping sets and reps at bodyweight instead.
      if (liftKey === "pullup") {
        return [makeWorkSet(label, 3, 4, 0, 6, "2–3 min", null)];
      }
      return [makeWorkSet(label, 3, 5, load(0.625), 6, "2–3 min", 0.625)];
    };

    if (phase.key === "test" || (phase.key === "retry" && feedback && feedback.retry === "attempt")) {
      if (feedback) {
        var attemptLoad = function (percentage) {
          return prescribedLoad(liftKey, feedback.attemptBase, percentage, bodyweight, preferences, true);
        };
        return attemptSets(attemptLoad, phase.key === "retry"
          ? ["Retry opener", "Retry attempt 2", "Retry goal attempt"]
          : ["Attempt 1", "Attempt 2 · if the opener was solid", "Goal attempt · only with room to spare"],
        [0.92, 0.97, 1]);
      }
      return attemptSets(function (percentage) { return load(percentage, true); },
        ["Attempt 1", "Attempt 2 · if the opener was solid", "Goal attempt · only with room to spare"],
        [0.9, 0.95, 1]);
    }
    if (phase.key === "retry") {
      return deloadSets("Recovery sets");
    }
    if (phase.key === "deload") {
      return deloadSets("Deload sets");
    }
    if (phase.key === "opener") {
      // Only the strength day rehearses a heavy single; a volume day inside
      // the taper would otherwise stack a second one days before the attempt.
      if (feedback && VOLUME_TYPES[type]) {
        return deloadSets("Taper sets");
      }
      return [
        makeWorkSet("Opener single", 1, 1, load(0.9), 8, "3–5 min", 0.9),
        makeWorkSet("Confirmation sets", 2, 3, load(0.75), 7, "2–3 min", 0.75)
      ];
    }

    var week = phase.blockWeek;
    if (VOLUME_TYPES[type]) {
      if (volumePrescription === MODERATE_VOLUME_PRESCRIPTION) {
        // These are starting loads and an effort target, not a prediction of
        // actual RPE. Keep 2–3 repetitions in reserve throughout the sets.
        var moderate = type === "push-volume"
          ? { sets: 4, reps: [10, 9, 8][week], percentage: [0.65, 0.675, 0.7][week] }
          : { sets: 3, reps: 8, percentage: [0.675, 0.7, 0.7][week] };
        return [makeWorkSet("Volume sets · 2–3 reps in reserve", moderate.sets, moderate.reps,
          load(moderate.percentage), 7.5, "2–3 min", moderate.percentage)];
      }
      var volume = [
        { sets: 4, reps: 6, percentage: 0.75, rpe: 7 },
        { sets: 4, reps: 5, percentage: 0.775, rpe: 7.5 },
        { sets: 4, reps: 4, percentage: 0.8, rpe: 8 }
      ][week];
      return [makeWorkSet("Volume sets", volume.sets, volume.reps, load(volume.percentage), volume.rpe, "2–3 min", volume.percentage)];
    }

    // The top single ramps on its own percentage: a capped reference moves less
    // per week than the smallest plate, so holding it at 90% would repeat.
    var topPercentage = [0.88, 0.9, 0.92][week];
    var topSet = makeWorkSet("Submaximal top single", 1, 1, load(topPercentage), 8, "3–5 min", topPercentage);
    if (type === "pull") {
      var pullMain = [
        { sets: 4, reps: 4, percentage: 0.825 },
        { sets: 4, reps: 3, percentage: 0.85 },
        { sets: 4, reps: 2, percentage: 0.875 }
      ][week];
      return [topSet, makeWorkSet("Main work sets", pullMain.sets, pullMain.reps, load(pullMain.percentage), 8, "2–3 min", pullMain.percentage)];
    }

    var main = [
      { sets: 4, reps: 5, percentage: 0.8, rpe: 8 },
      { sets: 4, reps: 4, percentage: 0.825, rpe: 8 },
      { sets: 4, reps: 3, percentage: 0.85, rpe: 8.5 }
    ][week];
    return [topSet, makeWorkSet("Main work sets", main.sets, main.reps, load(main.percentage), main.rpe, "3–5 min", main.percentage)];
  }

  // One weekly pull-up session is the smallest dose in the plan for the largest
  // relative goal. The second exposure is submaximal back-off work riding on
  // another day, so it adds practice without another heavy session.
  function secondaryPullSets(phase, oneRepMax, bodyweight, preferences) {
    var block = [
      { sets: 3, reps: 6, percentage: 0.7 },
      { sets: 3, reps: 5, percentage: 0.725 },
      { sets: 3, reps: 5, percentage: 0.75 }
    ][phase.blockWeek];
    if (!block) return [];
    return [makeWorkSet("Pull-up back-off sets", block.sets, block.reps,
      prescribedLoad("pullup", oneRepMax, block.percentage, bodyweight, preferences, true),
      7, "2 min", block.percentage)];
  }

  function secondaryPullTemplateId(template) {
    var items = template || [];
    var pull = items.filter(function (item) { return item.type === "pull"; })[0];
    if (!pull) return null;
    var best = null;
    var bestDistance = 1;
    items.slice().sort(function (left, right) {
      return Number(left.weekday) - Number(right.weekday);
    }).forEach(function (item) {
      if (item.type === "pull" || item.type === "squat") return;
      var gap = Math.abs(Number(item.weekday) - Number(pull.weekday));
      var distance = Math.min(gap, 7 - gap);
      // Next to the pull day the two sessions would be one long pull session.
      if (distance > bestDistance) {
        best = item;
        bestDistance = distance;
      }
    });
    return best ? best.id : null;
  }

  function warmupsFor(liftKey, workSets, preferences) {
    if (!workSets.length) {
      return [];
    }
    var workingLoad = workSets[0].loadKg;
    var increment = liftKey === "pullup" ? preferences.pullupIncrement : preferences.barbellIncrement;
    var result = [];

    if (liftKey === "pullup") {
      // The bodyweight set is movement preparation, not a lighter load, so it
      // stays even when the work sets carry no added weight.
      if (workingLoad > increment) {
        result.push({ label: "Ramp-up", sets: 1, reps: 3, loadKg: roundLoad(workingLoad * 0.5, increment) });
      }
      if (workingLoad > increment * 2) {
        result.push({ label: "Ramp-up", sets: 1, reps: 1, loadKg: roundLoad(workingLoad * 0.75, increment) });
      }
      return [{ label: "Bodyweight warm-up", sets: 1, reps: 5, loadKg: 0 }]
        .concat(uniqueWarmups(result, workingLoad).filter(function (item) {
          return item.loadKg > 0;
        }));
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
        result.push({ label: load === 20 ? "Empty-bar warm-up" : "Ramp-up", sets: 1, reps: step.reps, loadKg: Math.max(20, load) });
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

  function workoutFor(session, state, phase, referenceOneRepMax, feedback) {
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

    var planned = referenceOneRepMax != null && Number.isFinite(Number(referenceOneRepMax)) && Number(referenceOneRepMax) > 0
      ? Number(referenceOneRepMax)
      : (feedback
        ? Math.min(programmedOneRepMax(lift, liftKey, cycle, session.date, offset, feedback.holdWeeks),
          readinessCapOn(lift, liftKey, cycle, session.date, feedback, offset))
        : programmedOneRepMax(lift, liftKey, cycle, session.date, offset));
    var target = asNumber(lift.target1rm, planned);
    if (feedback) {
      feedback.attemptBase = Math.min(target,
        readinessCapOn(lift, liftKey, cycle, session.date, feedback, offset));
    }
    var workSets = workingSets(
      session.type,
      liftKey,
      phase,
      planned,
      target,
      bodyweight || 0,
      preferences,
      !cycle.volumePrescriptionFromDate || session.date >= cycle.volumePrescriptionFromDate
        ? cycle.volumePrescription : "legacy",
      feedback
    );
    var workout = {
      liftKey: liftKey,
      mainExercise: LIFT_LABELS[liftKey],
      needsSetup: false,
      planned1rm: Math.round(planned * 10) / 10,
      warmups: warmupsFor(liftKey, workSets, preferences),
      workSets: workSets,
      accessories: accessoriesFor(liftKey, session.type, phase)
    };
    if (phase.key === "test" && !feedback) {
      workout.guidance = TEST_GUIDANCE_LEGACY;
    } else if (phase.key === "test") {
      var capped = feedback.attemptBase < target - 1e-9;
      workout.guidance = "Work up 92 % → 97 % → 100 % of " + formatLoad(roundLoad(feedback.attemptBase,
        liftKey === "pullup" ? preferences.pullupIncrement : preferences.barbellIncrement), liftKey) + ". " +
        (capped
          ? "The goal of " + formatLoad(target, liftKey) + " is above 103 % of the current estimate, so the " +
            "attempts stop short of it; take the goal only if the last attempt moves fast. "
          : "") +
        "Drop the load if the warm-ups feel heavy and stop after any grind or miss. Use safeties or a reliable spotter.";
    } else if (phase.key === "retry" && feedback && feedback.retry === "attempt") {
      workout.guidance = "Retry slot. Use these attempts only if the goal test was missed or postponed; " +
        "otherwise do three easy sets of five and end the cycle fresh.";
    }
    if (feedback && feedback.secondaryPull && bodyweight != null &&
        cycle.lifts.pullup.current1rm != null && cycle.lifts.pullup.target1rm != null) {
      var pull = cycle.lifts.pullup;
      var pullSets = secondaryPullSets(phase, Math.min(
        programmedOneRepMax(pull, "pullup", cycle, session.date, bodyweight, feedback.secondaryPull.holdWeeks),
        readinessCapOn(pull, "pullup", cycle, session.date, feedback, bodyweight)
      ), bodyweight || 0, preferences);
      if (pullSets.length) {
        workout.secondary = { liftKey: "pullup", mainExercise: LIFT_LABELS.pullup, workSets: pullSets };
      }
    }
    return workout;
  }

  function markTestSessions(sessions) {
    ["bench", "pullup", "squat"].forEach(function (key) {
      var candidates = sessions.filter(function (session) {
        return liftKeyForType(session.type) === key;
      });
      if (!candidates.length) return;
      var last = candidates[candidates.length - 1];
      last.label = LIFT_LABELS[key] + " · Goal test";
      last.isTest = true;
    });
  }

  // Pick one goal test per lift near the end of the cycle. In order of priority:
  // no test on the very last training day, a later session of the same lift to
  // retry a miss in (the test moves earlier, the deadline does not), as few
  // tests on adjacent days as the template allows, and otherwise as late as
  // possible.
  function assignTestSessions(sessions, logs, today) {
    var keys = ["bench", "pullup", "squat"];
    var result = {};
    var open = sessions.filter(function (session) { return session.status !== "skipped"; });
    open.forEach(function (session) {
      if (!logs[session.id]) delete session.isTest;
    });
    if (!open.length) return result;
    var lastDate = open[open.length - 1].date;
    var windowStart = addDays(lastDate, -13);
    var byLift = {};
    var choices = keys.map(function (key) {
      var all = open.filter(function (session) { return liftKeyForType(session.type) === key; });
      byLift[key] = all;
      if (!all.length) return [null];
      var recorded = all.filter(function (session) { return session.isTest && session.status === "completed"; });
      if (recorded.length) return [recorded[recorded.length - 1]];
      var pending = all.filter(function (session) { return session.status !== "completed"; });
      var upcoming = pending.filter(function (session) { return !today || session.date >= today; });
      var pool = upcoming.length ? upcoming : pending;
      var inWindow = pool.filter(function (session) { return session.date >= windowStart; });
      return inWindow.length ? inWindow : (pool.length ? [pool[pool.length - 1]] : [null]);
    });
    var best = null;
    var bestCost = null;
    choices[0].forEach(function (first) {
      choices[1].forEach(function (second) {
        choices[2].forEach(function (third) {
          var picked = [first, second, third];
          var cost = [0, 0, 0, 0];
          picked.forEach(function (session, index) {
            if (!session) return;
            if (session.date === lastDate && session.status !== "completed") cost[0] += 1;
            if (!byLift[keys[index]].some(function (other) { return other.date > session.date; })) cost[1] += 1;
            cost[3] += daysBetween(session.date, lastDate);
            picked.slice(index + 1).forEach(function (other) {
              if (other && Math.abs(daysBetween(session.date, other.date)) <= 1) cost[2] += 1;
            });
          });
          var better = !bestCost;
          for (var index = 0; !better && index < cost.length; index += 1) {
            if (cost[index] !== bestCost[index]) {
              better = cost[index] < bestCost[index];
              break;
            }
          }
          if (better) {
            best = picked;
            bestCost = cost;
          }
        });
      });
    });
    (best || []).forEach(function (session, index) {
      if (!session) return;
      session.label = LIFT_LABELS[keys[index]] + " · Goal test";
      session.isTest = true;
      result[keys[index]] = session;
    });
    return result;
  }

  function mondayOf(date) {
    return addDays(date, 1 - isoWeekday(date));
  }

  // Count the wave back from the lift's own test: the test week takes the
  // deload's place, so the week before it is the heaviest build week and a
  // deload can never sit directly in front of the taper.
  function feedbackPhaseFor(session, cycle, test, resumeDates) {
    var anchor = progressionAnchor(cycle);
    var weekStart = mondayOf(session.date);
    var weekIndex = Math.floor(daysBetween(mondayOf(anchor), weekStart) / 7);
    var phase = function (key, label, blockWeek) {
      return { key: key, label: label, weekIndex: weekIndex, blockWeek: blockWeek };
    };
    if (session.isTest) return phase("test", "Goal test", 3);
    if (test && session.date > test.date) return phase("retry", "Retry or recovery", 3);
    var testWeek = mondayOf(test ? test.date : addDays(cycle.endDate, 7));
    // No heavy work for this lift in its test week or in the six days before
    // the attempt, whichever reaches further back.
    if (test && (weekStart === testWeek || daysBetween(session.date, test.date) <= 6)) {
      return phase("opener", "Taper", 3);
    }
    var weeksBack = Math.max(1, Math.round(daysBetween(weekStart, testWeek) / 7));
    var blockWeek = [2, 1, 0, 3][(weeksBack - 1) % 4];
    if (blockWeek === 3) {
      // Counting back can land a deload on the opening week, before there is
      // anything to recover from; start with an easy build week instead.
      if (weekStart <= mondayOf(cycle.startDate)) return phase("load-1", "Build week 1 · intro", 0);
      // A cycle that adopted this program mid-way was on the calendar wave
      // until then. If that wave's deload was the week before, a second light
      // week in a row would only lose training; build instead.
      var previousWeek = addDays(weekStart, -7);
      if (isIsoDate(cycle.programRevisionFromDate) && previousWeek < cycle.programRevisionFromDate &&
          previousWeek >= mondayOf(cycle.startDate) &&
          phaseFor({ date: previousWeek }, cycle, null).key === "deload") {
        return phase("load-1", "Build week 1", 0);
      }
      return phase("deload", "Deload week", 3);
    }
    var resumed = (resumeDates || []).some(function (date) {
      return session.date >= date && daysBetween(date, session.date) <= 6;
    });
    if (resumed && blockWeek > 0) {
      return phase("load-" + blockWeek, "Build week " + blockWeek + " · back from a layoff", blockWeek - 1);
    }
    return phase("load-" + (blockWeek + 1), "Build week " + (blockWeek + 1), blockWeek);
  }

  // Weeks the reference line must wait for each lift, as dated events:
  // a missed top set or a near-limit top single holds the following week, and
  // a run of missed sessions pauses the line for as long as it lasted.
  function holdEvents(state, sessions, asOfDate) {
    var events = { bench: [], pullup: [], squat: [] };
    var resumes = { bench: [], pullup: [], squat: [] };
    if (!isIsoDate(asOfDate)) return { events: events, resumes: resumes };
    cycleLogs(state, asOfDate).forEach(function (log) {
      var session = log.sessionSnapshot;
      var key = session.workout && session.workout.liftKey;
      if (!events[key] || log.status !== "completed" || session.program !== FEEDBACK_PROGRAM ||
          VOLUME_TYPES[session.type] || !/^load-/.test(String(session.phase && session.phase.key))) return;
      var sets = log.mainSets || [];
      var top = sets[0];
      var struggled = sets.some(function (set) { return set.completed === false; }) ||
        Boolean(top && top.rpe != null && Number(top.rpe) >= 9.5);
      if (struggled) events[key].push({ from: addDays(mondayOf(session.date), 7), weeks: 1 });
    });
    Object.keys(events).forEach(function (key) {
      var runStart = null;
      sessions.filter(function (session) {
        return liftKeyForType(session.type) === key && session.date < asOfDate;
      }).forEach(function (session) {
        if (session.status === "completed") {
          if (runStart && daysBetween(runStart, session.date) >= 7) {
            events[key].push({ from: session.date, weeks: Math.floor(daysBetween(runStart, session.date) / 7) });
            resumes[key].push(session.date);
          }
          runStart = null;
        } else if (!runStart) {
          runStart = session.date;
        }
      });
      if (runStart && daysBetween(runStart, asOfDate) >= 7) {
        events[key].push({ from: asOfDate, weeks: Math.floor(daysBetween(runStart, asOfDate) / 7) });
        resumes[key].push(asOfDate);
      }
    });
    return { events: events, resumes: resumes };
  }

  // A re-anchored lift starts a new line on its anchor day, so pauses from
  // before that day are already part of the number the owner entered.
  function holdWeeksSinceAnchor(cycle, liftKey, events, date) {
    var anchors = cycle.progression && cycle.progression.liftAnchors;
    var anchor = anchors && anchors[liftKey];
    var total = holdWeeksAt(events, date);
    return anchor && isIsoDate(anchor.date) ? total - holdWeeksAt(events, anchor.date) : total;
  }

  function holdWeeksAt(events, date) {
    return (events || []).reduce(function (total, event) {
      return total + (date >= event.from ? event.weeks : 0);
    }, 0);
  }

  function goalWarnings(state, totalWeeks) {
    var warnings = [];
    var cycle = state.activeCycle;
    if (totalWeeks < 8) {
      warnings.push("The cycle is shorter than 8 weeks, so the build/deload wave is compressed.");
    } else if (totalWeeks > 24) {
      warnings.push("The cycle is longer than 24 weeks; reassess the 1RMs once along the way.");
    }

    if (cycle.status !== "archived") {
      var bodyweight = latestBodyweight(cycle);
      // One sentence for all steep goals keeps the note short when several lifts share it.
      var steep = [];
      ["bench", "pullup", "squat"].forEach(function (key) {
        var lift = cycle.lifts[key];
        var offset = key === "pullup" ? asNumber(bodyweight, null) : 0;
        var start = asNumber(lift.baseline1rm, asNumber(lift.current1rm, null));
        var target = asNumber(lift.target1rm, null);
        if (offset == null || start == null || target == null || start + offset <= 0 || target <= start) return;
        var weeks = Math.max(1, daysBetween(cycle.startDate, cycle.endDate) / 7);
        var rate = ((target + offset) / (start + offset) - 1) / weeks;
        if (rate <= GOAL_RATE_WARNING + 1e-9) return;
        steep.push(LIFT_LABELS[key] + " needs +" + (rate * 100).toFixed(1) + " % per week to reach " +
          formatLoad(target, key));
      });
      if (steep.length) {
        warnings.push("Ambitious goals: " + steep.join("; ") + ". More than about 0.5 % per week is " +
          "optimistic at this level, so the training reference only keeps pace while logged sessions confirm it.");
      }
    }

    if (cycle.schedule) warnings.push(cycle.schedule.reason);
    return warnings;
  }

  function generate(inputState, holidayCalendars, options) {
    var state = normalizeState(inputState);
    var cycle = state.activeCycle;
    var asOfDate = planningDate(state, options);
    var history = refreshPerformance(state, asOfDate);
    if (cycle.startDate && cycle.endDate && cycle.endDate >= cycle.startDate) applyCycleDates(state, asOfDate);
    var warnings = [];
    if (!cycle.startDate || !cycle.endDate || cycle.endDate < cycle.startDate) {
      return { state: state, cycle: cycle, sessions: [], warnings: ["The cycle dates are not valid."], totalWeeks: 0 };
    }

    var holidays = compileHolidayCalendar(holidayCalendars, cycle.holidayOverrides);
    var sessions = buildBaseSessions(cycle, holidays, warnings);
    if (cycle.replannedSchedule) {
      var recordedDates = {};
      cycleLogs(state).forEach(function (log) { recordedDates[log.sessionSnapshot.date] = true; });
      cycle.replannedSchedule.retainedSessions.forEach(function (session) { recordedDates[session.date] = true; });
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
    var feedbackCycle = cycle.programRevision === FEEDBACK_PROGRAM;
    var today = options && isIsoDate(options.asOfDate) ? options.asOfDate : null;
    var tests = null;
    var holds = null;
    var secondaryPullHost = null;
    var testWeekIndex = null;
    // Missed sessions, failed sets and the measured-strength cap change the
    // prescriptions only up to the day the owner last chose "adjust plan to
    // my training". Between reviews the plan follows the programmed line, so
    // training on a different day than shown never silently lightens it.
    var reviewedOn = feedbackCycle ? trainingReviewDate(cycle) : null;
    if (feedbackCycle) {
      tests = assignTestSessions(sessions, state.logs, today);
      holds = holdEvents(state, sessions, reviewedOn);
      secondaryPullHost = secondaryPullTemplateId(cycle.template);
    } else {
      markTestSessions(sessions);
      var firstTest = sessions.filter(function (session) { return session.isTest; })[0];
      testWeekIndex = firstTest
        ? Math.floor(daysBetween(progressionAnchor(cycle), firstTest.date) / 7)
        : null;
    }
    var feedbackContext = function (session) {
      var key = liftKeyForType(session.type);
      var test = tests[key];
      var context = {
        holdWeeks: holdWeeksSinceAnchor(cycle, key, holds.events[key], session.date),
        reviewedOn: reviewedOn,
        reviewed1rm: reviewedOn && cycle.trainingReview.estimates ? cycle.trainingReview.estimates : null
      };
      if (test && session.date > test.date) {
        var testLog = state.logs[test.id];
        var lift = cycle.lifts[key];
        var reached = testLog && testLog.status === "completed" &&
          asNumber(lift.current1rm, -Infinity) >= asNumber(lift.target1rm, Infinity) - 1e-9;
        context.retry = reached ? "recovery" : "attempt";
      }
      var pullTest = tests.pullup;
      if (session.templateId === secondaryPullHost && key !== "pullup" &&
          /^load-/.test(session.phase.key) &&
          (!pullTest || daysBetween(session.date, pullTest.date) > 6)) {
        context.secondaryPull = { holdWeeks: holdWeeksSinceAnchor(cycle, "pullup", holds.events.pullup, session.date) };
      }
      return context;
    };

    var adjustmentDays = (cycle.scheduleAdjustments || []).reduce(function (total, entry) {
      return total + entry.days;
    }, 0);
    var programEndDate = addDays(cycle.endDate, -adjustmentDays);
    var totalWeeks = Math.max(1, Math.ceil((daysBetween(cycle.startDate, programEndDate) + 1) / 7));
    sessions.forEach(function (session) {
      var log = state.logs[session.id];
      if (log && log.sessionSnapshot) {
        var frozen = deepClone(log.sessionSnapshot);
        Object.keys(frozen).forEach(function (key) {
          session[key] = frozen[key];
        });
      } else if (!(cycle.replannedSchedule && session.date < cycle.replannedSchedule.fromDate &&
          session.workout && session.date === session.programDate)) {
        if (feedbackCycle && usesFeedback(cycle, session.date)) {
          var liftKey = liftKeyForType(session.type);
          session.phase = feedbackPhaseFor(session, cycle, tests[liftKey], holds.resumes[liftKey]);
          session.workout = workoutFor(session, state, session.phase, null, feedbackContext(session));
          session.program = FEEDBACK_PROGRAM;
        } else {
          session.phase = phaseFor(session, cycle, testWeekIndex);
          session.workout = workoutFor(session, state, session.phase);
        }
      } else if (cycle.volumePrescription === MODERATE_VOLUME_PRESCRIPTION &&
          cycle.volumePrescriptionFromDate && session.date >= cycle.volumePrescriptionFromDate &&
          VOLUME_TYPES[session.type] && session.phase && /^load-/.test(session.phase.key)) {
        // A prior schedule revision may have retained still-future workouts.
        // Adopt the dated volume change without altering their schedule, phase,
        // or reference strength after a deadline revision.
        session.workout = workoutFor(session, state, session.phase, session.workout.planned1rm);
      }
      session.status = log && log.status ? log.status : "planned";
      // Only a caller that knows today's date can tell a missed session from
      // one that is still ahead.
      if (today && session.status === "planned" && session.date < today) session.status = "missed";
      delete session.programDate;
      localizeSession(session);
    });

    // Scheduling warnings can name the owner's own rest days, so only the
    // warnings about the goal and the program are published.
    var publicWarnings = goalWarnings(state, totalWeeks);
    warnings = publicWarnings.concat(warnings);
    for (var year = Number(cycle.startDate.slice(0, 4)); year <= Number(cycle.endDate.slice(0, 4)); year += 1) {
      if (!(holidayCalendars || []).some(function (calendar) { return Number(calendar.year) === year; })) {
        warnings.push("No public-holiday calendar is loaded for " + year +
          "; sessions follow the weekly template. Rest days can be set by hand in the plan settings.");
      }
    }
    (holidayCalendars || []).forEach(function (calendar) {
      if (calendar.partial && Number(calendar.year) >= Number(cycle.startDate.slice(0, 4)) &&
          Number(calendar.year) <= Number(cycle.endDate.slice(0, 4))) {
        warnings.push("The " + calendar.year + " holiday calendar is incomplete: " +
          (calendar.partialNote || "only confirmed dates are included") + ".");
      }
    });
    return {
      state: state,
      cycle: cycle,
      sessions: sessions,
      warnings: warnings,
      totalWeeks: totalWeeks,
      bodyweight: latestBodyweight(cycle),
      publicWarnings: publicWarnings,
      performance: publicPerformance(history)
    };
  }

  // Estimated and tested 1RMs per lift, without the bodyweight they were
  // computed from, for the progress chart and the public snapshot.
  function publicPerformance(history) {
    var result = {};
    Object.keys(history || {}).forEach(function (key) {
      result[key] = history[key].map(function (entry) {
        return { date: entry.date, value: Math.round(entry.value * 10) / 10, isTest: Boolean(entry.isTest) };
      });
    });
    return result;
  }

  function canonical(value) {
    if (Array.isArray(value)) return "[" + value.map(canonical).join(",") + "]";
    if (value && typeof value === "object") {
      return "{" + Object.keys(value).sort().filter(function (key) {
        return value[key] !== undefined;
      }).map(function (key) {
        return JSON.stringify(key) + ":" + canonical(value[key]);
      }).join(",") + "}";
    }
    return JSON.stringify(value === undefined ? null : value);
  }

  function mergeKeyed(base, remote, local, newer) {
    var result = {};
    var keys = {};
    [base, remote, local].forEach(function (source) {
      Object.keys(source || {}).forEach(function (key) { keys[key] = true; });
    });
    Object.keys(keys).forEach(function (key) {
      var b = canonical((base || {})[key]);
      var r = canonical((remote || {})[key]);
      var l = canonical((local || {})[key]);
      var pick;
      if (l === b) pick = remote;
      else if (r === b || r === l) pick = local;
      else pick = newer && newer((remote || {})[key], (local || {})[key]) === "remote" ? remote : local;
      if (pick && pick[key] !== undefined) result[key] = deepClone(pick[key]);
    });
    return result;
  }

  function mergeError(field) {
    var error = new Error("merge_conflict");
    error.code = "merge_conflict";
    error.field = field;
    return error;
  }

  // Three-way merge for two devices saving from the same stored version.
  // Records that are naturally keyed (session logs, bodyweight entries,
  // per-session moves and skips) merge entry by entry. Anything else may be
  // changed on one side only; if both sides changed it, the caller has to ask.
  function mergeStates(baseInput, remoteInput, localInput) {
    var base = normalizeState(baseInput);
    var remote = normalizeState(remoteInput);
    var local = normalizeState(localInput);
    if (remote.activeCycle.id !== local.activeCycle.id || base.activeCycle.id !== local.activeCycle.id) {
      throw mergeError("activeCycle");
    }
    var merged = deepClone(remote);
    var newerLog = function (remoteLog, localLog) {
      var remoteAt = String(remoteLog && remoteLog.completedAt || "");
      var localAt = String(localLog && localLog.completedAt || "");
      return remoteAt > localAt ? "remote" : "local";
    };
    merged.logs = mergeKeyed(base.logs, remote.logs, local.logs, newerLog);
    var byDate = function (entries) {
      var map = {};
      (entries || []).forEach(function (entry) { map[entry.date] = entry; });
      return map;
    };
    var weights = mergeKeyed(byDate(base.activeCycle.bodyweightEntries),
      byDate(remote.activeCycle.bodyweightEntries), byDate(local.activeCycle.bodyweightEntries));
    merged.activeCycle.bodyweightEntries = Object.keys(weights).sort().map(function (date) { return weights[date]; });
    merged.activeCycle.sessionOverrides = mergeKeyed(base.activeCycle.sessionOverrides,
      remote.activeCycle.sessionOverrides, local.activeCycle.sessionOverrides);

    // Recomputed from the logs on every generate, so a difference here is
    // never a real disagreement between the two devices.
    var derived = { lifts: true, schedule: true, programRevision: true, programRevisionFromDate: true };
    var keyed = { bodyweightEntries: true, sessionOverrides: true };
    var cycleKeys = {};
    [base.activeCycle, remote.activeCycle, local.activeCycle].forEach(function (cycle) {
      Object.keys(cycle).forEach(function (key) { cycleKeys[key] = true; });
    });
    Object.keys(cycleKeys).forEach(function (key) {
      if (keyed[key]) return;
      var b = canonical(base.activeCycle[key]);
      var r = canonical(remote.activeCycle[key]);
      var l = canonical(local.activeCycle[key]);
      if (l === b || l === r) return;
      if (r !== b && !derived[key]) throw mergeError("activeCycle." + key);
      if (local.activeCycle[key] === undefined) delete merged.activeCycle[key];
      else merged.activeCycle[key] = deepClone(local.activeCycle[key]);
    });
    ["preferences", "archivedCycles"].forEach(function (key) {
      var b = canonical(base[key]);
      var r = canonical(remote[key]);
      var l = canonical(local[key]);
      if (l === b || l === r) return;
      if (r !== b) throw mergeError(key);
      merged[key] = deepClone(local[key]);
    });
    merged.version = remote.version;
    merged.updatedAt = remote.updatedAt;
    return merged;
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
      log.sessionSnapshot.date = date;
    }

    return state;
  }

  function adjustSchedule(inputState, sourceId, targetDate, options) {
    var settings = options || {};
    if (inputState.activeCycle && inputState.activeCycle.replannedSchedule && settings.allowDeadlineChange !== true) {
      throw sessionMoveError("schedule_deadline_locked");
    }
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

    var regeneratingIds = {};
    if (cycle.replannedSchedule) {
      buildBaseSessions(cycle, compileHolidayCalendar(settings.holidayCalendars || [], cycle.holidayOverrides), [])
        .concat(cycle.replannedSchedule.retainedSessions).forEach(function (session) {
          regeneratingIds[session.id] = true;
        });
    }
    var restoredSkips = [];
    candidates.forEach(function (session) {
      var log = state.logs[session.id];
      if (log && log.status === "skipped") {
        if (cycle.replannedSchedule && !regeneratingIds[session.id]) {
          // Older revisions only survive through their logged snapshot. Keep
          // that workout when clearing its skip, without replaying past shifts.
          cycle.replannedSchedule.retainedSessions.push(deepClone(session));
          cycle.sessionOverrides[session.id] = {
            action: "move",
            date: session.date,
            scheduleAdjustmentCount: cycle.scheduleAdjustments.length
          };
        }
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
      secondarySets: (log.secondarySets || []).map(function (set) {
        return { weight: asNumber(set.weight, null), reps: asNumber(set.reps, null) };
      }),
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
        isTest: Boolean(session.isTest),
        program: session.program || null
      }
    };
    state.logs[session.id] = nextLog;

    refreshPerformance(state);

    return state;
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
    if (workout.secondary) {
      // Pull-up loads reveal bodyweight, so the public copy keeps sets and reps only.
      result.secondary = deepClone(workout.secondary);
      result.secondary.workSets.forEach(function (set) { delete set.loadKg; });
    }
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
        volumePrescription: cycle.volumePrescription,
        volumePrescriptionFromDate: cycle.volumePrescriptionFromDate || null,
        programRevision: cycle.programRevision,
        programRevisionFromDate: cycle.programRevisionFromDate || null,
        scheduleRevision: typeof cycle.scheduleRevision === "string" ? cycle.scheduleRevision : null,
        schedule: deepClone(cycle.schedule),
        lifts: {
          bench: deepClone(cycle.lifts.bench),
          pullup: deepClone(cycle.lifts.pullup),
          squat: deepClone(cycle.lifts.squat)
        }
      },
      totalWeeks: plan.totalWeeks,
      warnings: (plan.publicWarnings || []).slice(0, 8),
      performance: deepClone(plan.performance || {}),
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
      })
    };
  }

  function filterLegacyOfficialMakeups(sessions, holidayCalendars) {
    return (sessions || []).filter(function (session) {
      if ((session.status !== "planned" && session.status !== "missed") ||
          !session.holiday ||
          session.holiday.kind !== "makeup") {
        return true;
      }
      var isOfficialMakeup = (holidayCalendars || []).some(function (calendar) {
        return (calendar.periods || []).some(function (period) {
          return localize(session.holiday.name) === localize(period.name) &&
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
      "PRODID:-//MiyaaL//Plan//EN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:MiyaaL training plan",
      "X-WR-TIMEZONE:" + prefs.timezone
    ];

    (generated.sessions || []).forEach(function (session) {
      var main = session.workout && session.workout.mainExercise ? session.workout.mainExercise : session.label;
      var work = session.workout && session.workout.workSets ? session.workout.workSets.map(function (set) {
        var load = Object.prototype.hasOwnProperty.call(set, "loadKg")
          ? " @ " + formatLoad(set.loadKg, session.workout.liftKey)
          : "";
        return set.label + " " + set.sets + "×" + set.reps + load;
      }).join("; ") : "";
      if (session.workout && session.workout.secondary) {
        work += "; " + session.workout.secondary.workSets.map(function (set) {
          return set.label + " " + set.sets + "×" + set.reps +
            (Object.prototype.hasOwnProperty.call(set, "loadKg") ? " @ " + formatLoad(set.loadKg, "pullup") : "");
        }).join("; ");
      }
      lines.push("BEGIN:VEVENT");
      lines.push("UID:" + escapeIcs(session.id) + "@miyaal.github.io");
      lines.push("DTSTART;TZID=" + prefs.timezone + ":" + compactDate(session.date) + "T" + compactClock(prefs.trainingTime));
      lines.push("DTEND;TZID=" + prefs.timezone + ":" + compactDate(session.date) + "T" + compactClock(endTime));
      lines.push("SUMMARY:" + escapeIcs(session.label + " · " + main));
      lines.push("DESCRIPTION:" + escapeIcs(work));
      lines.push("BEGIN:VALARM");
      lines.push("TRIGGER:-PT" + Math.max(0, prefs.reminderMinutes) + "M");
      lines.push("ACTION:DISPLAY");
      lines.push("DESCRIPTION:" + escapeIcs("Training reminder: " + session.label));
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
        return "+" + load + " kg added";
      }
      if (load < 0) {
        return Math.abs(load) + " kg assisted";
      }
      return "bodyweight";
    }
    return load + " kg";
  }

  return {
    DEFAULT_TEMPLATE: deepClone(DEFAULT_TEMPLATE),
    TYPE_LABELS: deepClone(TYPE_LABELS),
    LIFT_LABELS: deepClone(LIFT_LABELS),
    MODERATE_VOLUME_PRESCRIPTION: MODERATE_VOLUME_PRESCRIPTION,
    FEEDBACK_PROGRAM: FEEDBACK_PROGRAM,
    adoptFeedbackProgram: adoptFeedbackProgram,
    mergeStates: mergeStates,
    reanchorLift: reanchorLift,
    applyTrainingReview: applyTrainingReview,
    clearTrainingReview: clearTrainingReview,
    trainingReviewDate: trainingReviewDate,
    templateTitle: templateTitle,
    localize: localize,
    localizeSession: localizeSession,
    localizeCycle: localizeCycle,
    createDefaultState: createDefaultState,
    normalizeState: normalizeState,
    generate: generate,
    replanRemaining: replanRemaining,
    moveSession: moveSession,
    adjustSchedule: adjustSchedule,
    recordSession: recordSession,
    restoreSkippedSession: restoreSkippedSession,
    recordBodyweight: recordBodyweight,
    estimateOneRepMax: estimateOneRepMax,
    createPublicSnapshot: createPublicSnapshot,
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
