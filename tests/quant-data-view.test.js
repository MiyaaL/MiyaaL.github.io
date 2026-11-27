"use strict";

// The Data tab of the private quant dashboard, loaded from the repository sources
// with a fake Supabase client: no Jekyll build, no network.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { JSDOM } = require("jsdom");

const ROOT = path.resolve(__dirname, "..");
const read = (relative) => fs.readFileSync(path.join(ROOT, relative), "utf8");
const core = require("../assets/js/quant-core.js");
const OWNER = { user: { id: "owner" } };

function pageHtml() {
  const source = read("quant/index.html").replace(/^---\n[\s\S]*?\n---\n/, "");
  const html = source.replace(/\{\{\s*([^}]*?)\s*\}\}/g, (match, expression) => {
    if (expression.includes("supabase_url")) return "https://example.supabase.co";
    if (expression.includes("supabase_publishable_key")) return "test-key";
    throw new Error("Unhandled Liquid expression: " + match);
  });
  return '<!doctype html><html lang="en"><head><title>Quant</title></head><body><main>' + html + "</main></body></html>";
}

function sampleHealth(overrides) {
  return Object.assign({
    generated_at: "2026-11-27T16:31:00+08:00",
    calendar: { source: "sina", last_session: "2026-11-27" },
    datasets: [
      {
        id: "daily", frequency: "1d", provider: "akshare_cn_etf", adjust: "qfq", updated_at: "2026-11-27T08:31:00Z",
        symbols: [
          { symbol: "510300", name: "沪深300ETF", rows: 2160, first: "2018-01-02", last: "2026-11-27",
            sessions_behind: 0, missing_count: 0, missing_sessions: [], last_status: "ok", validation: [] },
          { symbol: "159915", name: "创业板ETF", rows: 2159, first: "2018-01-02", last: "2026-11-27",
            sessions_behind: 0, missing_count: 1, missing_sessions: ["2021-02-08"], last_status: "ok", validation: [] },
          { symbol: "513100", name: "纳指ETF", rows: 2100, first: "2018-01-02", last: "2026-11-20",
            sessions_behind: 5, missing_count: 1, missing_sessions: ["2022-01-13"], last_status: "failed",
            last_error: "timeout", validation: [] }
        ]
      },
      { id: "minute-1m", frequency: "1m", provider: "eastmoney", collected: false, symbols: [] }
    ],
    cross_check: { source: "sina_cn_etf", checked_at: "2026-11-27T08:40:00Z", days: 30, threshold: 0.002,
      results: [{ symbol: "510300", compared: 30, over_threshold: 0, max_deviation: 0.0004 }] },
    storage: { files: 9, bytes: 8388608 },
    alerts: [
      { level: "warning", dataset: "daily", symbol: "159915", message: "1 missing session" },
      { level: "critical", dataset: "daily", symbol: "513100", message: "last update failed: timeout" }
    ]
  }, overrides || {});
}

const PAPER = {
  generated_at: "2026-10-30T16:31:00", benchmark: "510300", insufficient: true,
  period: { start: "2026-10-30", end: "2026-10-30", days: 1 }, metrics: {}, series: null, monthly: [], signal: null
};

function fakeClient(dataRows) {
  const calls = [];
  return {
    calls,
    auth: {
      async getSession() { return { data: { session: OWNER }, error: null }; },
      async signInWithOAuth() { return { data: {}, error: null }; },
      async signOut() { return { error: null }; },
      onAuthStateChange() { return { data: { subscription: { unsubscribe() {} } } }; }
    },
    async rpc(name, args) {
      calls.push(args && args.p_kind);
      if (args && args.p_kind === "data") return { data: dataRows, error: null };
      return { data: [{ uploaded_at: "2026-10-30T08:32:00Z", payload: PAPER }], error: null };
    }
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 30));

async function loadPage(client, url) {
  const dom = new JSDOM(pageHtml(), { url: url || "https://miyaal.github.io/quant/", runScripts: "outside-only", pretendToBeVisual: true });
  const { window } = dom;
  window.QuantDashboardClient = client;
  window.eval(read("assets/js/quant-core.js"));
  window.eval(read("assets/js/quant-app.js"));
  await settle();
  return {
    window,
    $: (selector) => window.document.querySelector(selector),
    $$: (selector) => Array.from(window.document.querySelectorAll(selector))
  };
}

const DATA_ROW = [{ uploaded_at: "2026-11-27T08:41:00Z", payload: sampleHealth() }];

test("the Data tab loads the data kind on demand and shows health", async () => {
  const client = fakeClient(DATA_ROW);
  const page = await loadPage(client);
  assert.equal(page.$("[data-quant-tabs]").hidden, false);
  assert.deepEqual(client.calls, ["paper"], "only the paper kind is fetched first");

  page.$("[data-quant-tab='data']").click();
  await settle();
  assert.deepEqual(client.calls, ["paper", "data"]);
  assert.equal(page.$("[data-quant-data]").hidden, false);
  assert.equal(page.$("[data-quant-view]").hidden, true, "the paper panel is hidden");
  assert.equal(page.$("[data-quant-tab='data']").getAttribute("aria-selected"), "true");
  assert.equal(page.window.location.hash, "#data");

  const kpis = page.$$("[data-quant-data-kpis] .quant-kpi-value").map((node) => node.textContent);
  assert.deepEqual(kpis, ["2", "3", "5", "2"]);
  const alerts = page.$$("[data-quant-alerts] li").map((node) => node.textContent);
  assert.match(alerts[0], /Critical/, "critical alerts come first");
  const statuses = page.$$(".quant-health tbody tr td:nth-child(2)").map((node) => node.textContent.replace(/[✓!✕]/g, ""));
  assert.deepEqual(statuses, ["OK", "Warning", "Critical"]);
  assert.equal(page.$$(".quant-coverage-gap").length, 2, "one tick per missing session");
  const behind = page.$$(".quant-coverage-behind").map((node) => node.textContent);
  assert.deepEqual(behind, ["current", "current", "5 behind"], "staleness is written out, not only drawn");
  assert.match(page.$("[data-quant-datasets]").textContent, /Not collected yet/);
  assert.equal(page.$("[data-quant-cross-block]").hidden, false);
  assert.match(page.$("[data-quant-data-meta]").textContent, /8\.0 MB in 9 files/);

  page.$("[data-quant-tab='paper']").click();
  await settle();
  assert.equal(page.$("[data-quant-data]").hidden, true);
  assert.equal(page.$("[data-quant-view]").hidden, false);
});

test("opening /quant/#data starts on the Data tab", async () => {
  const client = fakeClient(DATA_ROW);
  const page = await loadPage(client, "https://miyaal.github.io/quant/#data");
  assert.deepEqual(client.calls, ["data"]);
  assert.equal(page.$("[data-quant-data]").hidden, false);
  assert.equal(page.$("[data-quant-tab='data']").tabIndex, 0);
  assert.equal(page.$("[data-quant-tab='paper']").tabIndex, -1);
});

test("arrow keys move between the tabs", async () => {
  const page = await loadPage(fakeClient(DATA_ROW));
  page.$("[data-quant-tab='paper']").dispatchEvent(new page.window.KeyboardEvent("keydown", { key: "ArrowRight" }));
  await settle();
  assert.equal(page.$("[data-quant-tab='data']").getAttribute("aria-selected"), "true");
  assert.equal(page.window.document.activeElement, page.$("[data-quant-tab='data']"));
});

test("no data upload yet shows its own empty state", async () => {
  const page = await loadPage(fakeClient([]), "https://miyaal.github.io/quant/#data");
  assert.equal(page.$("[data-quant-data-empty]").hidden, false);
  assert.equal(page.$("[data-quant-data-view]").hidden, true);
});

test("uploaded data-health text is rendered as text", async () => {
  const hostile = sampleHealth({
    alerts: [{ level: "warning", dataset: "<b>d</b>", symbol: "<img src=x onerror=alert(1)>", message: "<script>x</script>" }]
  });
  hostile.datasets[0].symbols[0].name = "<i>name</i>";
  const page = await loadPage(fakeClient([{ uploaded_at: "2026-11-27T08:41:00Z", payload: hostile }]),
    "https://miyaal.github.io/quant/#data");
  assert.equal(page.$$("[data-quant-data] img, [data-quant-data] b, [data-quant-data] i, [data-quant-data] script").length, 0);
  assert.match(page.$("[data-quant-alerts]").textContent, /<script>x<\/script>/);
});

test("data-health helpers: levels, bytes and the coverage axis", () => {
  const health = core.normalizeDataHealth(sampleHealth());
  const rows = health.datasets[0].symbols;
  assert.deepEqual(rows.map(core.symbolLevel), ["ok", "warning", "critical"]);
  assert.equal(core.formatBytes(1536), "1.5 KB");
  assert.equal(core.formatBytes(null), "—");
  const model = core.coverageModel(rows);
  assert.equal(model.start, "2018-01-02");
  assert.equal(model.end, "2026-11-27");
  assert.ok(model.rows[2].to < 1, "the stale instrument ends before the others");
  assert.equal(core.normalizeDataHealth({ alerts: [{ level: "nonsense", message: "m" }] }).alerts[0].level, "warning");
});
