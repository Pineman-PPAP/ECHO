import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cellCenter, parseLevel, type LevelDef } from '../src/game/grid';
import { LEVELS } from '../src/game/levels';
import { Player } from '../src/game/Player';
import { World, type WorldEvent } from '../src/game/World';
import { humFromMic } from '../src/input/mapping';
import { intent } from './helpers';

const corridor: LevelDef = {
  id: 'corridor',
  name: 'corridor',
  startFacing: 'E',
  intro: [],
  map: ['############', '#S........M#', '#########..#', '#E.........#', '############'],
};

function stepFor(w: World, ms: number, i: Parameters<typeof intent>[0], start = { now: 0 }): WorldEvent[] {
  const all: WorldEvent[] = [];
  for (let t = 0; t < ms; t += 16) {
    start.now += 16;
    all.push(...w.update(0.016, start.now, start.now / 1000, intent(i)));
    if (w.status !== 'playing') break;
  }
  return all;
}

describe('Player', () => {
  it('turns left for positive turn rate and cannot walk through walls', () => {
    const l = parseLevel(corridor);
    const p = new Player(l);
    expect(p.yaw).toBeCloseTo(-Math.PI / 2); // facing east
    p.update(1, Math.PI / 2, 0, l); // quarter turn left => facing north
    expect(p.yaw).toBeCloseTo(0);
    for (let i = 0; i < 100; i++) p.update(0.05, 0, CONFIG.MAX_SPEED_FWD, l);
    expect(p.z).toBeGreaterThanOrEqual(CONFIG.CELL_SIZE + CONFIG.PLAYER_RADIUS - 1e-6); // stopped by north wall
  });
  it('reports louder footsteps when walking faster', () => {
    const l = parseLevel(corridor);
    const fast = new Player(l);
    const slow = new Player(l);
    let fastStep = 0;
    let slowStep = 0;
    for (let i = 0; i < 200; i++) {
      fastStep = Math.max(fastStep, fast.update(0.016, 0, CONFIG.MAX_SPEED_FWD, l) ?? 0);
      slowStep = Math.max(slowStep, slow.update(0.016, 0, CONFIG.MAX_SPEED_FWD * 0.3, l) ?? 0);
    }
    expect(fastStep).toBeCloseTo(CONFIG.FOOTSTEP_NOISE_MAX);
    expect(slowStep).toBeLessThan(CONFIG.FOOTSTEP_MIN_AUDIBLE);
  });
});

describe('World', () => {
  it('tutorial levels have no active monsters', () => {
    expect(new World(LEVELS[0]).monstersEnabled).toBe(false);
  });

  it('a clap alerts the monster, which runs to where it heard you and catches a player who stays put', () => {
    const w = new World(corridor);
    const m = w.monsters[0];
    w.player.x = cellCenter({ c: 4, r: 1 }).x; // 6 cells = 18 m from the monster (a clap carries ~24 m)
    const clock = { now: 0 };
    const ev = stepFor(w, 16, { pulses: [1] }, clock);
    expect(ev.some((e) => e.type === 'pulse')).toBe(true);
    expect(ev.some((e) => e.type === 'heard')).toBe(true);
    expect(ev.filter((e) => e.type === 'alerted')).toHaveLength(1);
    expect(m.state).toBe('alert');
    const after = stepFor(w, 10000, {}, clock);
    expect(after.some((e) => e.type === 'caught')).toBe(true);
    expect(w.status).toBe('caught');
  });

  it('each pulse reveals a monster once, when its wavefront arrives', () => {
    const w = new World(corridor);
    const m = w.monsters[0];
    w.player.x = cellCenter({ c: 4, r: 1 }).x;
    const d = Math.hypot(m.x - w.player.x, m.z - w.player.z);
    const clock = { now: 0 };
    stepFor(w, 16, { pulses: [1.5] }, clock);
    const reveals = stepFor(w, 3000, {}, clock).filter((e) => e.type === 'reveal');
    expect(reveals).toHaveLength(1);
    expect(d).toBeLessThan(CONFIG.PULSE_MAX_RADIUS);
  });

  it('a quiet click does not reach a far monster', () => {
    const w = new World(corridor);
    const ev = stepFor(w, 16, { pulses: [0.05] }, { now: 0 });
    expect(ev.some((e) => e.type === 'heard')).toBe(false);
    expect(w.monsters[0].state).toBe('idle');
  });

  it('the firefly jar reveals a monster within its light, throttled', () => {
    const hum = humFromMic(60, 220, 30); // a loud hum: full glow
    const near = new World(corridor);
    near.player.x = cellCenter({ c: 8, r: 1 }).x; // monster is 2 cells = 6 m east
    const reveals = stepFor(near, 1500, { hum }, { now: 0 }).filter((e) => e.type === 'reveal');
    expect(near.jar.radius).toBeGreaterThan(6);
    expect(reveals.length).toBeGreaterThanOrEqual(6);
    expect(reveals.length).toBeLessThanOrEqual(1500 / CONFIG.JAR_AFTERIMAGE_INTERVAL_MS + 1);
    const far = new World(corridor);
    far.player.x = cellCenter({ c: 6, r: 1 }).x; // 12 m: beyond the jar's reach
    expect(stepFor(far, 1500, { hum }).some((e) => e.type === 'reveal')).toBe(false);
  });

  it('the jar light lights all around (not a cone) but not through rock', () => {
    const hum = humFromMic(60, 220, 30);
    const behind = new World(corridor);
    behind.player.x = cellCenter({ c: 8, r: 1 }).x;
    behind.player.yaw += Math.PI; // looking away from the monster
    expect(stepFor(behind, 1000, { hum }).some((e) => e.type === 'reveal')).toBe(true);
    const walled = new World({ id: 'w', name: 'w', startFacing: 'E', intro: [], map: ['#####', '#S#M#', '#...#', '#E..#', '#####'] });
    walled.monstersEnabled = false; // keep it still behind the wall
    expect(stepFor(walled, 1000, { hum }).some((e) => e.type === 'reveal')).toBe(false);
  });

  it('a hum is heard only up close', () => {
    const hum = humFromMic(60, 520, 30); // as loud as a hum gets
    const far = new World(corridor);
    far.player.x = cellCenter({ c: 8, r: 1 }).x; // 2 cells = 6 m from the monster
    expect(stepFor(far, 700, { hum }).some((e) => e.type === 'heard')).toBe(false);
    const near = new World(corridor);
    near.player.x = cellCenter({ c: 9, r: 1 }).x; // 3 m
    expect(stepFor(near, 700, { hum }).some((e) => e.type === 'heard')).toBe(true);
  });

  it('walking is heard, sneaking is not', () => {
    const run = (speed: number) => {
      const w = new World(corridor);
      w.player.x = cellCenter({ c: 6, r: 1 }).x; // 12 m from the monster, walking toward it
      return stepFor(w, 1500, { moveSpeed: speed }).some((e) => e.type === 'heard');
    };
    expect(run(CONFIG.MAX_SPEED_FWD)).toBe(true);
    expect(run(CONFIG.MAX_SPEED_FWD * 0.3)).toBe(false);
  });

  it('reaching the exit ends the level', () => {
    const w = new World(corridor);
    const e = cellCenter(w.level.exit);
    w.player.x = e.x + 0.5;
    w.player.z = e.z;
    const ev = stepFor(w, 16, {}, { now: 0 });
    expect(ev).toContainEqual({ type: 'exit' });
    expect(w.status).toBe('escaped');
    expect(stepFor(w, 100, { pulses: [1] }, { now: 100 })).toEqual([]);
  });

  it('danger rises as a hunting monster approaches', () => {
    const w = new World(corridor);
    expect(w.danger()).toBe(0);
    const m = w.monsters[0];
    m.state = 'alert';
    m.x = w.player.x + 3;
    m.z = w.player.z;
    expect(w.danger()).toBeCloseTo(1 - 3 / CONFIG.DANGER_RADIUS);
  });
});
