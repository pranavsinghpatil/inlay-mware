export interface ProxyConfig {
  host: string;
  port: number;
  upstreamBaseUrl?: URL;
  maxBodyBytes: number;
  upstreamTimeoutMs: number;
  observationMode: "off" | "structural";
  recurrenceProbe?: "off" | "exact-item";
  semanticInspection?: "off" | "role-categories";
  timelineMode?: "off" | "content-free";
  historyDirectory?: string;
  historyMaxSessions?: number;
}

function positiveInteger(value: string | undefined, fallback: number, name: string): number {
  if (value === undefined || value === "") return fallback;
  const parsed = Number.parseInt(value, 10);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`${name} must be a positive integer.`);
  }
  return parsed;
}

function observationMode(value: string | undefined): "off" | "structural" {
  const mode = value ?? "off";
  if (mode !== "off" && mode !== "structural") {
    throw new Error("INLAY_OBSERVATION must be 'off' or 'structural'.");
  }
  return mode;
}

function recurrenceProbe(value: string | undefined): "off" | "exact-item" {
  const probe = value ?? "off";
  if (probe !== "off" && probe !== "exact-item") {
    throw new Error("INLAY_RECURRENCE_PROBE must be 'off' or 'exact-item'.");
  }
  return probe;
}

function semanticInspection(value: string | undefined): "off" | "role-categories" {
  const inspection = value ?? "off";
  if (inspection !== "off" && inspection !== "role-categories") {
    throw new Error("INLAY_SEMANTIC_INSPECTION must be 'off' or 'role-categories'.");
  }
  return inspection;
}

function timelineMode(value: string | undefined): "off" | "content-free" {
  const mode = value ?? "off";
  if (mode !== "off" && mode !== "content-free") {
    throw new Error("INLAY_TIMELINE must be 'off' or 'content-free'.");
  }
  return mode;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ProxyConfig {
  const host = env.INLAY_HOST ?? "127.0.0.1";
  if (host !== "127.0.0.1" && host !== "::1" && host !== "localhost") {
    throw new Error("INLAY_HOST must be loopback-only (127.0.0.1, ::1, or localhost).");
  }

  const upstream = env.INLAY_UPSTREAM_BASE_URL;
  let upstreamBaseUrl: URL | undefined;
  if (upstream) {
    upstreamBaseUrl = new URL(upstream);
    if (upstreamBaseUrl.protocol !== "https:" && upstreamBaseUrl.protocol !== "http:") {
      throw new Error("INLAY_UPSTREAM_BASE_URL must use http or https.");
    }
  }

  const configuredObservationMode = observationMode(env.INLAY_OBSERVATION);
  const configuredRecurrenceProbe = recurrenceProbe(env.INLAY_RECURRENCE_PROBE);
  const configuredSemanticInspection = semanticInspection(env.INLAY_SEMANTIC_INSPECTION);
  const configuredTimelineMode = timelineMode(env.INLAY_TIMELINE);
  if (configuredRecurrenceProbe !== "off" && configuredObservationMode !== "structural") {
    throw new Error("INLAY_RECURRENCE_PROBE requires INLAY_OBSERVATION=structural.");
  }
  if (configuredSemanticInspection !== "off" && configuredRecurrenceProbe !== "exact-item") {
    throw new Error("INLAY_SEMANTIC_INSPECTION requires INLAY_RECURRENCE_PROBE=exact-item.");
  }
  if (configuredTimelineMode !== "off" && configuredObservationMode !== "structural") {
    throw new Error("INLAY_TIMELINE requires INLAY_OBSERVATION=structural.");
  }

  const historyMaxSessions = positiveInteger(env.INLAY_HISTORY_MAX_SESSIONS, 20, "INLAY_HISTORY_MAX_SESSIONS");
  if (!/^(?:[1-9][0-9]*)$/.test(env.INLAY_HISTORY_MAX_SESSIONS || "20") || historyMaxSessions > 100) {
    throw new Error("INLAY_HISTORY_MAX_SESSIONS must be an integer from 1 to 100.");
  }

  return {
    host,
    port: positiveInteger(env.INLAY_PORT, 8787, "INLAY_PORT"),
    upstreamBaseUrl,
    maxBodyBytes: positiveInteger(env.INLAY_MAX_BODY_BYTES, 10 * 1024 * 1024, "INLAY_MAX_BODY_BYTES"),
    upstreamTimeoutMs: positiveInteger(env.INLAY_UPSTREAM_TIMEOUT_MS, 120_000, "INLAY_UPSTREAM_TIMEOUT_MS"),
    observationMode: configuredObservationMode,
    recurrenceProbe: configuredRecurrenceProbe,
    semanticInspection: configuredSemanticInspection,
    timelineMode: configuredTimelineMode,
    historyDirectory: env.INLAY_HISTORY_DIR || undefined,
    historyMaxSessions,
  };
}

