import { CONFIG } from '../config';
import { cellCenter, findPath, isWall, type Cell, type Level } from './grid';
import { mulberry32 } from './rng';

/**
 * Where the cave's life goes (pure placement and timing; render/CaveLife.ts draws it).
 * Everything is seeded per level so the same level always looks and sounds the same.
 */

/** Stable per-level seed for the rock noise and the cave's life. */
export function levelSeed(level: Level): number {
  let h = 2166136261;
  for (const ch of level.def.id) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return (h >>> 0) % 100000;
}

function floorCells(level: Level): Cell[] {
  const out: Cell[] = [];
  for (let r = 0; r < level.rows; r++) for (let c = 0; c < level.cols; c++) if (!isWall(level, c, r)) out.push({ c, r });
  return out;
}

// ---------------------------------------------------------------- drips

export interface DripSpot {
  x: number;
  z: number;
  periodS: number;
  /** Phase offset (seconds) so the drips don't fall together. */
  offsetS: number;
}

/** One dripping spot per DRIP_EVERY_CELLS floor cells, somewhere inside its cell. */
export function dripSpots(level: Level, seed: number): DripSpot[] {
  const rand = mulberry32(seed + 101);
  const out: DripSpot[] = [];
  for (const cell of floorCells(level)) {
    if (rand() * CONFIG.DRIP_EVERY_CELLS >= 1) continue;
    const p = cellCenter(cell);
    out.push({
      x: p.x + (rand() - 0.5) * CONFIG.CELL_SIZE * 0.6,
      z: p.z + (rand() - 0.5) * CONFIG.CELL_SIZE * 0.6,
      periodS: CONFIG.DRIP_MIN_PERIOD_S + rand() * (CONFIG.DRIP_MAX_PERIOD_S - CONFIG.DRIP_MIN_PERIOD_S),
      offsetS: rand() * CONFIG.DRIP_MAX_PERIOD_S,
    });
  }
  return out;
}

/** Seconds a drop takes from DRIP_TOP_M to the floor. The shader uses the same formula. */
export function dripFallS(): number {
  return Math.sqrt((2 * CONFIG.DRIP_TOP_M) / CONFIG.GRAVITY_MPS2);
}

/** Drips whose drop hit the floor in the game-clock interval (prevS, nowS]. */
export function dripImpacts(spots: readonly DripSpot[], prevS: number, nowS: number): DripSpot[] {
  const fall = dripFallS();
  // A spot's k-th impact is at t = k * period - offset + fall.
  const count = (s: DripSpot, t: number) => Math.floor((t + s.offsetS - fall) / s.periodS);
  return spots.filter((s) => count(s, nowS) > count(s, prevS));
}

// ---------------------------------------------------------------- bats

export interface Roost {
  id: number;
  x: number;
  z: number;
}

/** Roosts along the route to the exit, so a loud clap on the way usually finds one. */
export function batRoosts(level: Level): Roost[] {
  const route = findPath(level, level.start, level.exit) ?? [];
  const out: Roost[] = [];
  for (let i = CONFIG.BAT_ROOST_FIRST; i < route.length - 1; i += CONFIG.BAT_ROOST_EVERY_CELLS) {
    const p = cellCenter(route[i]);
    out.push({ id: out.length, x: p.x, z: p.z });
  }
  return out;
}

export interface Bat {
  x0: number;
  y0: number;
  z0: number;
  x1: number;
  y1: number;
  z1: number;
  delayS: number;
  durationS: number;
  phase: number;
}

/**
 * A flock bursting off the ceiling at (rx, rz), over the player's head at (px, pz), and on behind
 * them the same distance again. Each bat gets its own offset, delay and wing phase.
 */
export function batFlock(rx: number, rz: number, px: number, pz: number, rand: () => number): Bat[] {
  const dx = px - rx;
  const dz = pz - rz;
  const d = Math.max(Math.hypot(dx, dz), 1);
  const ux = dx / d;
  const uz = dz / d;
  const bats: Bat[] = [];
  for (let i = 0; i < CONFIG.BAT_COUNT; i++) {
    const side = (rand() * 2 - 1) * CONFIG.BAT_SCATTER_M;
    const side1 = (rand() * 2 - 1) * CONFIG.BAT_SCATTER_M * 1.6;
    const span = 2 * d + 2;
    bats.push({
      x0: rx - uz * side,
      y0: CONFIG.WALL_HEIGHT - 0.4 - rand() * 0.3,
      z0: rz + ux * side,
      x1: rx + ux * span - uz * side1,
      y1: CONFIG.EYE_HEIGHT + 0.5 + rand() * 0.9,
      z1: rz + uz * span + ux * side1,
      delayS: rand() * 0.35,
      durationS: span / (CONFIG.BAT_SPEED * (0.85 + rand() * 0.3)),
      phase: rand() * Math.PI * 2,
    });
  }
  return bats;
}

// ---------------------------------------------------------------- remains

export type RemainsKind = 'bones' | 'lantern' | 'scratches';

export interface RemainsSpot {
  kind: RemainsKind;
  /** Cell centre. */
  x: number;
  z: number;
  /** Unit vector from the cell centre toward the wall the remains lie against. */
  wx: number;
  wz: number;
}

const SIDES: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * What happened to the last person: bones, their dropped lantern, claw marks. Dead ends first (the
 * remains lie against the back wall), then other wall-side cells; never on the start, exit, a monster
 * spawn, a moment's cells or a pot's cell.
 */
export function remainsSpots(level: Level, seed: number): RemainsSpot[] {
  const rand = mulberry32(seed + 202);
  const reserved = new Set<string>();
  const key = (c: Cell) => `${c.c},${c.r}`;
  for (const c of [level.start, level.exit, ...level.monsterSpawns]) reserved.add(key(c));
  for (const m of level.def.moments ?? []) {
    if ('trigger' in m) reserved.add(key(m.trigger));
    if ('at' in m) reserved.add(key(m.at));
  }
  for (const p of level.def.pots ?? []) reserved.add(key(p));
  const candidates = floorCells(level)
    .filter((c) => !reserved.has(key(c)))
    .map((c) => {
      const walls = SIDES.filter(([dc, dr]) => isWall(level, c.c + dc, c.r + dr));
      return { c, walls, rank: walls.length === 3 ? 0 : 1, tie: rand() };
    })
    .filter((x) => x.walls.length > 0)
    .sort((a, b) => a.rank - b.rank || a.tie - b.tie);
  const kinds: RemainsKind[] = ['bones', 'lantern', 'scratches'];
  return candidates.slice(0, CONFIG.REMAINS_PER_LEVEL).map((x, i) => {
    // A dead end's back wall is the one opposite its only opening.
    const open = SIDES.find(([dc, dr]) => !isWall(level, x.c.c + dc, x.c.r + dr));
    const back = x.walls.length === 3 && open ? ([-open[0], -open[1]] as const) : x.walls[Math.floor(rand() * x.walls.length)];
    const p = cellCenter(x.c);
    return { kind: kinds[i % kinds.length], x: p.x, z: p.z, wx: back[0], wz: back[1] };
  });
}
