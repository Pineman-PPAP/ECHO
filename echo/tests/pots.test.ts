import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cellCenter, isWall, parseLevel, type LevelDef } from '../src/game/grid';
import { LEVELS } from '../src/game/levels';
import { potLoudness, potSpots } from '../src/game/pots';
import { World, type WorldEvent } from '../src/game/World';
import { intent } from './helpers';

/** A straight corridor: start at (1,1) facing east, a pot at (7,1) and a Hollow at (10,1) wandering nearby. */
function corridor(pot: { dx: number; dz: number }): LevelDef {
  return {
    id: 'pots',
    name: 'pots',
    startFacing: 'E',
    intro: [],
    map: ['############', '#S........M#', '#########..#', '#E.........#', '############'],
    pots: [{ c: 7, r: 1, ...pot }],
  };
}

/** Put the player 1.5 m short of the pot, still facing east, so tests don't depend on a long walk. */
function nearPot(w: World): World {
  w.player.x = w.pots.list[0].x - 1.5;
  return w;
}

function walk(w: World, ms: number, moveSpeed: number): WorldEvent[] {
  const all: WorldEvent[] = [];
  for (let t = 16; t <= ms; t += 16) {
    all.push(...w.update(0.016, t, t / 1000, intent({ moveSpeed })));
    if (w.status !== 'playing') break;
  }
  return all;
}

describe('pots', () => {
  it('walking into a pot shatters it once: a potKicked event that summons the Stalker (not the Hollows)', () => {
    const w = nearPot(new World(corridor({ dx: 0, dz: 0 })));
    const events = walk(w, 3000, CONFIG.MAX_SPEED_FWD * 0.5);
    const kicks = events.filter((e) => e.type === 'potKicked');
    expect(kicks).toHaveLength(1);
    expect(w.pots.list[0].broken).toBe(true);
    expect(events.some((e) => e.type === 'stalker' && e.what === 'start')).toBe(true);
    expect(events.some((e) => e.type === 'heard' && e.kind === 'pot')).toBe(false);
    // Even a slow bump is clap-loud.
    const kick = kicks[0];
    if (kick.type !== 'potKicked') throw new Error('unreachable');
    expect(kick.loudness).toBeGreaterThanOrEqual(CONFIG.POT_LOUDNESS_SOFT);
  });

  it('lights the cave from the pot, not from the player', () => {
    const w = nearPot(new World(corridor({ dx: 0, dz: 0 })));
    const pot = w.pots.list[0];
    for (let t = 16; t <= 3000 && !pot.broken; t += 16) w.update(0.016, t, t / 1000, intent({ moveSpeed: 1.2 }));
    expect(pot.broken).toBe(true);
    expect(w.pulses.pulses.some((p) => p.x === pot.x && p.z === pot.z)).toBe(true);
    expect(w.pulsesEmitted).toBe(0); // the player's clap count is unchanged
  });

  it('standing still against a pot does not break it', () => {
    const start = cellCenter({ c: 1, r: 1 });
    const def = corridor({ dx: 0, dz: 0 });
    def.pots = [{ c: 1, r: 1, dx: 0.3, dz: 0 }];
    const w = new World(def);
    expect(Math.hypot(w.pots.list[0].x - start.x, w.pots.list[0].z - start.z)).toBeLessThan(CONFIG.POT_KICK_RADIUS_M);
    walk(w, 2000, 0);
    expect(w.pots.list[0].broken).toBe(false);
  });

  it('a pot against the wall can be walked past down the middle', () => {
    const w = nearPot(new World(corridor({ dx: 0, dz: 0.75 })));
    w.monstersEnabled = false; // only the pot matters here
    const events = walk(w, 2000, CONFIG.MAX_SPEED_FWD);
    expect(w.player.x).toBeGreaterThan(w.pots.list[0].x + 1);
    expect(events.some((e) => e.type === 'potKicked')).toBe(false);
  });

  it('is louder the faster you walk into it', () => {
    expect(potLoudness(0.2)).toBeCloseTo(CONFIG.POT_LOUDNESS_SOFT + (CONFIG.POT_LOUDNESS_HARD - CONFIG.POT_LOUDNESS_SOFT) * (0.2 / CONFIG.MAX_SPEED_FWD));
    expect(potLoudness(CONFIG.MAX_SPEED_FWD)).toBeCloseTo(CONFIG.POT_LOUDNESS_HARD);
    expect(potLoudness(10)).toBeCloseTo(CONFIG.POT_LOUDNESS_HARD);
  });

  describe.each(LEVELS.map((d) => [d.id, d] as const))('placement in %s', (_id, def) => {
    const level = parseLevel(def);
    const key = (c: { c: number; r: number }) => `${c.c},${c.r}`;
    const reserved = new Set([level.start, level.exit, ...level.monsterSpawns].map(key));
    for (const m of def.moments ?? []) {
      if ('trigger' in m) reserved.add(key(m.trigger));
      if ('at' in m) reserved.add(key(m.at));
    }

    it('has pots, each on a free floor cell, inside the cell clear of the rock', () => {
      expect((def.pots ?? []).length).toBeGreaterThan(0);
      for (const p of def.pots ?? []) {
        expect(isWall(level, p.c, p.r)).toBe(false);
        expect(reserved.has(key(p))).toBe(false);
        expect(Math.max(Math.abs(p.dx), Math.abs(p.dz)) + CONFIG.POT_RADIUS_M).toBeLessThanOrEqual(1);
      }
    });

    it('never blocks the walking line: every centre-to-centre path through its cell passes clear of it', () => {
      const spots = potSpots(def);
      (def.pots ?? []).forEach((p, i) => {
        const a = cellCenter(p);
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (isWall(level, p.c + dc, p.r + dr)) continue;
          const b = cellCenter({ c: p.c + dc, r: p.r + dr });
          expect(segmentDistance(spots[i].x, spots[i].z, a.x, a.z, b.x, b.z)).toBeGreaterThan(CONFIG.POT_KICK_RADIUS_M + 0.1);
        }
      });
    });
  });
});

function segmentDistance(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const t = Math.min(Math.max(((px - ax) * dx + (pz - az) * dz) / (dx * dx + dz * dz), 0), 1);
  return Math.hypot(px - (ax + dx * t), pz - (az + dz * t));
}
