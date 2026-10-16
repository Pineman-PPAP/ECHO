import { describe, expect, it } from 'vitest';
import { FieldManual, type ManualFrame, type ManualWorldView } from '../src/app/FieldManual';
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
function harness() {
  const manual = new FieldManual(true);
  let frame = manual.update(0, intent(), NOTHING);
  let elapsed = 0;
  const events = [...frame.events];
  const tick = (o: Partial<PlayerIntent> = {}, view = NOTHING, ms = DT) => {
    elapsed += ms; frame = manual.update(ms, intent(o), view); events.push(...frame.events); return frame;
  };
  const solve = () => {
    const id = frame.phase === 'await' ? frame.step?.id : '';
    const o: Partial<PlayerIntent> = id === 'hum' ? { hum: HUM } : id === 'turnLeft' ? { turnRate: 1 } : id === 'turnRight' ? { turnRate: -1 } : id === 'leanIn' ? { moveSpeed: 2.4 } : id === 'leanBack' ? { moveSpeed: -1.2 } : id === 'clapReveal' ? { pulses: [1] } : {};
    return tick(o, id === 'clapReveal' || id === 'watch' ? { hollowAlerted: true, hollowDistanceM: 12 } : NOTHING);
  };
  const reach = (predicate: (f: ManualFrame) => boolean) => {
    for (let i=0;i<10000;i++) { if (predicate(frame)) return; solve(); }
    throw new Error('Intro did not reach target');
  };
  return { manual, tick, reach, solve, events, get frame(){return frame;}, get elapsed(){return elapsed;} };
}

describe('short interactive intro', () => {
  it('starts with the raised sleeping jar, then look, move, Hollow, and finishes in under 25 seconds', () => {
    const h = harness();
    expect(h.frame.beat).toBe('jar'); expect(h.frame.jarShown).toBe(true);
    expect(h.frame.jarOffer).toBe(1);
    h.reach(f => f.phase === 'done');
    expect(h.events.filter(e => e.type === 'beatStart').map(e => e.type === 'beatStart' && e.beat)).toEqual(['jar','look','move','hear']);
    expect(h.events.filter(e => e.type === 'stepDone').map(e => e.type === 'stepDone' && e.step)).toEqual(['hum','quiet','turnLeft','turnRight','leanIn','leanBack','clapReveal','watch']);
    expect(h.elapsed).toBeLessThan(25000);
    expect(h.manual.learnedBasics).toBe(true);
  });
  it('requires actual hum, then silence; a carried hum cannot accidentally skip', () => {
    const h=harness(); h.reach(f=>f.phase==='await');
    for(let i=0;i<60;i++)h.tick({pulses:i===0?[1]:[]});
    expect(h.frame.step?.id).toBe('hum');
    for(let i=0;i<300;i++)h.tick({hum:HUM});
    expect(h.frame.beat).toBe('jar'); expect(h.frame.step?.id).toBe('quiet');
    h.reach(f=>f.beat==='look'); expect(h.frame.jarShown).toBe(true);
  });
  it('rejects the wrong turn direction and requires both forward and backward movement', () => {
    const h=harness(); h.reach(f=>f.step?.id==='turnLeft'&&f.phase==='await');
    for(let i=0;i<60;i++)h.tick({turnRate:-1,moveSpeed:2});
    expect(h.frame.step?.progress).toBe(0);
    h.reach(f=>f.step?.id==='leanIn'&&f.phase==='await');
    for(let i=0;i<60;i++)h.tick({moveSpeed:-1});
    expect(h.frame.step?.id).toBe('leanIn'); expect(h.frame.step?.progress).toBe(0);
    h.reach(f=>f.step?.id==='leanBack'&&f.phase==='await');
    for(let i=0;i<60;i++)h.tick({moveSpeed:1});
    expect(h.frame.step?.id).toBe('leanBack'); expect(h.frame.step?.progress).toBe(0);
  });
  it('does not complete the Hollow encounter until real scene hearing confirms the clap', () => {
    const h=harness(); h.reach(f=>f.step?.id==='clapReveal'&&f.phase==='await');
    h.tick({pulses:[0.2]});
    for(let i=0;i<60;i++)h.tick();
    expect(h.frame.step?.id).toBe('clapReveal'); expect(h.frame.step?.hint).not.toBe('');
    h.tick({}, {hollowAlerted:true,hollowDistanceM:12});
    expect(h.frame.phase).toBe('stepOk');
  });
  it('repeats hints after 20 seconds without falsely completing a lesson; double clap still skips', () => {
    const h=harness(); h.reach(f=>f.phase==='await');
    h.tick({},NOTHING,CONFIG.MANUAL_TIMEOUT_MS); h.tick({},NOTHING,CONFIG.MANUAL_TIMEOUT_MS);
    expect(h.frame.step?.id).toBe('hum'); expect(h.frame.step?.hint).toContain('double clap');
    expect(h.events.filter(e=>e.type==='timeout')).toHaveLength(2);
    h.tick({pulses:[1]});h.tick();h.tick({pulses:[1]});
    expect(h.frame.phase).toBe('end');
    h.reach(f=>f.phase==='done'); expect(h.manual.learnedBasics).toBe(false);
  });
  it('freezes lesson timers while the face is absent', () => {
    const h=harness(); h.reach(f=>f.phase==='await'); const ms=h.frame.phaseMs;
    h.tick({facePresent:false},NOTHING,30000);
    expect(h.frame.paused).toBe(true);expect(h.frame.phaseMs).toBe(ms);
  });
  it('supports held-hum skip outside the firefly lesson and automatically starts after the brief ending', () => {
    const h=harness();h.reach(f=>f.beat==='look'&&f.phase==='await');
    h.tick({hum:HUM},NOTHING,CONFIG.MANUAL_SKIP_HUM_MS);
    expect(h.frame.phase).toBe('end');
    h.tick({},NOTHING,CONFIG.MANUAL_END_AUTO_MS);
    expect(h.frame.phase).toBe('done');
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
