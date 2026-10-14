import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { request as httpRequest, createServer, type IncomingHttpHeaders, type IncomingMessage, type OutgoingHttpHeaders, type Server, type ServerResponse } from "node:http";
import { request as httpsRequest } from "node:https";
import type { ProxyConfig } from "./config.ts";
import { copyResponseHeaders, forwardHeaders, readBody, sendJson } from "./http.ts";
import { MetricsStore } from "./metrics.ts";
import { ExchangeLifecycle } from "./exchange-lifecycle.ts";
import { LocalDashboard, isDashboardRequest } from "./local-dashboard.ts";
import {
  deriveResponsesRequestStructure,
  ExactItemRecurrenceTracker,
  observeZstdResponsesRequestStructure,
  ResponsesStreamObserver,
  type ResponseStreamObservation,
} from "./observation.ts";

type SupportedUpstreamPath = "chat/completions" | "responses";
type IncomingRoute = "/v1/chat/completions" | "/v1/responses" | "/v1/codex/responses";

function isSupportedExchange(request: IncomingMessage): boolean {
  return request.method === "POST" && (
    request.url === "/v1/chat/completions"
    || request.url === "/v1/responses"
    || request.url === "/v1/codex/responses"
  );
}

function withoutHopByHopHeaders(headers: IncomingHttpHeaders): OutgoingHttpHeaders {
  const connectionTokens = String(headers.connection ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const excluded = new Set([
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", "host", ...connectionTokens,
  ]);
  const result: OutgoingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (value !== undefined && !excluded.has(name.toLowerCase())) result[name] = value;
  }
  return result;
}

function copyRawResponseHeaders(source: IncomingHttpHeaders, target: ServerResponse): void {
  const connectionTokens = String(source.connection ?? "")
    .split(",")
    .map((name) => name.trim().toLowerCase())
    .filter(Boolean);
  const excluded = new Set([
    "connection", "keep-alive", "proxy-authenticate", "proxy-authorization",
    "te", "trailer", "transfer-encoding", "upgrade", ...connectionTokens,
  ]);
  for (const [name, value] of Object.entries(source)) {
    if (value !== undefined && !excluded.has(name.toLowerCase())) target.setHeader(name, value);
  }
}

async function forwardModelsMetadata(config: ProxyConfig, request: IncomingMessage, response: ServerResponse): Promise<void> {
  if (!config.upstreamBaseUrl) {
    sendJson(response, 503, { error: { code: "inlay_upstream_not_configured", message: "Set INLAY_UPSTREAM_BASE_URL to enable forwarding." } });
    return;
  }

  const upstreamBase = new URL(config.upstreamBaseUrl);
  upstreamBase.search = "";
  upstreamBase.hash = "";
  upstreamBase.pathname = `${upstreamBase.pathname.replace(/\/$/, "")}/`;
  const upstreamUrl = new URL("models", upstreamBase);
  const incomingTarget = request.url ?? "/v1/models";
  const queryStart = incomingTarget.indexOf("?");
  upstreamUrl.search = queryStart >= 0 ? incomingTarget.slice(queryStart) : "";
  const transport = upstreamUrl.protocol === "https:" ? httpsRequest : httpRequest;
  let timedOut = false;
  let clientDisconnected = false;
  let upstreamRequest: ReturnType<typeof httpRequest> | undefined;
  const cancel = () => {
    if (!response.writableEnded) {
      clientDisconnected = true;
      upstreamRequest?.destroy();
    }
  };
  request.once("aborted", cancel);
  response.once("close", cancel);

  const timeout = setTimeout(() => {
    timedOut = true;
    upstreamRequest?.destroy();
  }, config.upstreamTimeoutMs);

  try {
    await new Promise<void>((resolve, reject) => {
      upstreamRequest = transport(upstreamUrl, { method: "GET", headers: withoutHopByHopHeaders(request.headers) }, (upstreamResponse) => {
        copyRawResponseHeaders(upstreamResponse.headers, response);
        response.writeHead(upstreamResponse.statusCode ?? 502, upstreamResponse.statusMessage);
        void pipeline(upstreamResponse, response).then(resolve, reject);
      });
      upstreamRequest.once("error", reject);
      upstreamRequest.end();
    });
  } catch {
    if (!clientDisconnected && !response.headersSent) {
      sendJson(response, timedOut ? 504 : 502, {
        error: {
          code: timedOut ? "inlay_upstream_timeout" : "inlay_upstream_unavailable",
          message: "The upstream provider could not complete this request.",
        },
      });
    } else if (!response.writableEnded) {
      response.destroy();
    }
  } finally {
    clearTimeout(timeout);
    request.removeListener("aborted", cancel);
    response.removeListener("close", cancel);
  }
}

function invokeUpstreamFetch(
  lifecycle: ExchangeLifecycle,
  fetchImplementation: typeof fetch,
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): ReturnType<typeof fetch> {
  lifecycle.forward();
  return fetchImplementation(input, init);
}

/** Converts elapsed stream facts into local wall-clock timestamps for one opt-in experiment. */
function contentFreeTimeline(
  requestStartedAtMs: number,
  timeToUpstreamHeadersMs: number | undefined,
  stream: ResponseStreamObservation | undefined,
) {
  return {
    requestStartedAtMs,
    ...(timeToUpstreamHeadersMs !== undefined ? { upstreamHeadersAtMs: requestStartedAtMs + Math.round(timeToUpstreamHeadersMs) } : {}),
    ...(stream?.timeToFirstResponseBodyByteMs !== undefined ? { firstResponseBodyByteAtMs: requestStartedAtMs + Math.round(stream.timeToFirstResponseBodyByteMs) } : {}),
    ...(stream?.timeToTerminalEventMs !== undefined ? { terminalEventAtMs: requestStartedAtMs + Math.round(stream.timeToTerminalEventMs) } : {}),
    completedAtMs: Date.now(),
    retryClassification: "unavailable" as const,
  };
}

function requestContentEncoding(request: IncomingMessage): "identity" | "br" | "deflate" | "gzip" | "zstd" | "other" {
  const value = request.headers["content-encoding"];
  const encoding = (Array.isArray(value) ? value.join(",") : value ?? "identity").split(",")[0].trim().toLowerCase();
  if (encoding === "" || encoding === "identity") return "identity";
  if (encoding === "br" || encoding === "deflate" || encoding === "gzip" || encoding === "zstd") return encoding;
  return "other";
}

async function forwardModelRequest(
  config: ProxyConfig,
  metrics: MetricsStore,
  lifecycle: ExchangeLifecycle,
  request: IncomingMessage,
  response: ServerResponse,
  upstreamPath: SupportedUpstreamPath,
  incomingRoute: IncomingRoute,
  recurrenceTracker?: ExactItemRecurrenceTracker,
): Promise<void> {
  if (!config.upstreamBaseUrl) {
    sendJson(response, 503, {
      error: {
        code: "inlay_upstream_not_configured",
        message: "Set INLAY_UPSTREAM_BASE_URL to enable forwarding.",
      },
    });
    return;
  }

  const startedAt = new Date().toISOString();
  const requestStartedAtMs = Date.now();
  const started = performance.now();
  let body;
  try {
    body = await readBody(request, config.maxBodyBytes);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid request body.";
    metrics.record({ requestId: "unavailable", route: incomingRoute, startedAt, durationMs: performance.now() - started, requestBytes: 0, errorCategory: "invalid_request" });
    sendJson(response, 413, { error: { code: "inlay_request_too_large", message } });
    return;
  }

  const observe = config.observationMode === "structural" && upstreamPath === "responses";
  const observeTimeline = observe && config.timelineMode === "content-free";
  const observationSequence = observe ? metrics.nextObservationSequence() : undefined;
  const contentEncoding = observe ? requestContentEncoding(request) : undefined;
  const identityRequestStructure = observe && contentEncoding === "identity"
    ? deriveResponsesRequestStructure(body.bytes)
    : undefined;
  const zstdObservation = observe && contentEncoding === "zstd"
    ? observeZstdResponsesRequestStructure(body.bytes)
    : undefined;
  const requestStructure = identityRequestStructure ?? zstdObservation?.requestStructure;
  const requestStructureUnavailableReason = !observe || requestStructure ? undefined
    : contentEncoding === "identity" ? "not_json"
    : zstdObservation?.unavailableReason ?? "content_encoded";
  const exactItemRecurrence = recurrenceTracker && observationSequence !== undefined && contentEncoding !== undefined
    ? recurrenceTracker.observe(observationSequence, body.bytes, contentEncoding)
    : undefined;

  const abortController = new AbortController();
  const timeout = setTimeout(() => abortController.abort(), config.upstreamTimeoutMs);
  let clientDisconnected = false;
  const cancelUpstream = () => {
    if (!response.writableEnded) {
      clientDisconnected = true;
      abortController.abort();
    }
  };
  request.once("aborted", cancelUpstream);
  response.once("close", cancelUpstream);

  let upstreamStatus: number | undefined;
  let timeToUpstreamHeadersMs: number | undefined;
  const responseObserver = observe ? new ResponsesStreamObserver() : undefined;
  try {
    const upstreamUrl = new URL(upstreamPath, `${config.upstreamBaseUrl.href.replace(/\/$/, "")}/`);
    const upstream = await invokeUpstreamFetch(lifecycle, fetch, upstreamUrl, {
      method: "POST",
      headers: forwardHeaders(request.headers, body.requestId),
      body: new Uint8Array(body.bytes),
      signal: abortController.signal,
    });
    timeToUpstreamHeadersMs = performance.now() - started;
    upstreamStatus = upstream.status;

    copyResponseHeaders(upstream.headers, response);
    response.setHeader("x-inlay-request-id", body.requestId);
    response.writeHead(upstream.status, upstream.statusText);

    if (upstream.body) {
      const source = Readable.fromWeb(upstream.body as Parameters<typeof Readable.fromWeb>[0]);
      if (responseObserver) {
        const observer = new Transform({
          transform(chunk, _encoding, callback) {
            const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
            responseObserver.observe(bytes, performance.now() - started);
            callback(null, chunk);
          },
        });
        await pipeline(source, observer, response);
      } else {
        await pipeline(source, response);
      }
    } else {
      response.end();
    }
    responseObserver?.finish();
    const stream = responseObserver?.snapshot();
    metrics.record({
      observationSequence,
      requestId: body.requestId,
      route: incomingRoute,
      startedAt,
      durationMs: performance.now() - started,
      timeToUpstreamHeadersMs,
      timeToFirstResponseBodyByteMs: stream?.timeToFirstResponseBodyByteMs,
      requestBytes: body.bytes.length,
      requestContentEncoding: contentEncoding,
      responseBytes: stream?.responseBytes,
      responseStatus: upstream.status,
      requestStructure,
      requestStructureUnavailableReason,
      exactItemRecurrence,
      usage: stream?.usage,
      ...(observeTimeline ? {
        timeline: contentFreeTimeline(requestStartedAtMs, timeToUpstreamHeadersMs, stream),
      } : {}),
      ...(observe ? {
        completed: true,
        cancelled: false,
        terminalEventObserved: stream?.terminalEventObserved,
        responseObservationIncomplete: stream?.responseObservationIncomplete,
        cancelledAfterTerminalEvent: false,
      } : {}),
    });
  } catch (error) {
    const isTimeout = abortController.signal.aborted && !clientDisconnected;
    const stream = responseObserver?.snapshot();
    metrics.record({
      observationSequence,
      requestId: body.requestId,
      route: incomingRoute,
      startedAt,
      durationMs: performance.now() - started,
      timeToUpstreamHeadersMs,
      timeToFirstResponseBodyByteMs: stream?.timeToFirstResponseBodyByteMs,
      requestBytes: body.bytes.length,
      requestContentEncoding: contentEncoding,
      responseBytes: stream?.responseBytes,
      responseStatus: upstreamStatus,
      errorCategory: clientDisconnected ? "client_disconnect" : isTimeout ? "upstream_timeout" : "upstream_unavailable",
      requestStructure,
      requestStructureUnavailableReason,
      exactItemRecurrence,
      usage: stream?.usage,
      ...(observeTimeline ? {
        timeline: contentFreeTimeline(requestStartedAtMs, timeToUpstreamHeadersMs, stream),
      } : {}),
      ...(observe ? {
        completed: false,
        cancelled: clientDisconnected,
        terminalEventObserved: stream?.terminalEventObserved,
        responseObservationIncomplete: stream?.responseObservationIncomplete,
        cancelledAfterTerminalEvent: clientDisconnected && Boolean(stream?.terminalEventObserved),
      } : {}),
    });
    if (!response.headersSent) {
      sendJson(response, isTimeout ? 504 : 502, {
        error: {
          code: isTimeout ? "inlay_upstream_timeout" : "inlay_upstream_unavailable",
          message: "The upstream provider could not complete this request.",
          request_id: body.requestId,
        },
      });
    } else {
      response.destroy(error instanceof Error ? error : undefined);
    }
  } finally {
    clearTimeout(timeout);
    request.removeListener("aborted", cancelUpstream);
    response.removeListener("close", cancelUpstream);
  }
}

export function createInlayServer(config: ProxyConfig, metrics = new MetricsStore()): Server {
  const exchangeLifecycle = new ExchangeLifecycle();
  const recurrenceTracker = config.recurrenceProbe === "exact-item"
    ? new ExactItemRecurrenceTracker(config.semanticInspection === "role-categories")
    : undefined;
  const dashboard = new LocalDashboard(config, metrics, exchangeLifecycle, recurrenceTracker);
  async function handleRequest(request: IncomingMessage, response: ServerResponse): Promise<void> {
    if (isDashboardRequest(request)) {
      await dashboard.handle(request, response);
      return;
    }
    if (request.method === "GET" && request.url === "/health") {
      sendJson(response, 200, { status: "ok", upstreamConfigured: Boolean(config.upstreamBaseUrl), mode: "transparent" });
      return;
    }
    if (request.method === "GET" && request.url === "/metrics") {
      sendJson(response, 200, {
        ...metrics.snapshot(),
        exchangeLifecycle: exchangeLifecycle.snapshot(),
        ...(recurrenceTracker ? { exactItemRecurrence: recurrenceTracker.snapshot() } : {}),
      });
      return;
    }
    if (request.method === "GET" && (request.url === "/v1/models" || request.url?.startsWith("/v1/models?") === true)) {
      const contentLength = request.headers["content-length"];
      if ((contentLength !== undefined && contentLength !== "0") || request.headers["transfer-encoding"] !== undefined) {
        sendJson(response, 400, { error: { code: "inlay_invalid_request", message: "GET /v1/models does not accept a request body." } });
        request.resume();
        return;
      }
      await forwardModelsMetadata(config, request, response);
      return;
    }
    if (request.method === "POST" && request.url === "/v1/chat/completions") {
      await forwardModelRequest(config, metrics, exchangeLifecycle, request, response, "chat/completions", "/v1/chat/completions", recurrenceTracker);
      return;
    }
    if (request.method === "POST" && request.url === "/v1/responses") {
      await forwardModelRequest(config, metrics, exchangeLifecycle, request, response, "responses", "/v1/responses", recurrenceTracker);
      return;
    }
    if (request.method === "POST" && request.url === "/v1/codex/responses") {
      await forwardModelRequest(config, metrics, exchangeLifecycle, request, response, "responses", "/v1/codex/responses", recurrenceTracker);
      return;
    }
    sendJson(response, 404, { error: { code: "inlay_route_not_found", message: "Supported routes: GET /health, GET /metrics, GET /v1/models, POST /v1/chat/completions, POST /v1/responses, POST /v1/codex/responses." } });
  }

  const server = createServer((request, response) => {
    const admitted = isSupportedExchange(request);
    if (admitted) exchangeLifecycle.admit();
    const originalCallbackPromise = handleRequest(request, response);
    if (!admitted) return originalCallbackPromise;
    return originalCallbackPromise.then(
      () => exchangeLifecycle.finalize(),
      (error: unknown) => {
        exchangeLifecycle.invalidate("callback_rejection");
        throw error;
      },
    );
  });
  dashboard.attach(server);
  return server;
}
