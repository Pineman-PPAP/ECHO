/** Small DSP helpers shared by the mic pipeline. All pure. */

/** Converts linear amplitude (RMS or peak) to dBFS. Silence maps to -120 dB, never -Infinity. */
export function ampToDb(amp: number): number {
  return 20 * Math.log10(Math.max(amp, 1e-6));
}

/** RMS and absolute peak of buf[start, start + length). */
export function rmsAndPeak(buf: Float32Array, start: number, length: number): { rms: number; peak: number } {
  let sum = 0;
  let peak = 0;
  const end = start + length;
  for (let i = start; i < end; i++) {
    const v = buf[i];
    sum += v * v;
    const a = v < 0 ? -v : v;
    if (a > peak) peak = a;
  }
  return { rms: Math.sqrt(sum / length), peak };
}

export function nextPow2(n: number): number {
  let p = 1;
  while (p < n) p <<= 1;
  return p;
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
