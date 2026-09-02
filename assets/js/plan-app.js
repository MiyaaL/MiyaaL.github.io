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
    kindButtons: app.querySelectorAll("[data-plan-kind]"),
    learningSelector: app.querySelector("[data-plan-learning-selector]"),
    learningSelect: app.querySelector("[data-plan-learning-select]"),
    newLearning: app.querySelector("[data-plan-new-learning]"),
    emptyEyebrow: app.querySelector("[data-plan-empty-eyebrow]"),
    emptyTitle: app.querySelector("[data-plan-empty-title]"),
    emptyDescription: app.querySelector("[data-plan-empty-description]"),
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
    learningSummary: app.querySelector("[data-plan-learning-summary]"),
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
    learningSettings: app.querySelector("[data-plan-learning-settings]"),
    learningSettingsForm: app.querySelector("[data-plan-learning-settings-form]"),
    learningSettingsTitle: app.querySelector("[data-plan-learning-settings-title]"),
    learningFormError: app.querySelector("[data-plan-learning-form-error]"),
    bodyweightDialog: app.querySelector("[data-plan-bodyweight-dialog]"),
    bodyweightForm: app.querySelector("[data-plan-bodyweight-form]"),
    bodyweightError: app.querySelector("[data-plan-bodyweight-error]"),
    templateEditor: app.querySelector("[data-plan-template-editor]"),
    holidayDate: app.querySelector("[data-plan-holiday-date]"),
    holidayType: app.querySelector("[data-plan-holiday-type]"),
    holidayOverrides: app.querySelector("[data-plan-holiday-overrides]"),
    moveConfirm: app.querySelector("[data-plan-move-confirm]"),
    moveConfirmMessage: app.querySelector("[data-plan-move-confirm-message]"),
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
  var pendingSessionMove = null;
  var draggedSessionId = null;
  var calendarDragActive = false;
  var suppressCalendarClick = false;
  var sessionMovePending = false;
  var selectedPlanKind = "fitness";
  var selectedLearningPlanId = null;
  var learningSettingsEditingId = null;
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
      if (privateState.activePlanId && privateState.learningPlans.some(function (plan) {
        return plan.id === privateState.activePlanId;
      })) {
        selectedPlanKind = "learning";
        selectedLearningPlanId = privateState.activePlanId;
      }
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
    renderPlanKindControls();
    if (selectedPlanKind === "learning") {
      dom.emptyEyebrow.textContent = "LEARNING / 学习计划";
      dom.emptyTitle.textContent = "还没有学习计划";
      dom.emptyDescription.textContent = isOwner
        ? "点击“新增学习计划”，设置每日任务与最终验收成果。"
        : "当前还没有公开的学习计划。";
    } else {
      dom.emptyEyebrow.textContent = "FITNESS / 健身计划";
      dom.emptyTitle.textContent = "计划尚未发布";
      dom.emptyDescription.textContent = "登录后填写周期、体重与三项当前/目标 1RM，即可生成第一份训练日历。";
    }
    setSyncState();
    dom.auth.hidden = false;
    dom.auth.textContent = store.configured ? "管理计划" : "同步未配置";
  }

  function displayPlan() {
    if (selectedPlanKind === "learning") {
      var learningPlan = null;
      if (isOwner && privateState) {
        learningPlan = (privateState.learningPlans || []).find(function (candidate) {
          return candidate.id === selectedLearningPlanId;
        }) || (privateState.learningPlans || [])[0];
      } else if (publicSnapshot) {
        learningPlan = (publicSnapshot.learningPlans || []).find(function (candidate) {
          return candidate.id === selectedLearningPlanId;
        }) || (publicSnapshot.learningPlans || [])[0];
      }
      if (!learningPlan) {
        return null;
      }
      selectedLearningPlanId = learningPlan.id;
      if (!isOwner && Array.isArray(learningPlan.sessions)) {
        return {
          plan: learningPlan,
          cycle: learningPlan,
          sessions: learningPlan.sessions,
          warnings: [],
          totalDays: Number(learningPlan.totalDays || learningPlan.sessions.length),
          completedDays: Number(learningPlan.completedDays || 0),
          completedCriteria: 0
        };
      }
      return core.generateLearningPlan(learningPlan);
    }
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
    renderPlanKindControls();
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
    dom.updateBodyweight.hidden = selectedPlanKind === "learning";
    dom.newCycle.hidden = selectedPlanKind === "learning";
    dom.edit.textContent = selectedPlanKind === "learning" ? "编辑学习计划" : "编辑计划";
    setSyncState();

    dom.title.textContent = plan.cycle.title || (selectedPlanKind === "learning" ? "学习计划" : "推拉蹲 + 推");
    dom.cycleMeta.textContent = formatDateRange(plan.cycle.startDate, plan.cycle.endDate) +
      (selectedPlanKind === "learning"
        ? " · " + plan.totalDays + " 天 · " + plan.completedDays + " 天已完成"
        : " · " + plan.totalWeeks + " 周 · " + plan.sessions.length + " 次训练");

    renderProgress(plan.cycle);
    renderLearningSummary(plan);
    renderWarnings(plan);
    renderCycleSelect();
    renderTrajectory(displayTrajectoryPlan(plan));
    normalizeViewDate(plan.cycle);
    renderCalendar(plan);
  }

  function renderPlanKindControls() {
    Array.prototype.slice.call(dom.kindButtons || []).forEach(function (button) {
      var active = button.dataset.planKind === selectedPlanKind;
      button.classList.toggle("is-active", active);
      button.setAttribute("aria-selected", active ? "true" : "false");
    });
    var plans = isOwner && privateState
      ? (privateState.learningPlans || [])
      : (publicSnapshot && publicSnapshot.learningPlans) || [];
    dom.learningSelector.hidden = selectedPlanKind !== "learning";
    dom.newLearning.hidden = !isOwner || isOffline || selectedPlanKind !== "learning";
    if (selectedPlanKind === "learning") {
      dom.learningSelect.innerHTML = plans.length ? plans.map(function (plan) {
        return '<option value="' + escapeHtml(plan.id) + '">' + escapeHtml(plan.title) + '</option>';
      }).join("") : '<option value="">暂无学习计划</option>';
      dom.learningSelect.value = selectedLearningPlanId || (plans[0] && plans[0].id) || "";
    }
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
    if (selectedPlanKind === "learning") {
      var plan = displayPlan();
      var total = Math.max(0, Number(plan && plan.totalDays || 0));
      var completed = Math.max(0, Number(plan && plan.completedDays || 0));
      var criteria = (cycle.acceptanceCriteria || []).length;
      var completedCriteria = Math.max(0, Number(plan && plan.completedCriteria || 0));
      var artifacts = (cycle.artifacts || []).length;
      dom.progress.innerHTML = [
        ["学习日", completed + " / " + total, total ? completed / total * 100 : 0],
        ["验收成果", completedCriteria + " / " + criteria, criteria ? completedCriteria / criteria * 100 : 0],
        ["学习生产物", artifacts + " 份", artifacts ? 100 : 0]
      ].map(function (item) {
        return '<div class="plan-progress-item"><div class="plan-progress-label"><strong>' +
          escapeHtml(item[0]) + '</strong><span>' + escapeHtml(item[1]) + '</span></div>' +
          '<div class="plan-progress-track" aria-hidden="true"><span style="--plan-progress:' +
          Math.min(100, item[2]).toFixed(1) + '%"></span></div></div>';
      }).join("");
      return;
    }
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
    if (selectedPlanKind === "learning") {
      dom.chart.hidden = true;
      return;
    }
    if (!chart) {
      dom.chart.hidden = true;
      return;
    }
    dom.chart.hidden = false;
    chart.render(dom.chart, plan, { today: todayInShanghai() });
  }

  function renderLearningSummary(plan) {
    if (selectedPlanKind !== "learning") {
      dom.learningSummary.hidden = true;
      return;
    }
    var cycle = plan.cycle;
    var criteria = cycle.acceptanceCriteria || [];
    dom.learningSummary.hidden = false;
    dom.learningSummary.innerHTML = '<div><p class="eyebrow">OUTCOME / 验收成果</p><h2>计划完成时要留下什么</h2>' +
      (cycle.objective ? '<p class="plan-learning-objective">' + escapeHtml(cycle.objective) + '</p>' : "") +
      '</div><ol class="plan-learning-criteria">' +
      (criteria.length ? criteria.map(function (criterion) {
        return '<li><span>' + escapeHtml(criterion.title) + '</span></li>';
      }).join("") : '<li><span>尚未设置验收成果。</span></li>') + '</ol>';
  }

  function renderWarnings(plan) {
    var warnings = (plan.warnings || []).slice();
    if (selectedPlanKind === "learning") {
      dom.warnings.hidden = warnings.length === 0;
      dom.warnings.innerHTML = warnings.slice(0, 5).map(function (warning) {
        return "<p>· " + escapeHtml(warning) + "</p>";
      }).join("");
      return;
    }
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
    if (selectedPlanKind === "learning") {
      dom.cycleSelectWrap.hidden = true;
      return;
    }
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
      var canDrag = Boolean(session && isOwner && !isOffline && selectedPlanKind === "fitness");
      var attributes = ' data-plan-date="' + escapeHtml(date) + '"';
      if (session) {
        attributes += ' data-session-id="' + escapeHtml(session.id) + '"';
      }
      if (canDrag) {
        attributes += ' draggable="true"';
      }
      var content = '<span class="plan-day-number">' + Number(date.slice(-2)) + "</span>";
      if (session) {
        content += '<strong class="plan-day-badge">' + escapeHtml(shortTypeLabel(session.type)) + "</strong>";
        content += '<span class="plan-day-load">' + escapeHtml(primaryLoad(session)) + "</span>";
        if (session.status && session.status !== "planned") {
          content += '<span class="plan-day-status is-' + escapeHtml(session.status) + '">' +
            escapeHtml(statusLabel(session.status)) + "</span>";
        }
        if (session.holiday && selectedPlanKind !== "learning") {
          content += '<span class="plan-day-holiday">调休</span>';
        }
      } else {
        var holiday = selectedPlanKind === "learning" ? null : holidayForDate(date);
        if (holiday && holiday.type === "off") {
          content += '<span class="plan-day-holiday">休</span>';
        }
      }
      var aria = session
        ? formatChineseDate(date, true) + " " + session.label + (canDrag ? "，可拖动调整日期" : "")
        : "";
      cells.push('<button class="' + classes.join(" ") + '" type="button"' + attributes +
        (session ? ' aria-label="' + escapeHtml(aria) + '"' : ' tabindex="-1"') +
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
          escapeHtml(primaryLoad(session) + " · " + (session.phase && session.phase.label || "学习日") + " · " + statusLabel(session.status)) +
          "</span></button>";
      }).join("") : '<span class="plan-agenda-rest">' +
        (selectedPlanKind !== "learning" && holidayForDate(date) && holidayForDate(date).type === "off"
          ? "法定休息日"
          : (selectedPlanKind === "learning" ? "无学习安排" : "恢复 / 无训练")) +
        "</span>";
      rows.push('<div class="plan-agenda-day"><div class="plan-agenda-date">' +
        escapeHtml(dateLabel) + '</div><div>' + content + "</div></div>");
    }
    dom.agenda.innerHTML = rows.join("");
  }

  function shortTypeLabel(type) {
    return {
      learning: "学习",
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
    if (session.type === "learning" || session.learning) {
      var tasks = session.learning && session.learning.tasks || [];
      if (tasks.length) {
        return tasks.length + " 项任务";
      }
      return session.learning && session.learning.objective ? "目标已设置" : "待补充任务";
    }
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
    if (selectedPlanKind === "learning" || session.type === "learning") {
      return learningSessionDetailsHtml(session);
    }
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

  function learningSessionDetailsHtml(session) {
    var learning = session.learning || {};
    var log = session.log || (privateState && privateState.learningPlans || []).reduce(function (found, plan) {
      return found || (plan.logs && plan.logs[session.id]);
    }, null) || {};
    var criteria = learning.acceptanceCriteria || [];
    var checked = log.criteria || [];
    var tasks = learning.tasks || [];
    var html = '<p class="plan-session-meta"><span>' + escapeHtml(formatChineseDate(session.date, true)) +
      '</span><span>学习日</span><span>' + escapeHtml(statusLabel(session.status)) + '</span></p>';
    html += '<section class="plan-session-section"><h3>今日学习任务</h3>' +
      (learning.objective ? '<p class="plan-learning-objective">' + escapeHtml(learning.objective) + '</p>' : "") +
      (tasks.length ? '<ul class="plan-learning-task-list">' + tasks.map(function (task) {
        return '<li>' + escapeHtml(task) + '</li>';
      }).join("") + '</ul>' : '<p>今天还没有预设任务，可以直接在总结中记录。</p>') + '</section>';
    if (criteria.length) {
      html += '<section class="plan-session-section"><h3>验收成果</h3><div class="plan-learning-checklist">' +
        criteria.map(function (criterion) {
          return '<label><input type="checkbox" data-learning-criterion="' + escapeHtml(criterion.id) + '"' +
            (checked.indexOf(criterion.id) >= 0 ? ' checked' : '') + '><span>' + escapeHtml(criterion.title) +
            (criterion.description ? '<small>' + escapeHtml(criterion.description) + '</small>' : '') + '</span></label>';
        }).join("") + '</div></section>';
    }
    if (isOwner && !isOffline) {
      var artifacts = log.artifacts || [];
      html += '<section class="plan-session-section"><h3>成果记录</h3>' +
        '<label class="plan-log-notes">今日计划（每行一项）<textarea data-learning-day-tasks rows="3">' +
        escapeHtml(tasks.join("\n")) + '</textarea></label>' +
        '<label class="plan-log-notes">学习总结 / 感悟<textarea data-learning-reflection maxlength="10000" placeholder="今天理解了什么？哪里仍然卡住？下一步是什么？">' +
        escapeHtml(log.reflection || log.notes || "") + '</textarea></label>' +
        '<label class="plan-learning-upload">学习生产物（可选）<input type="file" multiple data-learning-files>' +
        '<small>支持文档、图片、压缩包；每个文件不超过 2 MB，文件内容会随计划同步。</small></label>' +
        (artifacts.length ? '<ul class="plan-learning-artifacts">' + artifacts.map(learningArtifactHtml).join("") + '</ul>' : "") +
        '<div class="plan-log-actions"><button class="plan-button plan-button-primary" type="button" data-save-learning>保存今日成果</button>' +
        '<button class="plan-button" type="button" data-save-learning-plan>只保存当天计划</button>' +
        '<button class="plan-button" type="button" data-skip-session>标记为跳过</button></div></section>';
    }
    return html;
  }

  function learningArtifactHtml(artifact) {
    var label = escapeHtml(artifact.name || "未命名文件");
    var candidate = String(artifact.dataUrl || artifact.url || "");
    var href = /^(data:|https?:|blob:)/i.test(candidate) ? candidate : "#";
    return '<li><a href="' + escapeHtml(href) + '" download="' + label + '" target="_blank" rel="noreferrer">' +
      label + '</a><span>' + escapeHtml(formatArtifactSize(artifact.size)) + '</span></li>';
  }

  function formatArtifactSize(size) {
    var value = Number(size || 0);
    if (value < 1024) return value + " B";
    if (value < 1024 * 1024) return (value / 1024).toFixed(1) + " KB";
    return (value / (1024 * 1024)).toFixed(1) + " MB";
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

  function moveConflicts(plan, sourceId, targetDate) {
    return (plan.sessions || []).filter(function (session) {
      return session.id !== sourceId && session.date === targetDate;
    });
  }

  function openMoveConfirmation(request, source, conflicts) {
    pendingSessionMove = request;
    var conflictSummary = conflicts.map(function (session) {
      return "“" + session.label + "”（" + statusLabel(session.status) + "）";
    }).join("、");
    dom.moveConfirmMessage.textContent = "确认将“" + source.label + "”移动到 " +
      formatChineseDate(request.targetDate, true) + " 并替代 " + conflictSummary +
      "？原规划会从日历和 Progress Overview 中移除。";
    dom.moveConfirm.showModal();
  }

  async function applySessionMove(request) {
    if (sessionMovePending) {
      showMessage("上一次改期正在保存，请稍候。", "notice");
      return;
    }
    sessionMovePending = true;
    var previousState = privateState;
    var previousChartArchive = viewingChartArchive;
    try {
      privateState = core.moveSession(privateState, request.sourceId, request.targetDate, {
        holidayCalendars: holidayCalendars,
        replace: request.replace === true
      });
      viewingChartArchive = -1;
      var saveResult = await persist(
        request.replace ? "原规划已替代，本次训练已改期。" : "本次训练已改期。"
      );
      if (saveResult === false) {
        privateState = previousState;
        viewingChartArchive = previousChartArchive;
        render();
      }
    } catch (error) {
      if (error.code === "session_move_conflict") {
        var source = findSession(request.sourceId);
        if (source) {
          openMoveConfirmation({
            sourceId: request.sourceId,
            targetDate: request.targetDate,
            replace: true
          }, source, error.conflicts || []);
        }
      } else if (error.code === "session_move_recorded_target") {
        showMessage("目标日期已有训练记录，请先将那条记录移动到其他日期。", "error");
      } else if (error.code === "invalid_session_move_date") {
        showMessage("改期日期必须位于当前周期内。", "error");
      } else {
        showMessage("改期失败：" + error.message, "error");
      }
    } finally {
      sessionMovePending = false;
    }
  }

  function requestSessionMove(sourceId, targetDate) {
    if (sessionMovePending) {
      showMessage("上一次改期正在保存，请稍候。", "notice");
      return;
    }
    if (!isOwner || isOffline || !privateState) {
      showMessage("请先以本人账号在线登录。", "error");
      return;
    }
    var plan = displayPlan();
    var source = (plan.sessions || []).find(function (session) {
      return session.id === sourceId;
    });
    var cycle = privateState.activeCycle;
    if (!source) {
      showMessage("这项训练已发生变化，请刷新后重试。", "error");
      return;
    }
    if (!targetDate || targetDate < cycle.startDate || targetDate > cycle.endDate) {
      showMessage("改期日期必须位于当前周期内。", "error");
      return;
    }
    if (source.date === targetDate) {
      showMessage("训练日期没有变化。", "notice");
      return;
    }

    var request = { sourceId: sourceId, targetDate: targetDate, replace: false };
    var conflicts = moveConflicts(plan, sourceId, targetDate);
    var recordedConflict = conflicts.some(function (session) {
      return Boolean(privateState.logs[session.id]);
    });
    if (recordedConflict) {
      showMessage("目标日期已有训练记录，请先将那条记录移动到其他日期。", "error");
      return;
    }
    if (conflicts.length) {
      request.replace = true;
      openMoveConfirmation(request, source, conflicts);
      return;
    }
    applySessionMove(request);
  }

  function cancelSessionMove() {
    pendingSessionMove = null;
    dom.moveConfirm.close();
  }

  function confirmSessionMove() {
    if (!pendingSessionMove) {
      dom.moveConfirm.close();
      return;
    }
    var request = pendingSessionMove;
    pendingSessionMove = null;
    dom.moveConfirm.close();
    applySessionMove(request);
  }

  function bindDetailActions(session) {
    var learningSave = dom.detailBody.querySelector("[data-save-learning]");
    if (learningSave) {
      learningSave.addEventListener("click", function () {
        saveLearningLog(session, learningSave);
      });
    }
    var learningPlanSave = dom.detailBody.querySelector("[data-save-learning-plan]");
    if (learningPlanSave) {
      learningPlanSave.addEventListener("click", function () {
        saveLearningLog(session, learningPlanSave, "planned");
      });
    }
    var save = dom.detailBody.querySelector("[data-save-log]");
    if (save) {
      save.addEventListener("click", function () {
        saveTrainingLog(session);
      });
    }
    var skip = dom.detailBody.querySelector("[data-skip-session]");
    if (skip) {
      skip.addEventListener("click", function () {
        if (selectedPlanKind === "learning") {
          saveLearningLog(session, skip, "skipped");
        } else {
          privateState = core.recordSession(privateState, session, {
            status: "skipped",
            mainSets: [],
            notes: dom.detailBody.querySelector("[data-log-notes]").value
          });
          persist("已标记为跳过。");
        }
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
        requestSessionMove(session.id, date);
      });
    }
  }

  function fileToArtifact(file) {
    return new Promise(function (resolve, reject) {
      if (!file || file.size > 2 * 1024 * 1024) {
        reject(new Error("learning_file_too_large"));
        return;
      }
      if (typeof FileReader === "undefined") {
        resolve({ id: "artifact-" + Date.now().toString(36), name: file.name, size: file.size, type: file.type });
        return;
      }
      var reader = new FileReader();
      reader.onload = function () {
        resolve({
          id: "artifact-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 7),
          name: String(file.name || "未命名文件").slice(0, 180),
          size: Number(file.size || 0),
          type: String(file.type || "application/octet-stream"),
          dataUrl: reader.result,
          uploadedAt: new Date().toISOString()
        });
      };
      reader.onerror = function () { reject(new Error("learning_file_read_failed")); };
      reader.readAsDataURL(file);
    });
  }

  async function saveLearningLog(session, button, forcedStatus) {
    if (!isOwner || isOffline || !privateState) {
      showMessage("请先以本人账号在线登录。", "error");
      return;
    }
    if (button) button.disabled = true;
    try {
      var plan = privateState.learningPlans.find(function (candidate) {
        return candidate.id === selectedLearningPlanId;
      });
      var filesInput = dom.detailBody.querySelector("[data-learning-files]");
      var files = filesInput ? Array.prototype.slice.call(filesInput.files || []) : [];
      if (files.length > 5) {
        throw new Error("learning_file_limit");
      }
      var artifacts = [];
      for (var index = 0; index < files.length; index += 1) {
        artifacts.push(await fileToArtifact(files[index]));
      }
      var previous = plan && plan.logs && plan.logs[session.id];
      var criteria = Array.prototype.slice.call(dom.detailBody.querySelectorAll("[data-learning-criterion]:checked"))
        .map(function (input) { return input.dataset.learningCriterion; });
      privateState = core.recordLearningSession(privateState, selectedLearningPlanId, session, {
        status: forcedStatus || "completed",
        reflection: dom.detailBody.querySelector("[data-learning-reflection]").value,
        dailyPlan: {
          title: session.label,
          objective: session.learning && session.learning.objective || "",
          tasks: dom.detailBody.querySelector("[data-learning-day-tasks]").value.split(/\n+/)
            .map(function (task) { return task.trim(); }).filter(Boolean)
        },
        criteria: criteria,
        artifacts: (previous && previous.artifacts || []).concat(artifacts).slice(-12)
      });
      await persist(forcedStatus === "skipped"
        ? "学习日已标记为跳过。"
        : (forcedStatus === "planned" ? "当天学习计划已保存。" : "学习成果已保存。"));
    } catch (error) {
      var messages = {
        learning_file_too_large: "单个学习生产物不能超过 2 MB。",
        learning_file_limit: "一次最多上传 5 个文件。",
        learning_file_read_failed: "文件读取失败，请重试。"
      };
      showMessage(messages[error.message] || "学习成果保存失败：" + error.message, "error");
    } finally {
      if (button) button.disabled = false;
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
      return false;
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
      return true;
    } catch (error) {
      if (error.code === "version_conflict") {
        pendingConflictState = deepClone(privateState);
        dom.conflict.showModal();
        return "conflict";
      }
      showMessage("保存失败：" + error.message, "error");
      return false;
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

  function setLearningInput(name, value) {
    if (dom.learningSettingsForm && dom.learningSettingsForm.elements[name]) {
      dom.learningSettingsForm.elements[name].value = value == null ? "" : value;
    }
  }

  function openLearningSettings(planId) {
    if (!isOwner || isOffline || !privateState) {
      showMessage("请先以本人账号在线登录。", "error");
      return;
    }
    learningSettingsEditingId = planId || null;
    var existing = (privateState.learningPlans || []).find(function (plan) { return plan.id === planId; });
    var plan = existing ? core.normalizeLearningPlan(existing) : core.createDefaultLearningPlan(todayInShanghai(), core.addDays(todayInShanghai(), 27));
    dom.learningSettingsTitle.textContent = existing ? "编辑学习计划" : "新增学习计划";
    setLearningInput("learningTitle", plan.title);
    setLearningInput("learningObjective", plan.objective);
    setLearningInput("learningStartDate", plan.startDate);
    setLearningInput("learningEndDate", plan.endDate);
    LEARNING_DAY_NAMES.forEach(function (name, index) {
      var item = plan.dailyTemplate[String(index + 1)] || {};
      setLearningInput("learningDay" + (index + 1) + "Title", item.title);
      setLearningInput("learningDay" + (index + 1) + "Tasks", (item.tasks || []).join("\n"));
    });
    setLearningInput("learningCriteria", (plan.acceptanceCriteria || []).map(function (criterion) {
      return criterion.title + (criterion.description ? " · " + criterion.description : "");
    }).join("\n"));
    dom.learningFormError.textContent = "";
    dom.learningSettings.showModal();
  }

  var LEARNING_DAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

  async function saveLearningSettings(event) {
    event.preventDefault();
    var form = new FormData(dom.learningSettingsForm);
    var title = String(form.get("learningTitle") || "").trim();
    var objective = String(form.get("learningObjective") || "").trim();
    var startDate = String(form.get("learningStartDate") || "");
    var endDate = String(form.get("learningEndDate") || "");
    if (!title) {
      dom.learningFormError.textContent = "请填写学习计划名称。";
      return;
    }
    if (!startDate || !endDate || endDate < startDate) {
      dom.learningFormError.textContent = "结束日期必须不早于开始日期。";
      return;
    }
    var dailyTemplate = {};
    LEARNING_DAY_NAMES.forEach(function (_, index) {
      dailyTemplate[String(index + 1)] = {
        title: String(form.get("learningDay" + (index + 1) + "Title") || "").trim() || "学习任务",
        objective: "",
        tasks: String(form.get("learningDay" + (index + 1) + "Tasks") || "").split(/\n+/)
          .map(function (task) { return task.trim(); }).filter(Boolean)
      };
    });
    var acceptanceCriteria = String(form.get("learningCriteria") || "").split(/\n+/)
      .map(function (line) { return line.trim(); }).filter(Boolean)
      .map(function (line, index) {
        var parts = line.split(/\s+[·|｜]\s+/);
        return { id: "criterion-" + (index + 1), title: parts[0], description: parts.slice(1).join(" · ") };
      });
    var existing = (privateState.learningPlans || []).find(function (plan) {
      return plan.id === learningSettingsEditingId;
    });
    var next = core.normalizeLearningPlan(Object.assign({}, existing || core.createDefaultLearningPlan(startDate, endDate), {
      id: existing ? existing.id : "learning-" + startDate + "-" + Date.now().toString(36),
      title: title,
      objective: objective,
      startDate: startDate,
      endDate: endDate,
      dailyTemplate: dailyTemplate,
      acceptanceCriteria: acceptanceCriteria,
      status: existing ? existing.status : "active"
    }));
    if (existing) {
      privateState.learningPlans = privateState.learningPlans.map(function (plan) {
        return plan.id === next.id ? next : plan;
      });
    } else {
      privateState.learningPlans = (privateState.learningPlans || []).concat(next);
    }
    privateState.activePlanId = next.id;
    selectedPlanKind = "learning";
    selectedLearningPlanId = next.id;
    dom.learningSettings.close();
    await persist(existing ? "学习计划已更新。" : "学习计划已创建。");
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
    download("miyaal-" + (selectedPlanKind === "learning" ? "learning-plan" : "fitness-plan") + ".ics",
      core.generateIcs(plan, preferences), "text/calendar;charset=utf-8");
  }

  function exportJson() {
    if (!privateState) {
      return;
    }
    download(
      "miyaal-plan-backup-" + todayInShanghai() + ".json",
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
  dom.edit.addEventListener("click", function () {
    if (selectedPlanKind === "learning") {
      openLearningSettings(selectedLearningPlanId);
    } else {
      openSettings(false);
    }
  });
  dom.newCycle.addEventListener("click", function () { openSettings(true); });
  dom.signOut.addEventListener("click", function () {
    store.signOut().catch(function (error) {
      showMessage("退出失败：" + error.message, "error");
    });
  });
  dom.exportIcs.addEventListener("click", exportIcs);
  dom.exportJson.addEventListener("click", exportJson);
  Array.prototype.slice.call(dom.kindButtons || []).forEach(function (button) {
    button.addEventListener("click", function () {
      selectedPlanKind = button.dataset.planKind;
      if (selectedPlanKind === "learning" && isOwner && privateState) {
        selectedLearningPlanId = privateState.activePlanId || selectedLearningPlanId ||
          (privateState.learningPlans[0] && privateState.learningPlans[0].id);
      }
      viewDate = todayInShanghai();
      render();
    });
  });
  dom.learningSelect.addEventListener("change", function () {
    selectedLearningPlanId = dom.learningSelect.value || null;
    viewDate = todayInShanghai();
    render();
  });
  dom.newLearning.addEventListener("click", function () { openLearningSettings(null); });
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
  function clearCalendarDrag() {
    draggedSessionId = null;
    calendarDragActive = false;
    Array.prototype.slice.call(dom.monthGrid.querySelectorAll(".is-dragging, .is-drop-target, .is-replace-target")).forEach(function (cell) {
      cell.classList.remove("is-dragging", "is-drop-target", "is-replace-target");
      cell.removeAttribute("aria-grabbed");
    });
  }

  function suppressNextCalendarClick() {
    suppressCalendarClick = true;
    window.setTimeout(function () {
      suppressCalendarClick = false;
    }, 0);
  }

  function calendarCell(event) {
    return event.target && event.target.closest
      ? event.target.closest("[data-plan-date]")
      : null;
  }

  dom.monthGrid.addEventListener("dragstart", function (event) {
    var source = event.target.closest('[data-session-id][draggable="true"]');
    if (!source || sessionMovePending) {
      event.preventDefault();
      return;
    }
    draggedSessionId = source.dataset.sessionId;
    calendarDragActive = true;
    source.classList.add("is-dragging");
    source.setAttribute("aria-grabbed", "true");
    if (event.dataTransfer) {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", draggedSessionId);
    }
  });

  dom.monthGrid.addEventListener("dragover", function (event) {
    if (!calendarDragActive || !draggedSessionId) {
      return;
    }
    var target = calendarCell(event);
    var cycle = privateState && privateState.activeCycle;
    if (!target || !cycle || target.dataset.planDate < cycle.startDate || target.dataset.planDate > cycle.endDate) {
      return;
    }
    event.preventDefault();
    Array.prototype.slice.call(dom.monthGrid.querySelectorAll(".is-drop-target, .is-replace-target")).forEach(function (cell) {
      cell.classList.remove("is-drop-target", "is-replace-target");
    });
    target.classList.add("is-drop-target");
    if (target.dataset.sessionId && target.dataset.sessionId !== draggedSessionId) {
      target.classList.add("is-replace-target");
    }
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = "move";
    }
  });

  dom.monthGrid.addEventListener("dragleave", function (event) {
    var target = calendarCell(event);
    if (target && (!event.relatedTarget || !target.contains(event.relatedTarget))) {
      target.classList.remove("is-drop-target", "is-replace-target");
    }
  });

  dom.monthGrid.addEventListener("drop", function (event) {
    var target = calendarCell(event);
    var sourceId = draggedSessionId || (event.dataTransfer && event.dataTransfer.getData("text/plain"));
    if (!target || !sourceId) {
      clearCalendarDrag();
      return;
    }
    event.preventDefault();
    var targetDate = target.dataset.planDate;
    suppressNextCalendarClick();
    clearCalendarDrag();
    requestSessionMove(sourceId, targetDate);
  });

  dom.monthGrid.addEventListener("dragend", function () {
    suppressNextCalendarClick();
    clearCalendarDrag();
  });

  dom.monthGrid.addEventListener("click", function (event) {
    if (calendarDragActive || suppressCalendarClick) {
      return;
    }
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
  dom.learningSettingsForm.addEventListener("submit", saveLearningSettings);
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
  app.querySelector("[data-plan-close-learning-settings]").addEventListener("click", function () { dom.learningSettings.close(); });
  app.querySelector("[data-plan-cancel-learning-settings]").addEventListener("click", function () { dom.learningSettings.close(); });
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
  app.querySelector("[data-plan-cancel-move]").addEventListener("click", cancelSessionMove);
  app.querySelector("[data-plan-confirm-move]").addEventListener("click", confirmSessionMove);
  dom.moveConfirm.addEventListener("cancel", function () {
    pendingSessionMove = null;
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
    if (event.key === "Escape" && app.querySelector("dialog[open]")) {
      return;
    }
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
