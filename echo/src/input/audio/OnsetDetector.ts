/**
 * Detects short percussive sounds (claps, tongue clicks, knocks) hop by hop.
 * An onset fires when a hop is loud enough above the noise floor AND jumped by riseDb compared
 * with lookbackHops earlier. Slow attacks (a hum fading in) do not jump fast enough to fire.
 * The attack is only a candidate: it must decay quickly before an event is emitted. This keeps
 * abrupt hums, speech and sustained room-noise increases from firing sonar just because they start.
 */
export interface OnsetEvent {
  /** performance.now()-based time of the hop where the onset started. */
  timeMs: number;
  /** Highest hop peak (dBFS) minus the original noise floor, measured during attack/decay confirmation. */
  peakAboveDb: number;
}

export interface OnsetParams {
  minAboveFloorDb: number;
  riseDb: number;
  lookbackHops: number;
  peakHops: number;
  decayDb: number;
  decayHoldMs: number;
  maxDurationMs: number;
  minCrestDb: number;
  refractoryMs: number;
}

export class OnsetDetector {
  private readonly history: Float32Array;
  private histIdx = 0;
  /** Hops seen so far. No onsets until the lookback history is full (avoids a false onset at startup). */
  private seen = 0;
  private lastOnsetMs = -Infinity;
  private gateUntilMs = -Infinity;
  private pending: { timeMs: number; peakDb: number; peakLevelDb: number; floorDb: number; hopsLeft: number; decaySinceMs: number | null } | null = null;

  constructor(private readonly p: OnsetParams) {
    this.history = new Float32Array(p.lookbackHops).fill(-120);
  }

  /** Ignore onsets until this time (used when the game's own sounds leak from speakers into the mic). */
  gate(untilMs: number): void {
    this.gateUntilMs = Math.max(this.gateUntilMs, untilMs);
    this.pending = null;
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

    if (timeMs < this.gateUntilMs) return null;

    if (this.pending) {
      const p = this.pending;
      if (timeMs - p.timeMs > this.p.maxDurationMs) {
        this.pending = null;
        return null;
      }
      p.peakDb = Math.max(p.peakDb, peakDb);
      p.peakLevelDb = Math.max(p.peakLevelDb, levelDb);
      p.hopsLeft--;
      if (levelDb <= p.peakLevelDb - this.p.decayDb) p.decaySinceMs ??= timeMs;
      else p.decaySinceMs = null;
      if (p.hopsLeft <= 0 && p.decaySinceMs !== null && timeMs - p.decaySinceMs >= this.p.decayHoldMs) {
        this.pending = null;
        if (p.peakDb - p.peakLevelDb < this.p.minCrestDb) return null;
        return { timeMs: p.timeMs, peakAboveDb: p.peakDb - p.floorDb };
      }
      return null;
    }

    if (timeMs - this.lastOnsetMs < this.p.refractoryMs) return null;
    if (levelDb - floorDb < this.p.minAboveFloorDb) return null;
    if (levelDb - before < this.p.riseDb) return null;

    this.lastOnsetMs = timeMs;
    this.pending = { timeMs, peakDb, peakLevelDb: levelDb, floorDb, hopsLeft: this.p.peakHops, decaySinceMs: null };
    return null;
  }
}
