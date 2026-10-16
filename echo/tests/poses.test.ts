import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { choosePose } from '../src/game/poses';

describe('choosePose', () => {
  it('reaches for you when close, stalks or crouches when hunting, stands when idle', () => {
    expect(choosePose('alert', CONFIG.POSE_REACH_M - 0.1, 0, 3, 3).pose).toBe('reach');
    expect(['stalk', 'crouch']).toContain(choosePose('alert', 10, 0, 3, 3).pose);
    expect(['crouch', 'stand']).toContain(choosePose('search', 10, 0, 3, 3).pose);
    expect(choosePose('idle', 10, 0, 3, 3).pose).toBe('stand');
  });
  it('is the same on one spot (the beam must not flicker) but changes as it moves', () => {
    expect(choosePose('alert', 10, 1, 4.1, 7.2)).toEqual(choosePose('alert', 10, 1, 4.3, 7.4));
    const seen = new Set<string>();
    for (let x = 0; x < 30; x += CONFIG.POSE_CELL_M) seen.add(JSON.stringify(choosePose('alert', 10, 1, x, 5)));
    expect(seen.size).toBeGreaterThanOrEqual(3); // both poses, both mirrors (most of them)
  });
});
