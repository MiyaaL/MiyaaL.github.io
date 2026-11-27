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
    details: app.querySelector("[data-quant-details]")
  };

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

  function show(section) {
    [dom.locked, dom.empty, dom.view].forEach(function (node) {
      node.hidden = node !== section;
    });
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

  async function load() {
    showMessage("");
    var session = await client.auth.getSession();
    if (session.error) throw session.error;
    if (!session.data.session) {
      lock("Sign in with the owner's GitHub account to see the paper-trading results.");
      return;
    }
    setSignedIn(true);
    setState("Loading");
    var response = await client.rpc("load_quant_dashboard");
    if (response.error) {
      if (String(response.error.message || "").indexOf("not_dashboard_owner") >= 0) {
        await client.auth.signOut();
        lock("This GitHub account cannot view the dashboard.");
        return;
      }
      throw response.error;
    }
    var rows = Array.isArray(response.data) ? response.data : response.data ? [response.data] : [];
    if (!rows.length) {
      show(dom.empty);
      setState("No upload yet");
      return;
    }
    render(rows[0]);
  }

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
