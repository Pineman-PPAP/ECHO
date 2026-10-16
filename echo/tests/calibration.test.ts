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
  for (let frame = 0; frame < 60 * 120; frame++) {
    t += 1000 / 60;
    const step = r.step;
    if (steps[steps.length - 1] !== step) steps.push(step);
    // The player waits for the countdown, like a real one: they act only while the step measures.
    const acting = r.phase === 'measure';
    const yaw = step === 'left' ? s.leftYaw : 2;
    const face = frame % 2 === 0 ? faceFrame(t, { yaw, depth: 52 }) : null;
    let mic = micFrame();
    if (step === 'clap' && acting && claps < s.claps && frame % 40 === 0) {
      claps++;
      mic = micFrame({ onsets: [{ timeMs: t, peakAboveDb: 40 }] });
    }
    if (step === 'hum' && acting && s.hum) mic = micFrame({ humActive: true, aboveDb: 28, humPitchHz: 220 });
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
    expect(steps).toEqual(['face', 'quiet', 'neutral', 'left', 'clap', 'hum', 'speakers', 'done']);
    expect(data.neutralYawDeg).toBeCloseTo(2);
    expect(data.neutralDepth).toBeCloseTo(52);
    expect(data.leftSign).toBe(1);
    expect(data.clapRefAboveDb).toBeCloseTo(40);
    expect(data.humRefAboveDb).toBeCloseTo(28);
    expect(data.speakerLeak).toBe(false);
    expect(data.warnings).toEqual([]);
    expect(cues).toContain('testTone');
    expect(cues).toContain('ok');
    // Slow enough to read every step, but still under a minute.
    expect(t).toBeGreaterThan(30000);
    expect(t).toBeLessThan(60000);
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
  it('explains a step before measuring it, then shows what it measured', () => {
    const r = new CalibrationRunner(0);
    let t = 0;
    const tick = (face = faceFrame(t), mic = micFrame()) => {
      t += 1000 / 60;
      return r.update(t, face, mic);
    };
    // face -> result -> quiet intro
    while (r.step === 'face' || r.phase === 'result') tick(faceFrame(t));
    expect(r.step).toBe('quiet');
    expect(r.phase).toBe('intro');
    // Neutral, then the left step's intro: a turn during the countdown isn't measured yet.
    while (r.step !== 'left') tick(faceFrame(t, { yaw: 2 }));
    const intro = tick(faceFrame(t, { yaw: 25 }));
    expect(intro.view.phase).toBe('intro');
    expect(intro.view.status).toMatch(/^Starts in \d/);
    expect(intro.view.why).not.toBe('');
    const phase = () => r.phase; // a call, so TypeScript doesn't keep the narrowed type from the loop above
    while (phase() !== 'result') tick(faceFrame(t, { yaw: 25 }));
    const result = tick(faceFrame(t, { yaw: 25 }));
    expect(result.view.statusTone).toBe('ok');
    expect(result.view.status).toBe('Turned 23° to the left. Saved.');
  });
  it('ignores claps during the countdown', () => {
    const r = new CalibrationRunner(0);
    let t = 0;
    let sawCountdownClap = false;
    while (r.step !== 'hum') {
      t += 1000 / 60;
      const clap = r.step === 'clap' && r.phase === 'intro';
      if (clap) sawCountdownClap = true;
      r.update(t, faceFrame(t, { yaw: r.step === 'left' ? 25 : 2 }), micFrame({ onsets: clap ? [{ timeMs: t, peakAboveDb: 40 }] : [] }));
    }
    expect(sawCountdownClap).toBe(true);
    expect(r.data.warnings).toContain('Did not hear a clap; using default clap loudness.');
  });
  it('detects speakers leaking into the mic', () => {
    expect(run({ leftYaw: 25, claps: 2, hum: true, leak: true }).data.speakerLeak).toBe(true);
  });
});
