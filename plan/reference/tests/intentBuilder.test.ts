import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { defaultCalibration } from '../src/input/calibration';
import { IntentBuilder } from '../src/input/IntentBuilder';
import { faceFrame, micFrame } from './helpers';

describe('IntentBuilder', () => {
  it('maps head yaw (with calibrated sign) to turning and lean to walking', () => {
    const calib = { ...defaultCalibration(), neutralYawDeg: 5, leftSign: -1 as const, neutralDepth: 50 };
    const ib = new IntentBuilder(calib);
    let it0 = ib.update(0, faceFrame(0, { yaw: 5, depth: 50 }), micFrame());
    expect(it0.turnRate).toBe(0);
    expect(it0.moveSpeed).toBe(0);
    for (let t = 33; t < 1500; t += 33) it0 = ib.update(t, faceFrame(t, { yaw: 5 - 30, depth: 38 }), micFrame());
    expect(ib.relYawLeftDeg).toBeGreaterThan(25);
    expect(it0.turnRate).toBeCloseTo((CONFIG.MAX_TURN_RATE_DEG * Math.PI) / 180, 1);
    expect(it0.moveSpeed).toBeCloseTo(CONFIG.MAX_SPEED_FWD, 1);
  });
  it('reports eyes closed with duration, and loses the face after FACE_LOST_PAUSE_MS', () => {
    const ib = new IntentBuilder(defaultCalibration());
    ib.update(0, faceFrame(0, { blink: 0.9 }), null);
    expect(ib.update(200, faceFrame(200, { blink: 0.9 }), null).eyesClosedMs).toBe(200);
    const lost = ib.update(200 + CONFIG.FACE_LOST_PAUSE_MS + 1, null, null);
    expect(lost.facePresent).toBe(false);
    expect(lost.eyesClosed).toBe(false);
    expect(lost.moveSpeed).toBe(0);
  });
  it('turns onsets into pulses and hums into a beam (humStarted only once)', () => {
    const ib = new IntentBuilder(defaultCalibration());
    const a = ib.update(0, null, micFrame({ onsets: [{ timeMs: 0, peakAboveDb: CONFIG.CLAP_REF_ABOVE_DB_DEFAULT }] }));
    expect(a.pulses).toHaveLength(1);
    expect(a.pulses[0]).toBeCloseTo(1);
    const h1 = ib.update(16, null, micFrame({ humActive: true, aboveDb: 30, humPitchHz: 220 }));
    const h2 = ib.update(32, null, micFrame({ humActive: true, aboveDb: 30, humPitchHz: 220 }));
    expect(h1.beam).not.toBeNull();
    expect(h1.humStarted).toBe(true);
    expect(h2.humStarted).toBe(false);
  });
});
