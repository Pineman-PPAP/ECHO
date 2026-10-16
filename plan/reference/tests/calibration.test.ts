import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { CalibrationRunner, type CalibCue } from '../src/input/calibration';
import { faceFrame, micFrame } from './helpers';

interface Script {
  leftYaw: number;
  claps: number;
  hum: boolean;
  leak: boolean;
}

/** Plays a well-behaved (or misbehaving) player through the whole calibration at 60 fps. */
function run(s: Script) {
  const r = new CalibrationRunner(0);
  const cues: CalibCue[] = [];
  const steps: string[] = [];
  let claps = 0;
  let t = 0;
  for (let frame = 0; frame < 60 * 60; frame++) {
    t += 1000 / 60;
    const step = r.step;
    if (steps[steps.length - 1] !== step) steps.push(step);
    const yaw = step === 'left' ? s.leftYaw : 2;
    const blink = step === 'eyes' ? 0.85 : 0.08;
    const face = frame % 2 === 0 ? faceFrame(t, { yaw, depth: 52, blink }) : null;
    let mic = micFrame();
    if (step === 'clap' && claps < s.claps && frame % 40 === 0) {
      claps++;
      mic = micFrame({ onsets: [{ timeMs: t, peakAboveDb: 40 }] });
    }
    if (step === 'hum' && s.hum) mic = micFrame({ humActive: true, aboveDb: 28, humPitchHz: 220 });
    if (step === 'speakers' && s.leak && cues.includes('testTone')) mic = micFrame({ levelDb: -30 });
    const u = r.update(t, face, mic);
    cues.push(...u.cues);
    if (u.finished) return { data: r.data, cues, steps, t };
  }
  throw new Error('calibration never finished');
}

describe('CalibrationRunner', () => {
  it('measures a cooperative player', () => {
    const { data, cues, steps, t } = run({ leftYaw: 25, claps: 2, hum: true, leak: false });
    expect(steps).toEqual(['face', 'quiet', 'neutral', 'left', 'eyes', 'clap', 'hum', 'speakers', 'done']);
    expect(data.neutralYawDeg).toBeCloseTo(2);
    expect(data.neutralDepth).toBeCloseTo(52);
    expect(data.leftSign).toBe(1);
    expect(data.blinkClose).toBeGreaterThan(data.blinkOpen);
    expect(data.blinkClose).toBeCloseTo(0.08 + CONFIG.BLINK_CLOSE_FRACTION * (0.85 - 0.08));
    expect(data.clapRefAboveDb).toBeCloseTo(40);
    expect(data.humRefAboveDb).toBeCloseTo(28);
    expect(data.speakerLeak).toBe(false);
    expect(data.warnings).toEqual([]);
    expect(cues).toContain('beep');
    expect(cues).toContain('doubleBeep');
    expect(cues).toContain('testTone');
    expect(t).toBeLessThan(20000);
  });
  it('detects an inverted camera (turning left gives negative yaw)', () => {
    expect(run({ leftYaw: -21, claps: 2, hum: true, leak: false }).data.leftSign).toBe(-1);
  });
  it('falls back to defaults with warnings when the player does nothing', () => {
    const { data } = run({ leftYaw: 2, claps: 0, hum: false, leak: false });
    expect(data.leftSign).toBe(1);
    expect(data.clapRefAboveDb).toBe(CONFIG.CLAP_REF_ABOVE_DB_DEFAULT);
    expect(data.humRefAboveDb).toBe(CONFIG.HUM_REF_ABOVE_DB_DEFAULT);
    expect(data.warnings.length).toBe(3);
  });
  it('detects speakers leaking into the mic', () => {
    expect(run({ leftYaw: 25, claps: 2, hum: true, leak: true }).data.speakerLeak).toBe(true);
  });
});
