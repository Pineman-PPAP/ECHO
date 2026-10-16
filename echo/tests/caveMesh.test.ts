import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cellCenter, collidesCircle, isWall, parseLevel } from '../src/game/grid';
import { FIELD_MANUAL_LEVEL, LEVELS } from '../src/game/levels';
import { buildCaveMesh, CaveField, floorAt, planDistance, wallDistance } from '../src/render/caveMesh';

/** No rock may come closer to any position the camera can reach than the camera's near plane. */
const CAMERA_MARGIN_M = CONFIG.CAMERA_NEAR_M;

describe('planDistance', () => {
  it('is positive in corridors, negative in rock, zero on the wall line', () => {
    const l = parseLevel(LEVELS[0]);
    const p = cellCenter(l.start);
    expect(planDistance(l, p.x, p.z)).toBeCloseTo(CONFIG.CELL_SIZE / 2);
    expect(planDistance(l, p.x, CONFIG.CELL_SIZE)).toBeCloseTo(0);
    expect(planDistance(l, p.x, 0.5)).toBeLessThan(0);
  });
});

for (const def of [...LEVELS, FIELD_MANUAL_LEVEL]) {
  describe(`cave mesh: ${def.id}`, () => {
    const l = parseLevel(def);
    const t0 = performance.now();
    const field = new CaveField(l, 5);
    const m = buildCaveMesh(field);
    const ms = performance.now() - t0;
    const n = m.positions.length / 3;

    it('is a sane, indexed triangle mesh', () => {
      expect(n).toBeGreaterThan(1000);
      expect(m.indices.length % 3).toBe(0);
      expect(m.normals.length).toBe(m.positions.length);
      expect(m.layers.length).toBe(n);
      expect(m.shades.length).toBe(n);
      expect(m.shades.reduce((a, b) => Math.min(a, b), 1)).toBeGreaterThan(0);
      expect(m.indices.reduce((a, b) => Math.max(a, b), 0)).toBeLessThan(n);
      console.log(`${def.id}: ${n} vertices, ${m.indices.length / 3} triangles, built in ${ms.toFixed(0)} ms`);
    });

    it('rock never looks further away than it collides, and never reaches the camera', () => {
      let deepest = Infinity;
      let tooClose = 0;
      for (let v = 0; v < n; v++) {
        const x = m.positions[v * 3];
        const y = m.positions[v * 3 + 1];
        const z = m.positions[v * 3 + 2];
        if (y < 0.5 || y > 2.2) continue; // walls, not floor or ceiling
        deepest = Math.min(deepest, planDistance(l, x, z));
        if (Math.abs(y - CONFIG.EYE_HEIGHT) > 0.3) continue; // only rock at camera height can touch the camera
        if (planDistance(l, x, z) <= CONFIG.PLAYER_RADIUS - CAMERA_MARGIN_M) continue; // close to a wall line: safe
        // Otherwise no position the camera can reach may lie within CAMERA_MARGIN_M of this rock.
        for (let a = 0; a < 16; a++) {
          const px = x + Math.cos((a * Math.PI) / 8) * CAMERA_MARGIN_M;
          const pz = z + Math.sin((a * Math.PI) / 8) * CAMERA_MARGIN_M;
          if (!collidesCircle(l, px, pz, CONFIG.PLAYER_RADIUS)) tooClose++;
        }
        if (!collidesCircle(l, x, z, CONFIG.PLAYER_RADIUS)) tooClose++;
      }
      expect(deepest).toBeGreaterThan(-0.02); // never behind the collision line
      expect(tooClose).toBe(0);
    });

    it('finds the floor and the wall face for placing props', () => {
      const p = cellCenter(l.start);
      expect(Math.abs(floorAt(field, p.x, p.z))).toBeLessThan(CONFIG.CAVE_FLOOR_BUMP_M + 0.05);
      // Some wall of the start cell is 1.5 m away at the wall line, rock bulging up to CAVE_WALL_BUMP_M in front of it.
      const best = Math.min(...[[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dz]) => wallDistance(field, p.x, CONFIG.EYE_HEIGHT, p.z, dx, dz)));
      expect(best).toBeLessThanOrEqual(CONFIG.CELL_SIZE / 2 + 0.02);
      expect(best).toBeGreaterThanOrEqual(CONFIG.CELL_SIZE / 2 - CONFIG.CAVE_WALL_BUMP_M - CONFIG.CAVE_FILLET_MAX_M - 0.02);
    });

    it('floors face up, ceilings face down, and nothing hangs to head height mid-corridor', () => {
      let floors = 0;
      for (let v = 0; v < n; v++) {
        const x = m.positions[v * 3];
        const y = m.positions[v * 3 + 1];
        const z = m.positions[v * 3 + 2];
        if (isWall(l, Math.floor(x / CONFIG.CELL_SIZE), Math.floor(z / CONFIG.CELL_SIZE))) continue;
        if (planDistance(l, x, z) < 1) continue; // corridor middle only
        const ny = m.normals[v * 3 + 1];
        if (y < 0.5) {
          expect(ny).toBeGreaterThan(0.7);
          floors++;
        } else {
          expect(y).toBeGreaterThan(CONFIG.EYE_HEIGHT + 0.5);
          expect(ny).toBeLessThan(0);
        }
      }
      expect(floors).toBeGreaterThan(100);
    });
  });
}
