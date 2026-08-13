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
  var ACCESSORIES = {
    "push-strength": [
      exercise("站姿推举", 3, "6–8", 7.5, "90–120 秒"),
      exercise("上斜哑铃卧推", 3, "8–10", 8, "90 秒"),
      exercise("绳索下压", 3, "10–12", 8, "60–90 秒")
    ],
    pull: [
      exercise("胸托划船", 4, "6–8", 8, "90–120 秒"),
      exercise("面拉", 3, "12–15", 8, "60–90 秒"),
      exercise("哑铃弯举", 3, "8–12", 8, "60–90 秒")
    ],
    squat: [
      exercise("罗马尼亚硬拉", 3, "6–8", 7.5, "120 秒"),
      exercise("保加利亚分腿蹲", 3, "8–10 / 侧", 8, "90 秒"),
      exercise("核心训练", 3, "8–12", 7.5, "60 秒")
    ],
    "push-volume": [
      exercise("暂停卧推", 3, "5–6", 7.5, "120 秒"),
      exercise("哑铃肩推", 3, "8–10", 8, "90 秒"),
      exercise("侧平举", 3, "12–15", 8, "60 秒")
    ]
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
      schemaVersion: 1,
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
        loadAdjustments: {},
        createdAt: new Date().toISOString()
      },
      archivedCycles: [],
      logs: {}
    };
  }

  function normalizeState(input) {
    var fallback = createDefaultState();
    var state = deepClone(input || fallback);
    state.schemaVersion = 1;
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
    });
    state.activeCycle.template = Array.isArray(state.activeCycle.template) && state.activeCycle.template.length
      ? state.activeCycle.template
      : deepClone(DEFAULT_TEMPLATE);
    state.activeCycle.bodyweightEntries = Array.isArray(state.activeCycle.bodyweightEntries)
      ? state.activeCycle.bodyweightEntries
      : [];
    state.activeCycle.holidayOverrides = state.activeCycle.holidayOverrides || {};
    state.activeCycle.sessionOverrides = state.activeCycle.sessionOverrides || {};
    state.activeCycle.loadAdjustments = state.activeCycle.loadAdjustments || {};
    state.archivedCycles = Array.isArray(state.archivedCycles) ? state.archivedCycles : [];
    state.logs = state.logs || {};
    return state;
  }

  function latestBodyweight(cycle) {
    var entries = (cycle.bodyweightEntries || []).filter(function (entry) {
      return asNumber(entry.value, 0) > 0;
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
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || value == null || value < 30 || value > 300) {
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
        result.work[date] = { name: "自定义调休工作日", periodId: "override:" + date, source: "override" };
      }
    });
    return result;
  }

  function sessionId(cycle, template, date) {
    return cycle.id + ":" + template.id + ":" + date;
  }

  function buildBaseSessions(cycle, holidays, warnings) {
    var sessions = [];
    var missed = {};
    var occupied = {};
    var date = cycle.startDate;

    while (date <= cycle.endDate) {
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
      var workdays = period.workdays.filter(function (workday) {
        return workday >= cycle.startDate &&
          workday <= cycle.endDate &&
          !holidays.off[workday] &&
          !occupied[workday];
      }).sort();

      queue.slice(0, workdays.length).forEach(function (session, index) {
        session.date = workdays[index];
        session.holiday = {
          name: period.name,
          movedFrom: session.sourceDate,
          kind: "makeup"
        };
        sessions.push(session);
        occupied[session.date] = session.id;
      });

      queue.slice(workdays.length).forEach(function (session) {
        warnings.push(session.sourceDate + " 的" + session.label + "因" + period.name + "跳过，未找到可用调休工作日。");
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
        workday >= cycle.startDate &&
        workday <= cycle.endDate &&
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

  function liftKeyForType(type) {
    if (type === "pull") {
      return "pullup";
    }
    if (type === "squat") {
      return "squat";
    }
    return "bench";
  }

  function phaseFor(session, cycle, totalWeeks) {
    var weekIndex = Math.max(0, Math.floor(daysBetween(cycle.startDate, session.date) / 7));
    if (session.isTest) {
      return { key: "test", label: "目标测试", weekIndex: weekIndex, blockWeek: null };
    }
    if (weekIndex >= totalWeeks - 1) {
      return { key: "taper", label: "减量准备", weekIndex: weekIndex, blockWeek: null };
    }
    var blockWeek = weekIndex % 4;
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

  function plannedOneRepMax(lift, progress) {
    var current = asNumber(lift.current1rm, 0);
    var target = asNumber(lift.target1rm, current);
    return current + (target - current) * clamp(progress, 0, 1);
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
    var sets = [];
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
      sets.push(makeWorkSet("尝试 1", 1, 1, load(0.9, true), 8, "4–5 分钟", 0.9));
      sets.push(makeWorkSet("尝试 2", 1, 1, load(0.975, true), 9, "5 分钟", 0.975));
      sets.push(makeWorkSet("目标尝试", 1, 1, load(1, true), 10, "5 分钟", 1));
      return sets;
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
      var pullTop = [0.825, 0.85, 0.875][week];
      var pullBackoff = [
        { sets: 4, reps: 6, percentage: 0.7 },
        { sets: 5, reps: 5, percentage: 0.75 },
        { sets: 5, reps: 4, percentage: 0.8 }
      ][week];
      sets.push(makeWorkSet("顶组三次", 1, 3, load(pullTop), 8, "3–4 分钟", pullTop));
      sets.push(makeWorkSet("回退组", pullBackoff.sets, pullBackoff.reps, load(pullBackoff.percentage), 8, "2–3 分钟", pullBackoff.percentage));
      return sets;
    }

    var top = [0.88, 0.9, 0.92][week];
    var backoff = [
      { sets: 4, reps: 5, percentage: 0.725 },
      { sets: 4, reps: 4, percentage: 0.775 },
      { sets: 5, reps: 3, percentage: 0.825 }
    ][week];
    sets.push(makeWorkSet("非极限顶组", 1, 1, load(top), week === 2 ? 8 : 7.5, "3–5 分钟", top));
    sets.push(makeWorkSet("回退组", backoff.sets, backoff.reps, load(backoff.percentage), 8, "2–3 分钟", backoff.percentage));
    return sets;
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
      { percentage: 0.82, reps: 1 }
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
    var configured = asNumber(lift.current1rm, 0) > 0 &&
      asNumber(lift.target1rm, 0) > 0 &&
      (liftKey !== "pullup" || bodyweight != null);

    if (!configured) {
      return {
        liftKey: liftKey,
        mainExercise: LIFT_LABELS[liftKey],
        needsSetup: true,
        warmups: [],
        workSets: [],
        accessories: deepClone(ACCESSORIES[session.type] || [])
      };
    }

    var progress = clamp((phase.weekIndex + 1) / Math.max(1, totalWeeks), 0, 1);
    var planned = plannedOneRepMax(lift, progress);
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
      planned1rm: roundLoad(planned, 0.1),
      warmups: warmupsFor(liftKey, workSets, preferences),
      workSets: workSets,
      accessories: deepClone(ACCESSORIES[session.type] || [])
    };
  }

  function markTestSessions(sessions) {
    ["push-strength", "pull", "squat"].forEach(function (type) {
      var candidates = sessions.filter(function (session) {
        return session.type === type;
      });
      if (candidates.length) {
        candidates[candidates.length - 1].isTest = true;
      }
    });
  }

  function goalWarnings(state, totalWeeks) {
    var warnings = [];
    if (totalWeeks < 8) {
      warnings.push("计划少于 8 周，完整波浪周期会被压缩。");
    } else if (totalWeeks > 24) {
      warnings.push("计划超过 24 周，建议中途重新评估一次 1RM。");
    }

    Object.keys(state.activeCycle.lifts).forEach(function (key) {
      var lift = state.activeCycle.lifts[key];
      var current = asNumber(lift.current1rm, 0);
      var target = asNumber(lift.target1rm, 0);
      if (current > 0 && target > current && totalWeeks > 0) {
        var weeklyRate = (Math.pow(target / current, 1 / totalWeeks) - 1) * 100;
        if (weeklyRate > 1) {
          warnings.push(lift.label + "需要每周约增长 " + weeklyRate.toFixed(2) + "%，目标较激进。");
        }
      }
    });
    return warnings;
  }

  function applyNextAdjustments(sessions, state) {
    var cycle = state.activeCycle;
    var bodyweight = latestBodyweight(cycle) || 0;
    Object.keys(cycle.loadAdjustments || {}).forEach(function (liftKey) {
      var adjustment = cycle.loadAdjustments[liftKey];
      var candidate = sessions.filter(function (session) {
        return session.status === "planned" &&
          session.workout &&
          session.workout.liftKey === liftKey &&
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
      if (session.status !== "planned" || !session.workout || !session.workout.accessories) {
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
        var increase = ceiling && asNumber(previous.reps, 0) >= ceiling
          ? state.preferences.accessoryIncrement
          : 0;
        accessory.loadKg = roundLoad(
          asNumber(previous.weight, 0) + increase,
          state.preferences.accessoryIncrement
        );
        accessory.progression = increase > 0 ? "达到次数上限，下次加重" : "保持重量并继续增加次数";
      });
    });
  }

  function generate(inputState, holidayCalendars) {
    var state = normalizeState(inputState);
    var cycle = state.activeCycle;
    var warnings = [];
    if (!cycle.startDate || !cycle.endDate || cycle.endDate < cycle.startDate) {
      return { state: state, cycle: cycle, sessions: [], warnings: ["计划起止日期无效。"], totalWeeks: 0 };
    }

    var holidays = compileHolidayCalendar(holidayCalendars, cycle.holidayOverrides);
    var sessions = buildBaseSessions(cycle, holidays, warnings);
    sessions = applySessionOverrides(sessions, cycle.sessionOverrides, warnings);
    markTestSessions(sessions);

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
      }
    });
    sessions.sort(byDate);

    var totalWeeks = Math.max(1, Math.ceil((daysBetween(cycle.startDate, cycle.endDate) + 1) / 7));
    sessions.forEach(function (session) {
      var log = state.logs[session.id];
      if (log && log.sessionSnapshot) {
        var frozen = deepClone(log.sessionSnapshot);
        Object.keys(frozen).forEach(function (key) {
          session[key] = frozen[key];
        });
      } else {
        session.phase = phaseFor(session, cycle, totalWeeks);
        session.workout = workoutFor(session, state, session.phase, totalWeeks);
      }
      session.status = log && log.status ? log.status : "planned";
    });
    applyNextAdjustments(sessions, state);
    applyAccessoryProgression(sessions, state);

    warnings = goalWarnings(state, totalWeeks).concat(warnings);
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

  function recordSession(inputState, session, log) {
    var state = normalizeState(inputState);
    var nextLog = {
      status: log.status || "completed",
      completedAt: log.completedAt || new Date().toISOString(),
      mainSets: (log.mainSets || []).map(function (set) {
        return {
          weight: asNumber(set.weight, null),
          reps: asNumber(set.reps, null),
          rpe: asNumber(set.rpe, null),
          completed: set.completed !== false
        };
      }),
      accessories: deepClone(log.accessories || []),
      bodyweight: asNumber(log.bodyweight, null),
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

    if (nextLog.bodyweight && nextLog.bodyweight > 0) {
      state = recordBodyweight(state, {
        date: session.date,
        value: nextLog.bodyweight
      });
    }

    var liftKey = session.workout && session.workout.liftKey;
    if (liftKey && nextLog.mainSets.length) {
      var targetRpe = session.workout.workSets.length ? session.workout.workSets[0].rpe : 8;
      var actualRpe = Math.max.apply(Math, nextLog.mainSets.map(function (set) {
        return asNumber(set.rpe, targetRpe);
      }));
      var adjustment = suggestAdjustment(
        actualRpe,
        targetRpe,
        nextLog.mainSets.every(function (set) { return set.completed; })
      );
      state.activeCycle.loadAdjustments[liftKey] = {
        percentage: adjustment.percentage,
        reason: adjustment.reason,
        afterDate: session.date,
        updatedAt: nextLog.completedAt
      };
      var bodyweight = latestBodyweight(state.activeCycle) || 0;
      var estimates = nextLog.mainSets.map(function (set) {
        if (!set.completed) {
          return null;
        }
        var load = set.weight;
        if (liftKey === "pullup") {
          load += bodyweight;
        }
        var estimate = estimateOneRepMax(load, set.reps, set.rpe);
        return liftKey === "pullup" && estimate != null ? estimate - bodyweight : estimate;
      }).filter(function (value) {
        return value != null && value > 0;
      });
      if (estimates.length) {
        var best = Math.max.apply(Math, estimates);
        var current = asNumber(state.activeCycle.lifts[liftKey].current1rm, best);
        state.activeCycle.lifts[liftKey].current1rm = Math.round((current * 0.7 + best * 0.3) * 10) / 10;
      }
    }

    return state;
  }

  function publicWorkout(workout) {
    var result = {
      liftKey: workout.liftKey,
      mainExercise: workout.mainExercise,
      needsSetup: workout.needsSetup,
      planned1rm: workout.planned1rm,
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
    var cycle = state.activeCycle;
    return {
      schemaVersion: 1,
      version: state.version,
      updatedAt: state.updatedAt,
      cycle: {
        id: cycle.id,
        title: cycle.title,
        status: cycle.status,
        startDate: cycle.startDate,
        endDate: cycle.endDate,
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
      })
    };
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
      "PRODID:-//MiyaaL//Fitness Plan//ZH-CN",
      "CALSCALE:GREGORIAN",
      "METHOD:PUBLISH",
      "X-WR-CALNAME:MiyaaL 健身计划",
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
    normalizeState: normalizeState,
    generate: generate,
    recordSession: recordSession,
    recordBodyweight: recordBodyweight,
    estimateOneRepMax: estimateOneRepMax,
    suggestAdjustment: suggestAdjustment,
    createPublicSnapshot: createPublicSnapshot,
    generateIcs: generateIcs,
    roundLoad: roundLoad,
    formatLoad: formatLoad,
    addDays: addDays,
    daysBetween: daysBetween,
    isoWeekday: isoWeekday,
    latestBodyweight: latestBodyweight
  };
}));
