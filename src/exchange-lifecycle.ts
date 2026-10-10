export type ExchangeLifecycleUnavailableReason =
  | "overflow"
  | "invalid_transition"
  | "callback_rejection";

export interface ExchangeLifecycleSnapshot {
  admitted: number | null;
  active: number | null;
  forwarding: number | null;
  finalized: number | null;
  availability: "AVAILABLE" | "UNAVAILABLE";
  incomplete: boolean;
  unavailableReason: ExchangeLifecycleUnavailableReason | null;
}

/** Fixed process-local counters for supported exchange callback lifecycles. */
export class ExchangeLifecycle {
  private admitted = 0;
  private active = 0;
  private forwarding = 0;
  private finalized = 0;
  private unavailableReason: ExchangeLifecycleUnavailableReason | null = null;

  admit(): void {
    if (!this.isAvailable()) return;
    const admitted = this.increment(this.admitted);
    const active = this.increment(this.active);
    if (admitted === undefined || active === undefined) {
      this.invalidate("overflow");
      return;
    }
    this.admitted = admitted;
    this.active = active;
    this.checkInvariant();
  }

  forward(): void {
    if (!this.isAvailable()) return;
    if (this.active <= 0 || this.forwarding >= this.admitted) {
      this.invalidate("invalid_transition");
      return;
    }
    const forwarding = this.increment(this.forwarding);
    if (forwarding === undefined) {
      this.invalidate("overflow");
      return;
    }
    this.forwarding = forwarding;
    this.checkInvariant();
  }

  finalize(): void {
    if (!this.isAvailable()) return;
    if (this.active <= 0) {
      this.invalidate("invalid_transition");
      return;
    }
    const finalized = this.increment(this.finalized);
    if (finalized === undefined) {
      this.invalidate("overflow");
      return;
    }
    this.active -= 1;
    this.finalized = finalized;
    this.checkInvariant();
  }

  invalidate(reason: ExchangeLifecycleUnavailableReason = "invalid_transition"): void {
    this.unavailableReason ??= reason;
  }

  snapshot(): ExchangeLifecycleSnapshot {
    const available = this.isAvailable();
    return {
      admitted: available ? this.admitted : null,
      active: available ? this.active : null,
      forwarding: available ? this.forwarding : null,
      finalized: available ? this.finalized : null,
      availability: available ? "AVAILABLE" : "UNAVAILABLE",
      incomplete: !available,
      unavailableReason: this.unavailableReason,
    };
  }

  private increment(value: number): number | undefined {
    if (!Number.isSafeInteger(value) || value < 0) return undefined;
    if (value >= Number.MAX_SAFE_INTEGER) return undefined;
    return value + 1;
  }

  private isAvailable(): boolean {
    this.checkInvariant();
    return this.unavailableReason === null;
  }

  private checkInvariant(): void {
    if (
      !Number.isSafeInteger(this.admitted)
      || !Number.isSafeInteger(this.active)
      || !Number.isSafeInteger(this.forwarding)
      || !Number.isSafeInteger(this.finalized)
      || this.admitted < 0
      || this.active < 0
      || this.forwarding < 0
      || this.finalized < 0
      || this.forwarding > this.admitted
      || this.admitted !== this.active + this.finalized
    ) {
      this.invalidate("invalid_transition");
    }
  }
}
