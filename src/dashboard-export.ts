/** Browser-only export of closed-schema aggregate summaries; never recent rows. */
export const DASHBOARD_EXPORT_JS = String.raw`(() => {
  'use strict';
  let view = null;
  const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
  const choice = (value, values) => values.includes(value) ? value : null;
  const date = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) ? value : null;
  const coverage = value => ({ sum: count(value?.sum), available: count(value?.available), missing: count(value?.missing) });
  const flag = value => ({ yes: count(value?.yes), no: count(value?.no), unavailable: count(value?.unavailable) });
  function summary(value, kind) {
    const t = value?.totals || {};
    const lifecycle = value?.lifecycle || {};
    const usage = {};
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens']) usage[key] = coverage(t.usage?.[key]);
    const transport = {};
    for (const key of ['completed', 'cancelled', 'terminalEventObserved', 'responseObservationIncomplete', 'cancelledAfterTerminalEvent']) transport[key] = flag(t.transport?.[key]);
    const reasons = {};
    for (const key of ['content_encoded', 'not_json', 'zstd_decode_failed', 'zstd_output_limit']) reasons[key] = count(t.structure?.reasons?.[key]);
    const itemTypes = {};
    for (const key of ['message', 'function_call', 'function_call_output', 'computer_call', 'computer_call_output', 'item_reference', 'reasoning', 'other']) {
      const item = t.structure?.itemTypes?.[key];
      itemTypes[key] = { count: count(item?.count), canonicalBytes: count(item?.canonicalBytes) };
    }
    return {
      kind, startedAt: date(value?.startedAt), updatedAt: date(value?.updatedAt), endedAt: date(value?.endedAt),
      state: choice(value?.state, ['running', 'closed', 'end_unknown']),
      totals: {
        outcomes: count(t.outcomes), requestBytes: coverage(t.requestBytes), responseBytes: coverage(t.responseBytes), usage, transport,
        structure: { available: count(t.structure?.available), unavailable: count(t.structure?.unavailable), canonicalBytes: coverage(t.structure?.canonicalBytes), inputItems: coverage(t.structure?.inputItems), reasons, itemTypes },
        recurrence: { available: count(t.recurrence?.available), unavailable: count(t.recurrence?.unavailable), comparedItems: coverage(t.recurrence?.comparedItems), previouslySeenItems: coverage(t.recurrence?.previouslySeenItems), previouslySeenBytes: coverage(t.recurrence?.previouslySeenBytes), incomplete: flag(t.recurrence?.incomplete) }
      },
      lifecycle: {
        admitted: count(lifecycle.admitted), active: count(lifecycle.active), forwarding: count(lifecycle.forwarding), finalized: count(lifecycle.finalized),
        availability: choice(lifecycle.availability, ['AVAILABLE', 'UNAVAILABLE']), incomplete: typeof lifecycle.incomplete === 'boolean' ? lifecycle.incomplete : null,
        unavailableReason: choice(lifecycle.unavailableReason, ['overflow', 'invalid_transition', 'callback_rejection'])
      },
      recurrence: value?.recurrence ? { recurringGroupCount: count(value.recurrence.recurringGroupCount), groupsTruncated: typeof value.recurrence.groupsTruncated === 'boolean' ? value.recurrence.groupsTruncated : null, comparisonIncomplete: typeof value.recurrence.comparisonIncomplete === 'boolean' ? value.recurrence.comparisonIncomplete : null } : null
    };
  }
  function snapshot() {
    if (!view?.current?.totals) throw new Error('Unavailable');
    const selection = view.selection || {};
    const sessions = Array.isArray(view.history?.sessions) ? view.history.sessions.slice(0, 100) : [];
    return {
      schemaVersion: 1, exportedAt: new Date().toISOString(),
      dashboardConnection: document.getElementById('connection').textContent === 'Live' ? 'live' : 'stale',
      scope: 'Unfiltered current aggregates and selected saved-session aggregates. No recent outcome rows, workload content or identifiers. Not task totals or final billing.',
      modes: { observation: choice(view.modes?.observation, ['off', 'structural']), recurrence: choice(view.modes?.recurrence, ['off', 'exact-item']) },
      history: { status: choice(view.history?.status, ['ready', 'off', 'unavailable']), reason: choice(view.history?.reason, ['locked', 'invalid_history', 'io_error']), retentionSessions: count(view.history?.retentionSessions) },
      selection: {
        state: choice(selection['history-state'], ['', 'running', 'closed', 'unknown']),
        startedFromUtc: /^\d{4}-\d{2}-\d{2}$/.test(selection['history-from'] || '') ? selection['history-from'] : null,
        startedToUtc: /^\d{4}-\d{2}-\d{2}$/.test(selection['history-to'] || '') ? selection['history-to'] : null,
        order: choice(selection['history-order'], ['newest', 'oldest'])
      },
      summaries: [summary(view.current, 'current'), ...sessions.filter(s => s.sessionId !== view.current.sessionId).map(s => summary(s, 'saved'))]
    };
  }
  function csv(data) {
    const fields = [['snapshot_state', () => data.dashboardConnection], ['exported_at', () => data.exportedAt], ['kind', s => s.kind], ['session_state', s => s.state], ['started_at', s => s.startedAt], ['updated_at', s => s.updatedAt], ['ended_at', s => s.endedAt], ['outcomes', s => s.totals.outcomes]];
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens', 'cachedInputTokens']) {
      for (const part of ['sum', 'available', 'missing']) fields.push([key + '_' + part, s => s.totals.usage[key][part]]);
    }
    for (const key of ['requestBytes', 'responseBytes']) {
      for (const part of ['sum', 'available', 'missing']) fields.push([key + '_' + part, s => s.totals[key][part]]);
    }
    for (const key of ['admitted', 'active', 'forwarding', 'finalized', 'availability', 'incomplete', 'unavailableReason']) fields.push(['lifecycle_' + key, s => s.lifecycle[key]]);
    for (const key of ['completed', 'cancelled', 'terminalEventObserved', 'responseObservationIncomplete', 'cancelledAfterTerminalEvent']) {
      for (const part of ['yes', 'no', 'unavailable']) fields.push([key + '_' + part, s => s.totals.transport[key][part]]);
    }
    for (const [name, get] of [
      ['schema_version', () => data.schemaVersion], ['scope', () => data.scope], ['observation_mode', () => data.modes.observation], ['recurrence_mode', () => data.modes.recurrence],
      ['history_status', () => data.history.status], ['history_reason', () => data.history.reason], ['history_retention', () => data.history.retentionSessions],
      ['selected_state', () => data.selection.state], ['selected_started_from_utc', () => data.selection.startedFromUtc], ['selected_started_to_utc', () => data.selection.startedToUtc], ['selected_order', () => data.selection.order]
    ]) fields.push([name, get]);
    for (const key of ['available', 'unavailable']) fields.push(['structure_' + key, s => s.totals.structure[key]]);
    for (const key of ['canonicalBytes', 'inputItems']) {
      for (const part of ['sum', 'available', 'missing']) fields.push(['structure_' + key + '_' + part, s => s.totals.structure[key][part]]);
    }
    for (const key of ['content_encoded', 'not_json', 'zstd_decode_failed', 'zstd_output_limit']) fields.push(['structure_reason_' + key, s => s.totals.structure.reasons[key]]);
    for (const key of ['message', 'function_call', 'function_call_output', 'computer_call', 'computer_call_output', 'item_reference', 'reasoning', 'other']) {
      for (const part of ['count', 'canonicalBytes']) fields.push(['structure_' + key + '_' + part, s => s.totals.structure.itemTypes[key][part]]);
    }
    for (const key of ['available', 'unavailable']) fields.push(['recurrence_' + key, s => s.totals.recurrence[key]]);
    for (const key of ['comparedItems', 'previouslySeenItems', 'previouslySeenBytes']) {
      for (const part of ['sum', 'available', 'missing']) fields.push(['recurrence_' + key + '_' + part, s => s.totals.recurrence[key][part]]);
    }
    for (const part of ['yes', 'no', 'unavailable']) fields.push(['recurrence_incomplete_' + part, s => s.totals.recurrence.incomplete[part]]);
    for (const key of ['recurringGroupCount', 'groupsTruncated', 'comparisonIncomplete']) fields.push(['instance_recurrence_' + key, s => s.recurrence?.[key]]);
    const escape = value => value === null || value === undefined ? '' : '"' + String(value).replaceAll('"', '""') + '"';
    return [fields.map(([name]) => escape(name)).join(','), ...data.summaries.map(s => fields.map(([, get]) => escape(get(s))).join(','))].join('\r\n') + '\r\n';
  }
  function download(format) {
    const status = document.getElementById('export-status');
    try {
      const data = snapshot();
      const body = format === 'csv' ? csv(data) : JSON.stringify(data, null, 2) + '\n';
      const blob = new Blob([body], { type: format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = 'inlay-summaries-' + data.exportedAt.replaceAll(':', '').replaceAll('.', '-') + '.' + format;
      document.body.append(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      status.textContent = 'Exported ' + data.summaries.length + ' aggregate summaries' + (data.dashboardConnection === 'stale' ? ' from the last received snapshot; connection is offline.' : '.');
    } catch {
      status.textContent = 'Export unavailable. No valid aggregate snapshot has loaded.';
    }
  }
  document.addEventListener('inlay:view', event => {
    view = event.detail;
    for (const id of ['export-json', 'export-csv']) document.getElementById(id).disabled = !view?.current?.totals;
  });
  document.getElementById('export-json').addEventListener('click', () => download('json'));
  document.getElementById('export-csv').addEventListener('click', () => download('csv'));
})();`;
