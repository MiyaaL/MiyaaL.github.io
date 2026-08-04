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

  var DAY_MS = 24 * 60 * 60 * 1000;
  var SERIES = [
    { key: "bodyweight", label: "Bodyweight", metric: "Logged weight", kind: "actual" },
    { key: "bench", label: "Bench Press", metric: "Planned 1RM", kind: "planned" },
    { key: "pullup", label: "Weighted Pull-up", metric: "Planned added 1RM", kind: "planned" },
    { key: "squat", label: "Back Squat", metric: "Planned 1RM", kind: "planned" }
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

  function formatDate(date) {
    return date.toISOString().slice(0, 10);
  }

  function addDays(value, amount) {
    var date = parseDate(value);
    date.setUTCDate(date.getUTCDate() + amount);
    return formatDate(date);
  }

  function daysBetween(start, end) {
    return Math.round((parseDate(end).getTime() - parseDate(start).getTime()) / DAY_MS);
  }

  function dateInRange(date, start, end) {
    return date && date >= start && date <= end;
  }

  function dedupePoints(points) {
    var byDate = {};
    points.forEach(function (point) {
      if (point && point.date && readNumber(point.value) != null) {
        byDate[point.date] = point;
      }
    });
    return Object.keys(byDate).sort().map(function (date) {
      return byDate[date];
    });
  }

  function addTodayPoint(points, today, carryForward) {
    var sorted = dedupePoints(points);
    if (!sorted.length || !today) {
      return sorted;
    }

    var exact = sorted.find(function (point) {
      return point.date === today;
    });
    if (exact) {
      exact.isToday = true;
      return sorted;
    }

    var before = null;
    var after = null;
    sorted.forEach(function (point) {
      if (point.date < today) {
        before = point;
      } else if (!after && point.date > today) {
        after = point;
      }
    });

    if (before && after) {
      var span = Math.max(1, daysBetween(before.date, after.date));
      var progress = daysBetween(before.date, today) / span;
      sorted.push({
        date: today,
        value: before.value + (after.value - before.value) * progress,
        detail: "Current date · interpolated plan",
        isToday: true,
        isInterpolated: true
      });
    } else if (carryForward && before) {
      sorted.push({
        date: today,
        value: before.value,
        detail: "Current date · latest entry from " + before.date,
        isToday: true,
        isCarried: true
      });
    }

    return dedupePoints(sorted).map(function (point) {
      if (point.date === today) {
        point.isToday = true;
      }
      return point;
    });
  }

  function liftSeries(plan, definition, today) {
    var cycle = plan.cycle || {};
    var lift = cycle.lifts && cycle.lifts[definition.key] ? cycle.lifts[definition.key] : {};
    var points = [];

    (plan.sessions || []).forEach(function (session) {
      var workout = session.workout || {};
      var value = readNumber(workout.planned1rm);
      if (workout.liftKey !== definition.key || value == null) {
        return;
      }
      points.push({
        date: session.date,
        value: value,
        detail: (session.status === "completed" ? "Completed session" : "Planned session") +
          (session.phase && session.phase.label ? " · " + session.phase.label : "")
      });
    });

    var current = readNumber(lift.current1rm);
    if (current != null) {
      points = points.filter(function (point) {
        return point.date !== cycle.startDate;
      });
      points.push({ date: cycle.startDate, value: current, detail: "Cycle baseline" });
    }
    var target = readNumber(lift.target1rm);
    if (target != null) {
      points = points.filter(function (point) {
        return point.date !== cycle.endDate;
      });
      points.push({ date: cycle.endDate, value: target, detail: "Cycle target" });
    }

    points = dedupePoints(points);
    if (dateInRange(today, cycle.startDate, cycle.endDate)) {
      points = addTodayPoint(points, today, false);
    }
    if (!points.length) {
      return null;
    }

    return {
      key: definition.key,
      label: definition.label,
      metric: definition.metric,
      kind: definition.kind,
      points: points
    };
  }

  function bodyweightSeries(plan, definition, today) {
    var cycle = plan.cycle || {};
    if (!Array.isArray(cycle.bodyweightEntries)) {
      return null;
    }
    var points = cycle.bodyweightEntries.map(function (entry) {
      return {
        date: entry.date,
        value: readNumber(entry.value),
        detail: "Recorded bodyweight"
      };
    }).filter(function (point) {
      return point.value != null && dateInRange(point.date, cycle.startDate, cycle.endDate);
    });

    points = dedupePoints(points);
    if (dateInRange(today, cycle.startDate, cycle.endDate)) {
      points = addTodayPoint(points, today, true);
    }
    if (!points.length) {
      return null;
    }

    return {
      key: definition.key,
      label: definition.label,
      metric: definition.metric,
      kind: definition.kind,
      points: points
    };
  }

  function buildSeries(plan, today) {
    if (!plan || !plan.cycle || !plan.cycle.startDate || !plan.cycle.endDate) {
      return { startDate: null, endDate: null, today: today || null, series: [] };
    }

    var result = [];
    SERIES.forEach(function (definition) {
      var item = definition.key === "bodyweight"
        ? bodyweightSeries(plan, definition, today)
        : liftSeries(plan, definition, today);
      if (item) {
        result.push(item);
      }
    });

    return {
      startDate: plan.cycle.startDate,
      endDate: plan.cycle.endDate,
      today: today || null,
      series: result
    };
  }

  function niceDomain(series) {
    var values = [];
    series.forEach(function (item) {
      item.points.forEach(function (point) {
        values.push(point.value);
      });
    });
    if (!values.length) {
      return { minimum: 0, maximum: 100, ticks: [0, 20, 40, 60, 80, 100] };
    }

    var minimum = Math.min.apply(Math, values);
    var maximum = Math.max.apply(Math, values);
    if (minimum === maximum) {
      var spread = Math.max(2.5, Math.abs(minimum) * 0.08);
      minimum -= spread;
      maximum += spread;
    } else {
      var padding = (maximum - minimum) * 0.08;
      minimum -= padding;
      maximum += padding;
    }

    var roughStep = Math.max(0.1, (maximum - minimum) / 5);
    var magnitude = Math.pow(10, Math.floor(Math.log(roughStep) / Math.LN10));
    var residual = roughStep / magnitude;
    var step = (residual <= 1 ? 1 : residual <= 2 ? 2 : residual <= 2.5 ? 2.5 : residual <= 5 ? 5 : 10) * magnitude;
    var niceMinimum = Math.floor(minimum / step) * step;
    var niceMaximum = Math.ceil(maximum / step) * step;
    var ticks = [];
    for (var value = niceMinimum; value <= niceMaximum + step / 2; value += step) {
      ticks.push(Math.round(value * 100) / 100);
    }
    return { minimum: niceMinimum, maximum: niceMaximum, ticks: ticks };
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

  function shortDate(value) {
    var parts = String(value).split("-");
    return parts.length === 3 ? parts[1] + "." + parts[2] : value;
  }

  function fullDate(value) {
    return String(value).replace(/-/g, ".");
  }

  function renderLegend(element, series) {
    element.innerHTML = series.map(function (item) {
      return '<span class="plan-chart-legend-item"><i class="is-' + escapeXml(item.key) +
        '" aria-hidden="true"></i><span>' + escapeXml(item.label) + '</span><small>' +
        escapeXml(item.metric) + "</small></span>";
    }).join("");
  }

  function bindTooltips(plot, width) {
    var tooltip = plot.querySelector("[data-chart-tooltip]");
    var name = tooltip.querySelector("[data-chart-tooltip-name]");
    var value = tooltip.querySelector("[data-chart-tooltip-value]");
    var detail = tooltip.querySelector("[data-chart-tooltip-detail]");
    var points = Array.prototype.slice.call(plot.querySelectorAll("[data-chart-point]"));

    function show(point) {
      name.textContent = point.dataset.series + " · " + fullDate(point.dataset.date);
      value.textContent = point.dataset.value + " kg";
      detail.textContent = point.dataset.detail;
      tooltip.hidden = false;

      var x = Number(point.dataset.x);
      var y = Number(point.dataset.y);
      var renderedWidth = plot.clientWidth || width;
      var renderedX = x / width * renderedWidth;
      tooltip.style.left = Math.max(82, Math.min(renderedWidth - 82, renderedX)) + "px";
      tooltip.style.top = Math.max(18, y) + "px";
      tooltip.classList.toggle("is-below", y < 76);
    }

    function hide() {
      tooltip.hidden = true;
    }

    points.forEach(function (point) {
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

  function render(rootElement, plan, options) {
    var optionsValue = options || {};
    var model = buildSeries(plan, optionsValue.today);
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
    var height = Math.max(240, Math.round(plot.clientHeight || (width < 560 ? 260 : 300)));
    var margin = { top: 26, right: 18, bottom: 36, left: 52 };
    var chartWidth = Math.max(1, width - margin.left - margin.right);
    var chartHeight = height - margin.top - margin.bottom;
    var cycleDays = Math.max(1, daysBetween(model.startDate, model.endDate));
    var domain = niceDomain(model.series);
    var domainSpan = Math.max(1, domain.maximum - domain.minimum);
    var xFor = function (date) {
      return margin.left + daysBetween(model.startDate, date) / cycleDays * chartWidth;
    };
    var yFor = function (value) {
      return margin.top + (domain.maximum - value) / domainSpan * chartHeight;
    };

    var svg = [];
    svg.push('<svg class="plan-chart-svg" viewBox="0 0 ' + width + " " + height +
      '" role="img" aria-label="Cycle bodyweight and strength trajectory">');
    svg.push('<text class="plan-chart-unit" x="' + margin.left + '" y="12">KG</text>');

    domain.ticks.forEach(function (tick) {
      var y = yFor(tick);
      svg.push('<line class="plan-chart-grid-line" x1="' + margin.left + '" y1="' + y +
        '" x2="' + (width - margin.right) + '" y2="' + y + '"></line>');
      svg.push('<text class="plan-chart-axis-label" x="' + (margin.left - 10) + '" y="' + (y + 3) +
        '" text-anchor="end">' + escapeXml(formatValue(tick)) + "</text>");
    });

    for (var tickIndex = 0; tickIndex < 5; tickIndex += 1) {
      var tickDate = addDays(model.startDate, Math.round(cycleDays * tickIndex / 4));
      var tickX = xFor(tickDate);
      var anchor = tickIndex === 0 ? "start" : tickIndex === 4 ? "end" : "middle";
      svg.push('<text class="plan-chart-axis-label" x="' + tickX + '" y="' + (height - 8) +
        '" text-anchor="' + anchor + '">' + escapeXml(shortDate(tickDate)) + "</text>");
    }

    if (dateInRange(model.today, model.startDate, model.endDate)) {
      var todayX = xFor(model.today);
      var todayAnchor = todayX > width - 70 ? "end" : "start";
      var todayLabelX = todayAnchor === "end" ? todayX - 6 : todayX + 6;
      svg.push('<line class="plan-chart-today-line" x1="' + todayX + '" y1="' + margin.top +
        '" x2="' + todayX + '" y2="' + (height - margin.bottom) + '"></line>');
      svg.push('<text class="plan-chart-today-label" x="' + todayLabelX + '" y="' +
        (margin.top + 10) + '" text-anchor="' + todayAnchor + '">TODAY</text>');
    }

    model.series.forEach(function (item) {
      var path = item.points.map(function (point, index) {
        return (index === 0 ? "M" : "L") + xFor(point.date).toFixed(2) + " " + yFor(point.value).toFixed(2);
      }).join(" ");
      svg.push('<path class="plan-chart-line is-' + escapeXml(item.key) + '" d="' + path + '"></path>');

      item.points.forEach(function (point) {
        var x = xFor(point.date);
        var y = yFor(point.value);
        var displayValue = (item.key === "pullup" && point.value > 0 ? "+" : "") + formatValue(point.value);
        var detailText = point.detail || item.metric;
        var aria = item.label + ", " + fullDate(point.date) + ", " + displayValue + " kg, " + detailText;
        if (point.isToday) {
          svg.push('<circle class="plan-chart-today-ring is-' + escapeXml(item.key) + '" cx="' + x +
            '" cy="' + y + '" r="7"></circle>');
        }
        svg.push('<circle class="plan-chart-point-hit is-' + escapeXml(item.key) +
          (point.isToday ? " is-today" : "") + '" cx="' + x + '" cy="' + y +
          '" r="10" tabindex="0" focusable="true" aria-label="' + escapeXml(aria) +
          '" data-chart-point data-series="' + escapeXml(item.label) + '" data-date="' +
          escapeXml(point.date) + '" data-value="' + escapeXml(displayValue) + '" data-detail="' +
          escapeXml(detailText) + '" data-x="' + x + '" data-y="' + y + '"><title>' +
          escapeXml(aria) + "</title></circle>");
        svg.push('<circle class="plan-chart-point is-' + escapeXml(item.key) +
          (point.isToday ? " is-today" : "") + '" cx="' + x + '" cy="' + y +
          '" r="' + (point.isToday ? 4.5 : 2.6) + '"></circle>');
      });
    });

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
    render: render
  };
}));
