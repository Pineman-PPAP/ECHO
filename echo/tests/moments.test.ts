import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cellCenter, facingToYaw, findPath, isWall, lineOfSight, parseLevel, type Cell, type Facing, type LevelDef } from '../src/game/grid';
import { LEVELS } from '../src/game/levels';
import { WATCHER_ID, World, type WorldEvent } from '../src/game/World';
import { intent } from './helpers';

const same = (a: Cell, b: Cell) => a.c === b.c && a.r === b.r;

function route(def: LevelDef): Cell[] {
  const l = parseLevel(def);
  return [l.start, ...findPath(l, l.start, l.exit)!];
}

function byId(id: string): LevelDef {
  return LEVELS.find((d) => d.id === id)!;
}

/** Puts the player on a cell facing a direction and runs one frame. */
function stand(w: World, cell: Cell, facing: Facing, nowMs: number, i: Parameters<typeof intent>[0] = {}): WorldEvent[] {
  const p = cellCenter(cell);
  w.player.x = p.x;
  w.player.z = p.z;
  w.player.yaw = facingToYaw(facing);
  return w.update(0.016, nowMs, nowMs / 1000, intent(i));
}

describe('every level has its authored moment, placed on the route', () => {
  for (const def of LEVELS) {
    it(`${def.id}`, () => {
      const l = parseLevel(def);
      const r = route(def);
      expect(def.moments?.length ?? 0).toBeGreaterThan(0);
      for (const m of def.moments ?? []) {
        if (m.kind === 'quiet') {
          expect(r.some((c) => c.c >= m.from.c && c.c <= m.to.c && c.r >= m.from.r && c.r <= m.to.r)).toBe(true);
          continue;
        }
        expect(r.some((c) => same(c, m.trigger))).toBe(true);
        const t = cellCenter(m.trigger);
        if (m.kind === 'watcher' || m.kind === 'ambush') {
          expect(isWall(l, m.at.c, m.at.r)).toBe(false);
          const a = cellCenter(m.at);
          expect(lineOfSight(l, t.x, t.z, a.x, a.z)).toBe(true); // the eyes are seen from the trigger
          if (m.kind === 'watcher') expect(Math.hypot(a.x - t.x, a.z - t.z)).toBeGreaterThan(CONFIG.WATCHER_VANISH_M);
        }
        if (m.kind === 'walkPast') {
          const s = cellCenter(m.route[0]);
          expect(lineOfSight(l, t.x, t.z, s.x, s.z)).toBe(false); // it appears out of sight
          m.route.forEach((c, i) => {
            expect(isWall(l, c.c, c.r)).toBe(false);
            if (i > 0) expect(Math.abs(c.c - m.route[i - 1].c) + Math.abs(c.r - m.route[i - 1].r)).toBe(1);
          });
        }
        if ('monster' in m) expect(m.monster).toBeLessThan(l.monsterSpawns.length);
      }
    });
  }
});

describe('moments in play', () => {
  it('Awakening: eyes watch from beside the exit, then a clap makes them vanish', () => {
    const w = new World(byId('tutorial'), 1);
    const ev = stand(w, { c: 8, r: 5 }, 'W', 100);
    expect(ev).toContainEqual({ type: 'moment', kind: 'watcher', prompt: null });
    expect(w.eyes().map((e) => e.id)).toContain(WATCHER_ID);
    stand(w, { c: 8, r: 5 }, 'W', 200, { pulses: [1] });
    expect(w.eyes()).toHaveLength(0);
  });

  it('The Listener: the tunnel falls silent, it waits at the end, and only a sound brings it', () => {
    const w = new World(byId('listener'), 2);
    stand(w, { c: 5, r: 7 }, 'E', 100);
    expect(w.quiet).toBe(true);
    expect(w.droneLevel()).toBe(0);
    const ev = stand(w, { c: 9, r: 7 }, 'E', 200);
    expect(ev.some((e) => e.type === 'moment' && e.kind === 'ambush')).toBe(true);
    const m = w.monsters[0];
    expect(m.cell).toEqual({ c: 14, r: 7 });
    expect(w.eyes().map((e) => e.id)).toEqual([m.id]);
    // It is blind: standing silent, you are not found.
    const quiet: WorldEvent[] = [];
    for (let t = 300; t < 2300; t += 16) quiet.push(...w.update(0.016, t, t / 1000, intent()));
    expect(quiet.some((e) => e.type === 'alerted')).toBe(false);
    expect(m.state).not.toBe('alert');
    // A clap tells it where you are.
    const loud = w.update(0.016, 2400, 2.4, intent({ pulses: [1] }));
    expect(loud.some((e) => e.type === 'alerted')).toBe(true);
    expect(m.state).toBe('alert');
  });

  it('The Choir: a Hollow walks past the junction ahead, then the finale wakes everything', () => {
    const w = new World(byId('choir'), 3);
    const ev = stand(w, { c: 17, r: 8 }, 'S', 100);
    expect(ev.some((e) => e.type === 'moment' && e.kind === 'walkPast' && e.prompt)).toBe(true);
    const m = w.monsters[0];
    expect(m.state).toBe('patrol');
    let passed = false;
    for (let t = 116; t < 12000 && w.status === 'playing'; t += 16) {
      w.update(0.016, t, t / 1000, intent());
      if (m.cell.c === 15 && m.cell.r === 10) passed = true;
    }
    expect(passed).toBe(true); // it walked past the corner and turned away
    expect(w.status).toBe('playing');
    const fin = stand(w, { c: 13, r: 12 }, 'S', 20000);
    expect(fin.some((e) => e.type === 'moment' && e.kind === 'finale')).toBe(true);
    expect(w.moments.finale).toBe(true);
    expect(w.monsters.every((mm) => mm.state === 'alert')).toBe(true);
  });
});
