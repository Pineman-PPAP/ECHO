import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { beamFromHum, leanToSpeed, onsetLoudness, pulseRadius, yawToTurnRate } from '../src/input/mapping';

describe('yawToTurnRate', () => {
  it('has a dead zone, is signed (+ = left) and saturates', () => {
    expect(yawToTurnRate(0)).toBe(0);
    expect(yawToTurnRate(CONFIG.YAW_DEADZONE_DEG)).toBe(0);
    const max = (CONFIG.MAX_TURN_RATE_DEG * Math.PI) / 180;
    expect(yawToTurnRate(90)).toBeCloseTo(max);
    expect(yawToTurnRate(-90)).toBeCloseTo(-max);
    expect(yawToTurnRate(15)).toBeGreaterThan(0);
    expect(yawToTurnRate(15)).toBeLessThan(max);
  });
});

describe('leanToSpeed', () => {
  it('maps lean forward/back with dead zones', () => {
    expect(leanToSpeed(0)).toBe(0);
    expect(leanToSpeed(0.05)).toBe(0);
    expect(leanToSpeed(1)).toBeCloseTo(CONFIG.MAX_SPEED_FWD);
    expect(leanToSpeed(-1)).toBeCloseTo(-CONFIG.MAX_SPEED_BACK);
    expect(leanToSpeed(0.15)).toBeGreaterThan(0);
  });
});

describe('onsetLoudness / pulseRadius', () => {
  it('a calibrated clap is loudness 1; values are clamped', () => {
    expect(onsetLoudness(36, 36)).toBeCloseTo(1);
    expect(onsetLoudness(0, 36)).toBeCloseTo(0.05);
    expect(onsetLoudness(200, 36)).toBeCloseTo(1.5);
    expect(pulseRadius(0)).toBeCloseTo(CONFIG.PULSE_MIN_RADIUS);
    expect(pulseRadius(1.5)).toBeCloseTo(CONFIG.PULSE_MAX_RADIUS);
  });
});

describe('beamFromHum', () => {
  it('higher pitch => narrower beam; louder => longer range', () => {
    const low = beamFromHum(30, 110, 30);
    const high = beamFromHum(30, 520, 30);
    expect(low.halfAngleRad).toBeCloseTo((CONFIG.BEAM_WIDE_HALF_ANGLE_DEG * Math.PI) / 180);
    expect(high.halfAngleRad).toBeCloseTo((CONFIG.BEAM_NARROW_HALF_ANGLE_DEG * Math.PI) / 180);
    expect(beamFromHum(30, 220, 30).range).toBeCloseTo(CONFIG.BEAM_MAX_RANGE);
    expect(beamFromHum(CONFIG.HUM_MIN_ABOVE_FLOOR_DB, 220, 30).range).toBeCloseTo(CONFIG.BEAM_MIN_RANGE);
  });
});
