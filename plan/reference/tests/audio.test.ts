import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { ampToDb, rmsAndPeak } from '../src/input/audio/dsp';
import { HumDetector } from '../src/input/audio/HumDetector';
import { NoiseFloor } from '../src/input/audio/NoiseFloor';
import { OnsetDetector } from '../src/input/audio/OnsetDetector';
import { Yin } from '../src/input/audio/yin';
import { mulberry32 } from '../src/game/rng';

const SR = 48000;

function sine(hz: number, n: number, sr = SR, amp = 0.3): Float32Array {
  const b = new Float32Array(n);
  for (let i = 0; i < n; i++) b[i] = amp * Math.sin((2 * Math.PI * hz * i) / sr);
  return b;
}

function onsetParams() {
  return {
    minAboveFloorDb: CONFIG.ONSET_MIN_ABOVE_FLOOR_DB,
    riseDb: CONFIG.ONSET_RISE_DB,
    lookbackHops: CONFIG.ONSET_LOOKBACK_HOPS,
    peakHops: CONFIG.ONSET_PEAK_HOPS,
    refractoryMs: CONFIG.ONSET_REFRACTORY_MS,
  };
}

describe('dsp', () => {
  it('ampToDb never returns -Infinity', () => {
    expect(ampToDb(0)).toBe(-120);
    expect(ampToDb(1)).toBeCloseTo(0);
    expect(ampToDb(0.1)).toBeCloseTo(-20);
  });
  it('rmsAndPeak of a full-scale sine', () => {
    const { rms, peak } = rmsAndPeak(sine(1000, 4800, SR, 1), 0, 4800);
    expect(rms).toBeCloseTo(Math.SQRT1_2, 2);
    expect(peak).toBeCloseTo(1, 2);
  });
});

describe('Yin', () => {
  for (const sr of [44100, 48000]) {
    for (const hz of [110, 220, 440, 880]) {
      it(`detects ${hz} Hz at ${sr} Hz sample rate within 1%`, () => {
        const yin = new Yin(sr, CONFIG.YIN_WINDOW_S, CONFIG.YIN_MIN_HZ, CONFIG.YIN_MAX_HZ, CONFIG.YIN_THRESHOLD);
        const res = yin.detect(sine(hz, 4096, sr))!;
        expect(res).not.toBeNull();
        expect(Math.abs(res.hz - hz) / hz).toBeLessThan(0.01);
        expect(res.aperiodicity).toBeLessThan(CONFIG.YIN_MAX_APERIODICITY);
      });
    }
  }
  it('reports white noise as aperiodic', () => {
    const rand = mulberry32(1);
    const b = new Float32Array(4096).map(() => rand() * 2 - 1);
    const yin = new Yin(SR, CONFIG.YIN_WINDOW_S, CONFIG.YIN_MIN_HZ, CONFIG.YIN_MAX_HZ, CONFIG.YIN_THRESHOLD);
    expect(yin.detect(b)!.aperiodicity).toBeGreaterThan(CONFIG.YIN_MAX_APERIODICITY);
  });
  it('reports silence as aperiodic', () => {
    const yin = new Yin(SR, CONFIG.YIN_WINDOW_S, CONFIG.YIN_MIN_HZ, CONFIG.YIN_MAX_HZ, CONFIG.YIN_THRESHOLD);
    expect(yin.detect(new Float32Array(4096))!.aperiodicity).toBeGreaterThan(CONFIG.YIN_MAX_APERIODICITY);
  });
  it('returns null when the buffer is too short', () => {
    const yin = new Yin(SR, CONFIG.YIN_WINDOW_S, CONFIG.YIN_MIN_HZ, CONFIG.YIN_MAX_HZ, CONFIG.YIN_THRESHOLD);
    expect(yin.detect(new Float32Array(100))).toBeNull();
    expect(yin.requiredSamples()).toBeLessThanOrEqual(CONFIG.MIN_FFT_SIZE);
  });
});

describe('NoiseFloor', () => {
  const make = () => new NoiseFloor(1125, CONFIG.FLOOR_PERCENTILE, CONFIG.FLOOR_INIT_DB, CONFIG.FLOOR_MIN_DB, CONFIG.FLOOR_MAX_DB);
  it('tracks steady noise and ignores short loud claps', () => {
    const nf = make();
    const rand = mulberry32(2);
    for (let i = 0; i < 1125; i++) nf.push(-55 + (rand() - 0.5) * 4 + (i % 200 < 10 ? 45 : 0));
    nf.recompute();
    expect(nf.floorDb).toBeGreaterThan(-58);
    expect(nf.floorDb).toBeLessThan(-54);
  });
  it('rises to a sustained louder room within the window', () => {
    const nf = make();
    for (let i = 0; i < 1125; i++) nf.push(-60);
    for (let i = 0; i < 1125; i++) nf.push(-40);
    nf.recompute();
    expect(nf.floorDb).toBeCloseTo(-40);
  });
  it('set() forces and clamps the floor', () => {
    const nf = make();
    nf.set(-500);
    expect(nf.floorDb).toBe(CONFIG.FLOOR_MIN_DB);
    expect(nf.recompute()).toBe(CONFIG.FLOOR_MIN_DB); // not enough history yet -> unchanged
  });
});

describe('OnsetDetector', () => {
  const hopMs = (CONFIG.HOP_SIZE / SR) * 1000;
  it('fires exactly once for a clap and measures its peak after ONSET_PEAK_HOPS', () => {
    const od = new OnsetDetector(onsetParams());
    const events = [];
    let t = 0;
    for (let i = 0; i < 100; i++) expect(od.processHop(-60, -55, -60, (t += hopMs))).toBeNull();
    const levels = [-30, -18, -22, -28, -34, -40, -46, -52, -58, -60];
    const peaks = [-25, -10, -14, -20, -26, -32, -38, -44, -50, -55];
    let firedAtHop = -1;
    for (let i = 0; i < levels.length; i++) {
      const ev = od.processHop(levels[i], peaks[i], -60, (t += hopMs));
      if (ev) {
        events.push(ev);
        firedAtHop = i;
      }
    }
    expect(events).toHaveLength(1);
    expect(firedAtHop).toBe(CONFIG.ONSET_PEAK_HOPS);
    expect(events[0].peakAboveDb).toBeCloseTo(50); // -10 peak - (-60) floor
  });
  it('ignores a hum fading in slowly', () => {
    const od = new OnsetDetector(onsetParams());
    let t = 0;
    for (let i = 0; i < 100; i++) od.processHop(-60, -55, -60, (t += hopMs));
    for (let i = 0; i < 60; i++) expect(od.processHop(-60 + i * 0.7, -55 + i * 0.7, -60, (t += hopMs))).toBeNull();
  });
  it('respects the refractory period and the gate', () => {
    const od = new OnsetDetector(onsetParams());
    const clapAt = (start: number) => {
      let n = 0;
      for (let i = 0; i < 10; i++) if (od.processHop(i === 0 ? -20 : -60, i === 0 ? -12 : -55, -60, start + i * hopMs)) n++;
      return n;
    };
    let t = 0;
    for (let i = 0; i < 20; i++) od.processHop(-60, -55, -60, (t += hopMs));
    expect(clapAt(1000)).toBe(1);
    expect(clapAt(1000 + CONFIG.ONSET_REFRACTORY_MS / 2)).toBe(0);
    expect(clapAt(1000 + CONFIG.ONSET_REFRACTORY_MS * 2)).toBe(1);
    od.gate(5000);
    expect(clapAt(4000)).toBe(0);
    expect(clapAt(6000)).toBe(1);
  });
  it('end to end on raw samples: noise + two claps => two onsets, a hum fading in => none', () => {
    const rand = mulberry32(3);
    const n = SR * 2;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (rand() * 2 - 1) * 0.002; // ~ -57 dBFS noise
    for (const at of [0.5, 1.2]) {
      const s0 = Math.floor(at * SR);
      for (let i = 0; i < 2400; i++) x[s0 + i] += (rand() * 2 - 1) * 0.6 * Math.exp(-i / 300);
    }
    const od = new OnsetDetector(onsetParams());
    const hop = CONFIG.HOP_SIZE;
    let onsets = 0;
    for (let h = 0; h + hop <= n; h += hop) {
      const { rms, peak } = rmsAndPeak(x, h, hop);
      if (od.processHop(ampToDb(rms), ampToDb(peak), -57, (h / SR) * 1000)) onsets++;
    }
    expect(onsets).toBe(2);

    const hum = new Float32Array(n);
    // Realistic hum attack: level rises linearly in dB (-80 dBFS -> -14 dBFS over 120 ms).
    for (let i = 0; i < n; i++) {
      const db = -80 + 66 * Math.min(i / (0.12 * SR), 1);
      hum[i] = (rand() * 2 - 1) * 0.002 + Math.pow(10, db / 20) * Math.SQRT2 * Math.sin((2 * Math.PI * 200 * i) / SR);
    }
    const od2 = new OnsetDetector(onsetParams());
    let humOnsets = 0;
    for (let h = 0; h + hop <= n; h += hop) {
      const { rms, peak } = rmsAndPeak(hum, h, hop);
      if (od2.processHop(ampToDb(rms), ampToDb(peak), -57, (h / SR) * 1000)) humOnsets++;
    }
    expect(humOnsets).toBe(0);
  });
});

describe('OnsetDetector in a noisy room', () => {
  it('still catches a soft clap and a tongue click 20+ dB above a -43 dBFS floor', () => {
    const rand = mulberry32(6);
    const n = SR;
    const x = new Float32Array(n);
    for (let i = 0; i < n; i++) x[i] = (rand() * 2 - 1) * 0.012; // ~ -43 dBFS room noise
    const clap = Math.floor(0.3 * SR);
    for (let i = 0; i < 1500; i++) x[clap + i] += (rand() * 2 - 1) * 0.12 * Math.exp(-i / 250);
    const click = Math.floor(0.7 * SR);
    for (let i = 0; i < 240; i++) x[click + i] += 0.25 * Math.sin((2 * Math.PI * 2500 * i) / SR) * Math.exp(-i / 60);
    const nf = new NoiseFloor(1125, CONFIG.FLOOR_PERCENTILE, CONFIG.FLOOR_INIT_DB, CONFIG.FLOOR_MIN_DB, CONFIG.FLOOR_MAX_DB);
    const od = new OnsetDetector(onsetParams());
    const hop = CONFIG.HOP_SIZE;
    const times: number[] = [];
    for (let h = 0; h + hop <= n; h += hop) {
      const { rms, peak } = rmsAndPeak(x, h, hop);
      const lv = ampToDb(rms);
      nf.push(lv);
      if (h % (hop * 6) === 0) nf.recompute(); // ~every 16 ms, like one poll per frame
      const ev = od.processHop(lv, ampToDb(peak), nf.floorDb, (h / SR) * 1000);
      if (ev) times.push(ev.timeMs);
    }
    expect(times).toHaveLength(2);
    expect(Math.abs(times[0] - 300)).toBeLessThan(10);
    expect(Math.abs(times[1] - 700)).toBeLessThan(10);
  });
});

describe('HumDetector', () => {
  const params = {
    minAboveFloorDb: CONFIG.HUM_MIN_ABOVE_FLOOR_DB,
    maxAperiodicity: CONFIG.YIN_MAX_APERIODICITY,
    minHz: CONFIG.YIN_MIN_HZ,
    maxHz: CONFIG.YIN_MAX_HZ,
    attackMs: CONFIG.HUM_ATTACK_MS,
    releaseMs: CONFIG.HUM_RELEASE_MS,
    maxPitchSpreadOct: CONFIG.HUM_MAX_PITCH_SPREAD_OCT,
    historySize: CONFIG.HUM_PITCH_HISTORY,
  };
  it('turns on after the attack time for a steady hum (pitch every other poll) and off after release', () => {
    const hd = new HumDetector(params);
    let t = 0;
    let onAt = -1;
    for (let i = 0; i < 30; i++) {
      t += 16;
      const pitch = i % 2 === 0 ? { hz: 220 + (i % 3), aperiodicity: 0.05 } : null;
      if (hd.update(t, 25, pitch) && onAt < 0) onAt = t;
    }
    expect(onAt).toBeGreaterThanOrEqual(CONFIG.HUM_ATTACK_MS);
    expect(onAt).toBeLessThan(CONFIG.HUM_ATTACK_MS + 80);
    expect(hd.pitchHz).toBeGreaterThan(215);
    // Release is measured from the last steady pitch, which can be up to two polls before silence starts.
    let offAt = -1;
    const silenceStart = t;
    for (let i = 0; i < 30; i++) {
      t += 16;
      if (!hd.update(t, 2, null) && offAt < 0) offAt = t;
    }
    expect(offAt - silenceStart).toBeGreaterThanOrEqual(CONFIG.HUM_RELEASE_MS - 32);
    expect(offAt - silenceStart).toBeLessThan(CONFIG.HUM_RELEASE_MS + 40);
  });
  it('rejects a speech-like pitch glide', () => {
    const hd = new HumDetector(params);
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t += 30;
      const hz = 180 * Math.pow(2, (i * 30) / 300 / 1.5); // ~0.67 octave per 300 ms
      expect(hd.update(t, 25, { hz, aperiodicity: 0.05 })).toBe(false);
    }
  });
  it('rejects quiet or noisy input', () => {
    const hd = new HumDetector(params);
    let t = 0;
    for (let i = 0; i < 40; i++) {
      t += 30;
      expect(hd.update(t, 5, { hz: 220, aperiodicity: 0.05 })).toBe(false);
      expect(hd.update((t += 1), 25, { hz: 220, aperiodicity: 0.6 })).toBe(false);
    }
  });
});
