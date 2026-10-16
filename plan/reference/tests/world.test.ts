import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import {
  cellCenter,
  collidesCircle,
  facingToYaw,
  findPath,
  isWall,
  lineOfSight,
  moveWithCollision,
  parseLevel,
  yawForward,
  type LevelDef,
} from '../src/game/grid';
import { canHear, effectiveDistance, hearingRadius } from '../src/game/hearing';
import { LEVELS } from '../src/game/levels';
import { Monster } from '../src/game/Monster';
import { mulberry32 } from '../src/game/rng';

const box: LevelDef = {
  id: 'box',
  name: 'box',
  startFacing: 'N',
  intro: [],
  map: ['#######', '#S....#', '#.###.#', '#....E#', '#######'],
};

describe('parseLevel', () => {
  it('parses a valid level', () => {
    const l = parseLevel(box);
    expect(l.cols).toBe(7);
    expect(l.rows).toBe(5);
    expect(l.start).toEqual({ c: 1, r: 1 });
    expect(l.exit).toEqual({ c: 5, r: 3 });
    expect(isWall(l, 0, 0)).toBe(true);
    expect(isWall(l, 1, 1)).toBe(false);
    expect(isWall(l, -1, 2)).toBe(true);
    expect(isWall(l, 99, 2)).toBe(true);
  });
  it('rejects bad levels with a clear message', () => {
    expect(() => parseLevel({ ...box, map: ['#####', '#S.E#', '#.x.#', '#####'] })).toThrow(/unknown character/);
    expect(() => parseLevel({ ...box, map: ['#####', 'S..E#', '#####'] })).toThrow(/border/);
    expect(() => parseLevel({ ...box, map: ['#####', '#S..#', '#####'] })).toThrow(/missing 'E'/);
    expect(() => parseLevel({ ...box, map: ['#####', '#S.E##', '#####'] })).toThrow(/length/);
  });
});

describe('facing', () => {
  it('maps facings to forward vectors', () => {
    const f = (d: 'N' | 'E' | 'S' | 'W') => {
      const v = yawForward(facingToYaw(d));
      return [Math.round(v.x) + 0, Math.round(v.z) + 0];
    };
    expect(f('N')).toEqual([0, -1]);
    expect(f('E')).toEqual([1, 0]);
    expect(f('S')).toEqual([0, 1]);
    expect(f('W')).toEqual([-1, 0]);
  });
});

describe('lineOfSight / findPath / collision', () => {
  const l = parseLevel(box);
  const a = cellCenter({ c: 1, r: 1 });
  it('sees along an open corridor but not through walls', () => {
    const b = cellCenter({ c: 5, r: 1 });
    expect(lineOfSight(l, a.x, a.z, b.x, b.z)).toBe(true);
    const c = cellCenter({ c: 3, r: 3 });
    expect(lineOfSight(l, a.x, a.z, c.x, c.z)).toBe(false);
    const d = cellCenter({ c: 1, r: 3 });
    expect(lineOfSight(l, a.x, a.z, d.x, d.z)).toBe(true);
  });
  it('finds shortest paths', () => {
    expect(findPath(l, { c: 1, r: 1 }, { c: 1, r: 1 })).toEqual([]);
    const p = findPath(l, { c: 1, r: 1 }, { c: 5, r: 3 })!;
    expect(p).toHaveLength(6);
    expect(p[p.length - 1]).toEqual({ c: 5, r: 3 });
    expect(findPath(l, { c: 1, r: 1 }, { c: 0, r: 0 })).toBeNull();
  });
  it('blocks movement into walls and slides along them', () => {
    expect(collidesCircle(l, a.x, a.z, CONFIG.PLAYER_RADIUS)).toBe(false);
    // Walk north into the border wall: z must stop at wall + radius.
    const moved = moveWithCollision(l, a.x, a.z, 0, -10, CONFIG.PLAYER_RADIUS);
    expect(moved.z).toBeGreaterThanOrEqual(CONFIG.CELL_SIZE + CONFIG.PLAYER_RADIUS - 1e-6);
    // Diagonal into the wall slides east.
    const slid = moveWithCollision(l, a.x, a.z, 2, -10, CONFIG.PLAYER_RADIUS);
    expect(slid.x).toBeCloseTo(a.x + 2);
  });
});

describe('hearing', () => {
  const l = parseLevel(box);
  it('radius grows with loudness and walls muffle', () => {
    expect(hearingRadius(0)).toBe(CONFIG.HEAR_MIN_RADIUS);
    expect(hearingRadius(1.5)).toBe(CONFIG.HEAR_MAX_RADIUS);
    expect(hearingRadius(1)).toBeGreaterThan(CONFIG.PULSE_MAX_RADIUS * (1 / 1.5));
    const a = cellCenter({ c: 1, r: 1 });
    const c = cellCenter({ c: 3, r: 3 });
    const straight = Math.hypot(c.x - a.x, c.z - a.z);
    expect(effectiveDistance(l, a.x, a.z, c.x, c.z)).toBeCloseTo(straight * CONFIG.WALL_MUFFLE);
    expect(canHear(l, { kind: 'pulse', x: a.x, z: a.z, loudness: 1, timeMs: 0 }, c.x, c.z)).toBe(true);
    expect(canHear(l, { kind: 'footstep', x: a.x, z: a.z, loudness: 0.01, timeMs: 0 }, c.x, c.z)).toBe(false);
  });
});

describe('LEVELS', () => {
  for (const def of LEVELS) {
    it(`${def.id} parses, is solvable, and spawns monsters far from the start`, () => {
      const l = parseLevel(def);
      const path = findPath(l, l.start, l.exit);
      expect(path).not.toBeNull();
      if (def.tutorial) expect(l.monsterSpawns).toHaveLength(0);
      else expect(l.monsterSpawns.length).toBeGreaterThan(0);
      for (const m of l.monsterSpawns) {
        const p = findPath(l, l.start, m);
        expect(p).not.toBeNull();
        expect(p!.length).toBeGreaterThanOrEqual(8);
      }
    });
  }
});

describe('Monster', () => {
  const l = parseLevel(box);
  it('is frozen at speed 0, walks to a heard sound, then searches and goes idle', () => {
    const m = new Monster(0, { c: 5, r: 3 });
    const rand = mulberry32(5);
    const target = cellCenter({ c: 1, r: 1 });
    m.hear(l, target.x, target.z);
    expect(m.state).toBe('alert');
    const before = { x: m.x, z: m.z };
    m.update(0.1, 0, l, 0, rand);
    expect(m.moving).toBe(false);
    expect({ x: m.x, z: m.z }).toEqual(before);
    let t = 0;
    for (let i = 0; i < 200 && m.state === 'alert'; i++) m.update(0.05, CONFIG.MONSTER_SPEED_BLINK, l, (t += 50), rand);
    expect(m.state).toBe('search');
    expect(Math.hypot(m.x - target.x, m.z - target.z)).toBeLessThan(CONFIG.CELL_SIZE * 1.01);
    for (let i = 0; i < 400; i++) m.update(0.05, CONFIG.MONSTER_SPEED_BLINK, l, (t += 50), rand);
    expect(m.state).toBe('idle');
  });
  it('ignores unreachable sounds', () => {
    const m = new Monster(0, { c: 5, r: 3 });
    m.hear(l, 0.5, 0.5);
    expect(m.state).toBe('idle');
  });
});
