import { describe, expect, it } from 'vitest';
import { manualStepIntent } from '../src/app/manualIntent';
import type { ManualPhase, StepId } from '../src/app/FieldManual';
import { World } from '../src/game/World';
import { FIELD_MANUAL_LEVEL } from '../src/game/levels';
import { intent } from './helpers';

const mixed = intent({ turnRate: 1, moveSpeed: 2, pulses: [1], hum: { level: 1, pitch01: 0.5 }, humStarted: true });
const frame = (id: StepId, phase: ManualPhase = 'await') => ({ phase, step: { id } });

describe('tutorial action isolation', () => {
  it('allows only hum while waking/fading the jar; moving and clapping have no effect on the World', () => {
    const w = new World(FIELD_MANUAL_LEVEL);
    const { x, z, yaw } = w.player;
    for (const id of ['hum', 'quiet'] as const) {
      const filtered = manualStepIntent(frame(id), mixed);
      const events = w.update(0.05, 0, 0, filtered);
      expect(filtered.hum).toEqual(mixed.hum);
      expect(w.player.x).toBe(x); expect(w.player.z).toBe(z); expect(w.player.yaw).toBe(yaw);
      expect(events.some(e => e.type === 'pulse' || e.type === 'footstep')).toBe(false);
    }
    expect(w.jar.glow).toBeGreaterThan(0);
  });
  it('allows only the instructed turn direction, blocking walking, hum and pulses', () => {
    expect(manualStepIntent(frame('turnLeft'), mixed)).toEqual(intent({ turnRate: 1 }));
    expect(manualStepIntent(frame('turnRight'), mixed)).toEqual(intent());
    expect(manualStepIntent(frame('turnRight'), { ...mixed, turnRate: -1 })).toEqual(intent({ turnRate: -1 }));
  });
  it('allows only forward or backward walking in its own step', () => {
    expect(manualStepIntent(frame('leanIn'), mixed)).toEqual(intent({ moveSpeed: 2 }));
    expect(manualStepIntent(frame('leanBack'), mixed)).toEqual(intent());
    expect(manualStepIntent(frame('leanBack'), { ...mixed, moveSpeed: -1 })).toEqual(intent({ moveSpeed: -1 }));
  });
  it('only claps can affect the final encounter; watching and transitions accept no actions', () => {
    expect(manualStepIntent(frame('clapReveal'), mixed)).toEqual(intent({ pulses: [1] }));
    expect(manualStepIntent(frame('watch'), mixed)).toEqual(intent());
    for (const phase of ['setup','cut','stepOk','confirm','end','done'] as const) {
      expect(manualStepIntent(frame('hum', phase), mixed)).toEqual(intent());
    }
    expect(manualStepIntent(null, mixed)).toEqual(intent());
    expect(manualStepIntent(frame('hum'), { ...mixed, facePresent: false })).toEqual(intent({ facePresent: false }));
  });
});
