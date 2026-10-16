import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cellCenter, findPath, isWall, worldToCell, yawForward } from '../src/game/grid';
import { guidePoint, guideTrail, wallGuideMarks } from '../src/game/guide';
import { LEVELS } from '../src/game/levels';
import { World } from '../src/game/World';

describe('permanent wall arrows', () => {
  for (const def of LEVELS) {
    it(`${def.id}: sits on real walls and points along an open exit route`, () => {
      const world = new World(def);
      const marks = wallGuideMarks(world.level);
      expect(marks.length).toBeGreaterThan(0);
      expect(wallGuideMarks(world.level)).toEqual(marks);
      for (const mark of marks) {
        expect(isWall(world.level, mark.cell.c, mark.cell.r)).toBe(false);
        expect(isWall(world.level, mark.cell.c + mark.wx, mark.cell.r + mark.wz)).toBe(true);
        const next = findPath(world.level, mark.cell, world.level.exit)![0];
        expect(next).toBeDefined();
        // Project the painted arrow back into world space: it must match the next route step.
        expect(-mark.wz * mark.direction + 0).toBe(next.c - mark.cell.c);
        expect(mark.wx * mark.direction + 0).toBe(next.r - mark.cell.r);
      }
    });
  }
});

describe('guidePoint', () => {
  it('points along the route, not straight at the exit', () => {
    const w = new World(LEVELS[2], 3);
    const g = guidePoint(w.level, w.player.x, w.player.z);
    const gc = worldToCell(g.x, g.z);
    const pc = worldToCell(w.player.x, w.player.z);
    expect(Math.abs(gc.c - pc.c) + Math.abs(gc.r - pc.r)).toBeLessThanOrEqual(CONFIG.DRAFT_LOOKAHEAD_CELLS);
    expect(g).not.toEqual(cellCenter(w.level.exit));
  });

  it('uses the exit itself when it is close', () => {
    const w = new World(LEVELS[0], 1);
    const e = cellCenter(w.level.exit);
    expect(guidePoint(w.level, e.x, e.z)).toEqual(e);
  });
});

describe('guideTrail', () => {
  it('lays arrows along the route, each pointing at the next cell', () => {
    const w = new World(LEVELS[2], 3);
    const trail = guideTrail(w.level, w.player.x, w.player.z, 5);
    expect(trail).toHaveLength(5);
    // The Choir starts at (1,1) and its route runs east along row 1 first.
    trail.forEach((m, i) => {
      expect(worldToCell(m.x, m.z)).toEqual({ c: 2 + i, r: 1 });
      const f = yawForward(m.yaw);
      expect(f.x).toBeCloseTo(1);
      expect(f.z).toBeCloseTo(0);
    });
  });

  it('turns with the corridor', () => {
    const w = new World(LEVELS[2], 3);
    // From (7,1) the route turns south down column 7.
    const p = cellCenter({ c: 7, r: 1 });
    const [first] = guideTrail(w.level, p.x, p.z, 1);
    expect(worldToCell(first.x, first.z)).toEqual({ c: 7, r: 2 });
    const f = yawForward(first.yaw);
    expect(f.x).toBeCloseTo(0);
    expect(f.z).toBeCloseTo(1);
  });

  it('stops before the exit and is empty on it', () => {
    const w = new World(LEVELS[0], 1);
    const e = w.level.exit;
    const near = cellCenter({ c: e.c + 2, r: e.r });
    expect(guideTrail(w.level, near.x, near.z, 10)).toHaveLength(1);
    const on = cellCenter(e);
    expect(guideTrail(w.level, on.x, on.z, 10)).toEqual([]);
  });
});
