import { clamp } from './dsp';

/**
 * Adaptive noise floor = a low percentile of recent hop levels.
 * A percentile (not a mean) ignores short loud events such as claps, but still follows
 * a sustained change in room noise within ~windowSeconds. Callers stop pushing while
 * the player is humming so a long hum does not raise the floor.
 */
export class NoiseFloor {
  private readonly ring: Float32Array;
  private count = 0;
  private idx = 0;
  floorDb: number;

  constructor(
    capacityHops: number,
    private readonly percentile: number,
    initDb: number,
    private readonly minDb: number,
    private readonly maxDb: number,
  ) {
    this.ring = new Float32Array(Math.max(16, Math.floor(capacityHops)));
    this.floorDb = initDb;
  }

  push(levelDb: number): void {
    this.ring[this.idx] = levelDb;
    this.idx = (this.idx + 1) % this.ring.length;
    if (this.count < this.ring.length) this.count++;
  }

  /** Recomputes floorDb from the history. Call once per poll (not per hop). */
  recompute(): number {
    if (this.count < 16) return this.floorDb;
    const sorted = this.ring.slice(0, this.count).sort();
    const v = sorted[Math.floor(this.percentile * (this.count - 1))];
    this.floorDb = clamp(v, this.minDb, this.maxDb);
    return this.floorDb;
  }

  /** Forces the floor (calibration). Clears history so the forced value holds until new data arrives. */
  set(db: number): void {
    this.floorDb = clamp(db, this.minDb, this.maxDb);
    this.count = 0;
    this.idx = 0;
  }
}
