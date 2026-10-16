/**
 * Decides whether the player is humming (a steady voiced note) from per-poll pitch estimates.
 * Debounced: needs attackMs of continuous evidence to turn on and releaseMs of absence to turn off.
 * "Steady" = the spread (max - min, in octaves) of the last historySize pitches stays small,
 * which rejects most speech (pitch glides) while accepting a held hum or whistle.
 */
export interface HumParams {
  minAboveFloorDb: number;
  maxAperiodicity: number;
  minHz: number;
  maxHz: number;
  attackMs: number;
  releaseMs: number;
  maxPitchSpreadOct: number;
  historySize: number;
}

export class HumDetector {
  active = false;
  /** Median of recent voiced pitches (Hz); 0 when nothing voiced yet. */
  pitchHz = 0;
  private candidateSinceMs: number | null = null;
  private lastCandidateMs = -Infinity;
  private readonly pitches: number[] = [];

  constructor(private readonly p: HumParams) {}

  /**
   * Call once per mic poll.
   * @param aboveDb level above noise floor (dB)
   * @param pitch YIN result, or null when no pitch was computed this poll. The mic pipeline only
   *   computes pitch when aboveDb >= minAboveFloorDb and PITCH_INTERVAL_MS has passed, so
   *   "null while loud" means "no new evidence": the current state is kept unchanged.
   */
  update(timeMs: number, aboveDb: number, pitch: { hz: number; aperiodicity: number } | null): boolean {
    const loud = aboveDb >= this.p.minAboveFloorDb;
    if (pitch === null && loud) return this.active;

    const voiced =
      pitch !== null &&
      loud &&
      pitch.aperiodicity <= this.p.maxAperiodicity &&
      pitch.hz >= this.p.minHz &&
      pitch.hz <= this.p.maxHz;

    if (voiced) {
      this.pitches.push(pitch.hz);
      if (this.pitches.length > this.p.historySize) this.pitches.shift();
    } else {
      // Silence or an unvoiced frame breaks the steadiness history.
      this.pitches.length = 0;
    }

    const steady = voiced && this.isSteady();
    if (steady) {
      this.lastCandidateMs = timeMs;
      if (this.candidateSinceMs === null) this.candidateSinceMs = timeMs;
      this.pitchHz = median(this.pitches);
      if (!this.active && timeMs - this.candidateSinceMs >= this.p.attackMs) this.active = true;
    } else {
      this.candidateSinceMs = null;
      if (this.active && timeMs - this.lastCandidateMs >= this.p.releaseMs) this.active = false;
    }
    return this.active;
  }

  private isSteady(): boolean {
    if (this.pitches.length < 2) return false;
    let lo = Infinity;
    let hi = -Infinity;
    for (const hz of this.pitches) {
      const o = Math.log2(hz);
      if (o < lo) lo = o;
      if (o > hi) hi = o;
    }
    return hi - lo <= this.p.maxPitchSpreadOct;
  }
}

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
