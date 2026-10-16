import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { Ambience, type AmbientCue } from '../src/game/ambience';
import { cellCenter, facingToYaw, yawForward, type LevelDef } from '../src/game/grid';
import { mulberry32 } from '../src/game/rng';
import { chaseSpeed } from '../src/game/sight';
import { World, type WorldEvent } from '../src/game/World';
import { intent } from './helpers';

const corridor: LevelDef = {
  id: 'corridor',
  name: 'corridor',
  startFacing: 'E',
  intro: [],
  map: ['############', '#S........M#', '#########..#', '#E.........#', '############'],
};

/** The Hollow is walled into a pocket, so only the Hush can reach the player. */
const sealed: LevelDef = {
  id: 'sealed',
  name: 'sealed',
  startFacing: 'E',
  hush: true,
  intro: [],
  map: ['#######', '#S...E#', '#######', '#M#####', '#######'],
};

const clock = () => ({ now: 0 });
function run(w: World, ms: number, i: Parameters<typeof intent>[0], c: { now: number }): WorldEvent[] {
  const all: WorldEvent[] = [];
  for (let t = 0; t < ms; t += 16) {
    c.now += 16;
    all.push(...w.update(0.016, c.now, c.now / 1000, intent(i)));
    if (w.status !== 'playing') break;
  }
  return all;
}
/** A corridor world with the Hollow 8 m east of the player, facing them. */
function standoff(): World {
  const w = new World(corridor);
  const p = cellCenter({ c: 2, r: 1 });
  w.player.x = p.x;
  w.player.z = p.z;
  const m = w.monsters[0];
  m.x = p.x + 8;
  m.faceToward(w.player.x, w.player.z);
  return w;
}

describe('blind hunters', () => {
  it('a Hollow facing you down a clear corridor does not notice a silent player', () => {
    const w = standoff();
    const m = w.monsters[0];
    expect(w.eyes().map((e) => e.id)).toEqual([m.id]); // you can see its eyes, but it can't see you
    const events = run(w, 3000, {}, clock());
    expect(events.some((e) => e.type === 'alerted')).toBe(false);
    expect(m.state).not.toBe('alert');
    expect(w.status).toBe('playing');
  });

  it('a clap calls it: it runs at you, faster than you can walk from far away', () => {
    const w = standoff();
    const m = w.monsters[0];
    const c = clock();
    const start = { x: m.x, z: m.z };
    const first = run(w, 16, { pulses: [1] }, c);
    expect(first.filter((e) => e.type === 'alerted').map((e) => e.type === 'alerted' && e.monsterId)).toEqual([m.id]);
    run(w, 1000, {}, c);
    const moved = Math.hypot(m.x - start.x, m.z - start.z);
    expect(moved).toBeGreaterThan(CONFIG.MAX_SPEED_FWD); // faster than you can walk at 8 m
    expect(moved).toBeLessThanOrEqual(chaseSpeed(8) * 1.05);
  });

  it('it goes where it heard you, not where you are: slip away quietly and it searches the old spot', () => {
    const w = new World(corridor);
    const m = w.monsters[0];
    const c = clock();
    const clapAt = cellCenter({ c: 5, r: 1 });
    w.player.x = clapAt.x;
    run(w, 16, { pulses: [1] }, c);
    expect(m.goal).toEqual({ x: clapAt.x, z: clapAt.z });
    w.player.x = cellCenter({ c: 1, r: 1 }).x; // 12 m away, without a sound
    run(w, 8000, {}, c);
    expect(m.state).toBe('search');
    expect(w.status).toBe('playing');
  });

  it('reaches a player standing off-centre in a cell (it does not stop at the cell centre)', () => {
    const w = standoff();
    const m = w.monsters[0];
    const p = w.player;
    p.z -= 1.3; // near the cell's north wall: 1.3 m from the centre, beyond catch distance
    m.hear(w.level, p.x, p.z);
    run(w, 8000, {}, clock());
    expect(w.status).toBe('caught');
  });

  it('a heard clap turns a Hollow to face the player: its eyes appear', () => {
    const w = new World(corridor);
    const m = w.monsters[0];
    m.heading = Math.PI; // facing away (north)
    w.player.x = cellCenter({ c: 4, r: 1 }).x;
    expect(w.eyes()).toHaveLength(0);
    run(w, 16, { pulses: [1] }, clock());
    expect(m.state).toBe('alert');
    expect(w.eyes()).toHaveLength(1);
  });
});

describe('the Hush in a level', () => {
  it('catches a player who hides in silence', () => {
    const w = new World(sealed);
    const ev = run(w, 40000, {}, clock());
    expect(ev.some((e) => e.type === 'hush' && e.what === 'appear')).toBe(true);
    expect(ev).toContainEqual({ type: 'caught', by: 'hush', monsterId: -1 });
  });

  it('a clap drives it off, and a pulse reveals it as a pale afterimage', () => {
    const w = new World(sealed);
    const c = clock();
    run(w, CONFIG.HUSH_SILENCE_MS + 4000, {}, c);
    expect(w.hush?.present).toBe(true);
    expect(w.hushCloseness()).toBeGreaterThan(0);
    const ev = [...run(w, 16, { pulses: [1.5] }, c), ...run(w, 1500, {}, c)];
    expect(ev.some((e) => e.type === 'hush' && e.what === 'gone')).toBe(true);
    expect(w.hushCloseness()).toBe(0);
    const w2 = new World(sealed);
    const c2 = clock();
    run(w2, CONFIG.HUSH_SILENCE_MS + 8000, {}, c2);
    const reveal = [...run(w2, 16, { pulses: [0.6] }, c2), ...run(w2, 800, {}, c2)].find((e) => e.type === 'reveal' && e.who === 'hush');
    expect(reveal).toBeDefined();
  });

  it('levels without the flag have no Hush', () => {
    expect(new World(corridor).hush).toBeNull();
  });
});

describe('sound design hooks', () => {
  it('the drone falls silent as a Hollow comes close', () => {
    const w = standoff();
    w.monsters[0].x = w.player.x + CONFIG.DRONE_CUT_RADIUS_M + 1;
    expect(w.droneLevel()).toBe(1);
    w.monsters[0].x = w.player.x + CONFIG.DRONE_SILENT_RADIUS_M - 0.5;
    expect(w.droneLevel()).toBe(0);
  });

  it('a Hollow close by but not in front of you breathes in one ear', () => {
    const w = standoff();
    const m = w.monsters[0];
    m.x = w.player.x + 3; // east = ahead
    expect(w.earBreath()).toBeNull();
    w.player.yaw = facingToYaw('N'); // east is now on the right
    expect(w.earBreath()?.side).toBe(1);
    w.player.yaw = facingToYaw('S');
    expect(w.earBreath()?.side).toBe(-1);
  });
});

describe('Ambience', () => {
  it('plays fake scrapes only when no Hollow is near and not in quiet stretches', () => {
    const count = (near: number, quiet: boolean) => {
      const a = new Ambience(mulberry32(4));
      let n = 0;
      for (let t = 0; t <= 120000; t += 100) n += a.update(t, 0, 0, 0, near, [], quiet).filter((e) => e.cue === 'fakeScrape').length;
      return n;
    };
    expect(count(50, false)).toBeGreaterThanOrEqual(Math.floor(120000 / CONFIG.FAKE_SCRAPE_MAX_MS));
    expect(count(2, false)).toBe(0);
    expect(count(50, true)).toBe(0);
  });

  it('now and then copies a clap: late, from behind, never more often than the cooldown', () => {
    const a = new Ambience(mulberry32(9));
    const yaw = 0.4;
    const mimics: Array<{ t: number; cue: AmbientCue }> = [];
    for (let t = 0; t <= 600000; t += 50) {
      const claps = t % 5000 === 0 ? [1] : [];
      for (const cue of a.update(t, 0, 0, yaw, 50, claps, false)) if (cue.cue === 'mimic') mimics.push({ t, cue });
    }
    expect(mimics.length).toBeGreaterThan(2);
    const f = yawForward(yaw);
    for (let i = 0; i < mimics.length; i++) {
      const m = mimics[i];
      expect(m.t % 5000).toBeGreaterThanOrEqual(CONFIG.MIMIC_DELAY_MS);
      expect(m.cue.x * f.x + m.cue.z * f.z).toBeLessThan(0);
      if (i > 0) expect(m.t - mimics[i - 1].t).toBeGreaterThanOrEqual(CONFIG.MIMIC_COOLDOWN_MS);
    }
  });
});
