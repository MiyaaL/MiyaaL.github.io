"use strict";

// The private quant dashboard, loaded straight from the repository sources with
// a fake Supabase client: no Jekyll build, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const core = require("../assets/js/quant-core.js");

function pageHtml() {
  const source = read("quant/index.html").replace(/^---\n[\s\S]*?\n---\n/, "");
  const html = source.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (match, expression) => {
    if (expression.includes("supabase_url")) return "https://example.supabase.co";
    if (expression.includes("supabase_publishable_key")) return "test-key";
    throw new Error("Unhandled Liquid expression in quant/index.html: " + match);
  });
  if (/\{%|\{\{/.test(html)) throw new Error("quant/index.html contains Liquid this helper does not render");
  return '<!doctype html><html lang="en"><head><title>Quant</title></head><body><main>' + html + "</main></body></html>";
}

function sampleSnapshot(overrides) {
  const dates = [];
  const strategy = [];
  const benchmark = [];
  const drawdown = [];
  let peak = 100;
  for (let i = 0; i < 30; i += 1) {
    const day = new Date(Date.UTC(2026, 9, 1 + i));
    dates.push(day.toISOString().slice(0, 10));
    const value = 100 + i * 0.4 - (i > 18 && i < 24 ? (i - 18) * 1.1 : 0);
    strategy.push(Number(value.toFixed(4)));
    benchmark.push(Number((100 + i * 0.2).toFixed(4)));
    peak = Math.max(peak, value);
    drawdown.push(Number(((value / peak - 1) * 100).toFixed(4)));
  }
  return Object.assign({
    generated_at: "2026-10-30T16:31:00",
    benchmark: "510300",
    period: { start: dates[0], end: dates[dates.length - 1], days: dates.length },
    insufficient: false,
    metrics: {
      total_return: 0.1162, max_drawdown: -0.0512, sharpe: 1.234, excess_total_return: 0.058,
      annual_return: 0.21, annual_vol: 0.12, turnover: 3.4, max_drawdown_days: 7, win_rate: 0.61
    },
    series: { dates, strategy, benchmark, drawdown },
    monthly: [{ year: 2026, months: [null, null, null, null, null, null, null, null, null, 0.0312, -0.004, null], total: 0.027 }],
    signal: {
      signal_date: "2026-10-30",
      strategy: "dual_ma",
      params: { fast: 20, slow: 60 },
      targets: [{ symbol: "510300", name: "沪深300ETF", weight: 0.49 }, { symbol: "518880", name: "黄金ETF", weight: 0.25 }]
    }
  }, overrides || {});
}

// A fake supabase-js client: `session` decides who is signed in, `rpc` what the
// database answers. Every call is recorded.
function fakeClient(options) {
  const settings = options || {};
  const calls = [];
  let session = settings.session === undefined ? null : settings.session;
  const listeners = [];
  return {
    calls,
    auth: {
      async getSession() { calls.push("getSession"); return { data: { session }, error: null }; },
      async signInWithOAuth(args) { calls.push(["signInWithOAuth", args]); return { data: {}, error: null }; },
      async signOut() { calls.push("signOut"); session = null; return { error: null }; },
      onAuthStateChange(callback) { listeners.push(callback); return { data: { subscription: { unsubscribe() {} } } }; }
    },
    async rpc(name) {
      calls.push(["rpc", name]);
      if (settings.rpcError) return { data: null, error: { message: settings.rpcError } };
      return { data: settings.rows || [], error: null };
    }
  };
}

async function loadPage(client) {
  const dom = new JSDOM(pageHtml(), {
    url: "https://miyaal.github.io/quant/",
    runScripts: "outside-only",
    pretendToBeVisual: true
  });
  const { window } = dom;
  window.QuantDashboardClient = client;
  window.eval(read("assets/js/quant-core.js"));
  window.eval(read("assets/js/quant-app.js"));
  await new Promise((resolve) => setTimeout(resolve, 30));
  const $ = (selector) => window.document.querySelector(selector);
  return { window, $, $$: (selector) => Array.from(window.document.querySelectorAll(selector)) };
}

const OWNER = { user: { id: "owner" } };

test("a signed-out visitor sees the lock and nothing is fetched", async () => {
  const client = fakeClient();
  const page = await loadPage(client);
  assert.equal(page.$("[data-quant-locked]").hidden, false);
  assert.equal(page.$("[data-quant-view]").hidden, true);
  assert.match(page.$("[data-quant-locked-text]").textContent, /Sign in/);
  assert.equal(page.$("[data-quant-sign-in]").hidden, false);
  assert.equal(page.$("[data-quant-sign-out]").hidden, true);
  assert.ok(!client.calls.some((call) => Array.isArray(call) && call[0] === "rpc"), "no data request without a session");
  assert.equal(page.$("[data-quant-kpis]").children.length, 0);
});

test("sign-in returns to this page", async () => {
  const client = fakeClient();
  const page = await loadPage(client);
  page.$("[data-quant-sign-in]").click();
  await new Promise((resolve) => setTimeout(resolve, 10));
  const call = client.calls.find((item) => Array.isArray(item) && item[0] === "signInWithOAuth");
  assert.equal(call[1].provider, "github");
  assert.equal(call[1].options.redirectTo, "https://miyaal.github.io/quant/");
});

test("another GitHub account is signed out and sees no data", async () => {
  const client = fakeClient({ session: OWNER, rpcError: "not_dashboard_owner" });
  const page = await loadPage(client);
  assert.ok(client.calls.includes("signOut"));
  assert.equal(page.$("[data-quant-view]").hidden, true);
  assert.match(page.$("[data-quant-locked-text]").textContent, /cannot view/);
});

test("the owner with no upload sees the empty state", async () => {
  const page = await loadPage(fakeClient({ session: OWNER, rows: [] }));
  assert.equal(page.$("[data-quant-empty]").hidden, false);
  assert.equal(page.$("[data-quant-view]").hidden, true);
});

test("the owner sees KPIs, both charts, the signal and the table view", async () => {
  const rows = [{ generated_at: "2026-10-30T08:31:00Z", uploaded_at: "2026-10-30T08:32:00Z", payload: sampleSnapshot() }];
  const page = await loadPage(fakeClient({ session: OWNER, rows }));
  assert.equal(page.$("[data-quant-view]").hidden, false);
  const kpis = page.$$(".quant-kpi-value").map((node) => node.textContent);
  assert.deepEqual(kpis, ["+11.62%", "−5.12%", "1.23", "+5.80%"]);
  assert.equal(page.$$("[data-quant-chart='equity'] .quant-chart-line").length, 2);
  assert.equal(page.$$("[data-quant-chart='drawdown'] .quant-chart-line").length, 1);
  assert.equal(page.$$("[data-quant-chart='drawdown'] .quant-chart-area").length, 1);
  assert.equal(page.$$("[data-quant-chart='drawdown'] .quant-chart-end-label").length, 0, "single series: no end label");
  assert.equal(page.$$("[data-quant-chart='equity'] .quant-chart-end-label").length, 2);
  assert.equal(page.$("[data-quant-drawdown-now]").textContent, "Now at a new high.", "the sample ends on a new high");
  assert.equal(page.$$(".quant-legend li").length, 2);
  assert.equal(page.$$(".quant-table tbody tr").length > 30, true, "daily table plus monthly table");
  assert.match(page.$("[data-quant-signal]").textContent, /510300 沪深300ETF/);
  assert.match(page.$("[data-quant-signal]").textContent, /Cash 26\.0%/);
  assert.match(page.$("[data-quant-state]").textContent, /Updated 2026-10-30 16:32 CST/);
  assert.equal(page.$("[data-quant-sign-out]").hidden, false);
});

test("the chart answers the keyboard with every series at that date", async () => {
  const rows = [{ uploaded_at: "2026-10-30T08:32:00Z", payload: sampleSnapshot() }];
  const page = await loadPage(fakeClient({ session: OWNER, rows }));
  const chart = page.$("[data-quant-chart='equity']");
  chart.dispatchEvent(new page.window.Event("focus"));
  chart.dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "Home" }));
  const tooltip = chart.querySelector("[data-chart-tooltip]");
  assert.equal(tooltip.hidden, false);
  assert.equal(tooltip.querySelector("[data-chart-tooltip-date]").textContent, "2026-10-01");
  assert.equal(tooltip.querySelectorAll("li").length, 2);
  assert.match(tooltip.textContent, /100\.0/);
});

test("uploaded text is rendered as text, never as markup", async () => {
  const hostile = sampleSnapshot({
    benchmark: "<img src=x onerror=alert(1)>",
    signal: { signal_date: "2026-10-30", strategy: "<b>x</b>", params: {}, targets: [{ symbol: "<script>", name: "<i>n</i>", weight: 0.5 }] }
  });
  const page = await loadPage(fakeClient({ session: OWNER, rows: [{ uploaded_at: "2026-10-30T08:32:00Z", payload: hostile }] }));
  assert.equal(page.$$("[data-quant-app] img, [data-quant-app] b, [data-quant-app] i, [data-quant-app] script").length, 0);
  assert.match(page.$("[data-quant-signal]").textContent, /<script>/);
  assert.match(page.$(".quant-legend").textContent, /<img src=x/);
});

test("the drawdown caption reports a drawdown that has not recovered", async () => {
  const falling = sampleSnapshot();
  falling.series.drawdown[falling.series.drawdown.length - 1] = -3.25;
  const page = await loadPage(fakeClient({ session: OWNER, rows: [{ uploaded_at: "2026-10-30T08:32:00Z", payload: falling }] }));
  assert.equal(page.$("[data-quant-drawdown-now]").textContent, "Now −3.3% below the peak.");
});

test("ratios that need history stay hidden before 20 trading days", async () => {
  const short = sampleSnapshot();
  short.period.days = 12;
  const page = await loadPage(fakeClient({ session: OWNER, rows: [{ uploaded_at: "2026-10-30T08:32:00Z", payload: short }] }));
  const values = page.$$(".quant-kpi-value").map((node) => node.textContent);
  assert.equal(values[2], "—", "Sharpe hidden");
  assert.equal(values[0], "+11.62%", "total return still shown");
});

test("a snapshot with fewer than two days shows no charts", async () => {
  const fresh = sampleSnapshot({ series: null, insufficient: true, period: { start: "2026-11-10", end: "2026-11-10", days: 1 } });
  const page = await loadPage(fakeClient({ session: OWNER, rows: [{ uploaded_at: "2026-11-10T08:32:00Z", payload: fresh }] }));
  assert.equal(page.$("[data-quant-charts]").hidden, true);
  assert.equal(page.$("[data-quant-pending]").hidden, false);
});

test("formatting uses signs and a true minus", () => {
  assert.equal(core.formatPercent(0.1234, { signed: true }), "+12.34%");
  assert.equal(core.formatPercent(-0.05, { signed: true }), "−5.00%");
  assert.equal(core.formatPercent(0), "0.00%");
  assert.equal(core.formatRatio(-0.456), "−0.46");
  assert.equal(core.formatMetric({ format: "days" }, 1), "1 day");
  assert.equal(core.formatMetric({ format: "multiple" }, 3.44), "3.4×");
  assert.equal(core.formatMetric({ format: "percent" }, null), "—");
});

test("normalizeSnapshot drops malformed series instead of trusting them", () => {
  const broken = sampleSnapshot();
  broken.series.strategy = broken.series.strategy.slice(1);
  assert.equal(core.normalizeSnapshot(broken).series, null);
  const notDates = sampleSnapshot();
  notDates.series.dates[3] = "yesterday";
  assert.equal(core.normalizeSnapshot(notDates).series, null);
  assert.equal(core.normalizeSnapshot(null).series, null);
});

test("the chart SVG is well-formed XML", () => {
  const model = core.chartModel(["2026-10-01", "2026-10-02", "2026-10-03"], [
    { key: "strategy", label: "A & <B>", values: [100, 101, 99] }
  ], { includeZero: false });
  const svg = core.chartSvg(model, { label: "x", endLabels: true, area: true });
  const { window } = new JSDOM("");
  const parsed = new window.DOMParser().parseFromString(svg, "image/svg+xml");
  assert.equal(parsed.getElementsByTagName("parsererror").length, 0);
  assert.match(svg, /A &amp; &lt;B&gt;/);
});

test("ticks are clean and cover the range; end labels never collide", () => {
  assert.deepEqual(core.niceTicks(97.3, 112.8, 4), [95, 100, 105, 110, 115]);
  assert.deepEqual(core.niceTicks(-7.2, 0, 4), [-8, -6, -4, -2, 0]);
  const model = core.chartModel(["2026-10-01", "2026-10-02"], [
    { key: "strategy", label: "Strategy", values: [100, 105] },
    { key: "benchmark", label: "Benchmark", values: [100, 105.1] }
  ]);
  const labels = core.endLabels(model, (value) => value.toFixed(1));
  assert.ok(Math.abs(labels[0].y - labels[1].y) >= 30);
});

test("the page is wired only into /quant/ and kept out of search", () => {
  const head = read("_includes/head.html");
  const layout = read("_layouts/default.html");
  const page = read("quant/index.html");
  assert.match(head, /\{% if page\.quant %\}\s*<meta name="robots" content="noindex, nofollow">/);
  assert.match(layout, /\{% if page\.quant %\}[\s\S]*quant-core\.js[\s\S]*quant-app\.js[\s\S]*\{% endif %\}/);
  assert.match(page, /^sitemap: false$/m);
  assert.doesNotMatch(page, /\d+\.\d+%/, "the template ships no figures");
});
