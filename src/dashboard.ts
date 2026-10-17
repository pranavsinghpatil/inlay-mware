export const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="dark"><title>Inlay · Local observation</title><link rel="stylesheet" href="/dashboard/style.css"></head>
<body>
<a class="skip-link" href="#main">Skip to observations</a>
<header class="top"><a href="/" class="brand" aria-label="Inlay home"><img src="/dashboard/logo.png" width="26" height="26" alt="">Inlay</a><span class="subtitle">Local observation</span><div class="connection-wrap"><span class="connection-label">Dashboard</span><span id="connection" class="connection" role="status" aria-live="polite">Connecting…</span></div></header>
<div class="workspace">
<aside class="sidebar"><nav aria-label="Observation sections"><a href="#overview">Overview</a><a href="#reported-usage">Reported usage</a><a href="#recent-activity">Recent activity</a><a href="#saved-sessions">Saved sessions</a><a href="#scope">Scope &amp; setup</a><a href="/trajectories" target="_blank" rel="noopener">Agent trajectories</a></nav><p class="sidebar-note">On this machine.<br>Content-free measurements.</p></aside>
<main id="main">
<section id="overview" class="overview"><div class="page-heading"><h1>Local observation</h1><div class="export-actions" aria-label="Export aggregate summaries"><button id="export-json" type="button" disabled>Export JSON</button><button id="export-csv" type="button" disabled>Export CSV</button></div></div><p id="updated" class="updated">Waiting for first update</p><p id="export-status" class="export-status" role="status" aria-live="polite"></p><p class="intro">Activity routed through this Inlay instance.</p>
<div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
<p class="activity-state"><strong id="activity-title">Waiting for observations</strong><span id="activity-description">Connecting to the local dashboard. Measurement values have not loaded.</span><span id="session-state" class="session-state">Unavailable</span></p>
<div id="lifecycle" class="lifecycle" aria-label="Exchange lifecycle"></div>
<details class="definition"><summary>How to read these counts</summary><p>Admitted counts handler entries. Active counts handlers still open. Forwarding counts local calls to the upstream request function. Finalized counts normally closed handlers. They do not establish provider receipt or task success.</p><p>A session is this server instance's lifetime. Several clients using it contribute to combined totals; there is no per-agent attribution.</p></details>
</section>
<section id="reported-usage" class="section"><div class="section-heading"><h2>Reported usage</h2><span class="section-note">Current session</span></div><p id="usage-note" class="support-copy">Usage appears when a recorded outcome includes provider-reported values.</p><div id="usage" class="usage"></div><div id="volume" class="volume"></div><details class="definition"><summary>What coverage means</summary><p>Available counts outcomes that include a value for that field; missing counts those that do not. Zero is a reported value. Unavailable is not zero. Each total sums encountered values across recorded outcomes, not verified final accounting, a bill or a task total.</p></details></section>
<section class="observation-details" aria-label="Measurement detail">
<details class="measurement"><summary><span><strong>Integrity &amp; structure</strong><span id="integrity-brief" class="disclosure-note">Observation coverage and response flags</span></span><span class="disclosure-action" aria-hidden="true">Details</span></summary><div class="disclosure-body"><p class="support-copy">Yes / no / unavailable describes each recorded flag. No known incompleteness does not prove exhaustive observation. Canonical bytes measure structure, not tokens.</p><div id="integrity" class="detail-metrics"></div></div></details>
<details class="measurement"><summary><span><strong>Exact recurrence</strong><span id="recurrence-brief" class="disclosure-note">Previously seen canonical items</span></span><span class="disclosure-action" aria-hidden="true">Details</span></summary><div class="disclosure-body"><p class="support-copy">Matches are exact canonical items seen within this process. They do not establish redundant work, removable context or potential savings.</p><div id="recurrence" class="detail-metrics"></div></div></details>
</section>
<section id="recent-activity" class="section"><div class="section-heading"><h2>Recent activity</h2><span class="section-note">Latest 20 outcomes</span></div><div class="filters" aria-label="Filter recent outcomes"><label>Route<select id="recent-route"><option value="">All routes</option></select></label><label>Input usage<select id="recent-usage"><option value="">All availability</option><option value="available">Available</option><option value="missing">Missing</option></select></label><label>Transport<select id="recent-transport"><option value="">All flags</option><option value="completed">Completed · completed is true</option><option value="cancelled">Cancelled · cancelled is true</option><option value="incomplete">Incomplete · response or recurrence is incomplete</option><option value="unavailable">Unavailable · a relevant flag is unavailable</option></select></label></div><p id="recent-count" class="filter-count" aria-live="polite">Waiting for data</p><div class="table-wrap"><table class="recent-table"><caption class="visually-hidden">Recent recorded outcome measurements</caption><thead><tr><th scope="col">Route</th><th scope="col">Duration</th><th scope="col">Request bytes</th><th scope="col">Response bytes</th><th scope="col">Input tokens</th><th scope="col">Output tokens</th><th scope="col">Structure</th><th scope="col">Previously seen</th><th scope="col">Transport</th></tr></thead><tbody id="recent"><tr class="empty-row"><td colspan="9">Waiting for data</td></tr></tbody></table></div></section>
<section id="saved-sessions" class="section"><div class="section-heading"><h2>Saved sessions</h2><span class="section-note">Local aggregates</span></div><div id="history-filters" class="filters" aria-label="Filter saved sessions" hidden><label>State<select id="history-state"><option value="">All states</option><option value="running">Running</option><option value="closed">Closed</option><option value="unknown">End state unknown</option></select></label><label>Started from (UTC)<input id="history-from" type="date"></label><label>Started to (UTC)<input id="history-to" type="date"></label><label>Order<select id="history-order"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div><p class="support-copy">Exports include current totals and selected saved summaries; recent outcome rows remain in memory.</p><p id="history-count" class="filter-count" aria-live="polite"></p><div id="history" class="history">History status has not loaded.</div></section>
<details id="scope" class="scope"><summary>Scope &amp; setup<span aria-hidden="true">Read guide</span></summary><div class="scope-body"><div><h3>Connect a compatible client</h3><ol><li>Configure Inlay's upstream URL for your existing provider.</li><li>Point the client's supported HTTP base URL at this Inlay instance's <code>/v1</code> endpoint. The client keeps responsibility for authentication.</li><li>Use the client normally, then look for admitted exchanges and recorded outcomes here.</li></ol><p>Starting Inlay does not capture other open apps. WebSocket traffic and general coding-agent compatibility are unsupported.</p></div><div><h3>Keep aggregate history</h3><p>Set <code>INLAY_HISTORY_DIR</code> to a private local directory before starting the server. Retention defaults to 20 sessions; <code>INLAY_HISTORY_MAX_SESSIONS</code> accepts 1–100.</p><p>Only aggregate summaries are written, every five seconds and on normal close. Abrupt stops can lose recent updates or leave a lock requiring manual recovery.</p><h3>Know the boundary</h3><p>This view cannot establish task success, retries, provider receipt, cost savings or whole-run capture. Missing evidence remains unavailable.</p></div></div></details>
<footer><span>Inlay</span><span>Local measurements · No workload content retained</span></footer>
</main></div><script src="/dashboard/export.js" defer></script><script src="/dashboard/app.js" defer></script></body></html>`;

export const DASHBOARD_CSS = `
:root{color-scheme:dark;--ground:#131513;--surface:#1b1e1b;--raised:#222622;--ink:#e8ebe5;--muted:#a8b0a5;--accent:#b5cbaa;--line:#353b34;--warning:#edd3a7;--warning-bg:#302b22;--danger:#e9b3ac;font-family:"Segoe UI","Helvetica Neue",Arial,sans-serif;font-size:14px;line-height:1.55;color:var(--ink);background:var(--ground);font-synthesis:none;text-rendering:optimizeLegibility}
*{box-sizing:border-box}
body{margin:0}
a{color:inherit;text-decoration:none}
a:hover{color:var(--accent)}
a:focus-visible,summary:focus-visible{outline:2px solid var(--accent);outline-offset:5px;border-radius:3px}
a,summary{-webkit-tap-highlight-color:transparent}
p{margin:0 0 12px}
h1,h2,h3{font-weight:500;line-height:1.25;margin:0}
h1{font-size:26px;letter-spacing:-.025em}
h2{font-size:20px;letter-spacing:-.02em}
h3{font-size:15px;margin-bottom:12px}
code{font-family:ui-monospace,Consolas,monospace;font-size:.92em;overflow-wrap:anywhere;color:var(--ink)}
[hidden]{display:none!important}
.visually-hidden,.skip-link:not(:focus){position:absolute;width:1px;height:1px;padding:0;overflow:hidden;clip-path:inset(50%);white-space:nowrap}
.skip-link:focus{position:fixed;top:12px;left:12px;z-index:5;background:var(--ink);color:var(--ground);padding:12px 18px}
.top{height:56px;display:flex;align-items:center;gap:20px;padding:0 24px;background:var(--surface)}
.brand{display:flex;align-items:center;gap:12px;font-size:20px;font-weight:600;letter-spacing:-.025em}
.brand img{display:block;object-fit:contain}
.subtitle{color:var(--muted);font-size:14px}
.connection-wrap{margin-left:auto;display:flex;gap:12px;align-items:center}
.connection-label{font-size:13px;color:var(--muted)}
.connection{font-size:13px;display:flex;gap:7px;align-items:center}
.connection:before{content:"";width:6px;height:6px;border-radius:50%;background:var(--accent)}
.connection.offline{color:var(--danger)}
.connection.offline:before{background:var(--danger)}
.workspace{display:grid;grid-template-columns:160px minmax(0,1fr);max-width:1480px;margin:auto}
.sidebar{padding:26px 14px 24px 20px;align-self:start;position:sticky;top:0}
.sidebar nav{display:flex;flex-direction:column;gap:4px}
.sidebar nav a{padding:7px 10px;border-radius:4px;color:var(--muted)}
.sidebar nav a:hover,.sidebar nav a:focus-visible{color:var(--ink);background:var(--surface)}
.sidebar-note{font-size:12px;line-height:1.6;color:var(--muted);margin:30px 10px 0}
main{min-width:0;padding:20px 26px 24px;max-width:1240px}
section,details[id]{scroll-margin-top:24px}
.page-heading{display:flex;justify-content:space-between;align-items:baseline;gap:20px}
.updated{color:var(--muted);font-size:12px;margin:0;white-space:nowrap}
.intro{color:var(--muted);margin:6px 0 18px;font-size:14px}
.activity-state{display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 16px;margin:0 0 12px}
.activity-state strong{font-size:16px;font-weight:500}
.activity-state>span:nth-child(2){color:var(--muted);font-size:13px}
.session-state{font-size:12px;color:var(--accent);padding-top:4px;white-space:nowrap}
.notice{background:var(--warning-bg);color:var(--warning);padding:16px 20px;border-radius:4px;margin-bottom:20px}
.lifecycle{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));column-gap:20px;row-gap:14px;padding:8px 0 0}
.metric{min-width:0}
.metric .label{font-size:13px;color:var(--muted)}
.metric .value{font-size:26px;letter-spacing:-.025em;line-height:1.3;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
.metric .detail{font-size:12px;color:var(--muted);margin-top:5px}
.runtime-meta{grid-column:1/-1;display:flex;flex-wrap:wrap;gap:14px 36px;color:var(--muted);font-size:12px;background:var(--surface);border-radius:4px;padding:12px 16px}
.runtime-meta .metric{display:flex;gap:8px;align-items:baseline;flex-wrap:wrap}
.runtime-meta .label,.runtime-meta .value,.runtime-meta .detail{font-size:12px;line-height:1.55;margin:0;letter-spacing:0}
.runtime-meta .value{color:var(--ink)}
.definition{margin-top:16px;color:var(--muted);max-width:80ch;font-size:13px}
.definition summary{cursor:pointer;padding:5px 0;width:fit-content}
.definition p{margin:12px 0}
.section{margin-top:22px}
.section-heading{display:flex;align-items:baseline;justify-content:space-between;gap:16px;margin-bottom:10px}
.section-note{color:var(--muted);font-size:12px;text-align:right}
.support-copy{color:var(--muted);font-size:14px;max-width:80ch}
.filters{display:flex;flex-wrap:wrap;align-items:end;gap:10px 14px;margin:12px 0 6px}
.filters label{display:grid;gap:4px;color:var(--muted);font-size:12px}
.filters select,.filters input{min-height:36px;min-width:150px;padding:6px 9px;border:1px solid var(--line);border-radius:4px;background:var(--surface);color:var(--ink);font:inherit;font-size:13px}
.filters select:focus-visible,.filters input:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.filter-count{font-size:12px;color:var(--muted);margin:8px 0 0}
.usage{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:18px;padding:14px 0 8px}
.usage .value{font-size:28px}
.metric .value.unavailable{font-size:18px;line-height:2.1;letter-spacing:0;color:var(--muted)}
.volume{display:flex;flex-wrap:wrap;gap:16px 34px;margin-top:12px;background:var(--surface);padding:14px 18px;border-radius:4px}
.volume .metric{display:grid;grid-template-columns:auto auto;gap:0 10px;align-items:baseline}
.volume .value{font-size:14px;letter-spacing:0}
.volume .detail{grid-column:1/-1}
.observation-details{margin-top:30px;background:var(--surface);border-radius:6px;padding:0 24px}
.measurement+.measurement{border-top:1px solid var(--line)}
.measurement>summary{display:flex;justify-content:space-between;align-items:center;gap:20px;cursor:pointer;padding:20px 0;list-style:none}
.measurement>summary::-webkit-details-marker,.scope>summary::-webkit-details-marker{display:none}
summary strong{font-size:15px;font-weight:500}
.disclosure-note{display:block;color:var(--muted);font-size:13px;margin-top:3px}
.disclosure-action{font-size:12px;color:var(--muted);display:flex;gap:12px;align-items:center}
.disclosure-action:after,.scope>summary>span:after{content:"+";font-size:20px;font-weight:400}
.measurement[open] .disclosure-action:after,.scope[open]>summary>span:after{content:"−"}
.disclosure-body{padding:0 0 22px}
.detail-metrics{display:grid;grid-template-columns:1fr 1fr;gap:18px 36px;padding-top:10px}
.detail-metrics .metric .value{font-size:15px;line-height:1.6;letter-spacing:0}
.detail-metrics .metric .detail{margin-top:2px}
.table-wrap{max-width:100%;overflow:auto;margin-top:20px}
table{width:100%;border-collapse:collapse;font-size:13px}
th{text-align:left;color:var(--muted);font-weight:400;font-size:12px;padding:12px 10px;background:var(--surface)}
td{padding:18px 10px;border-bottom:1px solid var(--line);vertical-align:top;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}
th:first-child,td:first-child{padding-left:16px}
.recent-table td{min-width:66px}
.recent-table td:first-child{min-width:120px}
.recent-table td:last-child{min-width:130px;max-width:200px}
.recent-table td:nth-child(7){min-width:110px}
.recent-table td details>summary{cursor:pointer;white-space:nowrap;color:var(--muted)}
.recent-table td details p{color:var(--muted);font-size:12px;margin:8px 0 0;min-width:140px;white-space:normal}
.cell-label{display:none}
.empty-row td{padding:30px 20px;background:var(--surface);border:0;white-space:normal;color:var(--muted)}
.empty-row .empty-title{color:var(--ink);font-size:15px;margin-bottom:6px}
.empty-row a,.scope-body a{color:var(--accent);text-decoration:underline;text-underline-offset:4px}
.history{margin-top:20px}
.history .detail{color:var(--muted);font-size:12px;margin-bottom:14px}
.history-empty{padding:22px 24px;background:var(--surface);border-radius:6px}
.history-empty .empty-title{font-size:15px;color:var(--ink);margin-bottom:6px}
.history-empty p{color:var(--muted);max-width:72ch;margin-bottom:10px}
.history-empty .detail{margin:0}
.saved-session{background:var(--surface);padding:0 22px;border-radius:4px;margin-bottom:8px}
.saved-session>summary{cursor:pointer;padding:18px 0;display:flex;justify-content:space-between;gap:20px;list-style:none}
.saved-session>summary::-webkit-details-marker{display:none}
.saved-session .session-date{font-size:14px}
.saved-session .session-description{color:var(--muted);font-size:12px;display:block;margin-top:4px}
.saved-session .session-totals{color:var(--muted);font-size:13px;text-align:right}
.saved-session[open]>summary{padding-bottom:8px}
.saved-session .detail-metrics{padding-bottom:22px}
.scope{margin-top:42px;background:var(--surface);padding:0 24px;border-radius:6px}
.scope>summary{padding:20px 0;display:flex;justify-content:space-between;gap:16px;cursor:pointer;list-style:none;font-size:15px}
.scope>summary>span{color:var(--muted);font-size:12px;display:flex;align-items:center;gap:12px}
.scope-body{display:grid;grid-template-columns:1fr 1fr;gap:36px;padding:8px 0 26px;color:var(--muted);font-size:14px}
.scope-body h3{color:var(--ink)}
.scope-body ol{padding-left:20px;margin:0 0 16px}
.scope-body li{padding-left:4px;margin-bottom:12px}
.scope-body h3:not(:first-child){margin-top:22px}
footer{display:flex;justify-content:space-between;gap:24px;margin-top:42px;font-size:12px;color:var(--muted)}
footer span:first-child{color:var(--ink)}
@media(max-width:1050px){.workspace{grid-template-columns:165px minmax(0,1fr)}
.sidebar{padding-left:16px}
main{padding-left:26px;padding-right:26px}
.page-heading{display:block}
.updated{margin-top:10px}
.usage,.lifecycle{column-gap:16px}
.usage .value{font-size:24px}
}
@media(max-width:1050px){
.recent-table thead{display:none}
.recent-table,.recent-table tbody{display:block;width:100%}
.recent-table tr{display:grid;grid-template-columns:1fr 1fr;gap:8px 24px;padding:18px;background:var(--surface);border-radius:4px;margin-bottom:10px}
.recent-table td,.recent-table td:first-child,.recent-table td:last-child,.recent-table td:nth-child(7){min-width:0;max-width:none;padding:5px 0;border:0;display:grid;grid-template-columns:112px minmax(0,1fr);gap:10px}
.cell-label{display:block;color:var(--muted);font-size:12px}
.recent-table td details p{min-width:0}
.recent-table .empty-row{display:block}
.recent-table .empty-row td{display:block;padding:8px 0}
}
@media(max-width:760px){.top{height:64px;padding:0 20px;gap:20px}
.subtitle{display:none}
.connection-label{display:none}
.workspace{display:block}
.sidebar{position:static;padding:14px 16px 0}
.sidebar nav{flex-direction:row;flex-wrap:wrap;gap:2px}
.sidebar nav a{padding:8px 10px;font-size:12px}
.sidebar-note{display:none}
main{padding:26px 20px}
.page-heading h1{font-size:24px}
.intro{margin-bottom:22px}
.activity-state{gap:6px 12px}
.lifecycle,.usage{grid-template-columns:repeat(2,minmax(0,1fr));gap:22px 24px}
.runtime-meta{gap:10px}
.runtime-meta .metric{display:block}
.runtime-meta .label{display:inline;margin-right:8px}
.runtime-meta .value{display:inline}
.runtime-meta .detail{display:block}
.volume{gap:14px 24px}
.section{margin-top:24px}
.section-heading h2{font-size:19px}
.observation-details{padding:0 20px}
.detail-metrics,.scope-body{grid-template-columns:1fr;gap:18px}
.scope{padding:0 20px}
.scope-body{gap:24px}
.recent-table thead{display:none}
.recent-table,.recent-table tbody,.recent-table tr,.recent-table td{display:block;width:100%}
.recent-table tr{padding:16px;background:var(--surface);border-radius:4px;margin-bottom:10px}
.recent-table td,.recent-table td:first-child,.recent-table td:last-child,.recent-table td:nth-child(7){min-width:0;max-width:none;padding:5px 0;border:0;display:grid;grid-template-columns:112px minmax(0,1fr);gap:10px}
.cell-label{display:block;color:var(--muted);font-size:12px}
.recent-table td details p{min-width:0}
.recent-table .empty-row td{display:block;padding:8px 0}
.saved-session{padding:0 18px}
.saved-session>summary{display:block}
.saved-session .session-totals{text-align:left;display:block;margin-top:10px}
footer{display:block}
footer span{display:block;margin-bottom:6px}
}

.export-actions{display:flex;gap:6px;flex-wrap:wrap}
button{font:inherit;font-size:12px;background:var(--raised);color:var(--ink);border:1px solid var(--line);border-radius:4px;padding:6px 10px;cursor:pointer}
button:hover{background:var(--surface);border-color:var(--muted)}
button:disabled{opacity:.5;cursor:default}
button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
.export-status{font-size:12px;color:var(--muted);margin:0}
.export-status:empty{display:none}
.page-heading{align-items:center}
@media(max-width:760px){.page-heading{display:flex;flex-wrap:wrap;gap:12px}.export-actions{margin-bottom:4px}}
@media(prefers-reduced-motion:no-preference){a,summary{transition:color 140ms ease,background-color 140ms ease}
}
@media(prefers-reduced-motion:reduce){*,*:before,*:after{animation:none!important;transition:none!important;scroll-behavior:auto!important}
}
`;
export const DASHBOARD_JS = `(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const number = new Intl.NumberFormat();
  const timestamp = () => new Date().toLocaleTimeString();

  function addText(parent, value, className) {
    const element = document.createElement('div');
    if (className) element.className = className;
    element.textContent = value;
    parent.append(element);
    return element;
  }

  function addMetric(parent, label, value, detail = '') {
    const element = document.createElement('div');
    element.className = 'metric';
    addText(element, label, 'label');
    addText(element, value, value === 'Unavailable' ? 'value unavailable' : 'value');
    if (detail) addText(element, detail, 'detail');
    parent.append(element);
  }

  function clear(id) {
    const element = $(id);
    while (element.firstChild) element.removeChild(element.firstChild);
    return element;
  }

  function format(value) {
    return typeof value === 'number' && Number.isFinite(value) ? number.format(value) : 'Unavailable';
  }

  function coverage(value) {
    if (!value || typeof value !== 'object') return { sum: 'Unavailable', detail: 'Coverage unavailable' };
    return { sum: format(value.sum), detail: format(value.available) + ' available · ' + format(value.missing) + ' missing' };
  }

  function addCoverage(parent, label, value) {
    const result = coverage(value);
    addMetric(parent, label, result.sum, result.detail);
  }

  function dateLabel(value) {
    if (typeof value !== 'string') return 'Unavailable';
    const date = new Date(value);
    return Number.isFinite(date.getTime()) ? date.toLocaleString() : 'Unavailable';
  }

  function renderContext(session, totals, modes) {
    const count = totals.outcomes;
    const admitted = session.lifecycle.admitted;
    $('activity-title').textContent = count === 0 ? 'No recorded outcomes' : format(count) + ' recorded outcomes';
    $('activity-description').textContent = count === 0
      ? admitted > 0 ? 'Handler activity exists; no outcome summaries recorded.' : 'Only traffic routed through Inlay appears here.'
      : 'This server lifetime · no agent, conversation or task attribution.';
    $('usage-note').textContent = count === 0 ? 'No reported usage yet. There are no recorded outcomes to sum.'
      : modes.observation === 'off' ? 'Observation is off. Provider usage observation is disabled; missing fields remain unavailable.'
      : 'Each field has its own coverage. Missing provider values remain unavailable, not zero.';
    $('integrity-brief').textContent = format(totals.structure?.available) + (totals.structure?.available === 1 ? ' outcome' : ' outcomes') + ' with structure · ' + format(totals.structure?.unavailable) + ' unavailable';
    $('recurrence-brief').textContent = modes.recurrence === 'off' ? 'Tracking is off'
      : format(totals.recurrence?.available) + (totals.recurrence?.available === 1 ? ' outcome' : ' outcomes') + ' with recurrence · ' + format(totals.recurrence?.unavailable) + ' unavailable';
  }

  function renderLifecycle(session, modes) {
    const lifecycle = session.lifecycle;
    const parent = clear('lifecycle');
    for (const [label, key, detail] of [
      ['Admitted', 'admitted', 'Handler entries'], ['Active', 'active', 'Handlers still open'],
      ['Forwarding', 'forwarding', 'Local upstream invocations'], ['Finalized', 'finalized', 'Normally closed handlers']
    ]) addMetric(parent, label, format(lifecycle[key]), detail);
    const meta = document.createElement('div');
    meta.className = 'runtime-meta';
    addMetric(meta, 'Session started', dateLabel(session.startedAt));
    addMetric(meta, 'Observation mode', modes.observation || 'Unavailable');
    addMetric(meta, 'Lifecycle status', lifecycle.availability === 'AVAILABLE' ? 'Available' : 'Unavailable', lifecycle.incomplete === true ? 'Accounting incomplete: yes' : lifecycle.availability === 'AVAILABLE' && lifecycle.incomplete === false ? 'Accounting incomplete: no' : 'Accounting incomplete: unavailable');
    if (lifecycle.unavailableReason) addMetric(meta, 'Unavailable reason', lifecycle.unavailableReason);
    parent.append(meta);
  }

  function renderUsage(totals) {
    const parent = clear('usage');
    for (const [key, label] of [['inputTokens', 'Input tokens'], ['outputTokens', 'Output tokens'], ['cachedInputTokens', 'Cached input tokens'], ['totalTokens', 'Total tokens']]) {
      addCoverage(parent, label, totals.usage?.[key]);
    }
    const volume = clear('volume');
    addMetric(volume, 'Recorded outcomes', format(totals.outcomes));
    addCoverage(volume, 'Request bytes', totals.requestBytes);
    addCoverage(volume, 'Response bytes', totals.responseBytes);
  }

  function renderIntegrity(totals) {
    const parent = clear('integrity');
    const flags = totals.transport || {};
    for (const [key, label] of [['completed', 'Transport completed'], ['cancelled', 'Cancelled'], ['terminalEventObserved', 'Terminal event observed'], ['responseObservationIncomplete', 'Known response incompleteness'], ['cancelledAfterTerminalEvent', 'Cancelled after terminal event']]) {
      const value = flags[key] || {};
      addMetric(parent, label, format(value.yes) + ' yes', format(value.no) + ' no · ' + format(value.unavailable) + ' unavailable');
    }
    const structure = totals.structure || {};
    addMetric(parent, 'Structure coverage', format(structure.available) + ' available · ' + format(structure.unavailable) + ' unavailable');
    addCoverage(parent, 'Canonical bytes', structure.canonicalBytes);
    addCoverage(parent, 'Input items', structure.inputItems);
    if (structure.reasons) addMetric(parent, 'Unavailable reasons', Object.entries(structure.reasons).map(([key, value]) => key + ': ' + format(value)).join(' · ') || 'None');
    if (structure.itemTypes) addMetric(parent, 'Input composition', Object.entries(structure.itemTypes).map(([key, value]) => key + ': ' + format(value.count)).join(' · '));
  }

  function renderRecurrence(session, totals, modes) {
    const parent = clear('recurrence');
    const recurrence = totals.recurrence || {};
    addMetric(parent, 'Recurrence mode', modes.recurrence || 'Unavailable', modes.recurrence === 'off' ? 'Exact-item recurrence tracking is disabled' : 'Exact-item recurrence tracking enabled');
    addMetric(parent, 'Availability', format(recurrence.available) + ' available · ' + format(recurrence.unavailable) + ' unavailable');
    for (const [key, label] of [['comparedItems', 'Compared items'], ['previouslySeenItems', 'Previously seen items'], ['previouslySeenBytes', 'Previously seen bytes']]) {
      addCoverage(parent, label, recurrence[key]);
    }
    addMetric(parent, 'Comparison incomplete', format(recurrence.incomplete?.yes) + ' yes · ' + format(recurrence.incomplete?.no) + ' no · ' + format(recurrence.incomplete?.unavailable) + ' unavailable');
    if (session.recurrence) {
      const summary = session.recurrence;
      const truncation = summary.groupsTruncated === null ? 'Truncation unavailable' : summary.groupsTruncated ? 'Tracker groups truncated' : 'Tracker groups not truncated';
      const completeness = summary.comparisonIncomplete === null ? 'comparison status unavailable' : summary.comparisonIncomplete ? 'comparison incomplete' : 'no known comparison incompleteness';
      addMetric(parent, 'Instance recurring groups', format(summary.recurringGroupCount), truncation + ' · ' + completeness + '; group details are not shown');
    }
  }

  function cell(row, value, className = '', label = '') {
    const element = document.createElement('td');
    if (label) addText(element, label, 'cell-label');
    addText(element, value, 'cell-value');
    if (className) element.className = className;
    row.append(element);
    return element;
  }

  function boolLabel(value, yes, no, unknown) {
    return value === true ? yes : value === false ? no : unknown;
  }

  const recentControls = ['recent-route', 'recent-usage', 'recent-transport'];
  let recentRecords = [];
  let visibleRecent = [];
  let visibleHistory = [];
  let viewCurrent = null;
  let viewModes = {};
  let viewHistory = { status: 'unavailable', reason: null, retentionSessions: 0 };
  let rendering = false;
  function emitView() {
    if (!viewCurrent || typeof CustomEvent !== 'function') return;
    document.dispatchEvent(new CustomEvent('inlay:view', { detail: {
      current: viewCurrent, modes: viewModes,
      history: { status: viewHistory?.status, reason: viewHistory?.reason ?? null, retentionSessions: viewHistory?.retentionSessions ?? 0, sessions: visibleHistory },
      selection: Object.fromEntries(['history-state', 'history-from', 'history-to', 'history-order'].map(id => [id, $(id).value]))
    } }));
  }
  let recentViewProjection = null;
  let routeProjection = null;
  function recentMatches(record) {
    const route = $('recent-route').value;
    const usage = $('recent-usage').value;
    const transport = $('recent-transport').value;
    if (route && record.route !== route) return false;
    if (usage === 'available' && record.inputTokens == null) return false;
    if (usage === 'missing' && record.inputTokens != null) return false;
    if (transport === 'completed' && record.completed !== true) return false;
    if (transport === 'cancelled' && record.cancelled !== true) return false;
    if (transport === 'incomplete' && record.responseObservationIncomplete !== true && record.recurrenceIncomplete !== true) return false;
    if (transport === 'unavailable' && record.completed != null && record.cancelled != null && record.responseObservationIncomplete != null && record.recurrenceIncomplete != null) return false;
    return true;
  }
  function updateRecent() {
    const records = recentRecords.filter(recentMatches);
    visibleRecent = records;
    const projection = JSON.stringify([records, recentRecords.length, recentControls.map(id => $(id).value)]);
    if (projection === recentViewProjection) return;
    recentViewProjection = projection;
    const parent = clear('recent');
    const active = recentControls.some(id => $(id).value !== '');
    $('recent-count').textContent = recentRecords.length === 0 ? '0 of 0 retained outcomes · No recorded outcomes'
      : format(records.length) + ' of ' + format(recentRecords.length) + ' retained outcomes' + (active && records.length === 0 ? ' · No matches' : '');
    if (records.length === 0) {
      const row = document.createElement('tr'); row.className = 'empty-row';
      const empty = document.createElement('td'); empty.colSpan = 9;
      addText(empty, recentRecords.length === 0 ? 'No recorded outcomes' : 'No outcomes match these filters', 'empty-title');
      if (recentRecords.length === 0) addText(empty, 'Only requests explicitly routed through Inlay produce observations.');
      row.append(empty); parent.append(row);
      if (!rendering) emitView();
      return;
    }
    records.forEach((record) => {
      const row = document.createElement('tr');
      cell(row, record.route, 'route', 'Route');
      cell(row, record.durationMs === null ? 'Unavailable' : format(record.durationMs) + ' ms', '', 'Duration');
      cell(row, format(record.requestBytes), '', 'Request bytes');
      cell(row, format(record.responseBytes), '', 'Response bytes');
      cell(row, format(record.inputTokens), '', 'Input tokens');
      cell(row, format(record.outputTokens), '', 'Output tokens');
      cell(row, record.canonicalBytes === null ? (record.requestStructureUnavailableReason || 'Unavailable') : format(record.canonicalBytes) + ' bytes · ' + format(record.inputItems) + ' items', '', 'Structure');
      cell(row, format(record.previouslySeenItems), '', 'Previously seen');
      const transport = document.createElement('td'); addText(transport, 'Transport', 'cell-label');
      const details = document.createElement('details'); const summary = document.createElement('summary');
      summary.textContent = 'Response flags'; details.append(summary);
      for (const value of [boolLabel(record.completed, 'completed', 'not completed', 'completion unavailable'), boolLabel(record.cancelled, 'cancelled', 'not cancelled', 'cancellation unavailable'), boolLabel(record.terminalEventObserved, 'terminal event', 'no terminal event', 'terminal status unavailable'), boolLabel(record.responseObservationIncomplete, 'Known response incompleteness: yes', 'Known response incompleteness: no', 'Response incompleteness unavailable'), boolLabel(record.recurrenceIncomplete, 'Known recurrence incompleteness: yes', 'Known recurrence incompleteness: no', 'Recurrence incompleteness unavailable')]) { const text = document.createElement('p'); text.textContent = value; details.append(text); }
      transport.append(details); row.append(transport); parent.append(row);
    });
    if (!rendering) emitView();
  }
  recentControls.forEach(id => $(id).addEventListener('change', updateRecent));
  function renderRecent(records) {
    recentRecords = Array.isArray(records) ? records.slice(0, 20) : [];
    const route = $('recent-route');
    const selected = route.value;
    const routes = ['/v1/responses', '/v1/codex/responses', '/v1/chat/completions'];
    const key = JSON.stringify(routes);
    if (routeProjection !== key) {
      routeProjection = key;
      while (route.firstChild) route.removeChild(route.firstChild);
      const all = document.createElement('option'); all.value = ''; all.textContent = 'All routes'; route.append(all);
      routes.forEach(value => { const option = document.createElement('option'); option.value = value; option.textContent = value; route.append(option); });
    }
    route.value = routes.includes(selected) ? selected : '';
    updateRecent();
  }

  const historyDisclosures = new Map();
  let historyInfo = null;
  let historyEmpty = null;
  const historyControls = ['history-state', 'history-from', 'history-to', 'history-order'];
  historyControls.forEach(id => $(id).addEventListener('change', () => { if (lastHistory) renderHistory(lastHistory); }));
  let lastHistory = null;
  function renderHistory(history) {
    const parent = $('history');
    $('history-filters').hidden = history?.status !== 'ready';
    if (history?.status !== 'ready') {
      clear('history');
      historyDisclosures.clear();
      historyInfo = null;
      historyEmpty = null;
      lastHistory = null;
      viewHistory = history || { status: 'unavailable', reason: null, retentionSessions: 0 };
      visibleHistory = [];
      $('history-count').textContent = '';
      const empty = document.createElement('div');
      empty.className = 'history-empty';
      const off = history?.status === 'off';
      addText(empty, off ? 'History is off' : 'Historical summaries unavailable', 'empty-title');
      const note = document.createElement('p');
      note.textContent = off ? 'Current activity stays in memory. Set INLAY_HISTORY_DIR before starting Inlay to opt in to aggregate session summaries.'
        : 'The history writer is unavailable. Current measurements and proxy forwarding continue independently.';
      empty.append(note);
      if (history.reason) addText(empty, 'Status: ' + history.reason, 'detail');
      parent.append(empty);
      if (!rendering) emitView();
      return;
    }
    lastHistory = history;
    const sessions = Array.isArray(history.sessions) ? history.sessions.slice(0, 100) : [];
    const stateFilter = $('history-state').value;
    const from = $('history-from').value;
    const to = $('history-to').value;
    const order = $('history-order').value;
    const invalidRange = from && to && from > to;
    const filtered = sessions.filter(session => {
      if (invalidRange) return false;
      const state = ['running', 'closed'].includes(session.state) ? session.state : 'unknown';
      const started = typeof session.startedAt === 'string' ? session.startedAt.slice(0, 10) : '';
      return (!stateFilter || state === stateFilter) && (!from || started >= from) && (!to || started <= to);
    });
    filtered.sort((a, b) => {
      const aTime = Date.parse(a.startedAt) || 0, bTime = Date.parse(b.startedAt) || 0;
      return order === 'oldest' ? aTime - bTime : bTime - aTime;
    });
    $('history-count').textContent = sessions.length === 0 ? '0 of 0 retained summaries · No stored sessions'
      : format(filtered.length) + ' of ' + format(sessions.length) + ' retained summaries' + (invalidRange ? ' · Start-date range is reversed' : filtered.length === 0 ? ' · No matches' : '');
    if (!historyInfo) {
      clear('history');
      historyInfo = addText(parent, '', 'detail');
    }
    historyInfo.textContent = 'Retained aggregate summaries · retention limit ' + format(history.retentionSessions) + ' sessions';
    const visible = filtered;
    visibleHistory = visible;
    viewHistory = history;
    if (!historyEmpty) { historyEmpty = document.createElement('p'); historyEmpty.className = 'filter-count'; parent.append(historyEmpty); }
    historyEmpty.textContent = visible.length === 0 && sessions.length > 0 ? 'No saved sessions match these filters.' : '';
    const keys = new Set(visible.map(session => session.sessionId));
    for (const [key, nodes] of historyDisclosures) {
      if (!keys.has(key)) { parent.removeChild(nodes.details); historyDisclosures.delete(key); }
    }
    visible.forEach((session, index) => {
      let nodes = historyDisclosures.get(session.sessionId);
      if (!nodes) {
        const details = document.createElement('details');
        details.className = 'saved-session';
        const summary = document.createElement('summary');
        const identity = document.createElement('span');
        const date = addText(identity, '', 'session-date');
        const description = addText(identity, '', 'session-description');
        summary.append(identity);
        const totalLabel = addText(summary, '', 'session-totals');
        details.append(summary);
        const metrics = document.createElement('div');
        metrics.className = 'detail-metrics';
        details.append(metrics);
        nodes = { details, date, description, totalLabel, metrics };
        historyDisclosures.set(session.sessionId, nodes);
      }
      // Reuse the disclosure and its summary so polling preserves focus and open state.
      if (parent.children[index + 1] !== nodes.details) parent.insertBefore(nodes.details, parent.children[index + 1] || null);
      nodes.date.textContent = dateLabel(session.startedAt);
      const state = session.state === 'running' ? 'Running at last checkpoint' : session.state === 'closed' ? 'Closed' : 'End state unknown';
      nodes.description.textContent = state + ' · ' + (session.endedAt ? 'Ended ' + dateLabel(session.endedAt) : 'Unknown / not ended');
      const totals = session.totals || {};
      nodes.totalLabel.textContent = format(totals.outcomes) + ' outcomes · View summary';
      const metrics = nodes.metrics;
      while (metrics.firstChild) metrics.removeChild(metrics.firstChild);
      addMetric(metrics, 'Checkpoint updated', dateLabel(session.updatedAt));
      addCoverage(metrics, 'Input tokens', totals.usage?.inputTokens);
      addCoverage(metrics, 'Output tokens', totals.usage?.outputTokens);
      addCoverage(metrics, 'Response bytes', totals.responseBytes);
      for (const [label, value] of [
        ['Known response incomplete', totals.transport?.responseObservationIncomplete],
        ['Recurrence incomplete', totals.recurrence?.incomplete],
        ['Transport completed', totals.transport?.completed], ['Cancelled', totals.transport?.cancelled]
      ]) addMetric(metrics, label, format(value?.yes) + ' yes · ' + format(value?.no) + ' no · ' + format(value?.unavailable) + ' unavailable');
      addMetric(metrics, 'Admitted', format(session.lifecycle?.admitted));
      addMetric(metrics, 'Finalized', format(session.lifecycle?.finalized));

    });
    if (!rendering) emitView();
  }

  function render(data) {
    rendering = true;
    viewCurrent = data.current;
    viewModes = data.modes || {};
    const session = data.current;
    const totals = session.totals;
    renderContext(session, totals, data.modes || {});
    const state = $('session-state');
    state.textContent = session.state === 'running' ? 'Running' : session.state === 'closed' ? 'Closed' : 'End state unknown';
    renderLifecycle(session, data.modes || {});
    renderUsage(totals);
    renderIntegrity(totals);
    renderRecurrence(session, totals, data.modes || {});
    renderRecent(data.recent);
    renderHistory(data.history);
    rendering = false;
    emitView();
  }

  let lastSuccess = false;
  let busy = false;

  async function poll() {
    if (busy) return;
    busy = true;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    try {
      const response = await fetch('/dashboard/data', { signal: controller.signal, cache: 'no-store' });
      if (!response.ok) throw new Error('HTTP ' + response.status);
      const data = await response.json();
      if (data?.version !== 1 || !data.current?.totals) throw new Error('Invalid dashboard data');
      render(data);
      lastSuccess = true;
      if ($('connection').textContent !== 'Live') $('connection').textContent = 'Live';
      $('connection').className = 'connection';
      $('updated').textContent = 'Updated ' + timestamp();
      $('notice').hidden = true;
    } catch (_) {
      if ($('connection').textContent !== 'Offline') $('connection').textContent = 'Offline';
      $('connection').className = 'connection offline';
      $('notice').textContent = lastSuccess
        ? 'Connection lost. Showing the last successful update; values may be stale.'
        : 'Dashboard data is unavailable. No values have been assumed.';
      $('notice').hidden = false;
    } finally {
      clearTimeout(timeout);
      busy = false;
      setTimeout(poll, 2000);
    }
  }

  poll();
})();`;
