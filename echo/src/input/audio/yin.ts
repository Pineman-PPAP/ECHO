/**
 * YIN fundamental-frequency estimator (de Cheveigné & Kawahara, 2002).
 * Steps implemented: difference function, cumulative-mean-normalised difference (CMNDF),
 * absolute threshold, parabolic interpolation.
 */
export interface PitchResult {
  hz: number;
  /** CMNDF value at the chosen lag. 0 = perfectly periodic, ~1 = noise. */
  aperiodicity: number;
}

export class Yin {
  readonly windowSize: number;
  readonly tauMin: number;
  readonly tauMax: number;
  private readonly d: Float32Array;

  constructor(
    private readonly sampleRate: number,
    windowSeconds: number,
    minHz: number,
    maxHz: number,
    private readonly threshold: number,
  ) {
    this.windowSize = Math.round(sampleRate * windowSeconds);
    this.tauMax = Math.ceil(sampleRate / minHz);
    this.tauMin = Math.max(2, Math.floor(sampleRate / maxHz));
    this.d = new Float32Array(this.tauMax + 2);
  }

  /** Number of trailing samples detect() needs. Size the AnalyserNode so fftSize >= this. */
  requiredSamples(): number {
    return this.windowSize + this.tauMax + 2;
  }

  /** Estimates pitch from the LAST requiredSamples() samples of buf. Returns null if buf is too short. */
  detect(buf: Float32Array): PitchResult | null {
    const n = this.requiredSamples();
    if (buf.length < n) return null;
    const start = buf.length - n;
    const w = this.windowSize;
    const d = this.d;
    const tauMax = this.tauMax;

    // 1. Difference function d(tau) = sum_j (x_j - x_{j+tau})^2
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      let sum = 0;
      for (let j = 0; j < w; j++) {
        const delta = buf[start + j] - buf[start + j + tau];
        sum += delta * delta;
      }
      d[tau] = sum;
    }

    // 2. CMNDF d'(tau) = d(tau) * tau / sum_{k=1..tau} d(k);  d'(0) = 1
    d[0] = 1;
    let running = 0;
    for (let tau = 1; tau <= tauMax + 1; tau++) {
      running += d[tau];
      d[tau] = running > 0 ? (d[tau] * tau) / running : 1;
    }

    // 3. First lag below threshold, then walk down to the local minimum.
    let tauEst = -1;
    for (let tau = this.tauMin; tau <= tauMax; tau++) {
      if (d[tau] < this.threshold) {
        while (tau + 1 <= tauMax && d[tau + 1] < d[tau]) tau++;
        tauEst = tau;
        break;
      }
    }
    // No dip below threshold: report the global minimum; caller rejects it via aperiodicity.
    if (tauEst === -1) {
      tauEst = this.tauMin;
      for (let tau = this.tauMin + 1; tau <= tauMax; tau++) if (d[tau] < d[tauEst]) tauEst = tau;
    }

    // 4. Parabolic interpolation around tauEst for sub-sample accuracy.
    const s0 = d[tauEst - 1];
    const s1 = d[tauEst];
    const s2 = d[tauEst + 1];
    const denom = s0 + s2 - 2 * s1;
    let shift = denom !== 0 ? (0.5 * (s0 - s2)) / denom : 0;
    if (shift > 1 || shift < -1) shift = 0;
    return { hz: this.sampleRate / (tauEst + shift), aperiodicity: s1 };
  }
}
