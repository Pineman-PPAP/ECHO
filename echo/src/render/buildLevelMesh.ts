import * as THREE from 'three';
import { CONFIG } from '../config';
import { levelSeed } from '../game/caveLife';
import { cellCenter, type Level } from '../game/grid';
import { buildCaveMesh, CaveField } from './caveMesh';
import { createRevealMaterial, type RevealUniforms } from './revealMaterial';

export const COLORS = {
  wall: CONFIG.CAVE_WALL_COLOR,
  floor: CONFIG.CAVE_FLOOR_COLOR,
  ceiling: CONFIG.CAVE_CEIL_COLOR,
  exit: 0xe0b050,
  /** Hollows: a deep blood red (the echo shader makes the edges glow), with hot pinpoint eyes. */
  monster: 0xe0221a,
  monsterEyes: 0xff7a5c,
  /** The Hush: pale, cold, eyeless. */
  hush: 0xbfe6ff,
} as const;

/**
 * Builds the static level: the cave rock as ONE merged mesh (one draw call) meshed from a field over
 * the unchanged grid (caveMesh.ts), plus the exit portal. Returns the field too, for placing props.
 */
export function buildLevelMeshes(level: Level, uniforms: RevealUniforms): { group: THREE.Group; field: CaveField } {
  const group = new THREE.Group();
  const field = new CaveField(level, levelSeed(level));
  const data = buildCaveMesh(field);
  const attrs = {
    position: new THREE.BufferAttribute(data.positions, 3),
    normal: new THREE.BufferAttribute(data.normals, 3),
    aLayer: new THREE.BufferAttribute(data.layers, 1),
    aShade: new THREE.BufferAttribute(data.shades, 1),
  };
  const rock = createRevealMaterial(uniforms, COLORS.wall, { look: 'rock', floorColor: COLORS.floor, ceilColor: COLORS.ceiling });
  // Chunks share the vertex buffers; each has its own index list, so three.js can cull the chunks
  // out of view and draw the rest front to back (far less overdraw than one maze-sized mesh).
  for (const indices of chunkIndices(data.positions, data.indices, level)) {
    const geo = new THREE.BufferGeometry();
    for (const [name, a] of Object.entries(attrs)) geo.setAttribute(name, a);
    geo.setIndex(new THREE.BufferAttribute(indices, 1));
    geo.boundingSphere = sphereOf(data.positions, indices);
    group.add(new THREE.Mesh(geo, rock));
  }

  const e = cellCenter(level.exit);
  const exitMat = createRevealMaterial(uniforms, COLORS.exit, { ambient: 0.03 });
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 12, 48), exitMat);
  ring.position.set(e.x, 1.3, e.z);
  group.add(ring);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), exitMat);
  pad.position.set(e.x, CONFIG.CAVE_MARKER_Y_M, e.z);
  group.add(pad);
  return { group, field };
}

/** Splits the triangle list by which CAVE_CHUNK_CELLS square each triangle's first vertex falls in. */
function chunkIndices(p: Float32Array, idx: Uint32Array, level: Level): Uint32Array[] {
  const size = CONFIG.CAVE_CHUNK_CELLS * CONFIG.CELL_SIZE;
  const cols = Math.ceil(level.cols / CONFIG.CAVE_CHUNK_CELLS);
  const lists = new Map<number, number[]>();
  for (let t = 0; t < idx.length; t += 3) {
    const v = idx[t] * 3;
    const key = Math.floor(p[v + 2] / size) * cols + Math.floor(p[v] / size);
    let list = lists.get(key);
    if (!list) lists.set(key, (list = []));
    list.push(idx[t], idx[t + 1], idx[t + 2]);
  }
  return [...lists.values()].map((l) => new Uint32Array(l));
}

function sphereOf(p: Float32Array, idx: Uint32Array): THREE.Sphere {
  const box = new THREE.Box3();
  const v = new THREE.Vector3();
  for (const i of idx) box.expandByPoint(v.set(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
  return box.getBoundingSphere(new THREE.Sphere());
}
