import { describe, expect, it } from 'vitest';
import { FieldManual, type ManualEvent, type ManualFrame, type ManualWorldView } from '../src/app/FieldManual';
import { CONFIG } from '../src/config';
import { cellCenter, findPath, isWall, lineOfSight, parseLevel } from '../src/game/grid';
import { FIELD_MANUAL_LEVEL, FIELD_MANUAL_STAGE, LEVELS } from '../src/game/levels';
import { Tutorial } from '../src/game/Tutorial';
import { World } from '../src/game/World';
import type { PlayerIntent } from '../src/input/intent';
import { humFromMic } from '../src/input/mapping';
import { blendPose, restPose, shotPose } from '../src/render/CinematicCamera';
import { intent } from './helpers';

const DT = 1000 / 60;
const HUM = humFromMic(30, 220, 30);
const NOTHING: ManualWorldView = { hollowDistanceM: null, hollowAlerted: false };

/** The intent (and what the scene reports) that does whatever the current step asks. */
function solve(f: ManualFrame): { o: Partial<PlayerIntent>; view: ManualWorldView } {
  if (f.phase !== 'await' || !f.step) return { o: {}, view: NOTHING };
  switch (f.step.id) {
    case 'turnLeft':
      return { o: { turnRate: 1 }, view: NOTHING };
    case 'turnRight':
      return { o: { turnRate: -1 }, view: NOTHING };
    case 'leanIn':
      return { o: { moveSpeed: 2.4 }, view: NOTHING };
    case 'hum':
      return { o: { hum: HUM }, view: NOTHING };
    case 'clap':
    case 'softLoud':
    case 'clapAgain':
    case 'sound':
      return { o: { pulses: [1] }, view: NOTHING };
    case 'clapReveal':
      return { o: { pulses: [1] }, view: { hollowDistanceM: 12, hollowAlerted: true } };
    case 'watch':
      return { o: {}, view: { hollowDistanceM: CONFIG.MANUAL_HOLLOW_HALT_M - 0.1, hollowAlerted: true } };
    default:
      return { o: {}, view: NOTHING };
  }
}

function harness(sim = false) {
  const manual = new FieldManual(sim);
  const events: ManualEvent[] = [];
  let frame = manual.update(0, intent(), NOTHING);
  events.push(...frame.events);
  const tick = (o: Partial<PlayerIntent> = {}, view: ManualWorldView = NOTHING, ms = DT): ManualFrame => {
    frame = manual.update(ms, intent(o), view);
    events.push(...frame.events);
    return frame;
  };
  /** Ticks with a fixed intent until `until` holds; false if it never did within maxMs. */
  const run = (o: Partial<PlayerIntent>, until: (f: ManualFrame) => boolean, maxMs = 120000, view: ManualWorldView = NOTHING): boolean => {
    for (let t = 0; t < maxMs; t += DT) if (until(tick(o, view))) return true;
    return false;
  };
  /** Plays every step correctly until `until` holds. */
  const play = (until: (f: ManualFrame) => boolean, maxMs = 300000): boolean => {
    for (let t = 0; t < maxMs; t += DT) {
      const { o, view } = solve(frame);
      if (until(tick(o, view))) return true;
    }
    return false;
  };
  const awaiting = (beat: string, step?: string) => (f: ManualFrame) => f.phase === 'await' && f.beat === beat && (!step || f.step?.id === step);
  return { manual, events, tick, run, play, awaiting, get frame() { return frame; } };
}

describe('Field Manual', () => {
  it('teaches every lesson in order, each passing only when the player does it', () => {
    const h = harness();
    expect(h.frame.beat).toBe('dark');
    expect(h.frame.held).toBe(true);
    expect(h.play(h.awaiting('look'))).toBe(true);
    const order: string[] = [];
    h.play((f) => {
      if (f.phase === 'await' && f.step && order[order.length - 1] !== `${f.beat}/${f.step.id}`) order.push(`${f.beat}/${f.step.id}`);
      return f.phase === 'end';
    });
    expect(order).toEqual([
      'look/turnLeft',
      'look/turnRight',
      'move/leanIn',
      'move/sitBack',
      'clap/clap',
      'clap/softLoud',
      'jar/hum',
      'jar/quiet',
      'hear/clapReveal',
      'hear/watch',
      'hear/clapAgain',
      'freeze/hold',
      'hush/sound',
    ]);
    expect(h.events.filter((e) => e.type === 'timeout')).toEqual([]);
    expect(h.events.some((e) => e.type === 'place' && e.beat === 'hear')).toBe(true);
    expect(h.manual.learnedBasics).toBe(true);

    // The recap ignores the clap that ended the last lesson, then a clap starts the game.
    h.tick({ pulses: [1] });
    expect(h.frame.phase).toBe('end');
    h.run({}, (f) => f.phaseMs >= CONFIG.MANUAL_END_MIN_MS);
    h.tick({ pulses: [1] });
    expect(h.frame.phase).toBe('done');
    expect(h.events[h.events.length - 1]).toEqual({ type: 'finished' });
  });

  it('only accepts the action each step asks for', () => {
    const h = harness();
    h.play(h.awaiting('look', 'turnLeft'));
    // (Under MANUAL_SKIP_HUM_MS: a longer hum would skip the manual.)
    h.run({ pulses: [1], hum: HUM, turnRate: -1, moveSpeed: 2 }, () => false, CONFIG.MANUAL_SKIP_HUM_MS - 500);
    expect(h.frame.step?.id).toBe('turnLeft');
    expect(h.frame.step?.progress).toBe(0);

    h.play(h.awaiting('move', 'leanIn'));
    h.run({ turnRate: 1, pulses: [1], moveSpeed: -1 }, () => false, 3000);
    expect(h.frame.step?.progress).toBe(0);

    h.play(h.awaiting('clap', 'clap'));
    h.run({ turnRate: 1, moveSpeed: 1, hum: HUM }, () => false, CONFIG.MANUAL_SKIP_HUM_MS - 500);
    expect(h.frame.step?.id).toBe('clap');
    h.tick({ pulses: [0.4] });
    expect(h.frame.phase).toBe('stepOk');
  });

  it('runs in slow motion while waiting, and at full speed while the player acts', () => {
    const h = harness();
    h.play(h.awaiting('look', 'turnLeft'));
    h.run({}, () => false, CONFIG.MANUAL_ACTION_HOLD_MS + 100);
    expect(h.frame.slow).toBe(true);
    h.tick({ turnRate: 0.3 });
    expect(h.frame.slow).toBe(false);
  });

  it('shows the hint after MANUAL_HINT_MS and passes the step for the player after MANUAL_TIMEOUT_MS', () => {
    const h = harness();
    h.play(h.awaiting('look', 'turnLeft'));
    h.run({}, () => false, CONFIG.MANUAL_HINT_MS - 200);
    expect(h.frame.step?.hint).toBe('');
    h.run({}, () => false, 400);
    expect(h.frame.step?.hint).not.toBe('');
    expect(h.run({}, (f) => f.phase === 'confirm')).toBe(true);
    expect(h.frame.timedOut).toBe(true);
    expect(h.events.some((e) => e.type === 'timeout' && e.beat === 'look')).toBe(true);
    expect(h.events.some((e) => e.type === 'beatDone' && e.beat === 'look' && !e.learned)).toBe(true);
  });

  it('never soft-locks: doing nothing at all still reaches the game', () => {
    const h = harness();
    expect(h.run({}, (f) => f.phase === 'done', 10 * 60000)).toBe(true);
    expect(h.events.filter((e) => e.type === 'timeout').length).toBeGreaterThanOrEqual(6);
    expect(h.events.some((e) => e.type === 'finished')).toBe(true);
    expect(h.manual.learnedBasics).toBe(false);
  });

  it('skips to the recap when the player hums for MANUAL_SKIP_HUM_MS', () => {
    const h = harness();
    h.play(h.awaiting('look'));
    h.run({ hum: HUM }, () => false, CONFIG.MANUAL_SKIP_HUM_MS - 200);
    expect(h.frame.phase).toBe('await');
    expect(h.frame.skip.progress).toBeGreaterThan(0.8);
    h.run({ hum: HUM }, () => false, 300);
    expect(h.frame.phase).toBe('end');
    expect(h.events.some((e) => e.type === 'skip')).toBe(true);
    expect(h.manual.learnedBasics).toBe(false);
  });

  it('never skips on the jar lesson’s hum, even when the hum carries on into the next lesson', () => {
    const h = harness();
    h.play(h.awaiting('jar', 'hum'));
    expect(h.frame.skip.shown).toBe(false);
    h.run({ hum: HUM }, () => false, 2 * CONFIG.MANUAL_SKIP_HUM_MS);
    h.play((f) => f.beat === 'jar' && f.phase === 'confirm');
    // Humming from the jar's confirm straight into the next lesson does not count as a skip.
    expect(h.run({ hum: HUM }, (f) => f.beat === 'hear' && f.phase === 'setup')).toBe(true);
    h.run({ hum: HUM }, () => false, 2 * CONFIG.MANUAL_SKIP_HUM_MS);
    expect(h.events.some((e) => e.type === 'skip')).toBe(false);
  });

  it('waits while the face is away', () => {
    const h = harness();
    h.play(h.awaiting('move', 'leanIn'));
    const before = h.frame.phaseMs;
    h.run({ facePresent: false }, () => false, 2 * CONFIG.MANUAL_TIMEOUT_MS);
    expect(h.frame.paused).toBe(true);
    expect(h.frame.phaseMs).toBe(before);
    h.tick();
    expect(h.frame.phase).toBe('await');
    expect(h.frame.step?.id).toBe('leanIn');
  });

  it('freeze: moving or a sound during the stare starts the count again; stillness passes', () => {
    const h = harness();
    h.play(h.awaiting('freeze', 'hold'));
    expect(h.frame.stare).toBe(true);
    h.run({}, () => false, 1500);
    const fails = () => h.events.filter((e) => e.type === 'freezeFail').length;
    h.tick({ turnRate: CONFIG.STALKER_TURN_LIMIT_RAD_S * 2 });
    expect(fails()).toBe(1);
    expect(h.frame.step?.progress).toBe(0);
    // A tiny drift under the limits is not movement.
    h.run({ turnRate: CONFIG.STALKER_TURN_LIMIT_RAD_S * 0.5 }, () => false, 1000);
    h.tick({ hum: HUM });
    expect(fails()).toBe(2);
    expect(h.run({}, (f) => f.phase === 'confirm', CONFIG.MANUAL_FREEZE_MS + CONFIG.MANUAL_FREEZE_GRACE_MS + 200)).toBe(true);
    expect(h.frame.stare).toBe(false);
    expect(h.frame.timedOut).toBe(false);
  });

  it('wakes the Hollow only for its own lesson, and only a clap it heard counts', () => {
    const h = harness();
    let activeOutside = false;
    h.play((f) => {
      if (f.hollowActive && f.beat !== 'hear') activeOutside = true;
      return f.beat === 'hear' && f.phase === 'await';
    });
    expect(activeOutside).toBe(false);
    expect(h.frame.hollowActive).toBe(true);
    // Too soft: it didn't hear. The hint says so at once.
    h.tick({ pulses: [0.2] });
    h.run({}, () => false, CONFIG.MANUAL_HEARD_WAIT_MS + 50);
    expect(h.frame.step?.id).toBe('clapReveal');
    expect(h.frame.step?.hint).toContain('Louder');
    h.tick({ pulses: [1] }, { hollowDistanceM: 12, hollowAlerted: true });
    h.run({}, (f) => f.step?.id === 'watch' && f.phase === 'await', 5000, { hollowDistanceM: 12, hollowAlerted: true });
    expect(h.frame.hollowActive).toBe(true);
    h.tick({}, { hollowDistanceM: CONFIG.MANUAL_HOLLOW_HALT_M - 0.2, hollowAlerted: true });
    expect(h.frame.hollowActive).toBe(false);
    h.play((f) => f.beat === 'freeze');
    expect(h.frame.hollowActive).toBe(false);
  });

  it('raises the jar at its lesson and keeps it', () => {
    const h = harness();
    h.play((f) => f.beat === 'clap');
    expect(h.frame.jarShown).toBe(false);
    h.play((f) => f.beat === 'jar' && f.phase === 'setup');
    expect(h.frame.jarShown).toBe(true);
    expect(h.frame.jarOffer).toBe(1);
    h.play((f) => f.beat === 'hear');
    expect(h.frame.jarShown).toBe(true);
    expect(h.frame.jarOffer).toBe(0);
  });

  it('shows the sim key hints only in sim mode', () => {
    const sim = harness(true);
    sim.play(sim.awaiting('look'));
    expect(sim.frame.step?.text).toContain('[hold ←]');
    const real = harness(false);
    real.play(real.awaiting('look'));
    expect(real.frame.step?.text).not.toContain('[');
  });
});

describe('Field Manual practice cave', () => {
  const level = parseLevel(FIELD_MANUAL_LEVEL);
  const start = cellCenter(FIELD_MANUAL_STAGE.start);
  const reachable: Array<{ c: number; r: number }> = [];
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      if (!isWall(level, c, r) && findPath(level, level.start, { c, r }) !== null) reachable.push({ c, r });
    }
  }

  it('is not one of the game’s levels', () => {
    expect(LEVELS).not.toContain(FIELD_MANUAL_LEVEL);
    expect(level.start).toEqual(FIELD_MANUAL_STAGE.start);
  });

  it('can never be escaped, and the Hollow’s pocket is out of reach of any pulse', () => {
    expect(findPath(level, level.start, level.exit)).toBeNull();
    const spawn = cellCenter(level.monsterSpawns[0]);
    expect(findPath(level, level.start, level.monsterSpawns[0])).toBeNull();
    for (const cell of reachable) {
      const p = cellCenter(cell);
      expect(Math.hypot(p.x - spawn.x, p.z - spawn.z)).toBeGreaterThan(CONFIG.PULSE_MAX_RADIUS);
    }
  });

  it('puts the Hollow in plain line down the tunnel, within a normal clap’s reach', () => {
    const h = cellCenter(FIELD_MANUAL_STAGE.hollow);
    expect(lineOfSight(level, start.x, start.z, h.x, h.z)).toBe(true);
    const d = Math.hypot(h.x - start.x, h.z - start.z);
    expect(d).toBeGreaterThan(CONFIG.MANUAL_HOLLOW_HALT_M + 4);
    expect(d).toBeLessThan(CONFIG.PULSE_MIN_RADIUS + (CONFIG.PULSE_MAX_RADIUS - CONFIG.PULSE_MIN_RADIUS) / 1.5);
  });

  it('runs the real hearing: off by default, and a clap sends the Hollow up the tunnel', () => {
    const w = new World(FIELD_MANUAL_LEVEL, 1);
    expect(w.monstersEnabled).toBe(false);
    expect(w.hush).toBeNull();
    const m = w.monsters[0];
    m.placeAt(FIELD_MANUAL_STAGE.hollow);
    const d0 = Math.hypot(m.x - w.player.x, m.z - w.player.z);
    w.monstersEnabled = true;
    let t = 0;
    w.update(DT / 1000, t, t / 1000, intent({ pulses: [1] }));
    expect(m.state).toBe('alert');
    for (let i = 0; i < 60; i++) {
      t += DT;
      w.update(DT / 1000, t, t / 1000, intent());
    }
    expect(Math.hypot(m.x - w.player.x, m.z - w.player.z)).toBeLessThan(d0 - 1.5);
    expect(w.status).toBe('playing');
  });
});

describe('cinematic camera', () => {
  it('holds the first keyframe before it and the last after it, and blends from the plain view', () => {
    const keys = CONFIG.MANUAL_SHOTS.hear;
    expect(shotPose('hear', -1).fov).toBe(keys[0].fov);
    expect(shotPose('hear', 100).fov).toBe(keys[keys.length - 1].fov);
    const mid = shotPose('hear', keys[keys.length - 1].t / 2).fov;
    expect(mid).toBeLessThan(keys[0].fov);
    expect(mid).toBeGreaterThan(keys[keys.length - 1].fov);
    expect(blendPose(shotPose('hear', 100), 0)).toEqual(restPose());
    expect(blendPose(shotPose('dark', 0), 1)).toEqual(shotPose('dark', 0));
  });
});

describe('Tutorial after the Field Manual', () => {
  it('starts at the last step (just the way out) when the manual already taught the controls', () => {
    const world = new World(LEVELS[0], 1);
    const t = new Tutorial(world, false, 'exit');
    expect(t.step).toBe('exit');
    t.update(1 / 60, intent({ pulses: [1] }), [{ type: 'pulse', pulse: world.pulses.add(0, 1, 0, 0, 1) }]);
    expect(t.step).toBe('exit');
  });
});
