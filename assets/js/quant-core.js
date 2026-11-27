(function (root, factory) {
  "use strict";

  var api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.QuantCore = api;
  }
}(typeof globalThis !== "undefined" ? globalThis : this, function () {
  "use strict";

  // Pure helpers for the private quant-lab dashboard: they normalise the uploaded
  // snapshot, format figures and build the SVG charts. No DOM, no network, so the
  // same file runs in the page and under node:test.

  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  // The figures the owner reads first, in reading order. Each is a ratio or a day
  // count: the snapshot carries no amount of money.
  var KPIS = [
    { key: "total_return", label: "Total return", format: "percent", signed: true },
    { key: "max_drawdown", label: "Max drawdown", format: "percent", signed: true },
    { key: "sharpe", label: "Sharpe ratio", format: "ratio", minDays: 20 },
    { key: "excess_total_return", label: "Excess return", format: "percent", signed: true }
  ];

  var DETAILS = [
    { key: "annual_return", label: "Annual return", format: "percent", signed: true, minDays: 20 },
    { key: "annual_vol", label: "Annual volatility", format: "percent", minDays: 20 },
    { key: "sortino", label: "Sortino ratio", format: "ratio", minDays: 20 },
    { key: "calmar", label: "Calmar ratio", format: "ratio", minDays: 20 },
    { key: "max_drawdown_days", label: "Longest drawdown", format: "days" },
    { key: "win_rate", label: "Winning days", format: "percent" },
    { key: "avg_cash_weight", label: "Average cash", format: "percent" },
    { key: "turnover", label: "Turnover", format: "multiple" },
    { key: "blocked_days", label: "Days with blocked trades", format: "days" },
    { key: "benchmark_total_return", label: "Benchmark total return", format: "percent", signed: true },
    { key: "benchmark_max_drawdown", label: "Benchmark max drawdown", format: "percent", signed: true },
    { key: "beta", label: "Beta", format: "ratio", minDays: 20 },
    { key: "alpha", label: "Alpha", format: "percent", signed: true, minDays: 20 },
    { key: "tracking_error", label: "Tracking error", format: "percent", minDays: 20 },
    { key: "information_ratio", label: "Information ratio", format: "ratio", minDays: 20 }
  ];

  function finite(value) {
    var number = typeof value === "number" ? value : Number(value);
    return value !== null && value !== "" && Number.isFinite(number) ? number : null;
  }

  // Unicode minus, so a negative figure is as wide as a positive one.
  function signed(text, number) {
    if (number > 0) return "+" + text;
    if (number < 0) return "−" + text;
    return text;
  }

  function formatPercent(value, options) {
    var number = finite(value);
    if (number === null) return "—";
    var settings = options || {};
    var digits = settings.digits == null ? 2 : settings.digits;
    var text = Math.abs(number * 100).toFixed(digits) + "%";
    if (settings.signed) return signed(text, Number((number * 100).toFixed(digits)));
    return (number < 0 ? "−" : "") + text;
  }

  function formatRatio(value) {
    var number = finite(value);
    if (number === null) return "—";
    return (number < 0 ? "−" : "") + Math.abs(number).toFixed(2);
  }

  function formatMetric(definition, value) {
    var number = finite(value);
    if (number === null) return "—";
    if (definition.format === "percent") return formatPercent(number, { signed: definition.signed });
    if (definition.format === "ratio") return formatRatio(number);
    if (definition.format === "multiple") return number.toFixed(1) + "×";
    if (definition.format === "days") {
      var days = Math.round(number);
      return days + (days === 1 ? " day" : " days");
    }
    return String(number);
  }

  function isDate(value) {
    return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  function numberList(values, length) {
    if (!Array.isArray(values) || values.length !== length) return null;
    var out = values.map(finite);
    return out.every(function (value) { return value !== null; }) ? out : null;
  }

  // Accept only the fields the page renders, in the shapes it expects. Anything
  // else in the upload is ignored rather than trusted.
  function normalizeSnapshot(raw) {
    var source = raw && typeof raw === "object" ? raw : {};
    var period = source.period && typeof source.period === "object" ? source.period : null;
    var metrics = {};
    var rawMetrics = source.metrics && typeof source.metrics === "object" ? source.metrics : {};
    KPIS.concat(DETAILS).forEach(function (definition) {
      metrics[definition.key] = finite(rawMetrics[definition.key]);
    });

    var series = null;
    var rawSeries = source.series;
    if (rawSeries && Array.isArray(rawSeries.dates) && rawSeries.dates.length >= 2 &&
        rawSeries.dates.every(isDate)) {
      var length = rawSeries.dates.length;
      var strategy = numberList(rawSeries.strategy, length);
      var drawdown = numberList(rawSeries.drawdown, length);
      if (strategy && drawdown) {
        series = {
          dates: rawSeries.dates.slice(),
          strategy: strategy,
          benchmark: numberList(rawSeries.benchmark, length),
          drawdown: drawdown
        };
      }
    }

    var monthly = (Array.isArray(source.monthly) ? source.monthly : []).filter(function (row) {
      return row && Number.isInteger(row.year) && Array.isArray(row.months) && row.months.length === 12;
    }).map(function (row) {
      return { year: row.year, months: row.months.map(finite), total: finite(row.total) };
    });

    var signal = null;
    var rawSignal = source.signal;
    if (rawSignal && typeof rawSignal === "object") {
      signal = {
        signalDate: isDate(rawSignal.signal_date) ? rawSignal.signal_date : null,
        strategy: typeof rawSignal.strategy === "string" ? rawSignal.strategy : "",
        params: rawSignal.params && typeof rawSignal.params === "object" ? rawSignal.params : {},
        targets: (Array.isArray(rawSignal.targets) ? rawSignal.targets : []).filter(function (item) {
          return item && typeof item.symbol === "string" && finite(item.weight) !== null;
        }).map(function (item) {
          return {
            symbol: item.symbol,
            name: typeof item.name === "string" ? item.name : "",
            weight: finite(item.weight)
          };
        }).sort(function (a, b) { return b.weight - a.weight; })
      };
    }

    var days = period && Number.isInteger(period.days) ? period.days : 0;
    return {
      generatedAt: typeof source.generated_at === "string" ? source.generated_at : null,
      benchmark: typeof source.benchmark === "string" ? source.benchmark : "",
      period: period && isDate(period.start) && isDate(period.end)
        ? { start: period.start, end: period.end, days: days }
        : null,
      insufficient: Boolean(source.insufficient) || !series,
      metrics: metrics,
      series: series,
      monthly: monthly,
      signal: signal
    };
  }

  function metricHidden(definition, snapshot) {
    var days = snapshot.period ? snapshot.period.days : 0;
    return Boolean(definition.minDays && days < definition.minDays);
  }

  // Clean, evenly spaced ticks that cover [min, max].
  function niceTicks(min, max, target) {
    if (!Number.isFinite(min) || !Number.isFinite(max)) return [0];
    if (min === max) {
      var pad = Math.abs(min) * 0.05 || 1;
      min -= pad;
      max += pad;
    }
    var count = target || 5;
    var raw = (max - min) / count;
    var magnitude = Math.pow(10, Math.floor(Math.log10(raw)));
    var residual = raw / magnitude;
    var step = (residual > 5 ? 10 : residual > 2 ? 5 : residual > 1 ? 2 : 1) * magnitude;
    var start = Math.floor(min / step) * step;
    var end = Math.ceil(max / step) * step;
    var ticks = [];
    for (var value = start; value <= end + step / 2; value += step) {
      ticks.push(Number(value.toFixed(10)));
    }
    return ticks;
  }

  // Up to `count` x-axis labels, first and last always included.
  function dateTicks(dates, count) {
    if (dates.length <= count) return dates.map(function (_, index) { return index; });
    var picks = [];
    for (var i = 0; i < count; i += 1) {
      picks.push(Math.round(i * (dates.length - 1) / (count - 1)));
    }
    return picks.filter(function (value, index) { return picks.indexOf(value) === index; });
  }

  function escapeXml(text) {
    return String(text).replace(/[&<>"']/g, function (ch) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[ch];
    });
  }

  // `right` leaves room for the end labels ("Benchmark 510300" at 12px).
  var GEOMETRY = { width: 760, height: 260, left: 52, right: 136, top: 16, bottom: 30 };

  // One chart: shared x (dates), one y-scale. `lines` = [{ key, label, values }].
  function chartModel(dates, lines, options) {
    var settings = options || {};
    var g = GEOMETRY;
    var values = [];
    lines.forEach(function (line) { values = values.concat(line.values); });
    if (settings.includeZero) values.push(0);
    var ticks = niceTicks(Math.min.apply(null, values), Math.max.apply(null, values), 4);
    var yMin = ticks[0];
    var yMax = ticks[ticks.length - 1];
    var plotWidth = g.width - g.left - g.right;
    var plotHeight = g.height - g.top - g.bottom;
    function x(index) {
      return g.left + (dates.length === 1 ? plotWidth / 2 : index * plotWidth / (dates.length - 1));
    }
    function y(value) {
      return g.top + (yMax - value) * plotHeight / (yMax - yMin || 1);
    }
    return {
      geometry: g,
      dates: dates,
      ticks: ticks,
      x: x,
      y: y,
      lines: lines.map(function (line) {
        return {
          key: line.key,
          label: line.label,
          values: line.values,
          points: line.values.map(function (value, index) {
            return [Number(x(index).toFixed(2)), Number(y(value).toFixed(2))];
          })
        };
      })
    };
  }

  function pathFor(points) {
    return points.map(function (point, index) {
      return (index ? "L" : "M") + point[0] + " " + point[1];
    }).join(" ");
  }

  // End labels sit to the right of the last point; when two would collide they
  // are pushed apart and joined to their line by a thin leader.
  function endLabels(model, formatter) {
    var labels = model.lines.map(function (line) {
      var last = line.points[line.points.length - 1];
      return {
        key: line.key,
        name: line.label,
        value: formatter(line.values[line.values.length - 1]),
        anchorY: last[1],
        y: last[1]
      };
    }).sort(function (a, b) { return a.y - b.y; });
    var gap = 30;
    for (var i = 1; i < labels.length; i += 1) {
      if (labels[i].y - labels[i - 1].y < gap) labels[i].y = labels[i - 1].y + gap;
    }
    var floor = model.geometry.height - model.geometry.bottom;
    for (var j = labels.length - 1; j >= 0; j -= 1) {
      if (labels[j].y > floor) labels[j].y = floor;
      if (j > 0 && labels[j].y - labels[j - 1].y < gap) labels[j - 1].y = labels[j].y - gap;
    }
    return labels;
  }

  function chartSvg(model, options) {
    var settings = options || {};
    var g = model.geometry;
    var label = settings.label || "";
    var tickFormat = settings.tickFormat || function (value) { return String(value); };
    var parts = [];
    parts.push('<svg class="quant-chart-svg" viewBox="0 0 ' + g.width + " " + g.height +
      '" role="img" aria-label="' + escapeXml(label) + '">');
    model.ticks.forEach(function (tick) {
      var y = model.y(tick).toFixed(2);
      var zero = settings.zeroLine && tick === 0 ? " is-zero" : "";
      parts.push('<line class="quant-chart-grid' + zero + '" x1="' + g.left + '" x2="' +
        (g.width - g.right) + '" y1="' + y + '" y2="' + y + '"></line>');
      parts.push('<text class="quant-chart-axis" x="' + (g.left - 10) + '" y="' + y +
        '" text-anchor="end" dominant-baseline="middle">' + escapeXml(tickFormat(tick)) + "</text>");
    });
    dateTicks(model.dates, 5).forEach(function (index, order, all) {
      var anchor = order === 0 ? "start" : order === all.length - 1 ? "end" : "middle";
      parts.push('<text class="quant-chart-axis" x="' + model.x(index).toFixed(2) + '" y="' +
        (g.height - 8) + '" text-anchor="' + anchor + '">' + escapeXml(model.dates[index]) + "</text>");
    });
    if (settings.area && model.lines.length === 1) {
      var only = model.lines[0];
      var base = model.y(0).toFixed(2);
      parts.push('<path class="quant-chart-area" data-series="' + escapeXml(only.key) + '" d="' +
        pathFor(only.points) + " L" + only.points[only.points.length - 1][0] + " " + base +
        " L" + only.points[0][0] + " " + base + ' Z"></path>');
    }
    model.lines.forEach(function (line) {
      parts.push('<path class="quant-chart-line" data-series="' + escapeXml(line.key) + '" d="' +
        pathFor(line.points) + '"></path>');
      var last = line.points[line.points.length - 1];
      parts.push('<circle class="quant-chart-end" data-series="' + escapeXml(line.key) + '" cx="' +
        last[0] + '" cy="' + last[1] + '" r="4"></circle>');
    });
    if (settings.endLabels) {
      endLabels(model, settings.valueFormat || tickFormat).forEach(function (item) {
        var x = g.width - g.right + 12;
        if (Math.abs(item.y - item.anchorY) > 1) {
          parts.push('<line class="quant-chart-leader" x1="' + (g.width - g.right + 5) + '" x2="' + (x - 3) +
            '" y1="' + item.anchorY.toFixed(2) + '" y2="' + item.y.toFixed(2) + '"></line>');
        }
        parts.push('<text class="quant-chart-end-label" x="' + x + '" y="' + (item.y - 3).toFixed(2) + '">' +
          escapeXml(item.name) + "</text>");
        parts.push('<text class="quant-chart-end-value" x="' + x + '" y="' + (item.y + 12).toFixed(2) + '">' +
          escapeXml(item.value) + "</text>");
      });
    }
    parts.push('<line class="quant-chart-crosshair" data-chart-crosshair="true" x1="0" x2="0" y1="' + g.top +
      '" y2="' + (g.height - g.bottom) + '" hidden="hidden"></line>');
    parts.push("</svg>");
    return parts.join("");
  }

  // Nearest date index for a pointer at `ratio` (0..1) across the plot width.
  function indexAtRatio(model, ratio) {
    var g = model.geometry;
    var plotStart = g.left / g.width;
    var plotEnd = (g.width - g.right) / g.width;
    var t = (ratio - plotStart) / (plotEnd - plotStart);
    var index = Math.round(Math.max(0, Math.min(1, t)) * (model.dates.length - 1));
    return index;
  }

  function monthCells(row) {
    return row.months.map(function (value, index) {
      return { month: MONTHS[index], value: value, text: value === null ? "" : formatPercent(value, { signed: true, digits: 1 }) };
    });
  }

  return {
    MONTHS: MONTHS,
    KPIS: KPIS,
    DETAILS: DETAILS,
    formatPercent: formatPercent,
    formatRatio: formatRatio,
    formatMetric: formatMetric,
    normalizeSnapshot: normalizeSnapshot,
    metricHidden: metricHidden,
    niceTicks: niceTicks,
    dateTicks: dateTicks,
    chartModel: chartModel,
    chartSvg: chartSvg,
    endLabels: endLabels,
    indexAtRatio: indexAtRatio,
    monthCells: monthCells,
    escapeXml: escapeXml
  };
}));
