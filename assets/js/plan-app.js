(function () {
  "use strict";

  var app = document.querySelector("[data-plan-app]");
  if (!app || !window.PlanCore || !window.PlanStore) {
    return;
  }

  var core = window.PlanCore;
  var chart = window.PlanChart || null;
  var dom = {
    loading: app.querySelector("[data-plan-loading]"),
    empty: app.querySelector("[data-plan-empty]"),
    view: app.querySelector("[data-plan-view]"),
    message: app.querySelector("[data-plan-message]"),
    syncState: document.querySelector("[data-plan-sync-state]"),
    auth: document.querySelector("[data-plan-auth]"),
    title: app.querySelector("[data-plan-title]"),
    cycleMeta: app.querySelector("[data-plan-cycle-meta]"),
    ownerActions: app.querySelector("[data-plan-owner-actions]"),
    updateBodyweight: app.querySelector("[data-plan-update-bodyweight]"),
    edit: app.querySelector("[data-plan-edit]"),
    newCycle: app.querySelector("[data-plan-new-cycle]"),
    signOut: app.querySelector("[data-plan-sign-out]"),
    progress: app.querySelector("[data-plan-progress]"),
    chart: app.querySelector("[data-plan-chart]"),
    warnings: app.querySelector("[data-plan-warnings]"),
    cycleSelectWrap: app.querySelector("[data-plan-cycle-select-wrap]"),
    cycleSelect: app.querySelector("[data-plan-cycle-select]"),
    exportIcs: app.querySelector("[data-plan-export-ics]"),
    exportJson: app.querySelector("[data-plan-export-json]"),
    viewTitle: app.querySelector("[data-plan-view-title]"),
    month: app.querySelector("[data-plan-month]"),
    monthGrid: app.querySelector("[data-plan-month-grid]"),
    agenda: app.querySelector("[data-plan-agenda]"),
    previous: app.querySelector("[data-plan-previous]"),
    today: app.querySelector("[data-plan-today]"),
    next: app.querySelector("[data-plan-next]"),
    drawer: app.querySelector("[data-plan-drawer]"),
    detailTitle: app.querySelector("[data-plan-detail-title]"),
    detailBody: app.querySelector("[data-plan-detail-body]"),
    settings: app.querySelector("[data-plan-settings]"),
    settingsForm: app.querySelector("[data-plan-settings-form]"),
    settingsTitle: app.querySelector("[data-plan-settings-title]"),
    settingsBodyweight: app.querySelector("[data-plan-settings-bodyweight]"),
    formError: app.querySelector("[data-plan-form-error]"),
    bodyweightDialog: app.querySelector("[data-plan-bodyweight-dialog]"),
    bodyweightForm: app.querySelector("[data-plan-bodyweight-form]"),
    bodyweightError: app.querySelector("[data-plan-bodyweight-error]"),
    templateEditor: app.querySelector("[data-plan-template-editor]"),
    holidayDate: app.querySelector("[data-plan-holiday-date]"),
    holidayType: app.querySelector("[data-plan-holiday-type]"),
    holidayOverrides: app.querySelector("[data-plan-holiday-overrides]"),
    conflict: app.querySelector("[data-plan-conflict]")
  };
  var config = {
    url: app.dataset.supabaseUrl || "",
    publishableKey: app.dataset.supabaseKey || "",
    ownerGithubId: app.dataset.ownerGithubId || "",
    redirectTo: window.location.origin + "/plan/"
  };
  var store = window.PlanStore.createSupabaseAdapter(config);
  var holidayCalendars = [];
  var privateState = null;
  var publicSnapshot = null;
  var previewState = null;
  var isOwner = false;
  var isOffline = false;
  var viewingChartArchive = -1;
  var viewDate = todayInShanghai();
  var selectedSessionId = null;
  var settingsNewCycle = false;
  var settingsDraftCycle = null;
  var settingsHolidayOverrides = {};
  var pendingConflictState = null;
  var mobileQuery = window.matchMedia("(max-width: 780px)");
  var chartResizeTimer = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function todayInShanghai() {
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit"
      }).format(new Date());
    } catch (_) {
      return new Date().toISOString().slice(0, 10);
    }
  }

  function deepClone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  }

  function showMessage(text, kind) {
    dom.message.textContent = text || "";
    dom.message.dataset.kind = kind || "";
  }

  function setLoading(value) {
    dom.loading.hidden = !value;
    if (value) {
      dom.empty.hidden = true;
      dom.view.hidden = true;
    }
  }

  function setSyncState() {
    if (!store.configured) {
      dom.syncState.textContent = "同步未配置";
    } else if (isOffline) {
      dom.syncState.textContent = "离线 · 只读";
    } else if (isOwner) {
      dom.syncState.textContent = "已同步 · 本人";
    } else {
      dom.syncState.textContent = "公开只读";
    }
  }

  async function loadHolidayCalendars() {
    try {
      var response = await fetch(app.dataset.holidayUrl, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error("holiday_fetch_failed");
      }
      holidayCalendars = [await response.json()];
    } catch (_) {
      holidayCalendars = [];
    }
  }

  function createPreview() {
    previewState = core.createDefaultState(todayInShanghai());
    previewState.activeCycle.status = "draft";
    publicSnapshot = null;
    privateState = null;
    isOwner = false;
    isOffline = true;
    viewingChartArchive = -1;
    showMessage("Supabase 尚未配置；当前仅展示默认周模板预览。", "notice");
    render();
  }

  async function loadPublicPlan() {
    isOwner = false;
    privateState = null;
    viewingChartArchive = -1;
    var result = await store.loadPublic();
    isOffline = result.offline;
    publicSnapshot = result.record ? result.record.snapshot : null;
    if (result.record && publicSnapshot) {
      publicSnapshot.version = Number(result.record.version || publicSnapshot.version || 0);
      publicSnapshot.updatedAt = result.record.updatedAt || publicSnapshot.updatedAt;
    }
    previewState = null;
    render();
    if (result.error) {
      showMessage("网络不可用，正在显示最近一次公开缓存。", "offline");
    }
  }

  async function loadOwnerPlan() {
    try {
      var record = await store.loadPrivate();
      privateState = record && record.state
        ? core.normalizeState(record.state)
        : core.createDefaultState(todayInShanghai());
      privateState.version = record ? Number(record.version || 0) : 0;
      privateState.updatedAt = record ? record.updatedAt : null;
      isOwner = true;
      isOffline = false;
      publicSnapshot = null;
      previewState = null;
      viewingChartArchive = -1;
      render();
      if (!record) {
        openSettings(false);
      }
    } catch (error) {
      if (error.code === "not_plan_owner") {
        await store.signOut();
        showMessage("当前 GitHub 账号没有计划写权限。", "error");
        await loadPublicPlan();
        return;
      }
      throw error;
    }
  }

  async function initialize() {
    setLoading(true);
    await loadHolidayCalendars();

    if (!store.configured) {
      setLoading(false);
      createPreview();
      return;
    }

    try {
      var session = await store.getSession();
      if (session) {
        await loadOwnerPlan();
      } else {
        await loadPublicPlan();
      }
    } catch (error) {
      setLoading(false);
      showMessage("计划载入失败：" + error.message, "error");
      try {
        await loadPublicPlan();
      } catch (_) {
        renderEmpty();
      }
    }

    store.onAuthChange(function (event, session) {
      if (event === "SIGNED_IN" && session) {
        loadOwnerPlan().catch(function (error) {
          showMessage("登录后载入失败：" + error.message, "error");
        });
      }
      if (event === "SIGNED_OUT") {
        loadPublicPlan().catch(function (error) {
          showMessage("公开计划载入失败：" + error.message, "error");
        });
      }
    });
  }

  function renderEmpty() {
    setLoading(false);
    dom.empty.hidden = false;
    dom.view.hidden = true;
    setSyncState();
    dom.auth.hidden = false;
    dom.auth.textContent = store.configured ? "管理计划" : "同步未配置";
  }

  function displayPlan() {
    if (isOwner && privateState) {
      return core.generate(privateState, holidayCalendars);
    }
    if (previewState) {
      return core.generate(previewState, holidayCalendars);
    }
    if (publicSnapshot) {
      return {
        cycle: publicSnapshot.cycle,
        sessions: core.filterLegacyOfficialMakeups(
          publicSnapshot.sessions || [],
          holidayCalendars
        ),
        warnings: publicSnapshot.warnings || [],
        totalWeeks: publicSnapshot.totalWeeks || 0
      };
    }
    return null;
  }

  function snapshotProgressOverview(plan) {
    return {
      cycle: deepClone(plan.cycle),
      totalWeeks: plan.totalWeeks,
      sessions: (plan.sessions || []).map(function (session) {
        return {
          date: session.date,
          status: session.status,
          phase: session.phase ? { label: session.phase.label } : null,
          workout: session.workout ? {
            liftKey: session.workout.liftKey,
            planned1rm: session.workout.planned1rm
          } : null
        };
      })
    };
  }

  function planForArchive(archive) {
    if (archive.overview && archive.overview.cycle) {
      return deepClone(archive.overview);
    }
    var archivedState = core.createDefaultState(archive.cycle.startDate);
    archivedState.preferences = deepClone(privateState.preferences);
    archivedState.activeCycle = deepClone(archive.cycle);
    archivedState.logs = deepClone(archive.logs || {});
    return core.generate(archivedState, holidayCalendars);
  }

  function displayTrajectoryPlan(activePlan) {
    if (!isOwner || !privateState || viewingChartArchive < 0) {
      return activePlan;
    }
    var archive = privateState.archivedCycles[viewingChartArchive];
    if (!archive || !archive.cycle) {
      viewingChartArchive = -1;
      return activePlan;
    }
    return planForArchive(archive);
  }

  function render() {
    setLoading(false);
    var plan = displayPlan();
    if (!plan || !plan.cycle) {
      renderEmpty();
      return;
    }

    dom.empty.hidden = true;
    dom.view.hidden = false;
    dom.auth.hidden = isOwner;
    dom.auth.textContent = store.configured ? "管理计划" : "同步未配置";
    dom.ownerActions.hidden = !isOwner || isOffline;
    dom.exportJson.hidden = !isOwner;
    setSyncState();

    dom.title.textContent = plan.cycle.title || "推拉蹲 + 推";
    dom.cycleMeta.textContent = formatDateRange(plan.cycle.startDate, plan.cycle.endDate) +
      " · " + plan.totalWeeks + " 周 · " + plan.sessions.length + " 次训练";

    renderProgress(plan.cycle);
    renderWarnings(plan);
    renderCycleSelect();
    renderTrajectory(displayTrajectoryPlan(plan));
    normalizeViewDate(plan.cycle);
    renderCalendar(plan);
  }

  function normalizeViewDate(cycle) {
    if (!viewDate || viewDate < core.addDays(cycle.startDate, -35) || viewDate > core.addDays(cycle.endDate, 35)) {
      viewDate = cycle.startDate;
    }
  }

  function formatDateRange(start, end) {
    return formatChineseDate(start, false) + " — " + formatChineseDate(end, false);
  }

  function formatChineseDate(value, includeWeekday) {
    var date = new Date(value + "T12:00:00+08:00");
    return new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long",
      day: "numeric",
      weekday: includeWeekday ? "short" : undefined
    }).format(date);
  }

  function renderProgress(cycle) {
    dom.progress.innerHTML = ["bench", "pullup", "squat"].map(function (key) {
      var lift = cycle.lifts[key] || {};
      var current = Number(lift.current1rm || 0);
      var target = Number(lift.target1rm || 0);
      var percentage = target > 0 ? Math.min(100, Math.max(0, current / target * 100)) : 0;
      var suffix = key === "pullup" ? " kg 额外负重" : " kg";
      return '<div class="plan-progress-item">' +
        '<div class="plan-progress-label"><strong>' + escapeHtml(lift.label || core.LIFT_LABELS[key]) + '</strong>' +
        '<span>' + (current ? current.toFixed(1).replace(".0", "") : "—") + " → " +
        (target ? target.toFixed(1).replace(".0", "") : "—") + escapeHtml(suffix) + '</span></div>' +
        '<div class="plan-progress-track" aria-hidden="true"><span style="--plan-progress:' +
        percentage.toFixed(1) + '%"></span></div></div>';
    }).join("");
  }

  function renderTrajectory(plan) {
    if (!dom.chart) {
      return;
    }
    if (!chart) {
      dom.chart.hidden = true;
      return;
    }
    dom.chart.hidden = false;
    chart.render(dom.chart, plan, { today: todayInShanghai() });
  }

  function renderWarnings(plan) {
    var warnings = (plan.warnings || []).slice();
    var startYear = Number(String(plan.cycle.startDate).slice(0, 4));
    if (!holidayCalendars.some(function (calendar) { return Number(calendar.year) === startYear; })) {
      warnings.unshift("当前周期缺少 " + startYear + " 年官方节假日数据，请在设置中手动覆盖。");
    }
    dom.warnings.hidden = warnings.length === 0;
    dom.warnings.innerHTML = warnings.slice(0, 5).map(function (warning) {
      return "<p>· " + escapeHtml(warning) + "</p>";
    }).join("");
  }

  function renderCycleSelect() {
    var archives = isOwner && privateState ? privateState.archivedCycles : [];
    dom.cycleSelectWrap.hidden = !isOwner || !privateState;
    if (!isOwner || !privateState) {
      viewingChartArchive = -1;
      return;
    }
    if (viewingChartArchive >= archives.length) {
      viewingChartArchive = -1;
    }
    var cycleCount = archives.length + 1;
    var activeCycle = privateState.activeCycle;
    var options = ['<option value="-1">' +
      escapeHtml("Cycle " + String(cycleCount).padStart(2, "0") + " · Current · " +
        String(activeCycle.startDate).replace(/-/g, ".") + " — " +
        String(activeCycle.endDate).replace(/-/g, ".")) +
      "</option>"];
    archives.forEach(function (archive, index) {
      var ordinal = archives.length - index;
      options.push('<option value="' + index + '">' +
        escapeHtml("Cycle " + String(ordinal).padStart(2, "0") + " · Archived · " +
          String(archive.cycle.startDate).replace(/-/g, ".") + " — " +
          String(archive.cycle.endDate).replace(/-/g, ".")) +
        "</option>");
    });
    dom.cycleSelect.innerHTML = options.join("");
    dom.cycleSelect.value = String(viewingChartArchive);
  }

  function monthStart(value) {
    return String(value).slice(0, 7) + "-01";
  }

  function shiftMonth(value, amount) {
    var parts = monthStart(value).split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1 + amount, 1)).toISOString().slice(0, 10);
  }

  function weekStart(value) {
    return core.addDays(value, 1 - core.isoWeekday(value));
  }

  function sessionsByDate(plan) {
    return plan.sessions.reduce(function (map, session) {
      map[session.date] = map[session.date] || [];
      map[session.date].push(session);
      return map;
    }, {});
  }

  function renderCalendar(plan) {
    var map = sessionsByDate(plan);
    if (mobileQuery.matches) {
      renderAgenda(plan, map);
    } else {
      renderMonth(plan, map);
    }
  }

  function renderMonth(plan, map) {
    var first = monthStart(viewDate);
    var gridStart = core.addDays(first, 1 - core.isoWeekday(first));
    var currentMonth = first.slice(0, 7);
    dom.viewTitle.textContent = new Intl.DateTimeFormat("zh-CN", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long"
    }).format(new Date(first + "T12:00:00+08:00"));

    var cells = [];
    for (var index = 0; index < 42; index += 1) {
      var date = core.addDays(gridStart, index);
      var sessions = map[date] || [];
      var session = sessions[0];
      var classes = ["plan-day"];
      if (date.slice(0, 7) !== currentMonth) {
        classes.push("is-outside");
      }
      if (date === todayInShanghai()) {
        classes.push("is-today");
      }
      var attributes = session ? ' data-session-id="' + escapeHtml(session.id) + '"' : "";
      var content = '<span class="plan-day-number">' + Number(date.slice(-2)) + "</span>";
      if (session) {
        content += '<strong class="plan-day-badge">' + escapeHtml(shortTypeLabel(session.type)) + "</strong>";
        content += '<span class="plan-day-load">' + escapeHtml(primaryLoad(session)) + "</span>";
        if (session.status && session.status !== "planned") {
          content += '<span class="plan-day-status is-' + escapeHtml(session.status) + '">' +
            escapeHtml(statusLabel(session.status)) + "</span>";
        }
        if (session.holiday) {
          content += '<span class="plan-day-holiday">调休</span>';
        }
      } else {
        var holiday = holidayForDate(date);
        if (holiday && holiday.type === "off") {
          content += '<span class="plan-day-holiday">休</span>';
        }
      }
      cells.push('<button class="' + classes.join(" ") + '" type="button"' + attributes +
        (session ? ' aria-label="' + escapeHtml(formatChineseDate(date, true) + " " + session.label) + '"' : ' tabindex="-1"') +
        ">" + content + "</button>");
    }
    dom.monthGrid.innerHTML = cells.join("");
  }

  function renderAgenda(plan, map) {
    var start = weekStart(viewDate);
    var end = core.addDays(start, 6);
    dom.viewTitle.textContent = formatChineseDate(start, false) + " — " + formatChineseDate(end, false);
    var rows = [];
    for (var index = 0; index < 7; index += 1) {
      var date = core.addDays(start, index);
      var sessions = map[date] || [];
      var dateLabel = new Intl.DateTimeFormat("zh-CN", {
        timeZone: "Asia/Shanghai",
        month: "numeric",
        day: "numeric",
        weekday: "short"
      }).format(new Date(date + "T12:00:00+08:00"));
      var content = sessions.length ? sessions.map(function (session) {
        return '<button class="plan-agenda-session" type="button" data-session-id="' +
          escapeHtml(session.id) + '"><strong>' + escapeHtml(session.label) + '</strong><span>' +
          escapeHtml(primaryLoad(session) + " · " + session.phase.label + " · " + statusLabel(session.status)) +
          "</span></button>";
      }).join("") : '<span class="plan-agenda-rest">' +
        (holidayForDate(date) && holidayForDate(date).type === "off" ? "法定休息日" : "恢复 / 无训练") +
        "</span>";
      rows.push('<div class="plan-agenda-day"><div class="plan-agenda-date">' +
        escapeHtml(dateLabel) + '</div><div>' + content + "</div></div>");
    }
    dom.agenda.innerHTML = rows.join("");
  }

  function shortTypeLabel(type) {
    return {
      "push-strength": "推 · 强度",
      pull: "拉",
      squat: "蹲",
      "push-volume": "推 · 容量"
    }[type] || type;
  }

  function statusLabel(status) {
    return {
      planned: "计划中",
      completed: "已完成",
      skipped: "已跳过"
    }[status] || status || "计划中";
  }

  function primaryLoad(session) {
    var workout = session.workout || {};
    if (workout.needsSetup || !workout.workSets || !workout.workSets.length) {
      return "待设置重量";
    }
    var set = workout.workSets[0];
    var load = Object.prototype.hasOwnProperty.call(set, "loadKg")
      ? " · " + core.formatLoad(set.loadKg, workout.liftKey)
      : " · RPE " + set.rpe;
    return set.sets + "×" + set.reps + load;
  }

  function holidayForDate(date) {
    var overrides = privateState
      ? privateState.activeCycle.holidayOverrides || {}
      : {};
    if (overrides[date]) {
      return { type: overrides[date], name: overrides[date] === "off" ? "自定义休息日" : "自定义调休" };
    }
    for (var calendarIndex = 0; calendarIndex < holidayCalendars.length; calendarIndex += 1) {
      var periods = holidayCalendars[calendarIndex].periods || [];
      for (var periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
        if ((periods[periodIndex].daysOff || []).indexOf(date) >= 0) {
          return { type: "off", name: periods[periodIndex].name };
        }
        if ((periods[periodIndex].workdays || []).indexOf(date) >= 0) {
          return { type: "work", name: periods[periodIndex].name + "调休" };
        }
      }
    }
    return null;
  }

  function currentSessions() {
    var plan = displayPlan();
    return plan ? plan.sessions : [];
  }

  function findSession(id) {
    return currentSessions().find(function (session) {
      return session.id === id;
    });
  }

  function openDetails(id) {
    var session = findSession(id);
    if (!session) {
      return;
    }
    selectedSessionId = id;
    dom.detailTitle.textContent = session.label;
    dom.detailBody.innerHTML = sessionDetailsHtml(session);
    dom.drawer.hidden = false;
    document.documentElement.classList.add("plan-drawer-open");
    bindDetailActions(session);
  }

  function closeDetails() {
    dom.drawer.hidden = true;
    selectedSessionId = null;
    document.documentElement.classList.remove("plan-drawer-open");
  }

  function setListHtml(items, liftKey) {
    if (!items || !items.length) {
      return "<p>保存周期参数后生成精确重量。</p>";
    }
    return '<ul class="plan-set-list">' + items.map(function (item) {
      var load = Object.prototype.hasOwnProperty.call(item, "loadKg")
        ? core.formatLoad(item.loadKg, liftKey)
        : "";
      return "<li><strong>" + escapeHtml(item.label || item.name) + "</strong><span>" +
        escapeHtml(item.sets + "×" + item.reps + (load ? " · " + load : "") +
          (item.rpe ? " · RPE " + item.rpe : "") + (item.rest ? " · " + item.rest : "")) +
        "</span></li>";
    }).join("") + "</ul>";
  }

  function sessionDetailsHtml(session) {
    var workout = session.workout || {};
    var holiday = session.holiday
      ? " · " + session.holiday.name + "补课（原 " + session.holiday.movedFrom + "）"
      : "";
    var html = '<p class="plan-session-meta"><span>' + escapeHtml(formatChineseDate(session.date, true)) +
      '</span><span>' + escapeHtml(session.phase.label) + '</span><span>' +
      escapeHtml(statusLabel(session.status)) + escapeHtml(holiday) + "</span></p>";
    html += '<section class="plan-session-section"><h3>主动作 · ' +
      escapeHtml(workout.mainExercise || session.label) + "</h3>" +
      (workout.needsSetup ? "<p>尚未填写当前与目标 1RM。</p>" : "") +
      setListHtml(workout.workSets, workout.liftKey) + "</section>";
    html += '<section class="plan-session-section"><h3>热身组</h3>' +
      setListHtml(workout.warmups, workout.liftKey) + "</section>";
    html += '<section class="plan-session-section"><h3>辅助动作</h3>' +
      setListHtml(workout.accessories, null) + "</section>";

    if (isOwner && !isOffline && !workout.needsSetup) {
      html += trainingLogHtml(session);
    }
    return html;
  }

  function trainingLogHtml(session) {
    var log = privateState.logs[session.id] || {};
    var rows = [];
    (session.workout.workSets || []).forEach(function (prescription, groupIndex) {
      for (var setIndex = 0; setIndex < prescription.sets; setIndex += 1) {
        var saved = (log.mainSets || [])[rows.length] || {};
        rows.push('<div class="plan-log-grid" data-log-set data-planned-reps="' +
          escapeHtml(prescription.reps) + '"><span>#' + (rows.length + 1) + '</span>' +
          '<label>重量<input class="plan-log-input" data-log-weight type="number" step="0.1" value="' +
          escapeHtml(saved.weight != null ? saved.weight : prescription.loadKg) + '"></label>' +
          '<label>次数<input class="plan-log-input" data-log-reps type="number" min="1" max="30" value="' +
          escapeHtml(saved.reps != null ? saved.reps : prescription.reps) + '"></label>' +
          '<label>RPE<input class="plan-log-input" data-log-rpe type="number" min="6" max="10" step="0.5" value="' +
          escapeHtml(saved.rpe != null ? saved.rpe : prescription.rpe) + '"></label></div>');
      }
    });
    var accessoryRows = (session.workout.accessories || []).map(function (accessory) {
      var saved = (log.accessories || []).find(function (entry) {
        return entry.name === accessory.name;
      }) || {};
      var repMatches = String(accessory.reps || "").match(/\d+/g);
      var defaultReps = repMatches ? Math.max.apply(Math, repMatches.map(Number)) : "";
      return '<div class="plan-accessory-log" data-accessory-log data-accessory-name="' +
        escapeHtml(accessory.name) + '"><strong>' + escapeHtml(accessory.name) + '</strong>' +
        '<label>重量<input class="plan-log-input" data-accessory-weight type="number" min="0" step="0.1" value="' +
        escapeHtml(saved.weight != null ? saved.weight : (accessory.loadKg != null ? accessory.loadKg : "")) + '"></label>' +
        '<label>次数<input class="plan-log-input" data-accessory-reps type="number" min="0" max="200" value="' +
        escapeHtml(saved.reps != null ? saved.reps : defaultReps) + '"></label></div>';
    }).join("");

    return '<section class="plan-session-section"><h3>训练记录</h3>' +
      '<div><div class="plan-log-grid"><span></span><span>kg</span><span>reps</span><span>RPE</span></div>' +
      rows.join("") + "</div>" +
      '<div class="plan-accessory-records"><h4>辅助动作 · 聚合记录</h4>' + accessoryRows + "</div>" +
      '<label class="plan-log-notes">备注（仅本人可见）<textarea data-log-notes>' +
      escapeHtml(log.notes || "") + "</textarea></label>" +
      '<div class="plan-log-actions"><button class="plan-button plan-button-primary" type="button" data-save-log>按以上记录完成</button>' +
      '<button class="plan-button" type="button" data-skip-session>跳过本次</button></div>' +
      '<div class="plan-reschedule"><label>改期<input class="plan-log-input" data-move-date type="date" min="' +
      escapeHtml(privateState.activeCycle.startDate) + '" max="' + escapeHtml(privateState.activeCycle.endDate) +
      '" value="' + escapeHtml(session.date) + '"></label><button class="plan-button" type="button" data-move-session>仅移动本次</button></div></section>';
  }

  function bindDetailActions(session) {
    var save = dom.detailBody.querySelector("[data-save-log]");
    if (save) {
      save.addEventListener("click", function () {
        saveTrainingLog(session);
      });
    }
    var skip = dom.detailBody.querySelector("[data-skip-session]");
    if (skip) {
      skip.addEventListener("click", function () {
        privateState = core.recordSession(privateState, session, {
          status: "skipped",
          mainSets: [],
          notes: dom.detailBody.querySelector("[data-log-notes]").value
        });
        persist("已标记为跳过。");
      });
    }
    var move = dom.detailBody.querySelector("[data-move-session]");
    if (move) {
      move.addEventListener("click", function () {
        var date = dom.detailBody.querySelector("[data-move-date]").value;
        if (!date) {
          showMessage("请选择改期日期。", "error");
          return;
        }
        privateState.activeCycle.sessionOverrides[session.id] = { action: "move", date: date };
        persist("本次训练已改期。");
      });
    }
  }

  function saveTrainingLog(session) {
    var sets = Array.prototype.slice.call(dom.detailBody.querySelectorAll("[data-log-set]")).map(function (row) {
      return {
        weight: Number(row.querySelector("[data-log-weight]").value),
        reps: Number(row.querySelector("[data-log-reps]").value),
        rpe: Number(row.querySelector("[data-log-rpe]").value),
        completed: Number(row.querySelector("[data-log-reps]").value) >= Number(row.dataset.plannedReps)
      };
    });
    var accessories = Array.prototype.slice.call(dom.detailBody.querySelectorAll("[data-accessory-log]")).map(function (row) {
      return {
        name: row.dataset.accessoryName,
        weight: Number(row.querySelector("[data-accessory-weight]").value),
        reps: Number(row.querySelector("[data-accessory-reps]").value),
        completed: Number(row.querySelector("[data-accessory-reps]").value) > 0
      };
    });
    privateState = core.recordSession(privateState, session, {
      status: "completed",
      mainSets: sets,
      accessories: accessories,
      notes: dom.detailBody.querySelector("[data-log-notes]").value
    });
    persist("训练记录已保存。");
  }

  async function persist(successMessage) {
    if (!isOwner || isOffline || !store.configured) {
      showMessage("当前为只读状态，无法保存。", "error");
      return;
    }
    privateState.updatedAt = new Date().toISOString();
    var generated = core.generate(privateState, holidayCalendars);
    var snapshot = core.createPublicSnapshot(privateState, generated);
    try {
      var record = await store.save(privateState.version, privateState, snapshot);
      privateState.version = record.version;
      privateState.updatedAt = record.updatedAt;
      closeDetails();
      render();
      showMessage(successMessage, "success");
    } catch (error) {
      if (error.code === "version_conflict") {
        pendingConflictState = deepClone(privateState);
        dom.conflict.showModal();
        return;
      }
      showMessage("保存失败：" + error.message, "error");
    }
  }

  function inputValue(name, value) {
    dom.settingsForm.elements[name].value = value == null ? "" : value;
  }

  function latestBodyweightEntry(cycle, onOrBefore) {
    return (cycle.bodyweightEntries || []).filter(function (entry) {
      return Number(entry.value) > 0 && (!onOrBefore || entry.date <= onOrBefore);
    }).sort(function (left, right) {
      return String(left.date).localeCompare(String(right.date));
    }).slice(-1)[0] || null;
  }

  function openBodyweightDialog() {
    if (!isOwner || isOffline || !privateState) {
      showMessage("请先以本人账号在线登录。", "error");
      return;
    }
    var cycle = privateState.activeCycle;
    var date = todayInShanghai();
    if (date < cycle.startDate) {
      showMessage("当前周期尚未开始，暂不记录未来体重。", "notice");
      return;
    }
    if (date > cycle.endDate) {
      date = cycle.endDate;
    }
    var dateInput = dom.bodyweightForm.elements.date;
    var weightInput = dom.bodyweightForm.elements.bodyweight;
    var latest = latestBodyweightEntry(cycle);
    dateInput.min = cycle.startDate;
    dateInput.max = date;
    dateInput.value = date;
    weightInput.value = latest ? latest.value : "";
    dom.bodyweightError.textContent = "";
    dom.bodyweightDialog.showModal();
  }

  async function saveBodyweight(event) {
    event.preventDefault();
    var form = new FormData(dom.bodyweightForm);
    var date = String(form.get("date") || "");
    var bodyweight = Number(form.get("bodyweight"));
    var cycle = privateState && privateState.activeCycle;
    var latestAllowedDate = cycle && todayInShanghai() < cycle.endDate
      ? todayInShanghai()
      : cycle && cycle.endDate;
    if (!cycle || !date || date < cycle.startDate || date > latestAllowedDate) {
      dom.bodyweightError.textContent = "记录日期必须位于当前周期内，且不能晚于今天。";
      return;
    }
    if (!bodyweight || bodyweight < 30 || bodyweight > 300) {
      dom.bodyweightError.textContent = "请输入 30–300 kg 之间的有效体重。";
      return;
    }
    privateState = core.recordBodyweight(privateState, {
      date: date,
      value: bodyweight
    });
    dom.bodyweightDialog.close();
    await persist("体重记录已更新。");
  }

  function openSettings(newCycle) {
    if (!isOwner || isOffline) {
      showMessage("请先以本人账号在线登录。", "error");
      return;
    }
    settingsNewCycle = Boolean(newCycle);
    if (settingsNewCycle) {
      var fresh = core.createDefaultState(todayInShanghai());
      var current = privateState.activeCycle;
      fresh.activeCycle.lifts.bench.current1rm = current.lifts.bench.current1rm;
      fresh.activeCycle.lifts.pullup.current1rm = current.lifts.pullup.current1rm;
      fresh.activeCycle.lifts.squat.current1rm = current.lifts.squat.current1rm;
      fresh.activeCycle.lifts.bench.target1rm = current.lifts.bench.current1rm;
      fresh.activeCycle.lifts.pullup.target1rm = current.lifts.pullup.current1rm;
      fresh.activeCycle.lifts.squat.target1rm = current.lifts.squat.current1rm;
      settingsDraftCycle = fresh.activeCycle;
    } else {
      settingsDraftCycle = deepClone(privateState.activeCycle);
    }

    settingsHolidayOverrides = deepClone(settingsDraftCycle.holidayOverrides || {});
    dom.settingsTitle.textContent = settingsNewCycle ? "开始新周期" : "编辑计划";
    inputValue("startDate", settingsDraftCycle.startDate);
    inputValue("endDate", settingsDraftCycle.endDate);
    inputValue("trainingTime", privateState.preferences.trainingTime || "19:00");
    var bootstrapsBodyweight = !settingsNewCycle && settingsDraftCycle.status === "draft";
    dom.settingsBodyweight.hidden = !bootstrapsBodyweight;
    dom.settingsForm.elements.bodyweight.disabled = !bootstrapsBodyweight;
    dom.settingsForm.elements.bodyweight.required = bootstrapsBodyweight;
    inputValue("bodyweight", bootstrapsBodyweight ? core.latestBodyweight(settingsDraftCycle) || "" : "");
    inputValue("benchCurrent", settingsDraftCycle.lifts.bench.current1rm);
    inputValue("benchTarget", settingsDraftCycle.lifts.bench.target1rm);
    inputValue("pullupCurrent", settingsDraftCycle.lifts.pullup.current1rm);
    inputValue("pullupTarget", settingsDraftCycle.lifts.pullup.target1rm);
    inputValue("squatCurrent", settingsDraftCycle.lifts.squat.current1rm);
    inputValue("squatTarget", settingsDraftCycle.lifts.squat.target1rm);
    dom.formError.textContent = "";
    renderTemplateEditor(settingsDraftCycle.template);
    renderHolidayOverrides();
    dom.settings.showModal();
  }

  function templateTypeOptions(selected) {
    return Object.keys(core.TYPE_LABELS).map(function (type) {
      return '<option value="' + type + '"' + (type === selected ? " selected" : "") + ">" +
        escapeHtml(core.TYPE_LABELS[type]) + "</option>";
    }).join("");
  }

  function weekdayOptions(selected) {
    var labels = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];
    return labels.map(function (label, index) {
      var weekday = index + 1;
      return '<option value="' + weekday + '"' + (Number(selected) === weekday ? " selected" : "") +
        ">" + label + "</option>";
    }).join("");
  }

  function renderTemplateEditor(template) {
    dom.templateEditor.innerHTML = (template || []).map(function (item) {
      return '<div class="plan-template-row" draggable="true" data-template-id="' + escapeHtml(item.id) + '">' +
        '<span class="plan-template-handle" aria-hidden="true">⠿</span>' +
        '<select data-template-type aria-label="训练类型">' + templateTypeOptions(item.type) + "</select>" +
        '<select data-template-weekday aria-label="星期">' + weekdayOptions(item.weekday) + "</select>" +
        '<div class="plan-template-actions"><button type="button" data-template-up aria-label="上移">↑</button>' +
        '<button type="button" data-template-down aria-label="下移">↓</button>' +
        '<button type="button" data-template-remove aria-label="删除">×</button></div></div>';
    }).join("");
    bindTemplateEditor();
  }

  function bindTemplateEditor() {
    Array.prototype.slice.call(dom.templateEditor.querySelectorAll(".plan-template-row")).forEach(function (row) {
      row.querySelector("[data-template-up]").addEventListener("click", function () {
        if (row.previousElementSibling) {
          row.parentNode.insertBefore(row, row.previousElementSibling);
        }
      });
      row.querySelector("[data-template-down]").addEventListener("click", function () {
        if (row.nextElementSibling) {
          row.parentNode.insertBefore(row.nextElementSibling, row);
        }
      });
      row.querySelector("[data-template-remove]").addEventListener("click", function () {
        row.remove();
      });
      row.addEventListener("dragstart", function () {
        row.classList.add("is-dragging");
      });
      row.addEventListener("dragend", function () {
        row.classList.remove("is-dragging");
      });
    });
  }

  function handleTemplateDrag(event) {
    event.preventDefault();
    var dragging = dom.templateEditor.querySelector(".is-dragging");
    if (!dragging) {
      return;
    }
    var rows = Array.prototype.slice.call(dom.templateEditor.querySelectorAll(".plan-template-row:not(.is-dragging)"));
    var target = rows.find(function (row) {
      return event.clientY < row.getBoundingClientRect().top + row.offsetHeight / 2;
    });
    dom.templateEditor.insertBefore(dragging, target || null);
  }

  function readTemplateEditor() {
    return Array.prototype.slice.call(dom.templateEditor.querySelectorAll(".plan-template-row")).map(function (row, index) {
      var type = row.querySelector("[data-template-type]").value;
      return {
        id: row.dataset.templateId || type + "-" + Date.now() + "-" + index,
        weekday: Number(row.querySelector("[data-template-weekday]").value),
        type: type,
        label: core.TYPE_LABELS[type]
      };
    });
  }

  function renderHolidayOverrides() {
    var entries = Object.keys(settingsHolidayOverrides).sort();
    dom.holidayOverrides.innerHTML = entries.length ? entries.map(function (date) {
      return '<div class="plan-holiday-item"><span>' + escapeHtml(date + " · " +
        (settingsHolidayOverrides[date] === "off" ? "休息日" : "调休工作日")) +
        '</span><button class="plan-text-button" type="button" data-remove-holiday="' +
        escapeHtml(date) + '">删除</button></div>';
    }).join("") : '<p class="plan-cycle-meta">暂无手动覆盖。</p>';
    Array.prototype.slice.call(dom.holidayOverrides.querySelectorAll("[data-remove-holiday]")).forEach(function (button) {
      button.addEventListener("click", function () {
        delete settingsHolidayOverrides[button.dataset.removeHoliday];
        renderHolidayOverrides();
      });
    });
  }

  async function saveSettings(event) {
    event.preventDefault();
    var form = new FormData(dom.settingsForm);
    var startDate = form.get("startDate");
    var endDate = form.get("endDate");
    var bootstrapsBodyweight = !settingsNewCycle && privateState.activeCycle.status === "draft";
    var previousBodyweight = latestBodyweightEntry(
      privateState.activeCycle,
      settingsNewCycle ? String(startDate || "") : null
    );
    var bodyweight = bootstrapsBodyweight
      ? Number(form.get("bodyweight"))
      : previousBodyweight && Number(previousBodyweight.value);
    var lifts = {
      bench: { current: Number(form.get("benchCurrent")), target: Number(form.get("benchTarget")) },
      pullup: { current: Number(form.get("pullupCurrent")), target: Number(form.get("pullupTarget")) },
      squat: { current: Number(form.get("squatCurrent")), target: Number(form.get("squatTarget")) }
    };
    var template = readTemplateEditor();
    var weekdays = template.map(function (item) { return item.weekday; });

    if (!startDate || !endDate || endDate < startDate) {
      dom.formError.textContent = "目标日期必须晚于开始日期。";
      return;
    }
    if (core.daysBetween(startDate, endDate) < 27) {
      dom.formError.textContent = "计划至少需要 4 周；少于 8 周会继续显示风险提示。";
      return;
    }
    if (!bodyweight || bodyweight <= 0) {
      dom.formError.textContent = bootstrapsBodyweight
        ? "请填写有效的初始体重。"
        : "请先通过“更新体重”记录有效体重。";
      return;
    }
    if (!lifts.bench.current || !lifts.bench.target ||
        !lifts.squat.current || !lifts.squat.target ||
        bodyweight + lifts.pullup.current <= 0 ||
        bodyweight + lifts.pullup.target <= 0) {
      dom.formError.textContent = "请填写有效的三项当前/目标 1RM。";
      return;
    }
    if (!template.length || new Set(weekdays).size !== weekdays.length) {
      dom.formError.textContent = "周模板至少需要一个训练日，且同一天只能安排一次训练。";
      return;
    }

    if (settingsNewCycle && privateState.activeCycle.status !== "draft") {
      var archivedLogs = {};
      var archivedCycle = deepClone(privateState.activeCycle);
      var archivedOverview = snapshotProgressOverview(core.generate(privateState, holidayCalendars));
      archivedCycle.status = "archived";
      archivedOverview.cycle.status = "archived";
      Object.keys(privateState.logs).forEach(function (id) {
        if (id.indexOf(privateState.activeCycle.id + ":") === 0) {
          archivedLogs[id] = privateState.logs[id];
          delete privateState.logs[id];
        }
      });
      privateState.archivedCycles.unshift({
        cycle: archivedCycle,
        logs: archivedLogs,
        overview: archivedOverview,
        archivedAt: new Date().toISOString()
      });
    }

    var cycle = settingsNewCycle ? core.createDefaultState(startDate).activeCycle : privateState.activeCycle;
    cycle.startDate = startDate;
    cycle.endDate = endDate;
    cycle.id = settingsNewCycle ? "cycle-" + startDate + "-" + Date.now().toString(36) : cycle.id;
    cycle.status = "active";
    cycle.template = template;
    cycle.holidayOverrides = deepClone(settingsHolidayOverrides);
    cycle.sessionOverrides = settingsNewCycle ? {} : cycle.sessionOverrides || {};
    if (settingsNewCycle) {
      cycle.bodyweightEntries = [];
      if (previousBodyweight) {
        var carriedBodyweight = { date: startDate, value: Number(previousBodyweight.value) };
        var carriedFrom = previousBodyweight.carriedFrom || previousBodyweight.date;
        if (carriedFrom !== startDate) {
          carriedBodyweight.carriedFrom = carriedFrom;
        }
        cycle.bodyweightEntries.push(carriedBodyweight);
      }
    } else if (bootstrapsBodyweight) {
      cycle.bodyweightEntries = (cycle.bodyweightEntries || []).filter(function (entry) {
        return entry.date !== startDate;
      });
      cycle.bodyweightEntries.push({ date: startDate, value: bodyweight });
    }
    cycle.lifts.bench.current1rm = lifts.bench.current;
    cycle.lifts.bench.target1rm = lifts.bench.target;
    cycle.lifts.pullup.current1rm = lifts.pullup.current;
    cycle.lifts.pullup.target1rm = lifts.pullup.target;
    cycle.lifts.squat.current1rm = lifts.squat.current;
    cycle.lifts.squat.target1rm = lifts.squat.target;
    ["bench", "pullup", "squat"].forEach(function (key) {
      var lift = cycle.lifts[key];
      if (settingsNewCycle || lift.baseline1rm == null || lift.baseline1rm === "") {
        lift.baseline1rm = lift.current1rm;
      }
    });
    privateState.activeCycle = cycle;
    privateState.preferences.trainingTime = form.get("trainingTime") || "19:00";
    viewingChartArchive = -1;
    dom.settings.close();
    await persist(settingsNewCycle ? "新周期已创建，旧周期已归档。" : "计划已重新生成。");
  }

  function download(name, content, type) {
    var blob = new Blob([content], { type: type });
    var url = URL.createObjectURL(blob);
    var anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }

  function exportIcs() {
    var plan = displayPlan();
    if (!plan) {
      return;
    }
    var preferences = privateState ? privateState.preferences : {
      timezone: "Asia/Shanghai",
      trainingTime: "19:00",
      durationMinutes: 90,
      reminderMinutes: 120
    };
    download("miyaal-fitness-plan.ics", core.generateIcs(plan, preferences), "text/calendar;charset=utf-8");
  }

  function exportJson() {
    if (!privateState) {
      return;
    }
    download(
      "miyaal-fitness-plan-backup-" + todayInShanghai() + ".json",
      JSON.stringify(privateState, null, 2) + "\n",
      "application/json;charset=utf-8"
    );
  }

  async function forceSave() {
    if (!pendingConflictState) {
      dom.conflict.close();
      return;
    }
    try {
      var latest = await store.loadPrivate();
      pendingConflictState.version = latest ? latest.version : 0;
      privateState = pendingConflictState;
      pendingConflictState = null;
      dom.conflict.close();
      await persist("当前修改已覆盖服务器版本。");
    } catch (error) {
      showMessage("强制覆盖失败：" + error.message, "error");
    }
  }

  async function reloadAfterConflict() {
    pendingConflictState = null;
    dom.conflict.close();
    await loadOwnerPlan();
    showMessage("已重新载入服务器版本。", "success");
  }

  dom.auth.addEventListener("click", function () {
    if (!store.configured) {
      showMessage("请先在 _config.yml 配置 Supabase URL 与 Publishable Key。", "notice");
      return;
    }
    store.signIn().catch(function (error) {
      showMessage("GitHub 登录失败：" + error.message, "error");
    });
  });
  dom.updateBodyweight.addEventListener("click", openBodyweightDialog);
  dom.edit.addEventListener("click", function () { openSettings(false); });
  dom.newCycle.addEventListener("click", function () { openSettings(true); });
  dom.signOut.addEventListener("click", function () {
    store.signOut().catch(function (error) {
      showMessage("退出失败：" + error.message, "error");
    });
  });
  dom.exportIcs.addEventListener("click", exportIcs);
  dom.exportJson.addEventListener("click", exportJson);
  dom.previous.addEventListener("click", function () {
    viewDate = mobileQuery.matches ? core.addDays(weekStart(viewDate), -7) : shiftMonth(viewDate, -1);
    renderCalendar(displayPlan());
  });
  dom.today.addEventListener("click", function () {
    viewDate = todayInShanghai();
    renderCalendar(displayPlan());
  });
  dom.next.addEventListener("click", function () {
    viewDate = mobileQuery.matches ? core.addDays(weekStart(viewDate), 7) : shiftMonth(viewDate, 1);
    renderCalendar(displayPlan());
  });
  dom.monthGrid.addEventListener("click", function (event) {
    var button = event.target.closest("[data-session-id]");
    if (button) {
      openDetails(button.dataset.sessionId);
    }
  });
  dom.agenda.addEventListener("click", function (event) {
    var button = event.target.closest("[data-session-id]");
    if (button) {
      openDetails(button.dataset.sessionId);
    }
  });
  Array.prototype.slice.call(app.querySelectorAll("[data-plan-close-details]")).forEach(function (button) {
    button.addEventListener("click", closeDetails);
  });
  dom.settingsForm.addEventListener("submit", saveSettings);
  dom.bodyweightForm.addEventListener("submit", saveBodyweight);
  app.querySelector("[data-plan-close-settings]").addEventListener("click", function () { dom.settings.close(); });
  app.querySelector("[data-plan-close-bodyweight]").addEventListener("click", function () {
    dom.bodyweightDialog.close();
  });
  app.querySelector("[data-plan-cancel-bodyweight]").addEventListener("click", function () {
    dom.bodyweightDialog.close();
  });
  dom.templateEditor.addEventListener("dragover", handleTemplateDrag);
  app.querySelector("[data-plan-cancel-settings]").addEventListener("click", function () { dom.settings.close(); });
  app.querySelector("[data-plan-add-template]").addEventListener("click", function () {
    var template = readTemplateEditor();
    template.push({
      id: "session-" + Date.now().toString(36),
      weekday: 6,
      type: "push-volume",
      label: core.TYPE_LABELS["push-volume"]
    });
    renderTemplateEditor(template);
  });
  app.querySelector("[data-plan-add-holiday]").addEventListener("click", function () {
    var date = dom.holidayDate.value;
    if (!date) {
      dom.formError.textContent = "请选择需要覆盖的日期。";
      return;
    }
    settingsHolidayOverrides[date] = dom.holidayType.value;
    dom.holidayDate.value = "";
    dom.formError.textContent = "";
    renderHolidayOverrides();
  });
  dom.cycleSelect.addEventListener("change", function () {
    viewingChartArchive = Number(dom.cycleSelect.value);
    var plan = displayPlan();
    renderCycleSelect();
    renderTrajectory(displayTrajectoryPlan(plan));
  });
  app.querySelector("[data-plan-reload]").addEventListener("click", reloadAfterConflict);
  window.addEventListener("resize", function () {
    window.clearTimeout(chartResizeTimer);
    chartResizeTimer = window.setTimeout(function () {
      var plan = displayPlan();
      if (plan) {
        renderTrajectory(displayTrajectoryPlan(plan));
      }
    }, 120);
  });
  app.querySelector("[data-plan-force-save]").addEventListener("click", forceSave);
  mobileQuery.addEventListener("change", function () {
    renderCalendar(displayPlan());
  });
  document.addEventListener("keydown", function (event) {
    if (event.key === "Escape" && !dom.drawer.hidden) {
      closeDetails();
    }
  });

  window.addEventListener("offline", function () {
    isOffline = true;
    render();
    showMessage("网络已断开，当前计划切换为只读。", "offline");
  });
  window.addEventListener("online", function () {
    if (!store.configured) {
      return;
    }
    var reload = isOwner ? loadOwnerPlan : loadPublicPlan;
    reload().then(function () {
      showMessage("网络已恢复，计划已重新同步。", "success");
    }).catch(function (error) {
      showMessage("重新同步失败：" + error.message, "error");
    });
  });

  initialize();
}());
