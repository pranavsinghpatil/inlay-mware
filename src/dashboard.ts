export const DASHBOARD_HTML = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="color-scheme" content="light"><title>Inlay · Local observation</title><link rel="stylesheet" href="/dashboard/style.css"></head>
<body><header class="top"><a href="/" class="brand">Inlay</a><span class="subtitle">Local observation</span><span id="connection" class="connection" role="status" aria-live="polite">Connecting…</span></header>
<main><section class="intro"><div><p class="eyebrow">OBSERVATION DASHBOARD</p><h1>Local observation</h1><p class="muted">Content-free measurements from this server instance.</p></div><p id="updated" class="updated" aria-live="polite">Waiting for first update</p></section>
<div id="notice" class="notice" role="status" aria-live="polite" hidden></div>
<section class="card"><div class="section-head"><div><h2>Current session</h2><p class="muted">Recorded outcomes during this server instance</p></div><span id="session-state" class="badge">Unavailable</span></div><div id="lifecycle" class="metrics grid" aria-label="Exchange lifecycle"></div><h3>Reported usage and coverage</h3><div id="usage" class="metrics grid"></div><p class="footnote">Provider-reported usage; these values do not represent billing or task success. Counts describe recorded outcomes, not logical requests.</p></section>
<section class="columns"><article class="card"><h2>Integrity and structure</h2><div id="integrity" class="metrics"></div></article><article class="card"><h2>Recurrence</h2><div id="recurrence" class="metrics"></div></article></section>
<section class="card"><div class="section-head"><div><h2>Recent outcomes</h2><p class="muted">Latest approved summary fields</p></div></div><div class="table-wrap"><table><thead><tr><th>Route</th><th>Duration</th><th>Request bytes</th><th>Response bytes</th><th>Input tokens</th><th>Output tokens</th><th>Structure</th><th>Previously seen</th><th>Transport</th></tr></thead><tbody id="recent"><tr><td colspan="9" class="muted">Waiting for data</td></tr></tbody></table></div></section>
<section class="card"><div class="section-head"><div><h2>Historical sessions</h2><p class="muted">Aggregate summaries only</p></div></div><div id="history" class="table-wrap muted">History unavailable</div></section></main><footer>Inlay · Local dashboard</footer><script src="/dashboard/app.js" defer></script></body></html>`;

export const DASHBOARD_CSS = `:root{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;color:#20262c;background:#f4f6f7;font-synthesis:none;text-rendering:optimizeLegibility}*{box-sizing:border-box}body{margin:0}.top{height:64px;background:#fff;border-bottom:1px solid #dfe4e7;display:flex;align-items:center;padding:0 max(24px,calc((100% - 1120px)/2));gap:14px}.brand{font-weight:750;font-size:18px;color:#183e39;text-decoration:none}.subtitle{color:#77818a;font-size:14px}.connection{margin-left:auto;font-size:13px;color:#267451}.connection.offline{color:#a64235}.connection.stale{color:#8a631a}main{max-width:1120px;margin:40px auto;padding:0 24px}.intro,.section-head{display:flex;justify-content:space-between;align-items:flex-start;gap:20px}.intro{margin-bottom:24px}.eyebrow{font-size:11px;letter-spacing:.13em;color:#57766f;font-weight:700;margin:0 0 8px}h1{font-size:30px;letter-spacing:-.035em;margin:0 0 7px}h2{font-size:18px;margin:0 0 6px}h3{font-size:14px;margin:26px 0 10px}.muted,.updated{font-size:13px;color:#74808a;margin:0}.updated{text-align:right;padding-top:5px}.card{background:#fff;border:1px solid #e0e5e8;border-radius:10px;padding:22px;margin-bottom:18px;box-shadow:0 2px 8px #172b3608}.badge{background:#eaf3ef;color:#2d6c50;border-radius:999px;padding:5px 10px;font-size:12px;white-space:nowrap}.grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:10px}.metric{padding:13px;border:1px solid #e7ebed;border-radius:7px;min-width:0}.metric .label{font-size:12px;color:#6d7880;display:block;margin-bottom:7px}.metric .value{font-size:18px;font-weight:650;overflow-wrap:anywhere}.metric .detail{font-size:11px;color:#869098;margin-top:4px}.footnote{font-size:12px;color:#77818a;margin:16px 0 0;line-height:1.5}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.columns .card{min-width:0}.metrics:not(.grid) .metric{margin-top:9px}.notice{border:1px solid #edd8a6;background:#fff9e9;color:#6d5017;padding:12px 15px;border-radius:7px;margin-bottom:18px;font-size:13px}.notice[hidden]{display:none}.table-wrap{overflow:auto}table{border-collapse:collapse;width:100%;font-size:12px;white-space:nowrap}th{text-align:left;color:#71808a;font-weight:600;border-bottom:1px solid #e6eaec;padding:10px 12px}td{border-bottom:1px solid #eef0f1;padding:11px 12px}tbody tr:last-child td{border-bottom:0}.route{font-family:ui-monospace,monospace;font-size:11px}footer{max-width:1120px;margin:12px auto 30px;padding:0 24px;color:#8a949b;font-size:12px}@media(max-width:760px){main{margin:25px auto;padding:0 14px}.top{padding:0 14px}.grid{grid-template-columns:repeat(2,minmax(0,1fr))}.columns{grid-template-columns:1fr}.intro{display:block}.updated{text-align:left;margin-top:12px}.card{padding:16px}.section-head{gap:8px}footer{padding:0 14px}}`;

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
    addText(element, value, 'value');
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

  function renderLifecycle(session, modes) {
    const lifecycle = session.lifecycle;
    const parent = clear('lifecycle');
    for (const [label, key] of [['Admitted', 'admitted'], ['Active', 'active'], ['Forwarding', 'forwarding'], ['Finalized', 'finalized']]) {
      addMetric(parent, label, format(lifecycle[key]));
    }
    addMetric(parent, 'Session started', dateLabel(session.startedAt));
    addMetric(parent, 'Observation mode', modes.observation || 'Unavailable', modes.observation === 'off' ? 'Structure and provider usage observation are disabled' : 'Approved structural summaries enabled');
    addMetric(parent, 'Lifecycle status', lifecycle.availability === 'AVAILABLE' ? 'Available' : 'Unavailable', lifecycle.incomplete ? 'Accounting incomplete: yes' : 'Accounting incomplete: no');
    if (lifecycle.unavailableReason) addMetric(parent, 'Unavailable reason', lifecycle.unavailableReason);
  }

  function renderUsage(totals) {
    const parent = clear('usage');
    addMetric(parent, 'Recorded outcomes', format(totals.outcomes));
    addCoverage(parent, 'Request bytes', totals.requestBytes);
    addCoverage(parent, 'Response bytes', totals.responseBytes);
    for (const [key, label] of [['inputTokens', 'Input tokens'], ['outputTokens', 'Output tokens'], ['totalTokens', 'Total tokens'], ['cachedInputTokens', 'Cached input tokens']]) {
      addCoverage(parent, label, totals.usage?.[key]);
    }
  }

  function renderIntegrity(totals) {
    const parent = clear('integrity');
    const flags = totals.transport || {};
    for (const key of ['completed', 'cancelled', 'terminalEventObserved', 'responseObservationIncomplete', 'cancelledAfterTerminalEvent']) {
      const value = flags[key] || {};
      addMetric(parent, key.replace(/[A-Z]/g, (letter) => ' ' + letter), format(value.yes) + ' yes', format(value.no) + ' no · ' + format(value.unavailable) + ' unavailable');
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
      const completeness = summary.comparisonIncomplete === null ? 'comparison status unavailable' : summary.comparisonIncomplete ? 'comparison incomplete' : 'comparison complete';
      addMetric(parent, 'Instance recurring groups', format(summary.recurringGroupCount), truncation + ' · ' + completeness + '; group details are not shown');
    }
  }

  function cell(row, value, className = '') {
    const element = document.createElement('td');
    element.textContent = value;
    if (className) element.className = className;
    row.append(element);
  }

  function boolLabel(value, yes, no, unknown) {
    return value === true ? yes : value === false ? no : unknown;
  }

  function renderRecent(records) {
    const parent = clear('recent');
    if (!Array.isArray(records) || records.length === 0) {
      const row = document.createElement('tr');
      const empty = document.createElement('td');
      empty.colSpan = 9;
      empty.className = 'muted';
      empty.textContent = 'No recorded outcomes';
      row.append(empty);
      parent.append(row);
      return;
    }
    records.slice(0, 20).forEach((record) => {
      const row = document.createElement('tr');
      cell(row, record.route, 'route');
      cell(row, record.durationMs === null ? 'Unavailable' : format(record.durationMs) + ' ms');
      cell(row, format(record.requestBytes));
      cell(row, format(record.responseBytes));
      cell(row, format(record.inputTokens));
      cell(row, format(record.outputTokens));
      cell(row, record.canonicalBytes === null ? (record.requestStructureUnavailableReason || 'Unavailable') : format(record.canonicalBytes) + ' bytes · ' + format(record.inputItems) + ' items');
      cell(row, format(record.previouslySeenItems));
      const transport = [
        boolLabel(record.completed, 'completed', 'not completed', 'completion unavailable'),
        boolLabel(record.cancelled, 'cancelled', 'not cancelled', 'cancellation unavailable'),
        boolLabel(record.terminalEventObserved, 'terminal event', 'no terminal event', 'terminal status unavailable'),
        boolLabel(record.responseObservationIncomplete, 'Known response incompleteness: yes', 'Known response incompleteness: no', 'Response incompleteness unavailable'),
        boolLabel(record.recurrenceIncomplete, 'Known recurrence incompleteness: yes', 'Known recurrence incompleteness: no', 'Recurrence incompleteness unavailable'),
      ].join(' · ');
      cell(row, transport);
      parent.append(row);
    });
  }

  function renderHistory(history) {
    const parent = clear('history');
    if (history?.status === 'off') {
      addText(parent, 'History is off. Set INLAY_HISTORY_DIR to opt in to aggregate session summaries.');
      if (history.reason) addText(parent, 'Status: ' + history.reason);
      return;
    }
    if (history?.status !== 'ready') {
      addText(parent, history?.reason || 'Historical summaries unavailable');
      return;
    }
    const sessions = Array.isArray(history.sessions) ? history.sessions : [];
    addText(parent, 'Showing ' + Math.min(20, sessions.length) + ' of ' + format(sessions.length) + ' retained summaries · retention limit ' + format(history.retentionSessions) + ' sessions', 'detail');
    if (sessions.length === 0) {
      addText(parent, 'No stored sessions');
      return;
    }
    const table = document.createElement('table');
    const head = document.createElement('thead');
    const headerRow = document.createElement('tr');
    ['Started', 'Ended', 'State', 'Outcomes', 'Input tokens', 'Output tokens', 'Response bytes', 'Known response incomplete', 'Recurrence incomplete', 'Transport completed', 'Cancelled', 'Admitted', 'Finalized'].forEach((label) => {
      const header = document.createElement('th');
      header.textContent = label;
      headerRow.append(header);
    });
    head.append(headerRow);
    table.append(head);
    const body = document.createElement('tbody');
    sessions.slice(0, 20).forEach((session) => {
      const row = document.createElement('tr');
      const totals = session.totals || {};
      const flags = totals.transport || {};
      const responseIncomplete = flags.responseObservationIncomplete || {};
      const recurrenceIncomplete = totals.recurrence?.incomplete || {};
      const completed = flags.completed || {};
      const cancelled = flags.cancelled || {};
      const lifecycle = session.lifecycle || {};
      const values = [dateLabel(session.startedAt), session.endedAt ? dateLabel(session.endedAt) : 'Unknown / not ended', session.state, format(totals.outcomes), coverage(totals.usage?.inputTokens), coverage(totals.usage?.outputTokens), coverage(totals.responseBytes)];
      cell(row, values[0] || 'Unavailable'); cell(row, values[1]); cell(row, values[2] || 'Unavailable'); cell(row, values[3]);
      for (const value of values.slice(4)) cell(row, value.sum + ' (' + value.detail + ')');
      for (const value of [responseIncomplete, recurrenceIncomplete, completed, cancelled]) {
        cell(row, format(value.yes) + ' yes · ' + format(value.no) + ' no · ' + format(value.unavailable) + ' unavailable');
      }
      cell(row, format(lifecycle.admitted)); cell(row, format(lifecycle.finalized));
      body.append(row);
    });
    table.append(body);
    parent.append(table);
  }

  function render(data) {
    const session = data.current;
    const totals = session.totals;
    const state = $('session-state');
    state.textContent = session.state === 'running' ? 'Running' : session.state === 'closed' ? 'Closed' : 'End state unknown';
    renderLifecycle(session, data.modes || {});
    renderUsage(totals);
    renderIntegrity(totals);
    renderRecurrence(session, totals, data.modes || {});
    renderRecent(data.recent);
    renderHistory(data.history);
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
      $('connection').textContent = 'Live';
      $('connection').className = 'connection';
      $('updated').textContent = 'Updated ' + timestamp();
      $('notice').hidden = true;
    } catch (_) {
      $('connection').textContent = 'Offline';
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
