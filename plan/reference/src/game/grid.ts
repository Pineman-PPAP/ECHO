import { CONFIG } from '../config';

/**
 * Grid world. Cell (c, r): c = column = +x, r = row = +z.
 * World position of a cell's centre: x = (c + 0.5) * CELL_SIZE, z = (r + 0.5) * CELL_SIZE. y is up.
 */
export interface Cell {
  c: number;
  r: number;
}

export type Facing = 'N' | 'E' | 'S' | 'W';

export interface LevelDef {
  id: string;
  name: string;
  /** Lines shown on the intro card. */
  intro: string[];
  /**
   * ASCII rows, all the same length. Legend:
   *   '#' wall   '.' floor   'S' start (floor, exactly one)   'E' exit (floor, exactly one)
   *   'M' monster spawn (floor, zero or more)
   * The outer border must be all walls.
   */
  map: string[];
  /** Direction the player faces at start. N = -z (row decreasing), E = +x, S = +z, W = -x. */
  startFacing: Facing;
  tutorial?: boolean;
}

export interface Level {
  def: LevelDef;
  cols: number;
  rows: number;
  /** walls[r * cols + c] === 1 for wall cells. */
  walls: Uint8Array;
  start: Cell;
  exit: Cell;
  monsterSpawns: Cell[];
}

export function parseLevel(def: LevelDef): Level {
  const rows = def.map.length;
  if (rows < 3) throw new Error(`Level ${def.id}: needs at least 3 rows`);
  const cols = def.map[0].length;
  const walls = new Uint8Array(rows * cols);
  let start: Cell | null = null;
  let exit: Cell | null = null;
  const monsterSpawns: Cell[] = [];
  for (let r = 0; r < rows; r++) {
    const line = def.map[r];
    if (line.length !== cols) throw new Error(`Level ${def.id}: row ${r} has length ${line.length}, expected ${cols}`);
    for (let c = 0; c < cols; c++) {
      const ch = line[c];
      const border = r === 0 || c === 0 || r === rows - 1 || c === cols - 1;
      if (border && ch !== '#') throw new Error(`Level ${def.id}: border cell (${c},${r}) must be '#'`);
      switch (ch) {
        case '#':
          walls[r * cols + c] = 1;
          break;
        case '.':
          break;
        case 'S':
          if (start) throw new Error(`Level ${def.id}: more than one 'S'`);
          start = { c, r };
          break;
        case 'E':
          if (exit) throw new Error(`Level ${def.id}: more than one 'E'`);
          exit = { c, r };
          break;
        case 'M':
          monsterSpawns.push({ c, r });
          break;
        default:
          throw new Error(`Level ${def.id}: unknown character '${ch}' at (${c},${r})`);
      }
    }
  }
  if (!start) throw new Error(`Level ${def.id}: missing 'S'`);
  if (!exit) throw new Error(`Level ${def.id}: missing 'E'`);
  return { def, cols, rows, walls, start, exit, monsterSpawns };
}

/** Out-of-bounds counts as wall. */
export function isWall(level: Level, c: number, r: number): boolean {
  if (c < 0 || r < 0 || c >= level.cols || r >= level.rows) return true;
  return level.walls[r * level.cols + c] === 1;
}

export function cellCenter(cell: Cell): { x: number; z: number } {
  return { x: (cell.c + 0.5) * CONFIG.CELL_SIZE, z: (cell.r + 0.5) * CONFIG.CELL_SIZE };
}

export function worldToCell(x: number, z: number): Cell {
  return { c: Math.floor(x / CONFIG.CELL_SIZE), r: Math.floor(z / CONFIG.CELL_SIZE) };
}

/**
 * three.js camera yaw (rotation.y, radians) for a facing. A camera with rotation.y = yaw looks
 * along (-sin(yaw), 0, -cos(yaw)).
 */
export function facingToYaw(f: Facing): number {
  switch (f) {
    case 'N':
      return 0;
    case 'W':
      return Math.PI / 2;
    case 'S':
      return Math.PI;
    case 'E':
      return -Math.PI / 2;
  }
}

/** Forward unit vector on the XZ plane for a yaw. */
export function yawForward(yaw: number): { x: number; z: number } {
  return { x: -Math.sin(yaw), z: -Math.cos(yaw) };
}

/**
 * True if the straight segment a->b crosses no wall cell (Amanatides-Woo grid traversal).
 * The cells containing a and b themselves are not tested.
 */
export function lineOfSight(level: Level, ax: number, az: number, bx: number, bz: number): boolean {
  const cs = CONFIG.CELL_SIZE;
  let c = Math.floor(ax / cs);
  let r = Math.floor(az / cs);
  const endC = Math.floor(bx / cs);
  const endR = Math.floor(bz / cs);
  const dx = bx - ax;
  const dz = bz - az;
  const stepC = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepR = dz > 0 ? 1 : dz < 0 ? -1 : 0;
  const tDeltaC = stepC !== 0 ? Math.abs(cs / dx) : Infinity;
  const tDeltaR = stepR !== 0 ? Math.abs(cs / dz) : Infinity;
  let tMaxC = stepC > 0 ? ((c + 1) * cs - ax) / dx : stepC < 0 ? (c * cs - ax) / dx : Infinity;
  let tMaxR = stepR > 0 ? ((r + 1) * cs - az) / dz : stepR < 0 ? (r * cs - az) / dz : Infinity;
  let guard = 2 * (level.cols + level.rows) + 4;
  while ((c !== endC || r !== endR) && guard-- > 0) {
    if (tMaxC < tMaxR) {
      c += stepC;
      tMaxC += tDeltaC;
    } else {
      r += stepR;
      tMaxR += tDeltaR;
    }
    if (c === endC && r === endR) return true;
    if (isWall(level, c, r)) return false;
  }
  return true;
}

const DIRS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

/**
 * Shortest 4-connected path (breadth-first search; every step costs the same).
 * Returns the cells AFTER `from` up to and including `to`; [] if from == to; null if unreachable.
 */
export function findPath(level: Level, from: Cell, to: Cell): Cell[] | null {
  if (isWall(level, to.c, to.r) || isWall(level, from.c, from.r)) return null;
  if (from.c === to.c && from.r === to.r) return [];
  const n = level.cols * level.rows;
  const prev = new Int32Array(n).fill(-1);
  const startIdx = from.r * level.cols + from.c;
  const goalIdx = to.r * level.cols + to.c;
  prev[startIdx] = startIdx;
  const queue = new Int32Array(n);
  let head = 0;
  let tail = 0;
  queue[tail++] = startIdx;
  while (head < tail) {
    const idx = queue[head++];
    if (idx === goalIdx) break;
    const c = idx % level.cols;
    const r = (idx - c) / level.cols;
    for (const [dc, dr] of DIRS) {
      const nc = c + dc;
      const nr = r + dr;
      if (isWall(level, nc, nr)) continue;
      const nIdx = nr * level.cols + nc;
      if (prev[nIdx] !== -1) continue;
      prev[nIdx] = idx;
      queue[tail++] = nIdx;
    }
  }
  if (prev[goalIdx] === -1) return null;
  const path: Cell[] = [];
  for (let idx = goalIdx; idx !== startIdx; idx = prev[idx]) {
    const c = idx % level.cols;
    path.push({ c, r: (idx - c) / level.cols });
  }
  path.reverse();
  return path;
}

/** All floor cells whose BFS distance from `from` is between minSteps and maxSteps (inclusive). */
export function floorCellsWithin(level: Level, from: Cell, minSteps: number, maxSteps: number): Cell[] {
  const dist = new Int32Array(level.cols * level.rows).fill(-1);
  const out: Cell[] = [];
  const queue: Cell[] = [from];
  dist[from.r * level.cols + from.c] = 0;
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const d = dist[cur.r * level.cols + cur.c];
    if (d >= minSteps) out.push(cur);
    if (d === maxSteps) continue;
    for (const [dc, dr] of DIRS) {
      const nc = cur.c + dc;
      const nr = cur.r + dr;
      if (isWall(level, nc, nr) || dist[nr * level.cols + nc] !== -1) continue;
      dist[nr * level.cols + nc] = d + 1;
      queue.push({ c: nc, r: nr });
    }
  }
  return out;
}

/** True if a circle at (x, z) overlaps any wall cell. */
export function collidesCircle(level: Level, x: number, z: number, radius: number): boolean {
  const cs = CONFIG.CELL_SIZE;
  const c0 = Math.floor((x - radius) / cs);
  const c1 = Math.floor((x + radius) / cs);
  const r0 = Math.floor((z - radius) / cs);
  const r1 = Math.floor((z + radius) / cs);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      if (!isWall(level, c, r)) continue;
      const nx = Math.min(Math.max(x, c * cs), (c + 1) * cs);
      const nz = Math.min(Math.max(z, r * cs), (r + 1) * cs);
      const ddx = x - nx;
      const ddz = z - nz;
      if (ddx * ddx + ddz * ddz < radius * radius) return true;
    }
  }
  return false;
}

/**
 * Moves a circle by (dx, dz), sliding along walls. Sub-steps so it never tunnels through a wall.
 */
export function moveWithCollision(
  level: Level,
  x: number,
  z: number,
  dx: number,
  dz: number,
  radius: number,
): { x: number; z: number } {
  const dist = Math.hypot(dx, dz);
  const steps = Math.max(1, Math.ceil(dist / (radius * 0.5)));
  const sx = dx / steps;
  const sz = dz / steps;
  for (let i = 0; i < steps; i++) {
    if (!collidesCircle(level, x + sx, z, radius)) x += sx;
    if (!collidesCircle(level, x, z + sz, radius)) z += sz;
  }
  return { x, z };
}
