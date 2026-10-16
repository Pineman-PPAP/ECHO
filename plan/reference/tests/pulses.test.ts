import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { PulseManager } from '../src/game/PulseManager';
import { createRevealUniforms } from '../src/render/revealMaterial';

describe('PulseManager', () => {
  it('caps the number of pulses, prunes finished ones and writes uniforms', () => {
    const pm = new PulseManager();
    for (let i = 0; i < CONFIG.MAX_PULSES + 3; i++) pm.add(i, 1.6, 0, i * 0.1, 1);
    expect(pm.pulses).toHaveLength(CONFIG.MAX_PULSES);
    expect(pm.pulses[0].x).toBe(3); // oldest three dropped

    const u = createRevealUniforms();
    pm.writeUniforms(u);
    expect(u.uPulseA.value[0].toArray()).toEqual([3, 1.6, 0, pm.pulses[0].startS]);
    expect(u.uPulseB.value[0].y).toBeGreaterThan(0);

    pm.prune(1000);
    expect(pm.pulses).toHaveLength(0);
    pm.writeUniforms(u);
    expect(u.uPulseB.value.every((b) => b.y === 0)).toBe(true);
  });
  it('wavefront radius grows at PULSE_SPEED and stops at maxRadius', () => {
    const pm = new PulseManager();
    const p = pm.add(0, 0, 0, 10, 1);
    expect(PulseManager.frontRadius(p, 10)).toBe(0);
    expect(PulseManager.frontRadius(p, 10.1)).toBeCloseTo(CONFIG.PULSE_SPEED * 0.1);
    expect(PulseManager.frontRadius(p, 100)).toBe(p.maxRadius);
  });
});
