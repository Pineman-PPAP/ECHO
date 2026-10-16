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

  /** Share of the time (from 0.4 s into the hum) a soft hum is detected; `gateEvery` gates the mic like game sounds do. */
  function softHumOn(f0: number, aboveDb: number, breath: number, gateEvery: number | null = null): number {
    const sr = 48000;
    const signal = softHum(sr, f0, aboveDb, breath);
    const src = new FakeSource(sr, signal);
    const mic = new MicAnalyzer(src);
    let on = 0;
    let total = 0;
    for (let ms = 16; ms < 8000; ms += 16) {
      src.advance(16);
      if (gateEvery && ms > 2500 && Math.floor(ms / gateEvery) !== Math.floor((ms - 16) / gateEvery)) mic.gate(ms + 250);
      const f = mic.update(ms);
      if (ms >= 2400) {
        total++;
        if (f.humActive) on++;
      }
    }
    return on / total;
  }

  it.each([110, 150, 200, 250, 300])('catches a soft, breathy, wavering hum at %i Hz only ~8 dB over the room', (f0) => {
    expect(softHumOn(f0, 8, 0.3)).toBeGreaterThan(0.95);
  });

  it('a hum already going is held through the mic gates of game sounds', () => {
    expect(softHumOn(200, 8, 0.3, 600)).toBeGreaterThan(0.95);
  });

  it('loud broadband noise (wind, a fan, rustling) is not a hum', () => {
    const sr = 48000;
    const rand = mulberry32(5);
    const signal = new Float32Array(sr * 6);
    for (let i = 0; i < signal.length; i++) signal[i] = (rand() * 2 - 1) * (i > 2 * sr ? 0.03 : 0.003);
    const src = new FakeSource(sr, signal);
    const mic = new MicAnalyzer(src);
    let hum = false;
    for (let ms = 16; ms < 6000; ms += 16) {
      src.advance(16);
      hum ||= mic.update(ms).humActive;
    }
    expect(hum).toBe(false);
  });
});

/**
 * A quiet closed-mouth hum from 2 s to 8 s: fundamental plus two harmonics, aboveDb over a white-noise
 * room, with vibrato, slow pitch drift, a swelling level and breath noise (`breath` x the hum's amplitude).
 */
function softHum(sr: number, f0: number, aboveDb: number, breath: number): Float32Array {
  const rand = mulberry32(3);
  const x = new Float32Array(sr * 8);
  const room = 0.003;
  for (let i = 0; i < x.length; i++) x[i] = (rand() * 2 - 1) * room;
  const amp = (room / Math.sqrt(3)) * Math.pow(10, aboveDb / 20) * Math.SQRT2;
  let ph = 0;
  for (let i = 2 * sr; i < x.length; i++) {
    const t = i / sr;
    const f = f0 * (1 + 0.012 * Math.sin(2 * Math.PI * 4.5 * t) + 0.006 * Math.sin(2 * Math.PI * 0.7 * t));
    ph += (2 * Math.PI * f) / sr;
    const a = amp * (1 + 0.25 * Math.sin(2 * Math.PI * 1.3 * t)) * Math.min((t - 2) / 0.15, 1);
    x[i] += a * (0.8 * Math.sin(ph) + 0.45 * Math.sin(2 * ph) + 0.2 * Math.sin(3 * ph)) + a * breath * (rand() * 2 - 1);
  }
  return x;
}
