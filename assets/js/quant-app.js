(function () {
  "use strict";

  // Private quant-lab dashboard. The page ships no numbers: everything below is
  // fetched with load_quant_dashboard() after the owner signs in with GitHub,
  // and the database refuses every other account.

  var app = document.querySelector("[data-quant-app]");
  if (!app || !window.QuantCore) {
    return;
  }

  var core = window.QuantCore;
  var dom = {
    state: document.querySelector("[data-quant-state]"),
    signIn: document.querySelector("[data-quant-sign-in]"),
    signOut: document.querySelector("[data-quant-sign-out]"),
    message: app.querySelector("[data-quant-message]"),
    locked: app.querySelector("[data-quant-locked]"),
    lockedText: app.querySelector("[data-quant-locked-text]"),
    empty: app.querySelector("[data-quant-empty]"),
    view: app.querySelector("[data-quant-view]"),
    period: app.querySelector("[data-quant-period]"),
    kpis: app.querySelector("[data-quant-kpis]"),
    pending: app.querySelector("[data-quant-pending]"),
    charts: app.querySelector("[data-quant-charts]"),
    equity: app.querySelector("[data-quant-chart='equity']"),
    drawdown: app.querySelector("[data-quant-chart='drawdown']"),
    drawdownNow: app.querySelector("[data-quant-drawdown-now]"),
    legend: app.querySelector("[data-quant-legend]"),
    table: app.querySelector("[data-quant-table]"),
    signal: app.querySelector("[data-quant-signal]"),
    monthly: app.querySelector("[data-quant-monthly]"),
    details: app.querySelector("[data-quant-details]"),
    tabs: app.querySelector("[data-quant-tabs]"),
    tabButtons: Array.prototype.slice.call(app.querySelectorAll("[data-quant-tab]")),
    data: app.querySelector("[data-quant-data]"),
    dataEmpty: app.querySelector("[data-quant-data-empty]"),
    dataView: app.querySelector("[data-quant-data-view]"),
    dataMeta: app.querySelector("[data-quant-data-meta]"),
    dataKpis: app.querySelector("[data-quant-data-kpis]"),
    alerts: app.querySelector("[data-quant-alerts]"),
    datasets: app.querySelector("[data-quant-datasets]"),
    crossBlock: app.querySelector("[data-quant-cross-block]"),
    crossMeta: app.querySelector("[data-quant-cross-meta]"),
    cross: app.querySelector("[data-quant-cross]")
  };
  var activeTab = window.location.hash === "#data" ? "data" : "paper";
  var dataRecord;  // undefined = not fetched yet, null = nothing uploaded

  function createClient() {
    var url = app.getAttribute("data-supabase-url");
    var key = app.getAttribute("data-supabase-key");
    if (window.QuantDashboardClient) {
      return window.QuantDashboardClient; // injected by the DOM tests
    }
    if (!url || !key || !window.supabase || !window.supabase.createClient) {
      return null;
    }
    return window.supabase.createClient(url, key, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
    });
  }

  var client = createClient();

  function element(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function clear(node) {
    while (node && node.firstChild) node.removeChild(node.firstChild);
  }

  function setState(text) {
    if (dom.state) dom.state.textContent = text;
  }

  function showMessage(text) {
    dom.message.textContent = text || "";
    dom.message.hidden = !text;
  }

  // `section` is the locked panel, or one of the two tab panels' contents.
  function show(section) {
    var unlocked = section !== dom.locked;
    dom.locked.hidden = unlocked;
    dom.tabs.hidden = !unlocked;
    var paper = unlocked && activeTab === "paper";
    dom.empty.hidden = !(paper && section === dom.empty);
    dom.view.hidden = !(paper && section !== dom.empty);
    dom.data.hidden = !(unlocked && activeTab === "data");
  }

  function setSignedIn(signedIn) {
    if (dom.signIn) dom.signIn.hidden = signedIn;
    if (dom.signOut) dom.signOut.hidden = !signedIn;
  }

  function lock(text) {
    setSignedIn(false);
    clear(dom.kpis);
    clear(dom.equity);
    clear(dom.drawdown);
    clear(dom.dataKpis);
    clear(dom.datasets);
    dataRecord = undefined;
    show(dom.locked);
    dom.lockedText.textContent = text;
    setState("Private");
  }

  function formatTimestamp(value) {
    if (!value) return "";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    try {
      return new Intl.DateTimeFormat("en-CA", {
        timeZone: "Asia/Shanghai",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        hour12: false
      }).format(date).replace(",", "") + " CST";
    } catch (_) {
      return date.toISOString().slice(0, 16).replace("T", " ") + " UTC";
    }
  }

  // ---- rendering ---------------------------------------------------------

  function renderKpis(snapshot) {
    clear(dom.kpis);
    core.KPIS.forEach(function (definition) {
      var tile = element("div", "quant-kpi");
      tile.appendChild(element("dt", "quant-kpi-label", definition.label));
      var hidden = core.metricHidden(definition, snapshot);
      var value = hidden ? "—" : core.formatMetric(definition, snapshot.metrics[definition.key]);
      var figure = element("dd", "quant-kpi-value", value);
      if (hidden) figure.title = "Shown after 20 trading days";
      tile.appendChild(figure);
      dom.kpis.appendChild(tile);
    });
  }

  function chartLines(snapshot) {
    var lines = [{ key: "strategy", label: "Strategy", values: snapshot.series.strategy }];
    if (snapshot.series.benchmark) {
      lines.push({ key: "benchmark", label: "Benchmark " + snapshot.benchmark, values: snapshot.series.benchmark });
    }
    return lines;
  }

  function attachCrosshair(container, model, rows) {
    var svg = container.querySelector("svg");
    var crosshair = svg.querySelector("[data-chart-crosshair]");
    var tooltip = container.querySelector("[data-chart-tooltip]");
    var date = tooltip.querySelector("[data-chart-tooltip-date]");
    var list = tooltip.querySelector("[data-chart-tooltip-rows]");
    var current = model.dates.length - 1;

    function place(index) {
      current = Math.max(0, Math.min(model.dates.length - 1, index));
      var x = model.x(current);
      crosshair.setAttribute("x1", x.toFixed(2));
      crosshair.setAttribute("x2", x.toFixed(2));
      crosshair.removeAttribute("hidden");
      date.textContent = model.dates[current];
      clear(list);
      rows.forEach(function (row) {
        var item = element("li");
        var key = element("span", "quant-tooltip-key");
        key.setAttribute("data-series", row.key);
        item.appendChild(key);
        item.appendChild(element("strong", null, row.format(row.values[current])));
        item.appendChild(element("span", "quant-tooltip-name", row.label));
        list.appendChild(item);
      });
      tooltip.hidden = false;
      var ratio = x / model.geometry.width;
      tooltip.style.left = (ratio * 100).toFixed(2) + "%";
      tooltip.classList.toggle("is-left", ratio > 0.6);
    }

    function hide() {
      crosshair.setAttribute("hidden", "hidden");
      tooltip.hidden = true;
    }

    container.addEventListener("pointermove", function (event) {
      var box = svg.getBoundingClientRect();
      if (!box.width) return;
      place(core.indexAtRatio(model, (event.clientX - box.left) / box.width));
    });
    container.addEventListener("pointerleave", hide);
    container.addEventListener("focus", function () { place(current); });
    container.addEventListener("blur", hide);
    container.addEventListener("keydown", function (event) {
      var step = { ArrowLeft: -1, ArrowRight: 1, PageUp: -20, PageDown: 20 }[event.key];
      if (event.key === "Home") step = -current;
      if (event.key === "End") step = model.dates.length - 1 - current;
      if (step == null) return;
      event.preventDefault();
      place(current + step);
    });
  }

  function chartFrame(container, model, svgOptions, rows, label) {
    clear(container);
    container.setAttribute("aria-label", label + ". Use the arrow keys to read each day.");
    var holder = element("div", "quant-chart-plot");
    holder.innerHTML = core.chartSvg(model, svgOptions); // built from numbers and escaped text only
    var tooltip = element("div", "quant-chart-tooltip");
    tooltip.setAttribute("data-chart-tooltip", "");
    tooltip.setAttribute("role", "status");
    tooltip.hidden = true;
    var date = element("span", "quant-tooltip-date");
    date.setAttribute("data-chart-tooltip-date", "");
    var list = element("ul", "quant-tooltip-rows");
    list.setAttribute("data-chart-tooltip-rows", "");
    tooltip.appendChild(date);
    tooltip.appendChild(list);
    holder.appendChild(tooltip);
    container.appendChild(holder);
    attachCrosshair(container, model, rows);
  }

  function renderLegend(lines) {
    clear(dom.legend);
    dom.legend.hidden = lines.length < 2;
    lines.forEach(function (line) {
      var item = element("li");
      var key = element("span", "quant-legend-key");
      key.setAttribute("data-series", line.key);
      item.appendChild(key);
      item.appendChild(document.createTextNode(line.label));
      dom.legend.appendChild(item);
    });
  }

  function renderTable(snapshot, lines) {
    clear(dom.table);
    var head = element("tr");
    head.appendChild(element("th", null, "Date"));
    lines.forEach(function (line) { head.appendChild(element("th", null, line.label + " (start = 100)")); });
    head.appendChild(element("th", null, "Drawdown"));
    var thead = element("thead");
    thead.appendChild(head);
    var tbody = element("tbody");
    for (var i = snapshot.series.dates.length - 1; i >= 0; i -= 1) {
      var row = element("tr");
      row.appendChild(element("th", null, snapshot.series.dates[i]));
      lines.forEach(function (line) { row.appendChild(element("td", null, line.values[i].toFixed(2))); });
      row.appendChild(element("td", null, core.formatPercent(snapshot.series.drawdown[i] / 100, { signed: true })));
      tbody.appendChild(row);
    }
    dom.table.appendChild(thead);
    dom.table.appendChild(tbody);
  }

  function renderCharts(snapshot) {
    var ready = Boolean(snapshot.series);
    dom.pending.hidden = ready;
    dom.charts.hidden = !ready;
    if (!ready) {
      clear(dom.equity);
      clear(dom.drawdown);
      return;
    }
    var lines = chartLines(snapshot);
    var index = function (value) { return value.toFixed(1); };
    var equityModel = core.chartModel(snapshot.series.dates, lines, {});
    chartFrame(dom.equity, equityModel, {
      label: "Net value indexed to 100 at the start",
      tickFormat: function (value) { return value.toFixed(value % 1 ? 1 : 0); },
      valueFormat: index,
      endLabels: true
    }, lines.map(function (line) {
      return { key: line.key, label: line.label, values: line.values, format: index };
    }), "Net value, strategy against benchmark");

    // A single series: the heading names it, so there is no legend or end label.
    // The latest value goes in the caption instead.
    var drawdownLine = [{ key: "drawdown", label: "Drawdown", values: snapshot.series.drawdown }];
    var percent = function (value) { return core.formatPercent(value / 100, { signed: true, digits: 1 }); };
    var latest = snapshot.series.drawdown[snapshot.series.drawdown.length - 1];
    dom.drawdownNow.textContent = latest < 0 ? "Now " + percent(latest) + " below the peak." : "Now at a new high.";
    var drawdownModel = core.chartModel(snapshot.series.dates, drawdownLine, { includeZero: true });
    chartFrame(dom.drawdown, drawdownModel, {
      label: "Drawdown from the running peak",
      tickFormat: function (value) { return value === 0 ? "0%" : core.formatPercent(value / 100, { digits: 0 }); },
      valueFormat: percent,
      area: true,
      zeroLine: true
    }, [{ key: "drawdown", label: "Drawdown", values: snapshot.series.drawdown, format: percent }],
    "Strategy drawdown");

    renderLegend(lines);
    renderTable(snapshot, lines);
  }

  function renderSignal(snapshot) {
    clear(dom.signal);
    var signal = snapshot.signal;
    if (!signal) {
      dom.signal.appendChild(element("p", "quant-muted", "No signal uploaded yet."));
      return;
    }
    var params = Object.keys(signal.params).sort().map(function (key) {
      return key + "=" + String(signal.params[key]);
    }).join(", ");
    dom.signal.appendChild(element("p", "quant-signal-meta",
      [signal.signalDate ? "Signal of " + signal.signalDate : "", signal.strategy, params ? "(" + params + ")" : ""]
        .filter(Boolean).join(" · ") + " · executes at the next open"));
    if (!signal.targets.length) {
      dom.signal.appendChild(element("p", "quant-muted", "All cash: no instrument passes the signal."));
      return;
    }
    var list = element("ul", "quant-targets");
    var cash = 1;
    signal.targets.forEach(function (target) {
      cash -= target.weight;
      var item = element("li");
      var label = element("span", "quant-target-name");
      label.appendChild(element("span", "quant-target-symbol", target.symbol));
      label.appendChild(document.createTextNode(" " + target.name));
      item.appendChild(label);
      var meter = element("span", "quant-target-meter");
      meter.setAttribute("aria-hidden", "true");
      var fill = element("span", "quant-target-fill");
      fill.style.width = Math.max(0, Math.min(100, target.weight * 100)).toFixed(1) + "%";
      meter.appendChild(fill);
      item.appendChild(meter);
      item.appendChild(element("span", "quant-target-weight", core.formatPercent(target.weight, { digits: 1 })));
      list.appendChild(item);
    });
    dom.signal.appendChild(list);
    dom.signal.appendChild(element("p", "quant-muted", "Cash " + core.formatPercent(Math.max(0, cash), { digits: 1 })));
  }

  function renderMonthly(snapshot) {
    clear(dom.monthly);
    if (!snapshot.monthly.length) {
      var row = element("tr");
      var cell = element("td", "quant-muted", "Monthly returns appear after the first full month.");
      cell.colSpan = 14;
      row.appendChild(cell);
      dom.monthly.appendChild(row);
      return;
    }
    snapshot.monthly.slice().reverse().forEach(function (entry) {
      var row = element("tr");
      row.appendChild(element("th", null, String(entry.year)));
      core.monthCells(entry).forEach(function (cell) {
        var td = element("td", cell.value === null ? null : cell.value >= 0 ? "is-up" : "is-down", cell.text);
        row.appendChild(td);
      });
      var total = element("td", entry.total === null ? null : entry.total >= 0 ? "is-up" : "is-down",
        entry.total === null ? "" : core.formatPercent(entry.total, { signed: true, digits: 1 }));
      row.appendChild(total);
      dom.monthly.appendChild(row);
    });
  }

  function renderDetails(snapshot) {
    clear(dom.details);
    core.DETAILS.forEach(function (definition) {
      var hidden = core.metricHidden(definition, snapshot);
      var value = snapshot.metrics[definition.key];
      if (!hidden && value === null) return;
      var item = element("div");
      item.appendChild(element("dt", null, definition.label));
      item.appendChild(element("dd", null, hidden ? "after 20 days" : core.formatMetric(definition, value)));
      dom.details.appendChild(item);
    });
  }

  // ---- data health -------------------------------------------------------

  var LEVEL_TEXT = { ok: "OK", warning: "Warning", critical: "Critical" };

  function badge(levelName) {
    // Icon and word, never colour alone.
    var node = element("span", "quant-badge is-" + levelName);
    var icon = element("span", "quant-badge-icon", { ok: "✓", warning: "!", critical: "✕" }[levelName]);
    icon.setAttribute("aria-hidden", "true");
    node.appendChild(icon);
    node.appendChild(document.createTextNode(LEVEL_TEXT[levelName]));
    return node;
  }

  function renderDataKpis(health) {
    clear(dom.dataKpis);
    var symbols = 0;
    var behind = 0;
    health.datasets.forEach(function (dataset) {
      symbols += dataset.symbols.length;
      dataset.symbols.forEach(function (row) { behind = Math.max(behind, row.sessionsBehind || 0); });
    });
    var open = health.alerts.filter(function (item) { return item.level !== "ok"; }).length;
    [
      ["Datasets", String(health.datasets.length)],
      ["Instruments", String(symbols)],
      ["Most sessions behind", String(behind)],
      ["Open alerts", String(open)]
    ].forEach(function (pair) {
      var tile = element("div", "quant-kpi");
      tile.appendChild(element("dt", "quant-kpi-label", pair[0]));
      tile.appendChild(element("dd", "quant-kpi-value", pair[1]));
      dom.dataKpis.appendChild(tile);
    });
  }

  function renderAlerts(health) {
    clear(dom.alerts);
    var open = health.alerts.filter(function (item) { return item.level !== "ok"; });
    if (!open.length) {
      var item = element("li");
      item.appendChild(badge("ok"));
      item.appendChild(element("span", null, "No open alerts."));
      dom.alerts.appendChild(item);
      return;
    }
    open.forEach(function (alert) {
      var item = element("li");
      item.appendChild(badge(alert.level));
      var where = [alert.dataset, alert.symbol].filter(Boolean).join(" · ");
      if (where) item.appendChild(element("span", "quant-alert-where", where));
      item.appendChild(element("span", null, alert.message));
      dom.alerts.appendChild(item);
    });
  }

  function coverageBlock(model) {
    var figure = element("figure", "quant-coverage");
    figure.setAttribute("aria-label", "Coverage from " + model.start + " to " + model.end + "; ticks mark missing sessions");
    model.rows.forEach(function (row) {
      var line = element("div", "quant-coverage-row");
      line.appendChild(element("span", "quant-coverage-label", row.symbol));
      var track = element("span", "quant-coverage-track");
      var bar = element("span", "quant-coverage-bar");
      bar.style.left = (row.from * 100).toFixed(2) + "%";
      bar.style.width = (Math.max(row.to - row.from, 0.004) * 100).toFixed(2) + "%";
      track.appendChild(bar);
      row.gaps.forEach(function (at) {
        var gap = element("span", "quant-coverage-gap");
        gap.style.left = (at * 100).toFixed(2) + "%";
        track.appendChild(gap);
      });
      line.appendChild(track);
      // On a multi-year axis a few stale sessions are invisible, so they are written out.
      line.appendChild(element("span", "quant-coverage-behind", row.behind ? row.behind + " behind" : "current"));
      figure.appendChild(line);
    });
    var axis = element("figcaption", "quant-coverage-axis");
    axis.appendChild(element("span", null, model.start));
    axis.appendChild(element("span", null, model.end));
    figure.appendChild(axis);
    return figure;
  }

  function datasetBlock(dataset) {
    var block = element("section", "quant-block");
    var heading = element("div", "quant-block-heading");
    heading.appendChild(element("h2", null, "Dataset · " + dataset.id));
    block.appendChild(heading);
    var facts = [dataset.frequency, dataset.provider, dataset.adjust && "adjust " + dataset.adjust,
      dataset.updatedAt && "updated " + formatTimestamp(dataset.updatedAt)].filter(Boolean).join(" · ");
    block.appendChild(element("p", "quant-caption", facts));
    if (!dataset.collected || !dataset.symbols.length) {
      block.appendChild(element("p", "quant-muted", "Not collected yet."));
      return block;
    }
    var model = core.coverageModel(dataset.symbols);
    if (model) block.appendChild(coverageBlock(model));

    var wrap = element("div", "quant-table-wrap");
    var table = element("table", "quant-table quant-health");
    var head = element("tr");
    ["Instrument", "Status", "First", "Last", "Rows", "Behind", "Gaps", "Last update"].forEach(function (label) {
      var th = element("th", null, label);
      th.scope = "col";
      head.appendChild(th);
    });
    var thead = element("thead");
    thead.appendChild(head);
    var tbody = element("tbody");
    dataset.symbols.forEach(function (row) {
      var tr = element("tr");
      var name = element("th", null, row.symbol + (row.name ? " " + row.name : ""));
      name.scope = "row";
      tr.appendChild(name);
      var status = element("td");
      status.appendChild(badge(core.symbolLevel(row)));
      tr.appendChild(status);
      tr.appendChild(element("td", null, row.first || "—"));
      tr.appendChild(element("td", null, row.last || "—"));
      tr.appendChild(element("td", null, row.rows === null ? "—" : row.rows.toLocaleString("en-US")));
      tr.appendChild(element("td", null, row.sessionsBehind === null ? "—" : String(row.sessionsBehind)));
      var gaps = element("td", null, String(row.missingCount || 0));
      if (row.missingSessions.length) gaps.title = row.missingSessions.join(", ");
      tr.appendChild(gaps);
      var update = element("td", null, row.lastStatus || "—");
      var notes = [row.lastError].concat(row.problems).filter(Boolean);
      if (notes.length) update.title = notes.join("\n");
      tr.appendChild(update);
      tbody.appendChild(tr);
    });
    table.appendChild(thead);
    table.appendChild(tbody);
    wrap.appendChild(table);
    block.appendChild(wrap);
    return block;
  }

  function renderCrossCheck(health) {
    clear(dom.cross);
    var check = health.crossCheck;
    dom.crossBlock.hidden = !check || !check.results.length;
    if (dom.crossBlock.hidden) return;
    dom.crossMeta.textContent = [
      check.source && "Against " + check.source,
      check.days && "last " + check.days + " sessions",
      check.threshold !== null && "threshold " + core.formatPercent(check.threshold, { digits: 2 }),
      check.checkedAt && "checked " + formatTimestamp(check.checkedAt)
    ].filter(Boolean).join(" · ");
    var head = element("tr");
    ["Instrument", "Compared", "Over threshold", "Max deviation"].forEach(function (label) {
      var th = element("th", null, label);
      th.scope = "col";
      head.appendChild(th);
    });
    var thead = element("thead");
    thead.appendChild(head);
    var tbody = element("tbody");
    check.results.forEach(function (row) {
      var tr = element("tr");
      var name = element("th", null, row.symbol);
      name.scope = "row";
      tr.appendChild(name);
      tr.appendChild(element("td", null, row.compared === null ? "—" : String(row.compared)));
      tr.appendChild(element("td", null, row.overThreshold === null ? "—" : String(row.overThreshold)));
      tr.appendChild(element("td", null, row.maxDeviation === null ? "—" : core.formatPercent(row.maxDeviation, { digits: 2 })));
      tbody.appendChild(tr);
    });
    dom.cross.appendChild(thead);
    dom.cross.appendChild(tbody);
  }

  function renderData(record) {
    if (!record) {
      dom.dataEmpty.hidden = false;
      dom.dataView.hidden = true;
      return;
    }
    var health = core.normalizeDataHealth(record.payload);
    var storage = health.storage ? core.formatBytes(health.storage.bytes) + " in " + health.storage.files + " files" : "";
    dom.dataMeta.textContent = [
      health.lastSession && "Latest session " + health.lastSession,
      health.calendarSource && "calendar " + health.calendarSource,
      storage,
      "uploaded " + formatTimestamp(record.uploaded_at)
    ].filter(Boolean).join(" · ");
    renderDataKpis(health);
    renderAlerts(health);
    clear(dom.datasets);
    health.datasets.forEach(function (dataset) { dom.datasets.appendChild(datasetBlock(dataset)); });
    renderCrossCheck(health);
    dom.dataEmpty.hidden = true;
    dom.dataView.hidden = false;
  }

  function render(record) {
    var snapshot = core.normalizeSnapshot(record.payload);
    var period = snapshot.period;
    dom.period.textContent = period
      ? period.start + " → " + period.end + " · " + period.days + (period.days === 1 ? " trading day" : " trading days") +
        " · uploaded " + formatTimestamp(record.uploaded_at)
      : "Uploaded " + formatTimestamp(record.uploaded_at);
    renderKpis(snapshot);
    renderCharts(snapshot);
    renderSignal(snapshot);
    renderMonthly(snapshot);
    renderDetails(snapshot);
    show(dom.view);
    setState("Updated " + formatTimestamp(record.uploaded_at));
  }

  // ---- data --------------------------------------------------------------

  // Latest snapshot of one kind: the record, null when none was uploaded, or
  // undefined when the account was refused (the page is then locked).
  async function fetchKind(kind) {
    var response = await client.rpc("load_quant_dashboard", { p_kind: kind });
    if (response.error) {
      if (String(response.error.message || "").indexOf("not_dashboard_owner") >= 0) {
        await client.auth.signOut();
        lock("This GitHub account cannot view the dashboard.");
        return undefined;
      }
      throw response.error;
    }
    var rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    return rows.length ? rows[0] : null;
  }

  async function showData() {
    if (dataRecord === undefined) {
      setState("Loading");
      var record = await fetchKind("data");
      if (record === undefined) return;
      dataRecord = record;
    }
    renderData(dataRecord);
    show(dom.data);
    setState(dataRecord ? "Updated " + formatTimestamp(dataRecord.uploaded_at) : "No upload yet");
  }

  async function load() {
    showMessage("");
    var session = await client.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data.session) {
      lock("Sign in with the owner's GitHub account to see the paper-trading results and data health.");
      return;
    }
    setSignedIn(true);
    setState("Loading");
    if (activeTab === "data") {
      await showData();
      return;
    }
    var record = await fetchKind("paper");
    if (record === undefined) return;
    if (!record) {
      show(dom.empty);
      setState("No upload yet");
      return;
    }
    render(record);
  }

  function selectTab(name, focus) {
    activeTab = name;
    dom.tabButtons.forEach(function (button) {
      var selected = button.getAttribute("data-quant-tab") === name;
      button.setAttribute("aria-selected", selected ? "true" : "false");
      button.tabIndex = selected ? 0 : -1;
      if (selected && focus) button.focus();
    });
    if (window.history && window.history.replaceState) {
      window.history.replaceState(null, "", name === "data" ? "#data" : window.location.pathname);
    }
    load().catch(fail);
  }

  dom.tabButtons.forEach(function (button, index) {
    button.addEventListener("click", function () { selectTab(button.getAttribute("data-quant-tab"), false); });
    button.addEventListener("keydown", function (event) {
      var step = { ArrowRight: 1, ArrowLeft: -1 }[event.key];
      if (step == null) return;
      event.preventDefault();
      var next = dom.tabButtons[(index + step + dom.tabButtons.length) % dom.tabButtons.length];
      selectTab(next.getAttribute("data-quant-tab"), true);
    });
  });
  dom.tabButtons.forEach(function (button) {
    var selected = button.getAttribute("data-quant-tab") === activeTab;
    button.setAttribute("aria-selected", selected ? "true" : "false");
    button.tabIndex = selected ? 0 : -1;
  });

  function fail(error) {
    setState("Error");
    showMessage("The dashboard could not be loaded: " + (error && error.message ? error.message : "unknown error"));
  }

  if (!client) {
    lock("Sign-in is not configured for this site.");
    if (dom.signIn) dom.signIn.disabled = true;
    return;
  }

  if (dom.signIn) {
    dom.signIn.addEventListener("click", function () {
      client.auth.signInWithOAuth({
        provider: "github",
        options: { redirectTo: window.location.origin + window.location.pathname }
      }).then(function (response) {
        if (response && response.error) fail(response.error);
      }, fail);
    });
  }
  if (dom.signOut) {
    dom.signOut.addEventListener("click", function () {
      client.auth.signOut().then(function () {
        lock("Signed out.");
      }, fail);
    });
  }

  client.auth.onAuthStateChange(function (event) {
    if (event === "SIGNED_IN" || event === "SIGNED_OUT") {
      load().catch(fail);
    }
  });

  load().catch(fail);
}());
