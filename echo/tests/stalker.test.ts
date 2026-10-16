import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import type { LevelDef } from '../src/game/grid';
import { Stalker } from '../src/game/Stalker';
import { World, type WorldEvent } from '../src/game/World';
import type { PlayerIntent } from '../src/input/intent';
import { intent } from './helpers';

/** A straight corridor: start at (1,1) facing east, a pot at (7,1), a Hollow far off at (10,1). */
function corridor(tutorial = false): LevelDef {
  return {
    id: 'stalker',
    name: 'stalker',
    startFacing: 'E',
    intro: [],
    tutorial,
    map: ['############', '#S........M#', '#########..#', '#E.........#', '############'],
    pots: [{ c: 7, r: 1, dx: 0, dz: 0 }],
  };
}

const DT = 0.016;

/** Walks into the pot, then stops dead. Returns the world and every event so far. */
function breakPot(def = corridor()): { w: World; events: WorldEvent[]; t: number } {
  const w = new World(def);
  w.player.x = w.pots.list[0].x - 1.5;
  const events: WorldEvent[] = [];
  let t = 0;
  while (!w.pots.list[0].broken && t < 3000) {
    t += 16;
    events.push(...w.update(DT, t, t / 1000, intent({ moveSpeed: 1.2 })));
  }
  return { w, events, t };
}

/** Runs until the predicate holds (or ms pass), with `input(t)` as the player each frame. */
function runUntil(w: World, from: number, ms: number, input: (t: number) => Partial<PlayerIntent>, until: (e: WorldEvent[]) => boolean): { events: WorldEvent[]; t: number } {
  const events: WorldEvent[] = [];
  let t = from;
  while (t < from + ms) {
    t += 16;
    events.push(...w.update(DT, t, t / 1000, intent(input(t))));
    if (until(events) || w.status !== 'playing') break;
  }
  return { events, t };
}

const has = (what: string) => (events: WorldEvent[]) => events.some((e) => e.type === 'stalker' && e.what === what);

describe('the Stalker', () => {
  it('a broken pot summons it behind the player, and the Hollows do not hear the crash', () => {
    const { w, events } = breakPot();
    expect(events.some((e) => e.type === 'potKicked')).toBe(true);
    expect(has('start')(events)).toBe(true);
    expect(events.some((e) => e.type === 'heard' || e.type === 'alerted')).toBe(false);
    expect(w.stalker.phase).toBe('approach');
    expect(w.stalker.distanceTo(w.player.x, w.player.z)).toBeGreaterThan(CONFIG.STALKER_WARN_M);
    expect(w.stalker.x).toBeLessThan(w.player.x); // behind a player facing east
  });

  it('comes closer, warns, stares; standing silent and still sends it away and the game goes on', () => {
    const { w, t } = breakPot();
    let last = w.stalker.distanceTo(w.player.x, w.player.z);
    const approach = runUntil(w, t, 15000, () => ({}), (e) => {
      const d = w.stalker.distanceTo(w.player.x, w.player.z);
      expect(d).toBeLessThanOrEqual(last + 1e-9);
      last = d;
      return has('warn')(e);
    });
    expect(has('warn')(approach.events)).toBe(true);
    const stare = runUntil(w, approach.t, CONFIG.STALKER_WARN_MS + 500, () => ({}), has('stare'));
    expect(has('stare')(stare.events)).toBe(true);
    expect(w.stalker.distanceTo(w.player.x, w.player.z)).toBeCloseTo(CONFIG.STALKER_STARE_M);
    const after = runUntil(w, stare.t, 15000, () => ({}), has('gone'));
    expect(has('spared')(after.events)).toBe(true);
    expect(has('gone')(after.events)).toBe(true);
    expect(w.status).toBe('playing');
    expect(w.stalker.phase).toBe('idle');
  });

  it('you may still move and make noise while it is only coming', () => {
    const { w, t } = breakPot();
    const r = runUntil(w, t, 15000, (now) => ({ turnRate: 1, pulses: now % 800 === 0 ? [1] : [] }), has('warn'));
    expect(w.status).toBe('playing');
    expect(has('warn')(r.events)).toBe(true);
  });

  /** Breaks the pot and waits, silent and still, until its face appears. */
  function toStare(): { w: World; t: number } {
    const { w, t } = breakPot();
    const r = runUntil(w, t, 20000, () => ({}), has('stare'));
    expect(w.stalker.phase).toBe('stare');
    // Past the grace moment, still silent and still.
    const g = runUntil(w, r.t, CONFIG.STALKER_STARE_GRACE_MS + 32, () => ({}), () => false);
    expect(w.status).toBe('playing');
    return { w, t: g.t };
  }

  it.each([
    ['walking', { moveSpeed: 1 }],
    ['turning the head', { turnRate: 1.5 }],
    ['a clap', { pulses: [0.6] }],
    ['a hum', { hum: { level: 0.5, pitch01: 0.5 } }],
  ] as const)('during the stare, %s gets you caught', (_name, input) => {
    const { w, t } = toStare();
    const r = runUntil(w, t, 500, () => input as Partial<PlayerIntent>, () => false);
    expect(w.status).toBe('caught');
    expect(r.events.some((e) => e.type === 'caught' && e.by === 'stalker')).toBe(true);
  });

  it('a tiny drift of the head under the limits is not movement', () => {
    const { w, t } = toStare();
    runUntil(w, t, CONFIG.STALKER_STARE_MS, () => ({ turnRate: CONFIG.STALKER_TURN_LIMIT_RAD_S * 0.5 }), has('spared'));
    expect(w.status).toBe('playing');
  });

  it('holds the Hollows still while it comes', () => {
    const { w, t } = breakPot();
    const m = w.monsters[0];
    const at = { x: m.x, z: m.z };
    runUntil(w, t, 3000, () => ({ pulses: [1] }), () => false);
    expect(w.stalker.holding).toBe(true);
    expect({ x: m.x, z: m.z }).toEqual(at);
  });

  it('never comes in the tutorial', () => {
    const { w, events } = breakPot(corridor(true));
    expect(w.pots.list[0].broken).toBe(true);
    expect(has('start')(events)).toBe(false);
    expect(w.stalker.phase).toBe('idle');
  });

  it('a second pot while it is coming does not summon another', () => {
    const s = new Stalker();
    const rand = () => 0.5;
    expect(s.start(0, 0, 0, rand)).toBe(true);
    expect(s.start(0, 0, 0, rand)).toBe(false);
  });
});
