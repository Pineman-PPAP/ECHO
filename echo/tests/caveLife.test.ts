import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { batFlock, batRoosts, dripFallS, dripImpacts, dripSpots, levelSeed, remainsSpots, type DripSpot } from '../src/game/caveLife';
import { findPath, isWall, parseLevel, worldToCell } from '../src/game/grid';
import { LEVELS } from '../src/game/levels';
import { mulberry32 } from '../src/game/rng';
import { World } from '../src/game/World';
import { intent } from './helpers';

const listener = parseLevel(LEVELS[1]);

describe('drips', () => {
  it('sit inside floor cells, about one per DRIP_EVERY_CELLS', () => {
    const spots = dripSpots(listener, levelSeed(listener));
    let floor = 0;
    for (let r = 0; r < listener.rows; r++) for (let c = 0; c < listener.cols; c++) if (!isWall(listener, c, r)) floor++;
    expect(spots.length).toBeGreaterThan(floor / CONFIG.DRIP_EVERY_CELLS / 2);
    expect(spots.length).toBeLessThan((floor / CONFIG.DRIP_EVERY_CELLS) * 2);
    for (const s of spots) {
      const c = worldToCell(s.x, s.z);
      expect(isWall(listener, c.c, c.r)).toBe(false);
    }
  });

  it('land once per period, when the falling drop (same formula as the shader) reaches the floor', () => {
    const s: DripSpot = { x: 0, z: 0, periodS: 4, offsetS: 1 };
    const fall = dripFallS();
    expect(0.5 * CONFIG.GRAVITY_MPS2 * fall * fall).toBeCloseTo(CONFIG.DRIP_TOP_M);
    // First impact: t + offset - fall = 0 (mod period) => t = fall - 1 + 4k.
    const first = fall - 1 + 4;
    expect(dripImpacts([s], first - 0.01, first + 0.01)).toHaveLength(1);
    expect(dripImpacts([s], first + 0.01, first + 3.9)).toHaveLength(0);
    let n = 0;
    for (let t = 0; t < 40; t += 0.016) n += dripImpacts([s], t, t + 0.016).length;
    expect(n).toBe(10);
  });
});

describe('bats', () => {
  it('roost along the route to the exit', () => {
    const route = findPath(listener, listener.start, listener.exit)!;
    const roosts = batRoosts(listener);
    expect(roosts.length).toBeGreaterThanOrEqual(Math.floor(route.length / CONFIG.BAT_ROOST_EVERY_CELLS) - 1);
    for (const r of roosts) expect(route.some((c) => c.c === worldToCell(r.x, r.z).c && c.r === worldToCell(r.x, r.z).r)).toBe(true);
  });

  it('a flock bursts off the ceiling, over the player and away behind them', () => {
    const flock = batFlock(0, 0, 9, 0, mulberry32(3));
    expect(flock).toHaveLength(CONFIG.BAT_COUNT);
    for (const b of flock) {
      expect(b.y0).toBeGreaterThan(CONFIG.EYE_HEIGHT + 0.8);
      expect(b.x1).toBeGreaterThan(9 + 5); // well past the player
      expect(Math.abs(b.z0)).toBeLessThanOrEqual(CONFIG.BAT_SCATTER_M);
      expect(b.durationS).toBeGreaterThan(0);
    }
  });

  it('a loud clap near a roost wakes it once; a soft one does not', () => {
    const w = new World(LEVELS[1], 2);
    const [roost] = batRoosts(w.level);
    // Stand on the route a few cells before the first roost, with a clear line to it.
    const route = findPath(w.level, w.level.start, w.level.exit)!;
    const startCell = w.level.start;
    expect(route.length).toBeGreaterThan(CONFIG.BAT_ROOST_FIRST);
    w.player.x = (startCell.c + 0.5) * CONFIG.CELL_SIZE;
    w.player.z = (startCell.r + 0.5) * CONFIG.CELL_SIZE;
    const soft = w.update(0.016, 16, 0.016, intent({ pulses: [0.3] }));
    expect(soft.some((e) => e.type === 'bats')).toBe(false);
    const loud = w.update(0.016, 32, 0.032, intent({ pulses: [1.2] }));
    expect(loud).toContainEqual({ type: 'bats', x: roost.x, z: roost.z });
    const again = w.update(0.016, 48, 0.048, intent({ pulses: [1.2] }));
    expect(again.some((e) => e.type === 'bats' && e.x === roost.x && e.z === roost.z)).toBe(false);
  });
});

describe('remains', () => {
  for (const def of LEVELS) {
    it(`${def.id}: lie against a wall, dead ends first, never on reserved cells`, () => {
      const l = parseLevel(def);
      const spots = remainsSpots(l, levelSeed(l));
      expect(spots.length).toBe(CONFIG.REMAINS_PER_LEVEL);
      const reserved = [l.start, l.exit, ...l.monsterSpawns];
      for (const s of spots) {
        const c = worldToCell(s.x, s.z);
        expect(isWall(l, c.c, c.r)).toBe(false);
        expect(isWall(l, c.c + s.wx, c.r + s.wz)).toBe(true);
        expect(reserved.some((r) => r.c === c.c && r.r === c.r)).toBe(false);
      }
      expect(new Set(spots.map((s) => s.kind)).size).toBe(Math.min(3, CONFIG.REMAINS_PER_LEVEL));
    });
  }
});
