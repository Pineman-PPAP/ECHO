/**
 * One-Euro filter (Casiez et al., CHI 2012): smooths jitter when the signal is slow,
 * follows quickly when the signal moves fast. Used for head yaw and lean.
 */
export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
    private readonly dCutoff: number,
  ) {}

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
  }

  /** @param x raw value  @param tSec timestamp in seconds (monotonic) */
  filter(x: number, tSec: number): number {
    if (this.xPrev === null) {
      this.xPrev = x;
      this.tPrev = tSec;
      return x;
    }
    const dt = Math.max(tSec - this.tPrev, 1e-3);
    this.tPrev = tSec;
    const aD = smoothingFactor(dt, this.dCutoff);
    const dx = (x - this.xPrev) / dt;
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.minCutoff + this.beta * Math.abs(dxHat);
    const a = smoothingFactor(dt, cutoff);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    return xHat;
  }
}

function smoothingFactor(dt: number, cutoff: number): number {
  const r = 2 * Math.PI * cutoff * dt;
  return r / (r + 1);
}
