/**
 * Detects sharp sound onsets (claps, tongue clicks, knocks, the start of a shout) hop by hop.
 * An onset fires when a hop is loud enough above the noise floor AND jumped by riseDb compared
 * with lookbackHops earlier. Slow attacks (a hum fading in) do not jump fast enough to fire.
 * The event is emitted peakHops later so its peak loudness can be measured.
 */
export interface OnsetEvent {
  /** performance.now()-based time of the hop where the onset started. */
  timeMs: number;
  /** Highest hop peak (dBFS) minus noise floor, measured over the onset hop + peakHops after it. */
  peakAboveDb: number;
}

export interface OnsetParams {
  minAboveFloorDb: number;
  riseDb: number;
  lookbackHops: number;
  peakHops: number;
  refractoryMs: number;
}

export class OnsetDetector {
  private readonly history: Float32Array;
  private histIdx = 0;
  /** Hops seen so far. No onsets until the lookback history is full (avoids a false onset at startup). */
  private seen = 0;
  private lastOnsetMs = -Infinity;
  private gateUntilMs = -Infinity;
  private pending: { timeMs: number; peakDb: number; floorDb: number; hopsLeft: number } | null = null;

  constructor(private readonly p: OnsetParams) {
    this.history = new Float32Array(p.lookbackHops).fill(-120);
  }

  /** Ignore onsets until this time (used when the game's own sounds leak from speakers into the mic). */
  gate(untilMs: number): void {
    this.gateUntilMs = Math.max(this.gateUntilMs, untilMs);
  }

  /**
   * Feed one hop, oldest first.
   * @param levelDb hop RMS in dBFS   @param peakDb hop peak in dBFS   @param floorDb current noise floor
   */
  processHop(levelDb: number, peakDb: number, floorDb: number, timeMs: number): OnsetEvent | null {
    const before = this.history[this.histIdx]; // level exactly lookbackHops hops ago
    this.history[this.histIdx] = levelDb;
    this.histIdx = (this.histIdx + 1) % this.history.length;
    if (this.seen <= this.p.lookbackHops) {
      this.seen++;
      return null;
    }

    if (this.pending) {
      if (peakDb > this.pending.peakDb) this.pending.peakDb = peakDb;
      this.pending.hopsLeft--;
      if (this.pending.hopsLeft <= 0) {
        const ev: OnsetEvent = { timeMs: this.pending.timeMs, peakAboveDb: this.pending.peakDb - this.pending.floorDb };
        this.pending = null;
        return ev;
      }
      return null;
    }

    if (timeMs < this.gateUntilMs) return null;
    if (timeMs - this.lastOnsetMs < this.p.refractoryMs) return null;
    if (levelDb - floorDb < this.p.minAboveFloorDb) return null;
    if (levelDb - before < this.p.riseDb) return null;

    this.lastOnsetMs = timeMs;
    this.pending = { timeMs, peakDb, floorDb, hopsLeft: this.p.peakHops };
    if (this.p.peakHops <= 0) {
      const ev: OnsetEvent = { timeMs, peakAboveDb: peakDb - floorDb };
      this.pending = null;
      return ev;
    }
    return null;
  }
}
