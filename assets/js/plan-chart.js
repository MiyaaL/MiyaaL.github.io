(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.PlanChart = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Three lifts with very different loads share one chart, so each is plotted
  // as the share of its own distance from the cycle's starting 1RM to its goal.
  // Kilograms stay available in the tooltip.
  var DAY_MS = 24 * 60 * 60 * 1000;
  var LIFTS = [
    { key: "bench", label: "Bench press", short: "Bench" },
    { key: "pullup", label: "Weighted pull-up", short: "Pull-up" },
    { key: "squat", label: "Back squat", short: "Squat" }
  ];

  function readNumber(value) {
    if (value == null || value === "") {
      return null;
    }
    var number = Number(value);
    return Number.isFinite(number) ? number : null;
  }

  function parseDate(value) {
    var parts = String(value || "").split("-").map(Number);
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }

  function addDays(value, amount) {
    var date = parseDate(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return date.toISOString().slice(0, 10);
  }

  function daysBetween(start, end) {
    return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
  }

  function dateInRange(date, start, end) {
    return Boolean(date) && date >= start && date <= end;
  }

  function byDate(points) {
    var map = {};
    points.forEach(function (point) {
      if (point && point.date && readNumber(point.value) != null) {
        map[point.date] = point;
      }
    });
    return Object.keys(map).sort().map(function (date) { return map[date]; });
  }

  function valueAt(points, date) {
    var before = null;
    var after = null;
    points.forEach(function (point) {
      if (point.date <= date) before = point;
      else if (!after) after = point;
    });
    if (before && before.date === date) return before.value;
    if (before && after) {
      var span = Math.max(1, daysBetween(before.date, after.date));
      return before.value + (after.value - before.value) * daysBetween(before.date, date) / span;
    }
    return before ? before.value : (after ? after.value : null);
  }

  function hasCycle(plan) {
    return Boolean(plan && plan.cycle && plan.cycle.startDate && plan.cycle.endDate);
  }

  function liftSeries(plan, definition, today) {
    var cycle = plan.cycle;
    var lift = cycle.lifts && cycle.lifts[definition.key] ? cycle.lifts[definition.key] : {};
    var start = readNumber(lift.baseline1rm);
    if (start == null) start = readNumber(lift.current1rm);
    var goal = readNumber(lift.target1rm);
    if (start == null || goal == null) {
      return null;
    }
    // A maintenance goal has no distance to cover; it sits on the goal line.
    var span = goal - start;
    var percent = function (value) {
      return span > 0 ? (value - start) / span * 100 : (value >= goal ? 100 : 100 + (value - goal));
    };

    var planned = [{ date: cycle.startDate, value: start, detail: "Cycle start" }];
    (plan.sessions || []).forEach(function (session) {
      var workout = session.workout || {};
      var value = readNumber(workout.planned1rm);
      if (workout.liftKey !== definition.key || value == null || session.date === cycle.startDate) {
        return;
      }
      planned.push({
        date: session.date,
        value: value,
        detail: "Programmed reference" + (session.phase && session.phase.label ? " · " + session.phase.label : "")
      });
    });
    planned = byDate(planned);
    var actual = byDate(((plan.performance || {})[definition.key] || []).map(function (entry) {
      return {
        date: entry.date,
        value: readNumber(entry.value),
        isTest: Boolean(entry.isTest),
        detail: entry.isTest ? "Tested 1RM" : "Estimated 1RM from the logged session"
      };
    }).filter(function (point) {
      return dateInRange(point.date, cycle.startDate, cycle.endDate);
    }));
    var decorate = function (point) {
      point.percent = Math.round(percent(point.value) * 10) / 10;
      return point;
    };
    planned.forEach(decorate);
    actual.forEach(decorate);

    var todayPoint = null;
    if (dateInRange(today, cycle.startDate, cycle.endDate)) {
      var todayValue = valueAt(planned, today);
      if (todayValue != null) {
        todayPoint = decorate({ date: today, value: Math.round(todayValue * 10) / 10, detail: "Programmed reference today" });
      }
    }
    return {
      key: definition.key,
      label: definition.label,
      short: definition.short,
      start: start,
      goal: goal,
      points: planned,
      actual: actual,
      today: todayPoint
    };
  }

  function cycleSeries(plan, today) {
    return LIFTS.map(function (definition) {
      return liftSeries(plan, definition, today);
    }).filter(Boolean);
  }

  function buildSeries(plan, today) {
    if (!hasCycle(plan)) {
      return { startDate: null, endDate: null, today: today || null, series: [] };
    }
    return {
      startDate: plan.cycle.startDate,
      endDate: plan.cycle.endDate,
      today: today || null,
      series: cycleSeries(plan, today)
    };
  }

  // Overlapping cycles need one line per cycle per lift: concatenating them into a
  // single polyline would draw a segment between two cycles that never touch.
  function buildSeriesForPlans(plans, today) {
    var cycles = (plans || []).filter(hasCycle);
    if (!cycles.length) {
      return { startDate: null, endDate: null, today: today || null, series: [] };
    }
    var startDate = cycles[0].cycle.startDate;
    var endDate = cycles[0].cycle.endDate;
    var result = [];
    cycles.forEach(function (plan, index) {
      if (plan.cycle.startDate < startDate) startDate = plan.cycle.startDate;
      if (plan.cycle.endDate > endDate) endDate = plan.cycle.endDate;
      cycleSeries(plan, today).forEach(function (item) {
        item.id = index + "-" + item.key;
        item.cycleLabel = plan.cycleLabel || "Cycle " + String(index + 1).padStart(2, "0");
        item.cycleState = plan.cycle.status === "archived" ? "archived" : "current";
        result.push(item);
      });
    });
    return { startDate: startDate, endDate: endDate, today: today || null, series: result, multiCycle: true };
  }

  function percentDomain(series) {
    var values = [0, 100];
    series.forEach(function (item) {
      item.points.concat(item.actual).forEach(function (point) { values.push(point.percent); });
    });
    var minimum = Math.floor(Math.min.apply(Math, values) / 25) * 25;
    var maximum = Math.ceil(Math.max.apply(Math, values) / 25) * 25;
    var step = maximum - minimum > 200 ? 50 : 25;
    var ticks = [];
    for (var value = minimum; value <= maximum; value += step) ticks.push(value);
    return { minimum: minimum, maximum: maximum, ticks: ticks };
  }

  function escapeXml(value) {
    return String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function formatValue(value) {
    return Number(value).toFixed(1).replace(/\.0$/, "");
  }

  function formatKg(value, key) {
    return (key === "pullup" && value > 0 ? "+" : "") + formatValue(value) + " kg" + (key === "pullup" ? " added" : "");
  }

  function formatPercent(value) {
    return Math.round(value) + " %";
  }

  function shortDate(value) {
    var parts = String(value).split("-");
    return parts.length === 3 ? parts[1] + "." + parts[2] : value;
  }

  function fullDate(value) {
    return String(value).replace(/-/g, ".");
  }

  function renderLegend(element, series) {
    // One entry per lift whatever the number of cycles, then the two mark types.
    var seen = {};
    var html = series.filter(function (item) {
      if (seen[item.key]) return false;
      seen[item.key] = true;
      return true;
    }).map(function (item) {
      return '<span class="plan-chart-legend-item"><i class="is-' + escapeXml(item.key) +
        '" aria-hidden="true"></i><span>' + escapeXml(item.label) + "</span></span>";
    });
    html.push('<span class="plan-chart-legend-item is-key"><i class="is-line" aria-hidden="true"></i>' +
      "<span>Programmed</span></span>");
    html.push('<span class="plan-chart-legend-item is-key"><i class="is-dot" aria-hidden="true"></i>' +
      "<span>Logged estimate</span></span>");
    element.innerHTML = html.join("");
  }

  function bindTooltips(plot, width) {
    var tooltip = plot.querySelector("[data-chart-tooltip]");
    var name = tooltip.querySelector("[data-chart-tooltip-name]");
    var value = tooltip.querySelector("[data-chart-tooltip-value]");
    var detail = tooltip.querySelector("[data-chart-tooltip-detail]");

    function show(point) {
      name.textContent = point.dataset.series + " · " + fullDate(point.dataset.date);
      value.textContent = point.dataset.value + " · " + point.dataset.percent + " of the way";
      detail.textContent = point.dataset.detail;
      tooltip.hidden = false;
      var renderedWidth = plot.clientWidth || width;
      var x = Number(point.dataset.x) / width * renderedWidth;
      var y = Number(point.dataset.y);
      tooltip.style.left = Math.max(96, Math.min(renderedWidth - 96, x)) + "px";
      tooltip.style.top = Math.max(18, y) + "px";
      tooltip.classList.toggle("is-below", y < 84);
    }

    function hide() {
      tooltip.hidden = true;
    }

    Array.prototype.slice.call(plot.querySelectorAll("[data-chart-point]")).forEach(function (point) {
      point.addEventListener("mouseenter", function () { show(point); });
      point.addEventListener("mouseleave", hide);
      point.addEventListener("focus", function () { show(point); });
      point.addEventListener("blur", hide);
      point.addEventListener("keydown", function (event) {
        if (event.key === "Escape") {
          point.blur();
          hide();
        }
      });
    });
  }

  function hitTarget(item, point, x, y, kind, focusable) {
    var kg = formatKg(point.value, item.key);
    var detail = (item.cycleLabel ? item.cycleLabel + " · " : "") + point.detail;
    var aria = item.label + ", " + fullDate(point.date) + ", " + kg + ", " + formatPercent(point.percent) +
      " of the way to " + formatKg(item.goal, item.key) + ", " + detail;
    return '<circle class="plan-chart-point-hit" cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="11"' +
      (focusable ? ' tabindex="0" focusable="true" role="img" aria-label="' + escapeXml(aria) + '"'
        : ' aria-hidden="true"') +
      ' data-chart-point data-kind="' + kind + '" data-lift="' + escapeXml(item.key) + '" data-series="' +
      escapeXml(item.label) + '"' + (item.cycleLabel ? ' data-cycle-label="' + escapeXml(item.cycleLabel) + '"' : "") +
      ' data-date="' + escapeXml(point.date) + '" data-value="' + escapeXml(kg) + '" data-percent="' +
      escapeXml(formatPercent(point.percent)) + '" data-detail="' + escapeXml(detail) + '" data-x="' + x.toFixed(1) +
      '" data-y="' + y.toFixed(1) + '"></circle>';
  }

  // Direct labels sit at the line ends. Where two ends are closer than a line
  // of text they are spread apart and joined to their line by a short leader.
  function endLabels(series, xFor, yFor, top, bottom) {
    var labels = series.map(function (item) {
      var last = item.points[item.points.length - 1];
      return { item: item, x: xFor(last.date), anchor: yFor(last.percent), y: yFor(last.percent), value: last.value };
    }).sort(function (left, right) { return left.anchor - right.anchor; });
    var gap = 16;
    for (var index = 1; index < labels.length; index += 1) {
      if (labels[index].y - labels[index - 1].y < gap) labels[index].y = labels[index - 1].y + gap;
    }
    var overflow = labels.length ? labels[labels.length - 1].y - bottom : 0;
    if (overflow > 0) labels.forEach(function (label) { label.y -= overflow; });
    for (var back = labels.length - 2; back >= 0; back -= 1) {
      if (labels[back + 1].y - labels[back].y < gap) labels[back].y = labels[back + 1].y - gap;
    }
    labels.forEach(function (label) { label.y = Math.max(top, label.y); });
    return labels;
  }

  function render(rootElement, plan, options) {
    var settings = options || {};
    var model = settings.plans
      ? buildSeriesForPlans(settings.plans, settings.today)
      : buildSeries(plan, settings.today);
    var legend = rootElement.querySelector("[data-plan-chart-legend]");
    var plot = rootElement.querySelector("[data-plan-chart-plot]");
    var empty = rootElement.querySelector("[data-plan-chart-empty]");
    if (!legend || !plot || !empty) {
      return model;
    }

    if (!model.series.length) {
      legend.innerHTML = "";
      plot.innerHTML = "";
      plot.hidden = true;
      empty.hidden = false;
      return model;
    }

    plot.hidden = false;
    empty.hidden = true;
    renderLegend(legend, model.series);

    var width = Math.max(320, Math.round(plot.clientWidth || 960));
    var compact = width < 560;
    var height = Math.max(240, Math.round(plot.clientHeight || (compact ? 280 : 320)));
    var labelled = !model.multiCycle;
    var margin = { top: 24, right: labelled ? (compact ? 96 : 150) : 16, bottom: 34, left: 46 };
    var chartWidth = Math.max(1, width - margin.left - margin.right);
    var chartHeight = height - margin.top - margin.bottom;
    var cycleDays = Math.max(1, daysBetween(model.startDate, model.endDate));
    var domain = percentDomain(model.series);
    var domainSpan = Math.max(1, domain.maximum - domain.minimum);
    var xFor = function (date) {
      return margin.left + daysBetween(model.startDate, date) / cycleDays * chartWidth;
    };
    var yFor = function (value) {
      return margin.top + (domain.maximum - value) / domainSpan * chartHeight;
    };

    var svg = [];
    svg.push('<svg class="plan-chart-svg" viewBox="0 0 ' + width + " " + height +
      '" role="group" aria-label="Progress of each lift from its starting 1RM toward its goal, in percent">');

    domain.ticks.forEach(function (tick) {
      var y = yFor(tick);
      svg.push('<line class="plan-chart-grid-line' + (tick === 100 ? " is-goal" : "") + '" x1="' + margin.left +
        '" y1="' + y + '" x2="' + (margin.left + chartWidth) + '" y2="' + y + '"></line>');
      svg.push('<text class="plan-chart-axis-label" x="' + (margin.left - 8) + '" y="' + (y + 4) +
        '" text-anchor="end">' + (tick === 100 ? "Goal" : (tick === 0 ? "Start" : tick + " %")) + "</text>");
    });

    var tickCount = compact ? 3 : 5;
    for (var tickIndex = 0; tickIndex < tickCount; tickIndex += 1) {
      var tickDate = addDays(model.startDate, Math.round(cycleDays * tickIndex / (tickCount - 1)));
      var anchor = tickIndex === 0 ? "start" : tickIndex === tickCount - 1 ? "end" : "middle";
      svg.push('<text class="plan-chart-axis-label" x="' + xFor(tickDate) + '" y="' + (height - 8) +
        '" text-anchor="' + anchor + '">' + escapeXml(shortDate(tickDate)) + "</text>");
    }

    if (dateInRange(model.today, model.startDate, model.endDate)) {
      var todayX = xFor(model.today);
      var todayAnchor = todayX > margin.left + chartWidth - 50 ? "end" : "start";
      svg.push('<line class="plan-chart-today-line" x1="' + todayX + '" y1="' + margin.top +
        '" x2="' + todayX + '" y2="' + (height - margin.bottom) + '"></line>');
      svg.push('<text class="plan-chart-today-label" x="' + (todayAnchor === "end" ? todayX - 6 : todayX + 6) +
        '" y="' + (margin.top - 8) + '" text-anchor="' + todayAnchor + '">Today</text>');
    }

    var hits = [];
    model.series.forEach(function (item) {
      var cycleAttribute = item.cycleState ? ' data-cycle="' + escapeXml(item.cycleState) + '"' : "";
      var path = item.points.map(function (point, index) {
        return (index ? "L" : "M") + xFor(point.date).toFixed(2) + " " + yFor(point.percent).toFixed(2);
      }).join(" ");
      svg.push('<path class="plan-chart-line is-' + escapeXml(item.key) + '"' + cycleAttribute + ' d="' + path + '"></path>');
      item.points.forEach(function (point) {
        hits.push(hitTarget(item, point, xFor(point.date), yFor(point.percent), "planned", false));
      });
    });
    // Logged estimates are drawn after every line so their surface ring keeps
    // them legible where they cross one.
    model.series.forEach(function (item) {
      var cycleAttribute = item.cycleState ? ' data-cycle="' + escapeXml(item.cycleState) + '"' : "";
      item.actual.forEach(function (point) {
        var x = xFor(point.date);
        var y = yFor(point.percent);
        svg.push('<circle class="plan-chart-actual is-' + escapeXml(item.key) + (point.isTest ? " is-test" : "") +
          '"' + cycleAttribute + ' cx="' + x.toFixed(1) + '" cy="' + y.toFixed(1) + '" r="' +
          (point.isTest ? 5.5 : 4) + '"></circle>');
        hits.push(hitTarget(item, point, x, y, "actual", true));
      });
      if (item.today && item.cycleState !== "archived") {
        hits.push(hitTarget(item, item.today, xFor(item.today.date), yFor(item.today.percent), "today", true));
      }
    });

    if (labelled) {
      endLabels(model.series, xFor, yFor, margin.top + 4, height - margin.bottom).forEach(function (label) {
        var labelX = label.x + 14;
        if (Math.abs(label.y - label.anchor) > 1) {
          svg.push('<line class="plan-chart-leader" x1="' + (label.x + 2) + '" y1="' + label.anchor.toFixed(1) +
            '" x2="' + (labelX - 3) + '" y2="' + label.y.toFixed(1) + '"></line>');
        }
        svg.push('<text class="plan-chart-end-label" x="' + labelX + '" y="' + (label.y + 4).toFixed(1) + '">' +
          escapeXml(compact ? label.item.short : label.item.label) + '<tspan class="plan-chart-end-value" dx="6">' +
          escapeXml(formatKg(label.value, label.item.key).replace(" added", "")) + "</tspan></text>");
      });
    }

    svg.push(hits.join(""));
    svg.push("</svg>");
    svg.push('<div class="plan-chart-tooltip" data-chart-tooltip role="status" hidden>' +
      '<strong data-chart-tooltip-name></strong><span data-chart-tooltip-value></span>' +
      '<small data-chart-tooltip-detail></small></div>');
    plot.innerHTML = svg.join("");
    bindTooltips(plot, width);
    return model;
  }

  return {
    buildSeries: buildSeries,
    buildSeriesForPlans: buildSeriesForPlans,
    render: render
  };
}));
