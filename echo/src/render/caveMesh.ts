import { CONFIG } from '../config';
import { isWall, type Level } from '../game/grid';

/** Plain arrays for a three.js BufferGeometry (kept free of three.js so it is unit-testable). */
export interface CaveMeshData {
  positions: Float32Array;
  normals: Float32Array;
  /** Rock-layer coordinate per vertex: the shader draws a contour line at every whole number. */
  layers: Float32Array;
  /** Brightness multiplier per vertex: dark in crevices, with patches of darker rock. */
  shades: Float32Array;
  indices: Uint32Array;
}

/** Deterministic integer hash -> [0, 1). */
export function hash3(i: number, j: number, k: number, seed: number): number {
  let h = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(k, 0x9e3779b1) ^ Math.imul(seed, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}

/** Smooth 3D value noise in [0, 1]. */
export function valueNoise3(x: number, y: number, z: number, seed: number): number {
  const i = Math.floor(x);
  const j = Math.floor(y);
  const k = Math.floor(z);
  const fx = x - i;
  const fy = y - j;
  const fz = z - k;
  const u = fx * fx * (3 - 2 * fx);
  const v = fy * fy * (3 - 2 * fy);
  const w = fz * fz * (3 - 2 * fz);
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const c = (di: number, dj: number, dk: number) => hash3(i + di, j + dj, k + dk, seed);
  return lerp(
    lerp(lerp(c(0, 0, 0), c(1, 0, 0), u), lerp(c(0, 1, 0), c(1, 1, 0), u), v),
    lerp(lerp(c(0, 0, 1), c(1, 0, 1), u), lerp(c(0, 1, 1), c(1, 1, 1), u), v),
    w,
  );
}

/** Polynomial smooth minimum: rounds the crease where two surfaces meet over about k metres. */
function smin(a: number, b: number, k: number): number {
  const h = Math.max(k - Math.abs(a - b), 0) / k;
  return Math.min(a, b) - h * h * k * 0.25;
}

/** Distance from (x, z) to the square of grid cell (c, r). */
function cellDist(x: number, z: number, c: number, r: number): number {
  const cs = CONFIG.CELL_SIZE;
  const dx = Math.max(c * cs - x, 0, x - (c + 1) * cs);
  const dz = Math.max(r * cs - z, 0, z - (r + 1) * cs);
  return Math.hypot(dx, dz);
}

/**
 * Signed distance on the floor plan: positive inside corridors (distance to the nearest wall cell),
 * negative inside rock (minus the distance to the nearest floor cell). Exact out to 2 cells, capped beyond.
 */
export function planDistance(level: Level, x: number, z: number): number {
  const cs = CONFIG.CELL_SIZE;
  const c0 = Math.floor(x / cs);
  const r0 = Math.floor(z / cs);
  const inWall = isWall(level, c0, r0);
  let best = 2 * cs;
  for (let r = r0 - 2; r <= r0 + 2; r++) {
    for (let c = c0 - 2; c <= c0 + 2; c++) {
      if (isWall(level, c, r) === inWall) continue;
      best = Math.min(best, cellDist(x, z, c, r));
    }
  }
  return inWall ? -best : best;
}

/**
 * The rock as a scalar field: positive in the air, negative in rock, zero on the surface.
 * The plan distance is blurred (rounded corners), rock bulges 0..CAVE_WALL_BUMP_M into the corridor
 * (never back into the wall, so walls never look further away than they collide), and the walls blend
 * into an uneven floor and an arched ceiling with stalactites.
 */
export class CaveField {
  readonly h = CONFIG.CAVE_VOXEL_M;
  readonly nx: number;
  readonly nz: number;
  readonly ny: number;
  readonly y0: number;
  /** Blurred plan distance per column, [k * nx + i]. */
  private readonly plan: Float32Array;
  private readonly floorH: Float32Array;
  private readonly ceilH: Float32Array;

  constructor(
    readonly level: Level,
    readonly seed: number,
  ) {
    const h = this.h;
    this.nx = Math.round((level.cols * CONFIG.CELL_SIZE) / h) + 1;
    this.nz = Math.round((level.rows * CONFIG.CELL_SIZE) / h) + 1;
    this.y0 = -CONFIG.CAVE_FLOOR_BUMP_M - 2 * h;
    this.ny = Math.ceil((CONFIG.WALL_HEIGHT + CONFIG.CAVE_CEIL_VAR_M + 2 * h - this.y0) / h) + 1;
    const n = this.nx * this.nz;
    const raw = new Float32Array(n);
    this.floorH = new Float32Array(n);
    this.ceilH = new Float32Array(n);
    for (let k = 0; k < this.nz; k++) {
      for (let i = 0; i < this.nx; i++) {
        const x = i * h;
        const z = k * h;
        const idx = k * this.nx + i;
        raw[idx] = planDistance(level, x, z);
        this.floorH[idx] = CONFIG.CAVE_FLOOR_BUMP_M * (2 * valueNoise3(x * 0.8, 0.5, z * 0.8, seed + 7) - 1);
        this.ceilH[idx] =
          CONFIG.WALL_HEIGHT + CONFIG.CAVE_CEIL_VAR_M * (2 * valueNoise3(x * 0.35, 5.5, z * 0.35, seed + 11) - 1) - this.stalactite(x, z);
      }
    }
    // Blurring rounds every corner, but it would also pull convex wall corners back behind the
    // collision line. min(raw, blurred) keeps only the rounding that moves rock INTO the corridor,
    // capped so a player wedged into a corner never has rock at the camera.
    const blurred = blur2(raw, this.nx, this.nz, Math.max(1, Math.round(CONFIG.CAVE_CORNER_ROUND_M / (2 * h))));
    this.plan = raw.map((v, i) => Math.max(Math.min(v, blurred[i]), v - CONFIG.CAVE_FILLET_MAX_M));
  }

  /** Field value at sample (i, j, k). */
  sample(i: number, j: number, k: number): number {
    const idx = k * this.nx + i;
    const d = this.plan[idx];
    const y = this.y0 + j * this.h;
    if (d < -1.2) return d; // deep in rock: no surface within reach, skip the noise
    return this.combine(d, i * this.h, y, k * this.h, this.floorH[idx], this.ceilH[idx]);
  }

  /** Field value at any world point (bilinear on the column data). Used to place props on the rock. */
  at(x: number, y: number, z: number): number {
    const fi = Math.min(Math.max(x / this.h, 0), this.nx - 1.001);
    const fk = Math.min(Math.max(z / this.h, 0), this.nz - 1.001);
    const i = Math.floor(fi);
    const k = Math.floor(fk);
    const u = fi - i;
    const v = fk - k;
    const bil = (a: Float32Array) => {
      const p = k * this.nx + i;
      return (a[p] * (1 - u) + a[p + 1] * u) * (1 - v) + (a[p + this.nx] * (1 - u) + a[p + this.nx + 1] * u) * v;
    };
    return this.combine(bil(this.plan), x, y, z, bil(this.floorH), bil(this.ceilH));
  }

  private combine(plan: number, x: number, y: number, z: number, floorH: number, ceilH: number): number {
    // Broad swells stretched horizontally (layered rock) plus ridged mid-size chunks (sharp creases).
    const ridge = 1 - Math.abs(2 * valueNoise3(x * 1.7, y * 2.2, z * 1.7, this.seed + 3) - 1);
    const raw = 0.55 * valueNoise3(x * 0.6, y * 1.5, z * 0.6, this.seed) + 0.45 * ridge;
    const t = Math.min(Math.max((raw - 0.2) / 0.6, 0), 1);
    const n = t * t * (3 - 2 * t); // contrast: more flat faces and ledges, fewer in-between slopes
    // Bigger bulges only where they can't reach the camera: ledges low down and an arched top.
    const lo = CONFIG.CAVE_EYE_BAND_LOW_M;
    const hi = CONFIG.CAVE_EYE_BAND_HIGH_M;
    const out = y < lo ? (lo - y) / lo : y > hi ? (y - hi) / (CONFIG.WALL_HEIGHT - hi) : 0;
    const amp = CONFIG.CAVE_WALL_BUMP_M + (CONFIG.CAVE_LEDGE_BUMP_M - CONFIG.CAVE_WALL_BUMP_M) * Math.min(out, 1);
    const bump = amp * n;
    const walls = smin(plan - bump, ceilH - y, CONFIG.CAVE_CEIL_ROUND_M);
    return smin(walls, y - floorH, CONFIG.CAVE_FLOOR_ROUND_M);
  }

  /** Depth a stalactite hangs at (x, z), 0 if none: one jittered candidate per spacing square. */
  private stalactite(x: number, z: number): number {
    const s = CONFIG.CAVE_STALACTITE_SPACING_M;
    const gi = Math.floor(x / s);
    const gk = Math.floor(z / s);
    let best = 0;
    for (let dk = -1; dk <= 1; dk++) {
      for (let di = -1; di <= 1; di++) {
        const ci = gi + di;
        const ck = gk + dk;
        if (hash3(ci, 1, ck, this.seed + 17) > CONFIG.CAVE_STALACTITE_CHANCE) continue;
        const cx = (ci + 0.2 + 0.6 * hash3(ci, 2, ck, this.seed + 17)) * s;
        const cz = (ck + 0.2 + 0.6 * hash3(ci, 3, ck, this.seed + 17)) * s;
        const radius = 0.28 + 0.14 * hash3(ci, 4, ck, this.seed + 17);
        const d = Math.hypot(x - cx, z - cz);
        if (d >= radius) continue;
        const len = CONFIG.CAVE_STALACTITE_MAX_M * (0.35 + 0.65 * hash3(ci, 5, ck, this.seed + 17));
        const t = 1 - d / radius;
        best = Math.max(best, len * t * t);
      }
    }
    return best;
  }
}

/** Height of the rock floor at (x, z) (bisection between head height and below the floor). */
export function floorAt(f: CaveField, x: number, z: number): number {
  let air = 1.2;
  let rock = -0.4;
  for (let i = 0; i < 18; i++) {
    const m = (air + rock) / 2;
    if (f.at(x, m, z) > 0) air = m;
    else rock = m;
  }
  return (air + rock) / 2;
}

/** Distance from (x, y, z) along the unit direction (dx, dz) to the rock face (bisection). */
export function wallDistance(f: CaveField, x: number, y: number, z: number, dx: number, dz: number, max = 2.5): number {
  let air = 0;
  let rock = max;
  for (let i = 0; i < 18; i++) {
    const m = (air + rock) / 2;
    if (f.at(x + dx * m, y, z + dz * m) > 0) air = m;
    else rock = m;
  }
  return (air + rock) / 2;
}

/** Separable box blur, applied twice (a tent filter). Edges clamp. */
function blur2(src: Float32Array, nx: number, nz: number, radius: number): Float32Array {
  let a = src;
  for (let pass = 0; pass < 2; pass++) {
    const b = new Float32Array(a.length);
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0;
        for (let d = -radius; d <= radius; d++) sum += a[k * nx + Math.min(Math.max(i + d, 0), nx - 1)];
        b[k * nx + i] = sum / (2 * radius + 1);
      }
    }
    const c = new Float32Array(a.length);
    for (let k = 0; k < nz; k++) {
      for (let i = 0; i < nx; i++) {
        let sum = 0;
        for (let d = -radius; d <= radius; d++) sum += b[Math.min(Math.max(k + d, 0), nz - 1) * nx + i];
        c[k * nx + i] = sum / (2 * radius + 1);
      }
    }
    a = c;
  }
  return a;
}

/**
 * Meshes the cave field with naive surface nets: one vertex per voxel the surface passes through
 * (at the mean of its edge crossings), one quad per crossed grid edge. Smooth, watertight, and far
 * simpler than marching cubes. Faces wind so their normals point into the air.
 */
export function buildCaveMesh(f: CaveField): CaveMeshData {
  const { nx, ny, nz, h, y0, seed } = f;
  const values = new Float32Array(nx * ny * nz);
  const at = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) values[at(i, j, k)] = f.sample(i, j, k);

  // Vertices: one per voxel (cube) with mixed corner signs.
  const cx = nx - 1;
  const cy = ny - 1;
  const cz = nz - 1;
  const vertexOf = new Int32Array(cx * cy * cz).fill(-1);
  const pos: number[] = [];
  const corner = new Float32Array(8);
  const EDGES: ReadonlyArray<readonly [number, number]> = [
    [0, 1], [2, 3], [4, 5], [6, 7], // along x
    [0, 2], [1, 3], [4, 6], [5, 7], // along y
    [0, 4], [1, 5], [2, 6], [3, 7], // along z
  ];
  for (let k = 0; k < cz; k++) {
    for (let j = 0; j < cy; j++) {
      for (let i = 0; i < cx; i++) {
        let inside = 0;
        for (let n = 0; n < 8; n++) {
          const v = values[at(i + (n & 1), j + ((n >> 1) & 1), k + ((n >> 2) & 1))];
          corner[n] = v;
          if (v < 0) inside++;
        }
        if (inside === 0 || inside === 8) continue;
        let sx = 0;
        let sy = 0;
        let sz = 0;
        let count = 0;
        for (const [a, b] of EDGES) {
          const va = corner[a];
          const vb = corner[b];
          if (va < 0 === vb < 0) continue;
          const t = va / (va - vb);
          sx += (a & 1) + ((b & 1) - (a & 1)) * t;
          sy += ((a >> 1) & 1) + (((b >> 1) & 1) - ((a >> 1) & 1)) * t;
          sz += ((a >> 2) & 1) + (((b >> 2) & 1) - ((a >> 2) & 1)) * t;
          count++;
        }
        vertexOf[(k * cy + j) * cx + i] = pos.length / 3;
        pos.push((i + sx / count) * h, y0 + (j + sy / count) * h, (k + sz / count) * h);
      }
    }
  }

  // Faces: every grid edge with a sign change joins the 4 voxels around it.
  const idx: number[] = [];
  const cube = (i: number, j: number, k: number) =>
    i < 0 || j < 0 || k < 0 || i >= cx || j >= cy || k >= cz ? -1 : vertexOf[(k * cy + j) * cx + i];
  for (let k = 0; k < nz; k++) {
    for (let j = 0; j < ny; j++) {
      for (let i = 0; i < nx; i++) {
        const v0 = values[at(i, j, k)];
        // axis 0 = x (u = y, v = z), 1 = y (u = z, v = x), 2 = z (u = x, v = y): u x v = axis.
        for (let axis = 0; axis < 3; axis++) {
          const [di, dj, dk] = axis === 0 ? [1, 0, 0] : axis === 1 ? [0, 1, 0] : [0, 0, 1];
          if (i + di >= nx || j + dj >= ny || k + dk >= nz) continue;
          const v1 = values[at(i + di, j + dj, k + dk)];
          if (v0 < 0 === v1 < 0) continue;
          let q: number[];
          if (axis === 0) q = [cube(i, j - 1, k - 1), cube(i, j, k - 1), cube(i, j, k), cube(i, j - 1, k)];
          else if (axis === 1) q = [cube(i - 1, j, k - 1), cube(i - 1, j, k), cube(i, j, k), cube(i, j, k - 1)];
          else q = [cube(i - 1, j - 1, k), cube(i, j - 1, k), cube(i, j, k), cube(i - 1, j, k)];
          if (q.some((n) => n < 0)) continue;
          // Air on the +axis side => the quad faces +axis (counter-clockwise seen from there).
          if (v0 < 0) idx.push(q[0], q[1], q[2], q[0], q[2], q[3]);
          else idx.push(q[0], q[2], q[1], q[0], q[3], q[2]);
        }
      }
    }
  }

  const positions = new Float32Array(pos);
  const indices = new Uint32Array(idx);
  const normals = vertexNormals(positions, indices);
  return { positions, normals, layers: layerCoords(positions, seed), shades: shading(f, positions, normals, seed), indices };
}

/**
 * Baked shade: how open the space in front of each vertex is (the field ~ distance to rock, sampled
 * along the normal), so creases and the foot of walls go dark and bulges catch the sonar; times
 * large patches of slightly darker rock.
 */
function shading(f: CaveField, p: Float32Array, n: Float32Array, seed: number): Float32Array {
  const out = new Float32Array(p.length / 3);
  const reach = 0.45;
  for (let v = 0; v < out.length; v++) {
    const o = v * 3;
    const open = Math.min(Math.max(f.at(p[o] + n[o] * reach, p[o + 1] + n[o + 1] * reach, p[o + 2] + n[o + 2] * reach) / reach, 0), 1);
    const ao = CONFIG.CAVE_CREVICE_DARK + (1 - CONFIG.CAVE_CREVICE_DARK) * open;
    const patch = 0.62 + 0.48 * valueNoise3(p[o] * 0.45, p[o + 1] * 0.6, p[o + 2] * 0.45, seed + 41);
    out[v] = ao * patch;
  }
  return out;
}

/** Area-weighted average of the face normals around each vertex. */
function vertexNormals(p: Float32Array, idx: Uint32Array): Float32Array {
  const n = new Float32Array(p.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = idx[t] * 3;
    const b = idx[t + 1] * 3;
    const c = idx[t + 2] * 3;
    const ux = p[b] - p[a];
    const uy = p[b + 1] - p[a + 1];
    const uz = p[b + 2] - p[a + 2];
    const vx = p[c] - p[a];
    const vy = p[c + 1] - p[a + 1];
    const vz = p[c + 2] - p[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    for (const o of [a, b, c]) {
      n[o] += nx;
      n[o + 1] += ny;
      n[o + 2] += nz;
    }
  }
  for (let o = 0; o < n.length; o += 3) {
    const l = Math.hypot(n[o], n[o + 1], n[o + 2]) || 1;
    n[o] /= l;
    n[o + 1] /= l;
    n[o + 2] /= l;
  }
  return n;
}

/** Height in rock layers, warped by low-frequency noise: wavy strata on walls, topographic rings on floors. */
function layerCoords(p: Float32Array, seed: number): Float32Array {
  const out = new Float32Array(p.length / 3);
  for (let v = 0; v < out.length; v++) {
    const x = p[v * 3];
    const y = p[v * 3 + 1];
    const z = p[v * 3 + 2];
    out[v] =
      y * CONFIG.CAVE_LAYER_DENSITY +
      CONFIG.CAVE_LAYER_WARP * (2 * valueNoise3(x * 0.22, y * 0.3, z * 0.22, seed + 29) - 1) +
      0.45 * CONFIG.CAVE_LAYER_WARP * (2 * valueNoise3(x * 0.9, y * 0.9, z * 0.9, seed + 31) - 1);
  }
  return out;
}
