import { describe, expect, it } from 'vitest';
import { CONFIG } from '../src/config';
import { cellCenter, facingToYaw, parseLevel, type LevelDef } from '../src/game/grid';
import { chaseSpeed, eyeGlow, hollowSpeed, inView, sideOf } from '../src/game/sight';

const corridor: LevelDef = {
  id: 'corridor',
  name: 'corridor',
  startFacing: 'E',
  intro: [],
  map: ['############', '#S........M#', '#########..#', '#E.........#', '############'],
};
const l = parseLevel(corridor);
const east = facingToYaw('E');
const west = Math.atan2(-1, 0); // heading (atan2(dx, dz)) for walking toward -x

describe('inView / sideOf', () => {
  it('sees ahead but not behind or far to the side', () => {
    expect(inView(0, 0, east, 10, 0)).toBe(true);
    expect(inView(0, 0, east, 10, 5)).toBe(true);
    expect(inView(0, 0, east, -10, 0)).toBe(false);
    expect(inView(0, 0, east, 1, 10)).toBe(false);
  });
  it('tells left from right', () => {
    // Facing east (+x), south (+z) is on the right.
    expect(sideOf(0, 0, east, 5, 3)).toBe(1);
    expect(sideOf(0, 0, east, 5, -3)).toBe(-1);
  });
});

describe('eyeGlow', () => {
  const p = cellCenter({ c: 2, r: 1 });
  const m = cellCenter({ c: 8, r: 1 });
  it('glows when the Hollow faces the player down a clear corridor', () => {
    expect(eyeGlow(l, p.x, p.z, m.x, m.z, west)).toBeGreaterThan(0);
  });
  it('is dark when the Hollow faces away', () => {
    expect(eyeGlow(l, p.x, p.z, m.x, m.z, west + Math.PI)).toBe(0);
  });
  it('is dark through walls', () => {
    const below = cellCenter({ c: 8, r: 3 });
    expect(eyeGlow(l, p.x, p.z, below.x, below.z, Math.atan2(p.x - below.x, p.z - below.z))).toBe(0);
  });
  it('is brighter up close and dark beyond EYES_MAX_DISTANCE_M', () => {
    const near = eyeGlow(l, m.x - 3, m.z, m.x, m.z, west);
    const far = eyeGlow(l, p.x, p.z, m.x, m.z, west);
    expect(near).toBe(1);
    expect(far).toBeLessThan(near);
    expect(far).toBeGreaterThanOrEqual(CONFIG.EYES_FAR_GLOW);
    expect(eyeGlow(l, m.x - CONFIG.EYES_MAX_DISTANCE_M - 1, m.z, m.x, m.z, west)).toBe(0);
  });
});

describe('hollowSpeed', () => {
  it('creeps when not hunting (faster in a finale), slower than you walk', () => {
    expect(hollowSpeed(false)).toBe(CONFIG.MONSTER_SPEED_UNSEEN);
    expect(hollowSpeed(true)).toBeCloseTo(CONFIG.MONSTER_SPEED_UNSEEN * CONFIG.FINALE_SPEED_FACTOR);
    expect(CONFIG.MONSTER_SPEED_UNSEEN).toBeLessThan(CONFIG.MAX_SPEED_FWD);
  });
});

describe('chaseSpeed (the rubber band)', () => {
  it('sprints from far away, slows down close up, and a walking player stays a few metres ahead', () => {
    expect(chaseSpeed(30)).toBe(CONFIG.HUNT_SPEED_FAR);
    expect(chaseSpeed(0)).toBe(CONFIG.HUNT_SPEED_NEAR);
    expect(CONFIG.HUNT_SPEED_FAR).toBeGreaterThan(CONFIG.MAX_SPEED_FWD);
    expect(CONFIG.HUNT_SPEED_NEAR).toBeLessThan(CONFIG.MAX_SPEED_FWD);
    // Where the chase speed equals walking speed: the gap a player who keeps walking holds.
    let d = 0;
    while (chaseSpeed(d) < CONFIG.MAX_SPEED_FWD) d += 0.1;
    expect(d).toBeGreaterThan(CONFIG.CATCH_DISTANCE + 4);
    expect(d).toBeLessThan(9);
  });
  it('is used only for a hunting Hollow', () => {
    expect(hollowSpeed(false, 20)).toBe(CONFIG.HUNT_SPEED_FAR);
    expect(hollowSpeed(false, null)).toBe(CONFIG.MONSTER_SPEED_UNSEEN);
  });
});
