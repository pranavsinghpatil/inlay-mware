import type { ExactItemRecurrenceRequest, ProviderUsage, RequestStructure, RequestStructureUnavailableReason } from "./observation.ts";

/** Content-free local timestamps emitted only by INLAY_TIMELINE=content-free. */
export interface ContentFreeProviderTimeline {
  requestStartedAtMs: number;
  upstreamHeadersAtMs?: number;
  firstResponseBodyByteAtMs?: number;
  terminalEventAtMs?: number;
  completedAtMs: number;
  retryClassification: "unavailable";
}

export interface RequestMetric {
  /** Monotonic for structural Responses observations in this proxy process only. */
  observationSequence?: number;
  requestId: string;
  route: "/v1/chat/completions" | "/v1/responses" | "/v1/codex/responses";
  startedAt: string;
  durationMs: number;
  timeToUpstreamHeadersMs?: number;
  timeToFirstResponseBodyByteMs?: number;
  requestBytes: number;
  requestContentEncoding?: "identity" | "br" | "deflate" | "gzip" | "zstd" | "other";
  responseBytes?: number;
  completed?: boolean;
  cancelled?: boolean;
  terminalEventObserved?: boolean;
  responseObservationIncomplete?: boolean;
  cancelledAfterTerminalEvent?: boolean;
  responseStatus?: number;
  errorCategory?: "invalid_request" | "upstream_unavailable" | "upstream_timeout" | "client_disconnect" | "internal";
  requestStructure?: RequestStructure;
  requestStructureUnavailableReason?: RequestStructureUnavailableReason;
  exactItemRecurrence?: ExactItemRecurrenceRequest;
  usage?: ProviderUsage;
  timeline?: ContentFreeProviderTimeline;
}

export class MetricsStore {
  #recent: RequestMetric[] = [];
  #totalRequests = 0;
  #totalRequestBytes = 0;
  #nextObservationSequence = 0;
  #recordListeners = new Set<(metric: RequestMetric) => void>();

  /** Observe existing outcome records; does not add measurements or change snapshots. */
  subscribeRecords(listener: (metric: RequestMetric) => void): () => void {
    this.#recordListeners.add(listener);
    return () => { this.#recordListeners.delete(listener); };
  }

  nextObservationSequence(): number {
    this.#nextObservationSequence += 1;
    return this.#nextObservationSequence;
  }

  record(metric: RequestMetric): void {
    this.#totalRequests += 1;
    this.#totalRequestBytes += metric.requestBytes;
    this.#recent.unshift(metric);
    this.#recent.length = Math.min(this.#recent.length, 100);
    for (const listener of this.#recordListeners) {
      // Presentation/persistence failure must never change proxy outcome handling.
      try { listener(metric); } catch { /* The subscriber owns its availability. */ }
    }
  }

  snapshot(): object {
    return {
      totalRequests: this.#totalRequests,
      totalRequestBytes: this.#totalRequestBytes,
      recent: this.#recent,
      retention: "in-memory only; raw request and response bodies are never stored",
    };
  }
}
