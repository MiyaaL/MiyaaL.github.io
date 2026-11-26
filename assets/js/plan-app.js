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
    settingsReplanFrom: app.querySelector("[data-plan-settings-replan-from]"),
    settingsReplanHolidays: app.querySelector("[data-plan-settings-replan-holidays]"),
    settingsScheduleHelp: app.querySelector("[data-plan-settings-schedule-help]"),
    formError: app.querySelector("[data-plan-form-error]"),
    bodyweightDialog: app.querySelector("[data-plan-bodyweight-dialog]"),
    bodyweightForm: app.querySelector("[data-plan-bodyweight-form]"),
    bodyweightError: app.querySelector("[data-plan-bodyweight-error]"),
    templateEditor: app.querySelector("[data-plan-template-editor]"),
    holidayDate: app.querySelector("[data-plan-holiday-date]"),
    holidayType: app.querySelector("[data-plan-holiday-type]"),
    holidayOverrides: app.querySelector("[data-plan-holiday-overrides]"),
    moveConfirm: app.querySelector("[data-plan-move-confirm]"),
    moveConfirmEyebrow: app.querySelector("[data-plan-move-confirm-eyebrow]"),
    moveConfirmTitle: app.querySelector("[data-plan-move-confirm-title]"),
    moveConfirmMessage: app.querySelector("[data-plan-move-confirm-message]"),
    moveConfirmButton: app.querySelector("[data-plan-confirm-move]"),
    conflict: app.querySelector("[data-plan-conflict]"),
    conflictMessage: app.querySelector("[data-plan-conflict-message]")
  };
  var config = {
    url: app.dataset.supabaseUrl || "",
    publishableKey: app.dataset.supabaseKey || "",
    redirectTo: window.location.origin + "/plan/"
  };
  var store = window.PlanStore.createSupabaseAdapter(config);
  var holidayCalendars = [];
  var privateState = null;
  var ownerLoadPromise = null;
  var publicSnapshot = null;
  var previewState = null;
  var isOwner = false;
  var isOffline = false;
  var ALL_CYCLES = "all";
  var viewingChartArchive = -1;
  var allCyclePlans = null;
  var viewDate = todayInShanghai();
  var selectedSessionId = null;
  var settingsNewCycle = false;
  var settingsDraftCycle = null;
  var settingsHolidayOverrides = {};
  var settingsInitialSchedule = null;
  var pendingConflict = null;
  var savePending = false;
  var detailReturnFocus = null;
  var holidayYearsRequested = {};
  var pendingSessionMove = null;
  var pendingScheduleAdjustment = null;
  var draggedSessionId = null;
  var calendarDragActive = false;
  var suppressCalendarClick = false;
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
    var detailMessage = dom.detailBody.querySelector("[data-plan-detail-message]");
    if (dom.drawer.open && detailMessage) {
      detailMessage.textContent = text || "";
      detailMessage.dataset.kind = kind || "";
      if (text && detailMessage.scrollIntoView) detailMessage.scrollIntoView({ block: "nearest" });
    }
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
      dom.syncState.textContent = "Sync not configured";
    } else if (isOffline) {
      dom.syncState.textContent = "Offline · read-only";
    } else if (isOwner) {
      dom.syncState.textContent = "Synced · owner";
    } else {
      dom.syncState.textContent = "Public · read-only";
    }
  }

  async function loadHolidayYear(year) {
    if (holidayYearsRequested[year]) {
      return;
    }
    holidayYearsRequested[year] = true;
    try {
      var response = await fetch(app.dataset.holidayBase + "cn-" + year + ".json", { cache: "no-cache" });
      if (!response.ok) {
        throw new Error("holiday_fetch_failed");
      }
      var calendar = await response.json();
      if (calendar && Number(calendar.year) === year) {
        holidayCalendars.push(calendar);
        holidayCalendars.sort(function (left, right) { return left.year - right.year; });
      }
    } catch (_) {
      // A year without a published calendar simply follows the weekly template.
    }
  }

  // One file per calendar year the cycle touches; missing years are tolerated.
  async function ensureHolidayYears(cycle) {
    var years = [Number(todayInShanghai().slice(0, 4))];
    if (cycle && cycle.startDate && cycle.endDate) {
      for (var year = Number(String(cycle.startDate).slice(0, 4));
        year <= Number(String(cycle.endDate).slice(0, 4)) && years.length < 6; year += 1) {
        if (years.indexOf(year) < 0) years.push(year);
      }
    }
    await Promise.all(years.map(loadHolidayYear));
  }

  function createPreview() {
    previewState = core.createDefaultState(todayInShanghai());
    previewState.activeCycle.status = "draft";
    publicSnapshot = null;
    privateState = null;
    isOwner = false;
    isOffline = true;
    viewingChartArchive = -1;
    showMessage("Sync is not configured; showing a preview of the default weekly template.", "notice");
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
    await ensureHolidayYears(publicSnapshot && publicSnapshot.cycle);
    render();
    if (result.error) {
      showMessage("The network is unavailable; showing the last cached public plan.", "offline");
    }
  }

  function loadOwnerPlan() {
    if (!ownerLoadPromise) {
      ownerLoadPromise = loadOwnerPlanOnce().finally(function () {
        ownerLoadPromise = null;
      });
    }
    return ownerLoadPromise;
  }

  async function loadOwnerPlanOnce() {
    try {
      var record = await store.loadPrivate();
      privateState = record && record.state
        ? core.normalizeState(record.state)
        : core.createDefaultState(todayInShanghai());
      privateState.version = record ? Number(record.version || 0) : 0;
      privateState.updatedAt = record ? record.updatedAt : null;
      // Saved cycles move onto the feedback program from today. The change is
      // only kept in memory here and is stored with the owner's next save.
      privateState = core.adoptFeedbackProgram(privateState, todayInShanghai());
      isOwner = true;
      isOffline = false;
      publicSnapshot = null;
      previewState = null;
      viewingChartArchive = -1;
      await ensureHolidayYears(privateState.activeCycle);
      render();
      if (!record) {
        openSettings(false);
      }
    } catch (error) {
      if (error.code === "not_plan_owner") {
        await store.signOut();
        showMessage("This GitHub account cannot edit the plan.", "error");
        await loadPublicPlan();
        return;
      }
      throw error;
    }
  }

  async function initialize() {
    setLoading(true);
    await ensureHolidayYears(null);

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
      showMessage("The plan could not be loaded: " + error.message, "error");
      try {
        await loadPublicPlan();
      } catch (_) {
        isOffline = true;
        renderEmpty();
      }
    }

    store.onAuthChange(function (event, session) {
      if (event === "SIGNED_IN" && session) {
        loadOwnerPlan().catch(function (error) {
          showMessage("The plan could not be loaded after sign-in: " + error.message, "error");
        });
      }
      if (event === "SIGNED_OUT") {
        loadPublicPlan().catch(function (error) {
          showMessage("The public plan could not be loaded: " + error.message, "error");
        });
      }
    });
  }

  function renderEmpty() {
    setLoading(false);
    dom.empty.hidden = false;
    dom.view.hidden = true;
    dom.emptyTitle.textContent = "No plan published yet";
    dom.emptyDescription.textContent = "After signing in, enter the cycle dates, bodyweight and the current and " +
      "goal 1RM for each lift to generate the first training calendar.";
    setSyncState();
    dom.auth.hidden = false;
    dom.auth.textContent = store.configured ? "Owner sign-in" : "Sync not configured";
  }

  function displayPlan() {
    if (isOwner && privateState) {
      var generated = core.generate(privateState, holidayCalendars, { asOfDate: todayInShanghai() });
      privateState = generated.state;
      return generated;
    }
    if (previewState) {
      return core.generate(previewState, holidayCalendars);
    }
    if (publicSnapshot) {
      // Snapshots published before the page moved to English still carry the
      // old copy, and their statuses were fixed at the owner's last save.
      var today = todayInShanghai();
      var cycle = deepClone(publicSnapshot.cycle);
      core.localizeCycle(cycle);
      return {
        cycle: cycle,
        sessions: core.filterLegacyOfficialMakeups(
          publicSnapshot.sessions || [],
          holidayCalendars
        ).map(function (source) {
          var session = core.localizeSession(deepClone(source));
          if (session.status === "planned" && session.date < today) session.status = "missed";
          return session;
        }),
        warnings: Array.isArray(publicSnapshot.warnings) ? publicSnapshot.warnings
          : (cycle.schedule ? [cycle.schedule.reason] : []),
        performance: publicSnapshot.performance || null,
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
      }),
      performance: deepClone(plan.performance || null)
    };
  }

  function planForArchive(archive) {
    if (archive.overview && archive.overview.cycle) {
      return deepClone(archive.overview);
    }
    return regenerateArchive(archive);
  }

  // The stored overview only freezes planned 1RMs, so a day rendered from it would read
  // as "weight not set". Rebuilding from the archived state restores the same sets and
  // loads the calendar shows for that cycle on its own.
  function regenerateArchive(archive) {
    var archivedState = core.createDefaultState(archive.cycle.startDate);
    if (!Array.isArray(archive.cycle.scheduleAdjustments)) {
      archivedState.schemaVersion = 2;
    }
    archivedState.preferences = deepClone(privateState.preferences);
    archivedState.activeCycle = deepClone(archive.cycle);
    archivedState.logs = deepClone(archive.logs || {});
    return core.generate(archivedState, holidayCalendars, { asOfDate: todayInShanghai() });
  }

  function isAllCycleView() {
    return isOwner && Boolean(privateState) && viewingChartArchive === ALL_CYCLES;
  }

  function cycleOrdinal(index, archiveCount) {
    return "Cycle " + String(archiveCount - index).padStart(2, "0");
  }

  // Cycles overlap in time, so the all view keeps each cycle as its own plan instead
  // of merging sessions into one calendar-shaped plan.
  function allCyclePlanSet(activePlan) {
    if (!isOwner || !privateState || !activePlan) {
      return [];
    }
    var archives = privateState.archivedCycles || [];
    var plans = archives.map(function (archive, index) {
      var plan = regenerateArchive(archive);
      plan.cycleLabel = cycleOrdinal(index, archives.length);
      return plan;
    }).reverse();
    activePlan.cycleLabel = "Cycle " + String(archives.length + 1).padStart(2, "0");
    plans.push(activePlan);
    return plans;
  }

  function displayTrajectoryPlan(activePlan) {
    if (!isOwner || !privateState || viewingChartArchive === ALL_CYCLES) {
      return activePlan;
    }
    if (viewingChartArchive < 0) {
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
    dom.auth.textContent = store.configured ? "Owner sign-in" : "Sync not configured";
    dom.ownerActions.hidden = !isOwner || isOffline;
    dom.exportJson.hidden = !isOwner;
    setSyncState();

    allCyclePlans = isAllCycleView() ? allCyclePlanSet(plan) : null;

    if (allCyclePlans) {
      var firstCycle = allCyclePlans[0].cycle;
      var lastCycle = allCyclePlans[allCyclePlans.length - 1].cycle;
      var sessionCount = allCyclePlans.reduce(function (total, item) {
        return total + item.sessions.length;
      }, 0);
      dom.title.textContent = "All cycles";
      dom.cycleMeta.textContent = formatDateRange(firstCycle.startDate, lastCycle.endDate) +
        " · " + allCyclePlans.length + " cycles · " + sessionCount + " sessions";
    } else {
      dom.title.textContent = plan.cycle.title || core.templateTitle(plan.cycle.template);
      dom.cycleMeta.textContent = formatDateRange(plan.cycle.startDate, plan.cycle.endDate) +
        " · " + plan.totalWeeks + " weeks · " + plan.sessions.length + " sessions" +
        (plan.cycle.requestedEndDate && plan.cycle.requestedEndDate !== plan.cycle.endDate
          ? " · originally ending " + formatLongDate(plan.cycle.requestedEndDate, false) + " · moved by hand"
          : "");
    }

    renderProgress(plan);
    renderWarnings(plan);
    renderCycleSelect();
    renderTrajectory(displayTrajectoryPlan(plan));
    normalizeViewDate(allCyclePlans ? null : plan.cycle);
    renderCalendar(plan);
  }

  function normalizeViewDate(cycle) {
    var span = cycle;
    if (!span && allCyclePlans) {
      span = {
        startDate: allCyclePlans[0].cycle.startDate,
        endDate: allCyclePlans[allCyclePlans.length - 1].cycle.endDate
      };
    }
    if (!span) {
      return;
    }
    if (!viewDate || viewDate < core.addDays(span.startDate, -35) || viewDate > core.addDays(span.endDate, 35)) {
      viewDate = span.startDate;
    }
  }

  function formatDateRange(start, end) {
    return formatLongDate(start, false) + " — " + formatLongDate(end, false);
  }

  function formatLongDate(value, includeWeekday) {
    var date = new Date(value + "T12:00:00+08:00");
    return new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "short",
      day: "numeric",
      weekday: includeWeekday ? "short" : undefined
    }).format(date);
  }

  function formatKgValue(value) {
    return Number(value).toFixed(1).replace(/\.0$/, "");
  }

  // Where the programmed reference stands today, read from the same series the
  // chart draws so the tile and the chart can never disagree.
  function programmedToday(plan) {
    var result = {};
    if (!chart || !plan || !plan.cycle || plan.cycle.status === "archived") {
      return result;
    }
    chart.buildSeries(plan, todayInShanghai()).series.forEach(function (item) {
      if (item.today) {
        result[item.key] = item.today.value;
      }
    });
    return result;
  }

  function liftProgressModel(cycle, key, reference) {
    var lift = cycle.lifts[key] || {};
    var hasCurrent = lift.current1rm != null && lift.current1rm !== "";
    var hasTarget = lift.target1rm != null && lift.target1rm !== "";
    var current = Number(lift.current1rm || 0);
    var target = Number(lift.target1rm || 0);
    var start = lift.baseline1rm == null || lift.baseline1rm === "" ? current : Number(lift.baseline1rm);
    var share = function (value) {
      return target > start
        ? Math.min(100, Math.max(0, (value - start) / (target - start) * 100))
        : (hasTarget && value >= target ? 100 : 0);
    };
    var model = {
      hasCurrent: hasCurrent,
      hasTarget: hasTarget,
      current: current,
      target: target,
      percentage: share(current),
      marker: reference == null ? null : share(reference),
      status: null
    };
    if (hasCurrent && hasTarget) {
      // Loads are rounded to 2.5 kg, so a gap smaller than half a kilogram is noise.
      var gap = reference == null ? 0 : Math.round((reference - current) * 10) / 10;
      if (current >= target) {
        model.status = { tone: "ok", text: "Goal reached" };
      } else if (reference != null && gap >= 0.5) {
        model.status = { tone: "warn", text: "Behind plan by " + formatKgValue(gap) + " kg" };
      } else if (reference != null) {
        model.status = { tone: "ok", text: "On track" };
      }
    }
    return model;
  }

  function progressTrackHtml(model) {
    return '<div class="plan-progress-track' + (model.percentage <= 0 ? " is-at-start" : "") +
      '" aria-hidden="true"><span style="--plan-progress:' + model.percentage.toFixed(1) + '%"></span>' +
      (model.marker == null ? "" : '<i style="--plan-reference:' + model.marker.toFixed(1) + '%"></i>') + "</div>";
  }

  function liftProgressItemHtml(cycle, key, withLabel, reference) {
    var model = liftProgressModel(cycle, key, reference);
    var prefix = key === "pullup" ? "+" : "";
    var unit = key === "pullup" ? " kg added" : " kg";
    if (!withLabel) {
      // Compact form for the all-cycles table: the numbers and the bar only.
      return '<div class="plan-progress-item is-compact">' +
        '<div class="plan-progress-label"><span>' + (model.hasCurrent ? formatKgValue(model.current) : "—") +
        " → " + (model.hasTarget ? formatKgValue(model.target) : "—") + escapeHtml(unit) + "</span></div>" +
        progressTrackHtml(model) + "</div>";
    }
    return '<div class="plan-progress-item" data-plan-lift="' + escapeHtml(key) + '">' +
      '<div class="plan-progress-label"><strong>' + escapeHtml(core.LIFT_LABELS[key]) + "</strong>" +
      (model.status ? '<span class="plan-progress-status is-' + model.status.tone + '">' +
        escapeHtml(model.status.text) + "</span>" : "") + "</div>" +
      '<p class="plan-progress-value"><b>' + (model.hasCurrent ? prefix + formatKgValue(model.current) : "—") +
      "</b>" + escapeHtml(unit) + '<span class="plan-progress-goal">' +
      (model.hasTarget ? "of " + prefix + formatKgValue(model.target) + " kg goal" : "no goal set") + "</span></p>" +
      progressTrackHtml(model) +
      (model.marker == null ? "" : '<p class="plan-progress-key"><i aria-hidden="true"></i>Programmed reference today</p>') +
      "</div>";
  }

  function liftProgressHtml(plan) {
    var reference = programmedToday(plan);
    return ["bench", "pullup", "squat"].map(function (key) {
      return liftProgressItemHtml(plan.cycle, key, true, reference[key]);
    }).join("");
  }

  function renderProgress(plan) {
    dom.progress.classList.toggle("is-all-cycles", Boolean(allCyclePlans));
    if (allCyclePlans) {
      // One cycle per row keeps several cycles short: the lift names sit in the column
      // header once, and each row only carries that cycle's numbers.
      dom.progress.innerHTML =
        '<div class="plan-progress-table" role="table" aria-label="Strength progress for each cycle">' +
        '<div class="plan-progress-row is-head" role="row"><span class="plan-progress-cycle-label" role="columnheader">Cycle</span>' +
        ["bench", "pullup", "squat"].map(function (key) {
          return '<span role="columnheader">' + escapeHtml(core.LIFT_LABELS[key]) + "</span>";
        }).join("") + "</div>" +
        allCyclePlans.map(function (item) {
          return '<div class="plan-progress-row" role="row"><span class="plan-progress-cell">' +
            '<span class="plan-progress-cycle-label" role="rowheader">' + escapeHtml(item.cycleLabel) +
            "</span><span class=\"plan-progress-range\">" +
            escapeHtml(formatDateRange(item.cycle.startDate, item.cycle.endDate)) +
            (item.cycle.status === "archived" ? " · archived" : " · current") + "</span></span>" +
            ["bench", "pullup", "squat"].map(function (key) {
              return '<span class="plan-progress-cell" role="cell">' +
                liftProgressItemHtml(item.cycle, key, false) + "</span>";
            }).join("") + "</div>";
        }).join("") + "</div>";
      return;
    }
    dom.progress.innerHTML = liftProgressHtml(plan);
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
    chart.render(dom.chart, plan, {
      today: todayInShanghai(),
      plans: allCyclePlans || undefined
    });
  }

  function renderWarnings(plan) {
    var warnings = (plan.warnings || []).slice();
    dom.warnings.hidden = warnings.length === 0;
    // The sentence describing the program is information, not a warning: it
    // reads as a paragraph. Everything else is grouped under a "Note" label.
    var about = [];
    var notes = [];
    warnings.slice(0, 6).forEach(function (warning) {
      (/^Three build weeks/.test(warning) ? about : notes).push(warning);
    });
    var html = about.map(function (text) {
      return '<p class="plan-note">' + escapeHtml(text) + "</p>";
    }).join("");
    if (notes.length) {
      html += '<div class="plan-note-warn"><span class="plan-note-label">Note</span>' +
        (notes.length === 1
          ? "<p>" + escapeHtml(notes[0]) + "</p>"
          : "<ul>" + notes.map(function (text) { return "<li>" + escapeHtml(text) + "</li>"; }).join("") + "</ul>") +
        "</div>";
    }
    dom.warnings.innerHTML = html;
  }

  function renderCycleSelect() {
    var archives = isOwner && privateState ? privateState.archivedCycles : [];
    dom.cycleSelectWrap.hidden = !isOwner || !privateState;
    if (!isOwner || !privateState) {
      viewingChartArchive = -1;
      return;
    }
    if (viewingChartArchive !== ALL_CYCLES && viewingChartArchive >= archives.length) {
      viewingChartArchive = -1;
    }
    if (viewingChartArchive === ALL_CYCLES && !archives.length) {
      viewingChartArchive = -1;
    }
    var cycleCount = archives.length + 1;
    var activeCycle = privateState.activeCycle;
    var options = [];
    if (archives.length) {
      options.push('<option value="all">' +
        escapeHtml("ALL") + "</option>");
    }
    options.push('<option value="-1">' +
      escapeHtml("Cycle " + String(cycleCount).padStart(2, "0") + " · Current · " +
        String(activeCycle.startDate).replace(/-/g, ".") + " — " +
        String(activeCycle.endDate).replace(/-/g, ".")) +
      "</option>");
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

  // In the all view a date can hold sessions from several overlapping cycles, so each
  // entry carries the cycle tag it belongs to; a single cycle keeps ordinal null.
  function calendarEntries(plan) {
    var map = {};
    (allCyclePlans || [plan]).forEach(function (item) {
      var ordinal = item.cycleLabel || null;
      item.sessions.forEach(function (session) {
        map[session.date] = map[session.date] || [];
        map[session.date].push({ session: session, ordinal: ordinal });
      });
    });
    Object.keys(map).forEach(function (date) {
      map[date].sort(function (left, right) {
        return String(left.ordinal || "").localeCompare(String(right.ordinal || ""));
      });
    });
    return map;
  }

  function renderCalendar(plan) {
    var map = calendarEntries(plan);
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
    var today = todayInShanghai();
    dom.viewTitle.textContent = new Intl.DateTimeFormat("en-US", {
      timeZone: "Asia/Shanghai",
      year: "numeric",
      month: "long"
    }).format(new Date(first + "T12:00:00+08:00"));

    var cells = [];
    for (var index = 0; index < 42; index += 1) {
      var date = core.addDays(gridStart, index);
      var entries = map[date] || [];
      var session = entries.length ? entries[0].session : null;
      var classes = ["plan-day"];
      if (date.slice(0, 7) !== currentMonth) {
        classes.push("is-outside");
      }
      if (date === today) {
        classes.push("is-today");
      }
      var canDrag = Boolean(session && !allCyclePlans && isOwner && !isOffline);
      var attributes = ' data-plan-date="' + escapeHtml(date) + '"';
      var number = '<span class="plan-day-number">' + Number(date.slice(-2)) + "</span>";
      var top = function (chip) {
        return '<span class="plan-day-top">' + (chip || "<span></span>") + number + "</span>";
      };
      if (entries.length === 1) {
        // A day with one session is a single button; the label carries what
        // the cell shows so the date and status are not lost to a screen reader.
        var aria = formatLongDate(date, true) + ", " + session.label + ", " + statusLabel(session.status) +
          (canDrag ? ", draggable to another date" : "");
        cells.push('<button class="' + classes.concat(sessionToneClasses(session)).join(" ") + '" type="button"' +
          attributes + ' data-session-id="' + escapeHtml(session.id) + '"' + (canDrag ? ' draggable="true"' : "") +
          ' aria-label="' + escapeHtml(aria) + '">' + top(sessionChipHtml(session)) +
          daySessionCellHtml(entries[0]) + "</button>");
      } else if (entries.length) {
        // Several cycles can share a date in the all-cycles view; each session
        // is its own button so every one of them is reachable by keyboard.
        cells.push('<div class="' + classes.join(" ") + ' has-sessions"' + attributes + ">" + top("") +
          '<span class="plan-day-sessions">' + entries.map(function (entry) {
            return daySessionEntryHtml(entry, date);
          }).join("") + "</span></div>");
      } else {
        var holiday = holidayForDate(date);
        cells.push('<div class="' + classes.join(" ") + ' is-rest"' + attributes + ">" +
          top(holiday && holiday.type === "off"
            ? '<span class="plan-day-holiday" title="' + escapeHtml(holiday.name) + '">Holiday</span>' : "") +
          "</div>");
      }
    }
    dom.monthGrid.innerHTML = cells.join("");
  }

  // What a session's cell is tinted by: its outcome once it has one, otherwise
  // the kind of week it belongs to.
  function sessionTone(session) {
    var phase = session.phase && session.phase.key;
    if (session.status === "completed") return { key: "completed", label: "Done" };
    if (session.status === "missed") return { key: "missed", label: "Missed" };
    if (session.status === "skipped") return { key: "skipped", label: "Skipped" };
    if (phase === "test" || phase === "retry") return { key: "test", label: phase === "retry" ? "Retry" : "Test" };
    if (phase === "deload" || phase === "opener") return { key: "deload", label: phase === "opener" ? "Opener" : "Deload" };
    return null;
  }

  function sessionToneClasses(session) {
    var tone = sessionTone(session);
    return tone ? ["is-" + tone.key] : [];
  }

  function sessionChipHtml(session) {
    var tone = sessionTone(session);
    return tone ? '<span class="plan-day-status is-' + tone.key + '">' + escapeHtml(tone.label) + "</span>" : "";
  }

  function daySessionCellHtml(entry) {
    var session = entry.session;
    var html = '<strong class="plan-day-badge">' + escapeHtml(shortTypeLabel(session.type)) + "</strong>";
    html += '<span class="plan-day-load">' + escapeHtml(primaryLoad(session)) + "</span>";
    if (session.holiday) {
      html += '<span class="plan-day-holiday">Make-up</span>';
    }
    return html;
  }

  function daySessionEntryHtml(entry, date) {
    var session = entry.session;
    return '<button class="plan-day-session" type="button" data-session-id="' + escapeHtml(session.id) +
      '" aria-label="' + escapeHtml(formatLongDate(date, true) + ", " + entry.ordinal + ", " + session.label +
        ", " + statusLabel(session.status)) + '">' +
      '<span class="plan-day-cycle">' + escapeHtml(entry.ordinal) + "</span>" +
      '<strong class="plan-day-badge">' + escapeHtml(shortTypeLabel(session.type)) + "</strong>" +
      '<span class="plan-day-load">' + escapeHtml(primaryLoad(session)) + "</span>" +
      sessionChipHtml(session) + "</button>";
  }

  function renderAgenda(plan, map) {
    var start = weekStart(viewDate);
    var end = core.addDays(start, 6);
    dom.viewTitle.textContent = formatLongDate(start, false) + " — " + formatLongDate(end, false);
    var rows = [];
    for (var index = 0; index < 7; index += 1) {
      var date = core.addDays(start, index);
      var entries = map[date] || [];
      var dateLabel = new Intl.DateTimeFormat("en-US", {
        timeZone: "Asia/Shanghai",
        month: "short",
        day: "numeric",
        weekday: "short"
      }).format(new Date(date + "T12:00:00+08:00"));
      var content = entries.length ? entries.map(function (entry) {
        var session = entry.session;
        return '<button class="plan-agenda-session' + sessionToneClasses(session).map(function (name) {
          return " " + name;
        }).join("") + '" type="button" data-session-id="' +
          escapeHtml(session.id) + '" aria-label="' + escapeHtml(dateLabel + ", " + session.label + ", " +
            statusLabel(session.status)) + '"><span class="plan-agenda-title"><strong>' + (entry.ordinal
            ? '<span class="plan-day-cycle">' + escapeHtml(entry.ordinal) + "</span> " : "") +
          escapeHtml(session.label) + "</strong>" + sessionChipHtml(session) + '</span><span class="plan-agenda-meta">' +
          escapeHtml([primaryLoad(session), session.phase && session.phase.label].filter(Boolean).join(" · ")) +
          "</span></button>";
      }).join("") : '<span class="plan-agenda-rest">' +
        (holidayForDate(date) && holidayForDate(date).type === "off" ? "Public holiday" : "Rest day") +
        "</span>";
      rows.push('<div class="plan-agenda-day"><div class="plan-agenda-date">' +
        escapeHtml(dateLabel) + '</div><div>' + content + "</div></div>");
    }
    dom.agenda.innerHTML = rows.join("");
  }

  function shortTypeLabel(type) {
    return {
      "push-strength": "Push · Strength",
      pull: "Pull",
      squat: "Squat · Strength",
      "push-volume": "Push · Volume",
      "squat-volume": "Squat · Volume"
    }[type] || type;
  }

  function statusLabel(status) {
    return {
      planned: "Planned",
      completed: "Done",
      skipped: "Skipped",
      missed: "Missed"
    }[status] || status || "Planned";
  }

  function primaryLoad(session) {
    var workout = session.workout || {};
    if (workout.needsSetup || !workout.workSets || !workout.workSets.length) {
      return "Loads not set";
    }
    var goalAttempt = session.phase && session.phase.key === "test";
    var set = goalAttempt ? workout.workSets[workout.workSets.length - 1] : workout.workSets.reduce(function (main, candidate) {
      return candidate.sets > main.sets ||
        (candidate.sets === main.sets && candidate.reps > main.reps) ? candidate : main;
    });
    var load = Object.prototype.hasOwnProperty.call(set, "loadKg")
      ? " · " + core.formatLoad(set.loadKg, workout.liftKey)
      : " · RPE " + set.rpe;
    return (goalAttempt ? "Attempt " : "") + set.sets + "×" + set.reps + load;
  }

  function holidayForDate(date) {
    var overrides = privateState
      ? privateState.activeCycle.holidayOverrides || {}
      : {};
    if (overrides[date]) {
      return { type: overrides[date], name: overrides[date] === "off" ? "Custom rest day" : "Custom training day" };
    }
    for (var calendarIndex = 0; calendarIndex < holidayCalendars.length; calendarIndex += 1) {
      var periods = holidayCalendars[calendarIndex].periods || [];
      for (var periodIndex = 0; periodIndex < periods.length; periodIndex += 1) {
        var name = core.localize(periods[periodIndex].name);
        if ((periods[periodIndex].daysOff || []).indexOf(date) >= 0) {
          return { type: "off", name: name };
        }
        if ((periods[periodIndex].workdays || []).indexOf(date) >= 0) {
          return { type: "work", name: name + " make-up day" };
        }
      }
    }
    return null;
  }

  function currentSessions() {
    if (allCyclePlans) {
      return allCyclePlans.reduce(function (all, item) {
        return all.concat(item.sessions);
      }, []);
    }
    var plan = displayPlan();
    return plan ? plan.sessions : [];
  }

  function isArchivedSession(session) {
    return Boolean(privateState && privateState.activeCycle &&
      session.id.indexOf(privateState.activeCycle.id + ":") !== 0);
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
    detailReturnFocus = document.activeElement && document.activeElement !== document.body
      ? document.activeElement : null;
    dom.detailTitle.textContent = session.label;
    dom.detailBody.innerHTML = sessionDetailsHtml(session) +
      '<div class="plan-message" data-plan-detail-message role="status" aria-live="polite"></div>';
    bindDetailActions(session);
    if (!dom.drawer.open) {
      dom.drawer.showModal();
    }
  }

  function closeDetails() {
    if (dom.drawer.open) {
      dom.drawer.close();
    }
  }

  // Rendering replaces the calendar, so the element that opened the drawer may
  // be gone; fall back to the same session's new button.
  function restoreDetailFocus() {
    var id = selectedSessionId;
    selectedSessionId = null;
    var target = detailReturnFocus && document.contains(detailReturnFocus) ? detailReturnFocus : null;
    detailReturnFocus = null;
    if (!target && id) {
      target = Array.prototype.slice.call(app.querySelectorAll("[data-session-id]")).filter(function (element) {
        return element.dataset.sessionId === id;
      })[0] || null;
    }
    if (target && target.focus) {
      target.focus();
    }
  }

  function setListHtml(items, liftKey) {
    if (!items || !items.length) {
      return "<p>Exact loads appear once the cycle settings are saved.</p>";
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
      ? " · " + session.holiday.name + " (moved from " + session.holiday.movedFrom + ")"
      : "";
    var html = '<p class="plan-session-meta"><span>' + escapeHtml(formatLongDate(session.date, true)) +
      '</span><span>' + escapeHtml(session.phase.label) + '</span><span>' +
      escapeHtml(statusLabel(session.status)) + escapeHtml(holiday) + "</span></p>";
    html += '<section class="plan-session-section"><h3>Main lift · ' +
      escapeHtml(workout.mainExercise || session.label) + "</h3>" +
      (workout.needsSetup ? "<p>The current and goal 1RM have not been entered yet.</p>" : "") +
      setListHtml(workout.workSets, workout.liftKey) +
      (workout.guidance && (session.phase.key === "test" || session.phase.key === "retry")
        ? "<p>" + escapeHtml(workout.guidance) + "</p>" : "") + "</section>";
    if (workout.secondary && workout.secondary.workSets.length) {
      html += '<section class="plan-session-section"><h3>Second lift · ' +
        escapeHtml(workout.secondary.mainExercise) + "</h3>" +
        setListHtml(workout.secondary.workSets, workout.secondary.liftKey) + "</section>";
    }
    html += '<section class="plan-session-section"><h3>Warm-up</h3>' +
      setListHtml(workout.warmups, workout.liftKey) + "</section>";
    html += '<section class="plan-session-section"><h3>Accessories</h3>' +
      (workout.accessories && workout.accessories.length ? setListHtml(workout.accessories, null) : "<p>No accessory work in this session.</p>") + "</section>";

    // Archived cycles share their logs with the active cycle's record path, so their
    // sessions open read-only from the all-cycles view.
    if (isOwner && !isOffline && !workout.needsSetup && !isArchivedSession(session)) {
      html += trainingLogHtml(session);
    }
    return html;
  }

  function numberField(label, attribute, value, extra) {
    return "<label>" + label + '<input class="plan-log-input" ' + attribute + ' type="number" ' + extra +
      ' value="' + escapeHtml(value == null ? "" : value) + '"></label>';
  }

  function trainingLogHtml(session) {
    var log = privateState.logs[session.id] || {};
    var rows = [];
    (session.workout.workSets || []).forEach(function (prescription) {
      for (var setIndex = 0; setIndex < prescription.sets; setIndex += 1) {
        var saved = (log.mainSets || [])[rows.length] || {};
        rows.push('<div class="plan-log-grid" role="group" aria-label="Set ' + (rows.length + 1) +
          '" data-log-set data-planned-reps="' + escapeHtml(prescription.reps) +
          '"><span class="plan-log-set-number">Set ' + (rows.length + 1) + "</span>" +
          numberField("Weight (kg)", "data-log-weight",
            saved.weight != null ? saved.weight : prescription.loadKg, 'step="0.1" inputmode="decimal"') +
          numberField("Reps", "data-log-reps",
            saved.reps != null ? saved.reps : prescription.reps, 'min="0" max="30" inputmode="numeric"') +
          numberField("RPE", "data-log-rpe", saved.rpe,
            'min="1" max="10" step="0.5" inputmode="decimal" placeholder="optional"') + "</div>");
      }
    });
    var secondaryRows = [];
    var secondary = session.workout.secondary;
    (secondary ? secondary.workSets : []).forEach(function (prescription) {
      for (var setIndex = 0; setIndex < prescription.sets; setIndex += 1) {
        var saved = (log.secondarySets || [])[secondaryRows.length] || {};
        secondaryRows.push('<div class="plan-log-grid" role="group" aria-label="Pull-up set ' +
          (secondaryRows.length + 1) + '" data-log-secondary-set><span class="plan-log-set-number">Set ' +
          (secondaryRows.length + 1) + "</span>" +
          numberField("Added weight (kg)", "data-log-weight",
            saved.weight != null ? saved.weight : prescription.loadKg, 'step="0.1" inputmode="decimal"') +
          numberField("Reps", "data-log-reps",
            saved.reps != null ? saved.reps : prescription.reps, 'min="0" max="30" inputmode="numeric"') +
          "</div>");
      }
    });
    var accessoryRows = (session.workout.accessories || []).map(function (accessory) {
      var saved = (log.accessories || []).find(function (entry) {
        return entry.name === accessory.name || core.localize(entry.name) === accessory.name;
      }) || {};
      return '<div class="plan-accessory-log" role="group" aria-label="' + escapeHtml(accessory.name) +
        '" data-accessory-log data-accessory-name="' +
        escapeHtml(accessory.name) + '" data-accessory-planned-sets="' + Number(accessory.sets) + '"><strong>' +
        escapeHtml(accessory.name) + "</strong>" +
        numberField("Weight (kg)", "data-accessory-weight",
          saved.weight != null ? saved.weight : accessory.loadKg, 'min="0" step="0.1" inputmode="decimal"') +
        numberField("Sets done", "data-accessory-sets", saved.sets, 'min="0" max="20" inputmode="numeric"') +
        numberField("Reps per set", "data-accessory-reps", saved.reps,
          'min="0" max="200" step="1" inputmode="numeric"') + "</div>";
    }).join("");

    var scheduleButton = session.status !== "completed"
      ? '<button class="plan-button" type="button" data-adjust-schedule>Shift this and all later sessions</button>'
      : "";
    var skipAction = session.status === "skipped"
      ? '<button class="plan-button" type="button" data-restore-skipped-session>Undo skip</button>'
      : '<button class="plan-button" type="button" data-skip-session>Skip this session</button>';
    var scheduleHint = session.status !== "completed"
      ? '<p class="plan-cycle-meta">An earlier date pulls the rest of the plan forward and a later one pushes it back; skipped sessions in that range return to planned.</p>'
      : "";
    var isAttempt = session.phase.key === "test" || session.phase.key === "retry";
    return '<section class="plan-session-section"><h3>Training log</h3>' +
      "<div>" + rows.join("") + "</div><p>" + (isAttempt
        ? "Enter 0 reps for a missed attempt. The heaviest single you complete becomes the measured 1RM."
        : "RPE is optional. Enter the reps you actually got: a set short of its target, or a top single " +
          "at RPE 9.5 or more, holds next week's increase for this lift.") + "</p>" +
      (secondaryRows.length
        ? '<div class="plan-accessory-records"><h4>Pull-up back-off sets</h4>' + secondaryRows.join("") + "</div>"
        : "") +
      (accessoryRows
        ? '<div class="plan-accessory-records"><h4>Accessories · totals</h4>' + accessoryRows + "</div>" : "") +
      '<label class="plan-log-notes">Notes (visible to you only)<textarea data-log-notes>' +
      escapeHtml(log.notes || "") + "</textarea></label>" +
      '<div class="plan-log-actions"><button class="plan-button plan-button-primary" type="button" data-save-log>Save session log</button>' +
      skipAction + '</div>' +
      '<div class="plan-reschedule"><label>Move to<input class="plan-log-input" data-move-date type="date" min="' +
      escapeHtml(privateState.activeCycle.startDate) + '" max="' + escapeHtml(core.addDays(privateState.activeCycle.endDate, 365)) +
      '" value="' + escapeHtml(session.date) + '"></label><button class="plan-button" type="button" data-move-session>Move this session only</button>' +
      scheduleButton + "</div>" + scheduleHint + "</section>";
  }

  function moveConflicts(plan, sourceId, targetDate) {
    return (plan.sessions || []).filter(function (session) {
      return session.id !== sourceId && session.date === targetDate;
    });
  }

  function openMoveConfirmation(request, source, conflicts) {
    pendingScheduleAdjustment = null;
    pendingSessionMove = request;
    dom.moveConfirmEyebrow.textContent = "MOVE SESSION";
    dom.moveConfirmTitle.textContent = "Replace the planned session?";
    dom.moveConfirmButton.textContent = "Replace";
    var conflictSummary = conflicts.map(function (session) {
      return "“" + session.label + "” (" + statusLabel(session.status) + ")";
    }).join(", ");
    dom.moveConfirmMessage.textContent = "Move “" + source.label + "” to " +
      formatLongDate(request.targetDate, true) + " and replace " + conflictSummary +
      "? The replaced session is removed from the calendar and the progress chart.";
    dom.moveConfirm.showModal();
  }

  async function applySessionMove(request) {
    if (savePending) {
      showMessage("The previous change is still being saved.", "notice");
      return;
    }
    var previousChartArchive = viewingChartArchive;
    try {
      var nextState = core.moveSession(privateState, request.sourceId, request.targetDate, {
        holidayCalendars: holidayCalendars,
        asOfDate: todayInShanghai(),
        replace: request.replace === true
      });
      viewingChartArchive = -1;
      var saveResult = await commit(nextState,
        request.replace ? "The session was moved and replaced the one planned there." : "The session was moved.");
      if (saveResult !== true) {
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
        showMessage("That date already has a logged session; move that one first.", "error");
      } else if (error.code === "invalid_session_move_date") {
        showMessage("The new date must be inside the current cycle.", "error");
      } else {
        showMessage("The session could not be moved: " + error.message, "error");
      }
    }
  }

  function showScheduleAdjustmentError(error) {
    if (error.code === "schedule_deadline_locked") {
      showMessage("This cycle has a fixed end date. Move sessions one at a time inside it, or set a new end date in the plan settings.", "error");
    } else if (error.code === "schedule_adjust_recorded_future") {
      showMessage("Logged sessions lie in that range, so it cannot be shifted as a whole. Start from a later session, or move this one only.", "error");
    } else if (error.code === "schedule_adjust_conflict") {
      showMessage("The new date cannot be on or before the previous session. Pick a date closer to this one, or move the earlier session first.", "error");
    } else if (error.code === "invalid_schedule_adjust_date") {
      showMessage("Pick a different date, no earlier than the cycle start and at most a year away.", "error");
    } else if (error.code === "invalid_schedule_adjust_source") {
      showMessage("This session is already done or has changed, so the plan cannot be shifted from it.", "error");
    } else {
      showMessage("The plan could not be shifted: " + error.message, "error");
    }
  }

  function openScheduleAdjustmentConfirmation(request) {
    var advancing = request.days < 0;
    var days = Math.abs(request.days);
    pendingSessionMove = null;
    pendingScheduleAdjustment = request;
    dom.moveConfirmEyebrow.textContent = advancing ? "PULL PLAN FORWARD" : "PUSH PLAN BACK";
    dom.moveConfirmTitle.textContent = advancing ? "Pull the rest of the plan forward?" : "Push the rest of the plan back?";
    dom.moveConfirmButton.textContent = advancing ? "Pull forward" : "Push back";
    dom.moveConfirmMessage.textContent = "The " + request.affectedCount + " unfinished sessions from “" +
      request.sourceLabel + "” onward move " + (advancing ? "forward" : "back") + " by " + days +
      (days === 1 ? " day" : " days") + ", and the cycle ends on " +
      formatLongDate(request.newEndDate, false) + ". " +
      (request.changesFixedDeadline ? "This also changes the fixed end date. " : "") +
      "Skipped sessions in that range return to planned.";
    dom.moveConfirm.showModal();
  }

  async function applyScheduleAdjustment(request) {
    if (savePending) {
      showMessage("The previous change is still being saved.", "notice");
      return;
    }
    var previousChartArchive = viewingChartArchive;
    try {
      var nextState = core.adjustSchedule(privateState, request.sourceId, request.targetDate, {
        holidayCalendars: holidayCalendars,
        asOfDate: todayInShanghai(),
        allowDeadlineChange: true
      });
      viewingChartArchive = -1;
      var saveResult = await commit(nextState, request.days < 0
        ? "Skips were cleared and the remaining sessions pulled forward."
        : "Skips were cleared and the remaining sessions pushed back.");
      if (saveResult !== true) {
        viewingChartArchive = previousChartArchive;
        render();
      }
    } catch (error) {
      showScheduleAdjustmentError(error);
    }
  }

  function requestScheduleAdjustment(sourceId, targetDate) {
    if (savePending) {
      showMessage("The previous change is still being saved.", "notice");
      return;
    }
    if (!isOwner || isOffline || !privateState) {
      showMessage("Sign in as the owner while online first.", "error");
      return;
    }
    var plan = displayPlan();
    var source = (plan.sessions || []).find(function (session) {
      return session.id === sourceId;
    });
    if (!source) {
      showMessage("This session has changed; reload and try again.", "error");
      return;
    }
    if (source.date === targetDate) {
      showMessage("The date is unchanged.", "notice");
      return;
    }
    try {
      var previewState = core.adjustSchedule(privateState, sourceId, targetDate, {
        holidayCalendars: holidayCalendars,
        asOfDate: todayInShanghai(),
        allowDeadlineChange: true
      });
      var previewPlan = core.generate(previewState, holidayCalendars, { asOfDate: todayInShanghai() });
      openScheduleAdjustmentConfirmation({
        sourceId: sourceId,
        sourceLabel: source.label,
        targetDate: targetDate,
        days: core.daysBetween(source.date, targetDate),
        affectedCount: (plan.sessions || []).filter(function (session) {
          return session.date >= source.date && session.status !== "completed";
        }).length,
        newEndDate: previewPlan.cycle.endDate,
        changesFixedDeadline: Boolean(privateState.activeCycle.replannedSchedule)
      });
    } catch (error) {
      showScheduleAdjustmentError(error);
    }
  }

  function requestSessionMove(sourceId, targetDate) {
    if (savePending) {
      showMessage("The previous change is still being saved.", "notice");
      return;
    }
    if (!isOwner || isOffline || !privateState) {
      showMessage("Sign in as the owner while online first.", "error");
      return;
    }
    var plan = displayPlan();
    var source = (plan.sessions || []).find(function (session) {
      return session.id === sourceId;
    });
    var cycle = privateState.activeCycle;
    if (!source) {
      showMessage("This session has changed; reload and try again.", "error");
      return;
    }
    if (!targetDate || targetDate < cycle.startDate || targetDate > cycle.endDate) {
      showMessage("The new date must be inside the current cycle.", "error");
      return;
    }
    if (source.date === targetDate) {
      showMessage("The date is unchanged.", "notice");
      return;
    }

    var request = { sourceId: sourceId, targetDate: targetDate, replace: false };
    var conflicts = moveConflicts(plan, sourceId, targetDate);
    var recordedConflict = conflicts.some(function (session) {
      return Boolean(privateState.logs[session.id]);
    });
    if (recordedConflict) {
      showMessage("That date already has a logged session; move that one first.", "error");
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
    pendingScheduleAdjustment = null;
    dom.moveConfirm.close();
  }

  function confirmSessionMove() {
    if (pendingScheduleAdjustment) {
      var adjustment = pendingScheduleAdjustment;
      pendingScheduleAdjustment = null;
      dom.moveConfirm.close();
      applyScheduleAdjustment(adjustment);
      return;
    }
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
    var save = dom.detailBody.querySelector("[data-save-log]");
    if (save) {
      save.addEventListener("click", function () {
        saveTrainingLog(session, save);
      });
    }
    var skip = dom.detailBody.querySelector("[data-skip-session]");
    if (skip) {
      skip.addEventListener("click", async function () {
        skip.disabled = true;
        try {
          await commit(core.recordSession(privateState, session, {
            status: "skipped",
            mainSets: [],
            notes: dom.detailBody.querySelector("[data-log-notes]").value
          }), "The session was marked as skipped.");
        } finally {
          skip.disabled = false;
        }
      });
    }
    var restoreSkipped = dom.detailBody.querySelector("[data-restore-skipped-session]");
    if (restoreSkipped) {
      restoreSkipped.addEventListener("click", function () {
        cancelSessionSkip(session, restoreSkipped);
      });
    }
    var move = dom.detailBody.querySelector("[data-move-session]");
    if (move) {
      move.addEventListener("click", function () {
        var date = dom.detailBody.querySelector("[data-move-date]").value;
        if (!date) {
          showMessage("Pick the date to move this session to.", "error");
          return;
        }
        requestSessionMove(session.id, date);
      });
    }
    var adjustSchedule = dom.detailBody.querySelector("[data-adjust-schedule]");
    if (adjustSchedule) {
      adjustSchedule.addEventListener("click", function () {
        var date = dom.detailBody.querySelector("[data-move-date]").value;
        if (!date) {
          showMessage("Pick the date this session should land on.", "error");
          return;
        }
        requestScheduleAdjustment(session.id, date);
      });
    }
  }

  async function cancelSessionSkip(session, button) {
    button.disabled = true;
    try {
      await commit(core.restoreSkippedSession(privateState, session.id),
        "The skip was undone.");
    } catch (error) {
      showMessage("The skip could not be undone: " + error.message, "error");
    } finally {
      button.disabled = false;
    }
  }

  async function saveTrainingLog(session, button) {
    var invalid = Array.prototype.slice.call(dom.detailBody.querySelectorAll("input[type=number]")).find(function (input) {
      return !input.checkValidity();
    });
    if (invalid) {
      invalid.reportValidity();
      showMessage("Check the weight, reps and RPE fields in the log.", "error");
      return;
    }
    var sets = Array.prototype.slice.call(dom.detailBody.querySelectorAll("[data-log-set]")).map(function (row) {
      return {
        weight: Number(row.querySelector("[data-log-weight]").value),
        reps: Number(row.querySelector("[data-log-reps]").value),
        rpe: row.querySelector("[data-log-rpe]").value === "" ? null : Number(row.querySelector("[data-log-rpe]").value),
        completed: Number(row.querySelector("[data-log-reps]").value) >= Number(row.dataset.plannedReps)
      };
    });
    var secondarySets = Array.prototype.slice.call(dom.detailBody.querySelectorAll("[data-log-secondary-set]")).map(function (row) {
      return {
        weight: Number(row.querySelector("[data-log-weight]").value),
        reps: Number(row.querySelector("[data-log-reps]").value)
      };
    });
    var previousAccessories = (privateState.logs[session.id] || {}).accessories || [];
    var accessories = Array.prototype.slice.call(dom.detailBody.querySelectorAll("[data-accessory-log]")).map(function (row) {
      var previous = previousAccessories.find(function (entry) {
        return entry.name === row.dataset.accessoryName || core.localize(entry.name) === row.dataset.accessoryName;
      });
      // Editing the simplified form preserves fields from older records.
      return Object.assign({}, previous, {
        name: row.dataset.accessoryName,
        weight: Number(row.querySelector("[data-accessory-weight]").value),
        sets: Number(row.querySelector("[data-accessory-sets]").value),
        reps: Number(row.querySelector("[data-accessory-reps]").value),
        completed: Number(row.querySelector("[data-accessory-sets]").value) > 0 &&
          Number(row.querySelector("[data-accessory-reps]").value) > 0
      });
    });
    if (button) button.disabled = true;
    try {
      await commit(core.recordSession(privateState, session, {
        status: "completed",
        mainSets: sets,
        secondarySets: secondarySets,
        accessories: accessories,
        notes: dom.detailBody.querySelector("[data-log-notes]").value
      }), "The session log was saved.");
    } finally {
      if (button) button.disabled = false;
    }
  }

  // The single write path. The state on screen is only replaced once the
  // server has accepted the new one, so a failed or conflicting save leaves
  // the last saved plan in place.
  async function commit(candidateState, successMessage) {
    if (!isOwner || isOffline || !store.configured) {
      showMessage("The plan is read-only right now and cannot be saved.", "error");
      return false;
    }
    if (savePending) {
      showMessage("The previous change is still being saved.", "notice");
      return false;
    }
    savePending = true;
    try {
      var nextState = core.adoptFeedbackProgram(deepClone(candidateState), todayInShanghai());
      await ensureHolidayYears(nextState.activeCycle);
      var generated = core.generate(nextState, holidayCalendars, { asOfDate: todayInShanghai() });
      nextState = generated.state;
      var snapshot = core.createPublicSnapshot(nextState, generated);
      var record = await store.save(nextState.version, nextState, snapshot);
      nextState.version = record.version;
      nextState.updatedAt = record.updatedAt;
      privateState = nextState;
      // Render first so the drawer can hand focus back to the session's new button.
      render();
      closeDetails();
      showMessage(successMessage, "success");
      return true;
    } catch (error) {
      if (error.code === "version_conflict") {
        pendingConflict = { local: deepClone(candidateState), message: successMessage };
        dom.conflictMessage.textContent = "Another device saved the plan after this page loaded it. " +
          "Merging keeps the session logs, bodyweight entries and moves from both sides.";
        dom.conflict.showModal();
        return "conflict";
      }
      showMessage("Saving failed; the plan was not changed: " + error.message, "error");
      return false;
    } finally {
      savePending = false;
    }
  }

  async function resolveConflict(strategy) {
    var pending = pendingConflict;
    if (!pending) {
      dom.conflict.close();
      return;
    }
    try {
      var latest = await store.loadPrivate();
      var remote = latest && latest.state ? core.normalizeState(latest.state) : null;
      var resolved;
      if (strategy === "merge" && remote) {
        remote.version = Number(latest.version || 0);
        resolved = core.mergeStates(privateState, remote, pending.local);
      } else {
        resolved = deepClone(pending.local);
      }
      resolved.version = latest ? Number(latest.version || 0) : 0;
      pendingConflict = null;
      dom.conflict.close();
      await commit(resolved, strategy === "merge"
        ? "Both sets of changes were merged and saved."
        : "The server version was overwritten with this device's plan.");
    } catch (error) {
      if (error.code === "merge_conflict") {
        dom.conflictMessage.textContent = "Both devices changed the same plan settings (" + error.field +
          "), so they cannot be merged automatically. Reload the server version, or overwrite it with this device's plan.";
        return;
      }
      showMessage("The conflict could not be resolved: " + error.message, "error");
    }
  }

  function discardConflict() {
    pendingConflict = null;
    render();
    showMessage("The unsaved change was discarded; the plan shows the last version this page saved.", "notice");
  }

  async function reloadAfterConflict() {
    pendingConflict = null;
    dom.conflict.close();
    await loadOwnerPlan();
    showMessage("The server version was reloaded.", "success");
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
      showMessage("Sign in as the owner while online first.", "error");
      return;
    }
    var cycle = privateState.activeCycle;
    var date = todayInShanghai();
    if (date < cycle.startDate) {
      showMessage("The cycle has not started yet, so there is no bodyweight to record.", "notice");
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
      dom.bodyweightError.textContent = "The date must be inside the current cycle and no later than today.";
      return;
    }
    if (!bodyweight || bodyweight < 30 || bodyweight > 300) {
      dom.bodyweightError.textContent = "Enter a bodyweight between 30 and 300 kg.";
      return;
    }
    var saved = await commit(core.recordBodyweight(privateState, {
      date: date,
      value: bodyweight
    }), "The bodyweight entry was saved.");
    if (saved === false) {
      dom.bodyweightError.textContent = "Saving failed; nothing was changed. Try again shortly.";
      return;
    }
    dom.bodyweightDialog.close();
  }

  function openSettings(newCycle) {
    if (!isOwner || isOffline) {
      showMessage("Sign in as the owner while online first.", "error");
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
    dom.settingsTitle.textContent = settingsNewCycle ? "Start a new cycle" : "Edit plan";
    inputValue("startDate", settingsDraftCycle.startDate);
    inputValue("endDate", settingsDraftCycle.requestedEndDate || settingsDraftCycle.endDate);
    inputValue("replanFromDate", todayInShanghai());
    inputValue("trainOnHolidays", "yes");
    updateSettingsScheduleFields();
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
    settingsInitialSchedule = settingsScheduleSignature();
    dom.settings.showModal();
  }

  function settingsScheduleSignature() {
    var fields = dom.settingsForm.elements;
    return JSON.stringify({
      endDate: fields.endDate.value,
      fromDate: fields.replanFromDate.value,
      trainOnHolidays: fields.trainOnHolidays.value,
      template: readTemplateEditor().map(function (item) {
        return [item.id, item.type, item.weekday];
      }),
      holidays: Object.keys(settingsHolidayOverrides).sort().map(function (date) {
        return [date, settingsHolidayOverrides[date]];
      })
    });
  }

  function updateSettingsScheduleFields() {
    var fields = dom.settingsForm.elements;
    var replanning = !settingsNewCycle && settingsDraftCycle.status !== "draft";
    dom.settingsReplanFrom.hidden = !replanning;
    dom.settingsReplanHolidays.hidden = !replanning;
    fields.replanFromDate.disabled = !replanning;
    fields.replanFromDate.required = replanning;
    fields.trainOnHolidays.disabled = !replanning;
    fields.startDate.readOnly = replanning;
    if (replanning) fields.startDate.value = settingsDraftCycle.startDate;
    dom.settingsScheduleHelp.textContent = replanning
      ? "The end date is fixed. The first save, or any change to the schedule fields, keeps earlier sessions " +
        "and every log, drops moves and shifts on the remaining sessions, and lays them out again from the " +
        "weekly template. Later edits to loads or training time keep manual moves."
      : "The cycle ends on the date you set; it is never extended automatically.";
  }

  function templateTypeOptions(selected) {
    return Object.keys(core.TYPE_LABELS).map(function (type) {
      return '<option value="' + type + '"' + (type === selected ? " selected" : "") + ">" +
        escapeHtml(core.TYPE_LABELS[type]) + "</option>";
    }).join("");
  }

  function weekdayOptions(selected) {
    var labels = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
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
        '<select data-template-type aria-label="Session type">' + templateTypeOptions(item.type) + "</select>" +
        '<select data-template-weekday aria-label="Weekday">' + weekdayOptions(item.weekday) + "</select>" +
        '<div class="plan-template-actions"><button type="button" data-template-up aria-label="Move up">↑</button>' +
        '<button type="button" data-template-down aria-label="Move down">↓</button>' +
        '<button type="button" data-template-remove aria-label="Remove">×</button></div></div>';
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
        (settingsHolidayOverrides[date] === "off" ? "rest day" : "training day")) +
        '</span><button class="plan-text-button" type="button" data-remove-holiday="' +
        escapeHtml(date) + '">Remove</button></div>';
    }).join("") : '<p class="plan-cycle-meta">No manual overrides.</p>';
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
    var replanning = !settingsNewCycle && privateState.activeCycle.status !== "draft" &&
      (!privateState.activeCycle.replannedSchedule || settingsScheduleSignature() !== settingsInitialSchedule);

    if (!startDate || !endDate || endDate < startDate) {
      dom.formError.textContent = "The end date must be after the start date.";
      return;
    }
    if (core.daysBetween(startDate, endDate) < 27) {
      dom.formError.textContent = "A cycle needs at least 4 weeks; anything under 8 weeks keeps a warning.";
      return;
    }
    if (!bodyweight || bodyweight <= 0) {
      dom.formError.textContent = bootstrapsBodyweight
        ? "Enter a valid starting bodyweight."
        : "Record a bodyweight with “Update bodyweight” first.";
      return;
    }
    if (!lifts.bench.current || !lifts.bench.target ||
        !lifts.squat.current || !lifts.squat.target ||
        bodyweight + lifts.pullup.current <= 0 ||
        bodyweight + lifts.pullup.target <= 0) {
      dom.formError.textContent = "Enter a valid current and goal 1RM for all three lifts.";
      return;
    }
    if (!template.length || new Set(weekdays).size !== weekdays.length) {
      dom.formError.textContent = "The weekly template needs at least one session and at most one per day.";
      return;
    }

    var nextState = deepClone(privateState);
    if (replanning) {
      try {
        nextState = core.replanRemaining(privateState, holidayCalendars, {
          fromDate: String(form.get("replanFromDate") || ""),
          endDate: endDate,
          asOfDate: todayInShanghai(),
          template: template,
          holidayOverrides: deepClone(settingsHolidayOverrides),
          trainOnHolidays: form.get("trainOnHolidays") === "yes"
        });
      } catch (error) {
        dom.formError.textContent = error.code === "invalid_replan_dates"
          ? "The reschedule start date must lie between the cycle start and end dates."
          : (error.code === "replan_recorded_after_deadline"
            ? "Sessions are already logged after that end date; set the end date after them."
            : (error.code === "invalid_replan_template"
              ? "Check the weekly template: at least one session, and at most one per day."
              : "The plan could not be rescheduled: " + error.message));
        return;
      }
    }

    if (settingsNewCycle && nextState.activeCycle.status !== "draft") {
      var archivedLogs = {};
      var archivedCycle = deepClone(nextState.activeCycle);
      var archivedOverview = snapshotProgressOverview(core.generate(
        nextState,
        holidayCalendars,
        { asOfDate: todayInShanghai() }
      ));
      archivedCycle.status = "archived";
      archivedOverview.cycle.status = "archived";
      Object.keys(nextState.logs).forEach(function (id) {
        if (id.indexOf(nextState.activeCycle.id + ":") === 0) {
          archivedLogs[id] = nextState.logs[id];
          delete nextState.logs[id];
        }
      });
      nextState.archivedCycles.unshift({
        cycle: archivedCycle,
        logs: archivedLogs,
        overview: archivedOverview,
        archivedAt: new Date().toISOString()
      });
    }

    var cycle = settingsNewCycle ? core.createDefaultState(startDate).activeCycle : nextState.activeCycle;
    cycle.startDate = startDate;
    cycle.requestedEndDate = endDate;
    cycle.endDate = endDate;
    cycle.schedule = null;
    cycle.id = settingsNewCycle ? "cycle-" + startDate + "-" + Date.now().toString(36) : cycle.id;
    var wasDraft = cycle.status === "draft";
    cycle.status = "active";
    if (settingsNewCycle || wasDraft || cycle.title === core.templateTitle(cycle.template)) {
      cycle.title = core.templateTitle(template);
    }
    cycle.template = template;
    if (!replanning) cycle.holidayOverrides = deepClone(settingsHolidayOverrides);
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
    ["bench", "pullup", "squat"].forEach(function (key) {
      var lift = cycle.lifts[key];
      if (settingsNewCycle || Number(lift.current1rm) !== lifts[key].current) {
        lift.assessed1rm = lifts[key].current;
        lift.assessedOn = settingsNewCycle ? core.addDays(startDate, -1) : todayInShanghai();
        // A corrected estimate restarts the reference line from that value.
        if (!settingsNewCycle && cycle.status !== "draft") {
          core.reanchorLift(cycle, key, lifts[key].current, todayInShanghai());
        }
      }
      lift.current1rm = lifts[key].current;
      lift.target1rm = lifts[key].target;
      if (settingsNewCycle || lift.baseline1rm == null || lift.baseline1rm === "") lift.baseline1rm = lift.current1rm;
    });
    nextState.activeCycle = cycle;
    nextState.preferences.trainingTime = form.get("trainingTime") || "19:00";
    var previousChartArchive = viewingChartArchive;
    viewingChartArchive = -1;
    var saved = await commit(nextState, settingsNewCycle ? "The new cycle was created and the previous one archived." :
      (replanning ? "The remaining sessions were rescheduled to the fixed end date." : "The plan was regenerated."));
    if (saved !== true) viewingChartArchive = previousChartArchive;
    if (saved === true) {
      dom.settings.close();
    } else if (saved === false) {
      dom.formError.textContent = "Saving failed; the plan was not changed. Try again shortly.";
    } else {
      dom.settings.close();
    }
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
    download("miyaal-training-plan.ics",
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

  dom.auth.addEventListener("click", async function () {
    if (!store.configured) {
      showMessage("Set the Supabase URL and publishable key in _config.yml first.", "notice");
      return;
    }
    dom.auth.disabled = true;
    try {
      var availability;
      try {
        availability = await store.loadPublic();
      } catch (_) {
        availability = null;
      }
      if (!availability || availability.offline) {
        showMessage("The sync service is unavailable, so sign-in is not possible right now.", "offline");
        return;
      }
      await store.signIn();
    } catch (error) {
      showMessage("GitHub sign-in failed: " + error.message, "error");
    } finally {
      dom.auth.disabled = false;
    }
  });
  dom.updateBodyweight.addEventListener("click", openBodyweightDialog);
  dom.edit.addEventListener("click", function () { openSettings(false); });
  dom.newCycle.addEventListener("click", function () { openSettings(true); });
  dom.signOut.addEventListener("click", function () {
    store.signOut().catch(function (error) {
      showMessage("Sign-out failed: " + error.message, "error");
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
  function clearCalendarDrag() {
    draggedSessionId = null;
    calendarDragActive = false;
    Array.prototype.slice.call(dom.monthGrid.querySelectorAll(".is-dragging, .is-drop-target, .is-replace-target")).forEach(function (cell) {
      cell.classList.remove("is-dragging", "is-drop-target", "is-replace-target");
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
    if (!source || savePending) {
      event.preventDefault();
      return;
    }
    draggedSessionId = source.dataset.sessionId;
    calendarDragActive = true;
    source.classList.add("is-dragging");
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
      dom.formError.textContent = "Pick the date to override.";
      return;
    }
    settingsHolidayOverrides[date] = dom.holidayType.value;
    dom.holidayDate.value = "";
    dom.formError.textContent = "";
    renderHolidayOverrides();
  });
  dom.cycleSelect.addEventListener("change", function () {
    viewingChartArchive = dom.cycleSelect.value === ALL_CYCLES
      ? ALL_CYCLES
      : Number(dom.cycleSelect.value);
    render();
  });
  app.querySelector("[data-plan-cancel-move]").addEventListener("click", cancelSessionMove);
  app.querySelector("[data-plan-confirm-move]").addEventListener("click", confirmSessionMove);
  dom.moveConfirm.addEventListener("cancel", function () {
    pendingSessionMove = null;
    pendingScheduleAdjustment = null;
  });
  app.querySelector("[data-plan-reload]").addEventListener("click", reloadAfterConflict);
  app.querySelector("[data-plan-merge]").addEventListener("click", function () { resolveConflict("merge"); });
  // Esc closes the dialog without choosing: drop the unsaved change so the
  // page never shows a plan the server does not have.
  dom.conflict.addEventListener("cancel", discardConflict);
  dom.drawer.addEventListener("close", restoreDetailFocus);
  dom.drawer.addEventListener("click", function (event) {
    if (event.target === dom.drawer) {
      closeDetails();
    }
  });
  window.addEventListener("resize", function () {
    window.clearTimeout(chartResizeTimer);
    chartResizeTimer = window.setTimeout(function () {
      var plan = displayPlan();
      if (plan) {
        renderTrajectory(displayTrajectoryPlan(plan));
      }
    }, 120);
  });
  app.querySelector("[data-plan-force-save]").addEventListener("click", function () { resolveConflict("overwrite"); });
  mobileQuery.addEventListener("change", function () {
    renderCalendar(displayPlan());
  });
  window.addEventListener("offline", function () {
    isOffline = true;
    render();
    showMessage("The network dropped; the plan is read-only until it returns.", "offline");
  });
  window.addEventListener("online", function () {
    if (!store.configured) {
      return;
    }
    var reload = isOwner ? loadOwnerPlan : loadPublicPlan;
    reload().then(function () {
      showMessage("The network is back and the plan was reloaded.", "success");
    }).catch(function (error) {
      showMessage("The plan could not be reloaded: " + error.message, "error");
    });
  });

  initialize();
}());
