import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { MicAnalyzer, type SampleSource } from '../src/input/audio/MicAnalyzer';
import { mulberry32 } from '../src/game/rng';

/** Plays a pre-rendered signal; time advances in 128-sample render quanta like a real AudioContext. */
class FakeSource implements SampleSource {
  readonly bufferSize = 2048;
  /** Samples rendered so far (whole render quanta). */
  samples = 0;
  /** Exact (fractional) sample position of the wall clock. */
  private pos = 0;
  constructor(
    readonly sampleRate: number,
    private readonly signal: Float32Array,
  ) {}
  advance(ms: number): void {
    this.pos += (ms / 1000) * this.sampleRate;
    this.samples = Math.min(Math.floor(this.pos / 128) * 128, this.signal.length);
  }
  currentTime(): number {
    return this.samples / this.sampleRate;
  }
  read(into: Float32Array): void {
    for (let i = 0; i < into.length; i++) {
      const idx = this.samples - into.length + i;
      into[i] = idx >= 0 ? this.signal[idx] : 0;
    }
  }
}

function scene(sr: number): Float32Array {
  const rand = mulberry32(7);
  const n = sr * 5;
  const x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = (rand() * 2 - 1) * 0.003;
  for (const at of [1.0, 2.0]) {
    const s0 = Math.floor(at * sr);
    for (let i = 0; i < sr * 0.05; i++) x[s0 + i] += (rand() * 2 - 1) * 0.5 * Math.exp(-i / (sr * 0.006));
  }
  // Hum 3.0 s .. 4.2 s at 220 Hz with a soft 120 ms attack.
  const h0 = Math.floor(3.0 * sr);
  const h1 = Math.floor(4.2 * sr);
  for (let i = h0; i < h1; i++) {
    const t = (i - h0) / sr;
    const db = -70 + 55 * Math.min(t / 0.12, 1);
    x[i] += Math.pow(10, db / 20) * Math.sin(2 * Math.PI * 220 * t);
  }
  return x;
}

describe('MicAnalyzer (fake source)', () => {
  for (const sr of [44100, 48000]) {
    it(`rejects brief voiced bursts without losing a clap made during a hum at ${sr} Hz`, () => {
      const rand = mulberry32(92);
      const signal = new Float32Array(sr * 3);
      const clapAt = Math.floor(2.2 * sr);
      for (let i = 0; i < signal.length; i++) {
        const t = i / sr;
        signal[i] = (rand() * 2 - 1) * 0.002;
        if (t >= 0.5 && t < 0.55) signal[i] += 0.3 * Math.sin(2 * Math.PI * 130 * t);
        if (t >= 1.5 && t < 2.8) signal[i] += 0.05 * Math.sin(2 * Math.PI * 220 * t);
        if (i >= clapAt && i < clapAt + sr * 0.05) {
          signal[i] += (rand() * 2 - 1) * 0.6 * Math.exp(-(i - clapAt) / (sr * 0.006));
        }
      }
      const src = new FakeSource(sr, signal);
      const mic = new MicAnalyzer(src);
      const events = [];
      while (src.samples < signal.length - src.bufferSize) {
        src.advance(16.7);
        events.push(...mic.update((src.samples / sr) * 1000).onsets);
      }
      expect(events).toHaveLength(1);
      expect(Math.abs(events[0].timeMs - 2200)).toBeLessThan(12);
    });
    it(`keeps abrupt hum starts and sustained background bursts from firing sonar at ${sr} Hz`, () => {
      const rand = mulberry32(91);
      const signal = new Float32Array(sr * 4);
      for (let i = 0; i < signal.length; i++) {
        const t = i / sr;
        signal[i] = (rand() * 2 - 1) * 0.002;
        if (t >= 0.5 && t < 1.25) signal[i] += 0.3 * Math.sin(2 * Math.PI * 130 * t);
        if (t >= 2 && t < 2.8) signal[i] += (rand() * 2 - 1) * 0.15;
      }
      const src = new FakeSource(sr, signal);
      const mic = new MicAnalyzer(src);
      const events = [];
      let humDetected = false;
      while (src.samples < signal.length - src.bufferSize) {
        src.advance(16.7);
        const frame = mic.update((src.samples / sr) * 1000);
        events.push(...frame.onsets);
        humDetected ||= frame.humActive;
      }
      expect(events).toHaveLength(0);
      expect(humDetected).toBe(true);
    });
  }
  for (const sr of [44100, 48000]) {
    it(`finds both claps and the hum at ${sr} Hz, even with irregular frame times`, () => {
      const src = new FakeSource(sr, scene(sr));
      const mic = new MicAnalyzer(src);
      const rand = mulberry32(8);
      const onsetTimes: number[] = [];
      let humOnAt = -1;
      let humOffAt = -1;
      const pitches: number[] = [];
      while (src.samples < sr * 5 - 2048) {
        src.advance(rand() < 0.1 ? 45 : 16.7); // occasional 45 ms stall
        const now = (src.samples / sr) * 1000;
        const f = mic.update(now);
        for (const o of f.onsets) onsetTimes.push(o.timeMs);
        if (f.humActive && humOnAt < 0) humOnAt = now;
        if (!f.humActive && humOnAt >= 0 && humOffAt < 0) humOffAt = now;
        if (f.humActive) pitches.push(f.humPitchHz);
      }
      expect(onsetTimes).toHaveLength(2);
      expect(Math.abs(onsetTimes[0] - 1000)).toBeLessThan(12);
      expect(Math.abs(onsetTimes[1] - 2000)).toBeLessThan(12);
      expect(humOnAt).toBeGreaterThan(3000);
      expect(humOnAt).toBeLessThan(3000 + 120 + CONFIG.HUM_ATTACK_MS + 100);
      expect(humOffAt).toBeGreaterThan(4200);
      expect(humOffAt).toBeLessThan(4200 + CONFIG.HUM_RELEASE_MS + 100);
      const avg = pitches.reduce((a, b) => a + b, 0) / pitches.length;
      expect(Math.abs(avg - 220)).toBeLessThan(3);
    });
  }
  it('gate() suppresses onsets and hums', () => {
    const sr = 48000;
    const src = new FakeSource(sr, scene(sr));
    const mic = new MicAnalyzer(src);
    mic.gate(10_000);
    let onsets = 0;
    let hum = false;
    while (src.samples < sr * 5 - 2048) {
      src.advance(16.7);
      const f = mic.update((src.samples / sr) * 1000);
      onsets += f.onsets.length;
      hum ||= f.humActive;
    }
    expect(onsets).toBe(0);
    expect(hum).toBe(false);
  });
});
