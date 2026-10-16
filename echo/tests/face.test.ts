import { Euler, Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { EyeState, blinkThresholdsFromCalibration } from '../src/input/face/EyeState';
import { blinkScore, headPoseFromMatrix } from '../src/input/face/faceMath';
import { OneEuroFilter } from '../src/input/filters/OneEuro';
import { mulberry32 } from '../src/game/rng';

describe('headPoseFromMatrix', () => {
  it('recovers yaw, pitch and depth from a column-major matrix', () => {
    const m = new Matrix4().compose(
      new Vector3(2, -1, -48),
      new Quaternion().setFromEuler(new Euler((10 * Math.PI) / 180, (25 * Math.PI) / 180, 0, 'YXZ')),
      new Vector3(1, 1, 1),
    );
    const pose = headPoseFromMatrix(m.elements);
    expect(pose.yawDeg).toBeCloseTo(25, 3);
    expect(pose.pitchDeg).toBeCloseTo(10, 3);
    expect(pose.depth).toBeCloseTo(48, 3);
  });
});

describe('blinkScore', () => {
  it('averages the two eyes and tolerates missing categories', () => {
    expect(
      blinkScore([
        { categoryName: '_neutral', score: 0 },
        { categoryName: 'eyeBlinkLeft', score: 0.8 },
        { categoryName: 'eyeBlinkRight', score: 0.6 },
      ]).mean,
    ).toBeCloseTo(0.7);
    expect(blinkScore([]).mean).toBe(0);
  });
});

describe('EyeState', () => {
  it('uses hysteresis and counts blinks with duration', () => {
    const e = new EyeState(0.5, 0.3);
    e.update(0, 0.1);
    expect(e.closed).toBe(false);
    e.update(33, 0.6);
    expect(e.closed).toBe(true);
    e.update(66, 0.4); // between thresholds: still closed
    expect(e.closed).toBe(true);
    expect(e.closedForMs(100)).toBe(67);
    e.update(200, 0.2);
    expect(e.closed).toBe(false);
    expect(e.blinkCount).toBe(1);
    expect(e.lastBlinkDurationMs).toBe(167);
    expect(e.closedForMs(300)).toBe(0);
  });
  it('derives thresholds from calibration and rejects a too-small range', () => {
    const th = blinkThresholdsFromCalibration(0.1, 0.8, CONFIG.BLINK_CLOSE_FRACTION, CONFIG.BLINK_OPEN_FRACTION, CONFIG.BLINK_MIN_CALIBRATED_RANGE)!;
    expect(th.close).toBeCloseTo(0.1 + 0.55 * 0.7);
    expect(th.open).toBeCloseTo(0.1 + 0.35 * 0.7);
    expect(th.close).toBeGreaterThan(th.open);
    expect(blinkThresholdsFromCalibration(0.2, 0.3, 0.55, 0.35, 0.2)).toBeNull();
  });
});

describe('OneEuroFilter', () => {
  it('passes a constant through and reduces jitter', () => {
    const f = new OneEuroFilter(CONFIG.HEAD_FILTER_MIN_CUTOFF, CONFIG.HEAD_FILTER_BETA, CONFIG.HEAD_FILTER_D_CUTOFF);
    for (let i = 0; i < 30; i++) expect(f.filter(5, i / 30)).toBeCloseTo(5);
    const g = new OneEuroFilter(CONFIG.HEAD_FILTER_MIN_CUTOFF, CONFIG.HEAD_FILTER_BETA, CONFIG.HEAD_FILTER_D_CUTOFF);
    const rand = mulberry32(4);
    let rawVar = 0;
    let outVar = 0;
    for (let i = 0; i < 300; i++) {
      const raw = (rand() - 0.5) * 4;
      const out = g.filter(raw, i / 30);
      if (i > 30) {
        rawVar += raw * raw;
        outVar += out * out;
      }
    }
    expect(outVar).toBeLessThan(rawVar * 0.5);
  });
  it('follows a step change within half a second', () => {
    const f = new OneEuroFilter(CONFIG.HEAD_FILTER_MIN_CUTOFF, CONFIG.HEAD_FILTER_BETA, CONFIG.HEAD_FILTER_D_CUTOFF);
    f.filter(0, 0);
    let v = 0;
    for (let i = 1; i <= 15; i++) v = f.filter(20, i / 30);
    expect(v).toBeGreaterThan(18);
  });
});
