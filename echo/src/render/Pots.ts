import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import type { Level } from '../game/grid';
import { levelSeed } from '../game/caveLife';
import { potSpots, type Pot } from '../game/pots';
import { mulberry32 } from '../game/rng';
import { floorAt, type CaveField } from './caveMesh';
import { createRevealMaterial, type RevealUniforms } from './revealMaterial';

/** Dull fired clay: visible in sonar light, but never as bright as the gold way out or the red Hollows. */
const CLAY = 0x8c6d55;

interface PotMeshes {
  whole: THREE.Mesh;
  shards: THREE.Mesh;
}

/**
 * The level's clay pots, lit only by sonar like everything else. Each pot is two meshes: the whole pot,
 * and its shards (a broken base plus pieces scattered on the floor), swapped when World breaks it.
 */
export class PotsView {
  private readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;
  private meshes: PotMeshes[] = [];

  constructor(scene: THREE.Scene, uniforms: RevealUniforms) {
    scene.add(this.group);
    // Both faces: you can see into the pot's mouth, and the shards are thin open curves.
    this.material = createRevealMaterial(uniforms, CLAY, { doubleSided: true });
  }

  setLevel(level: Level, field: CaveField): void {
    for (const m of this.meshes) {
      m.whole.geometry.dispose();
      m.shards.geometry.dispose();
    }
    this.group.clear();
    const seed = levelSeed(level);
    this.meshes = potSpots(level.def).map((p) => {
      const y = floorAt(field, p.x, p.z);
      const rand = mulberry32(seed + 404 + p.id * 31);
      const whole = new THREE.Mesh(potGeometry(rand() * Math.PI * 2), this.material);
      whole.position.set(p.x, y, p.z);
      const shards = new THREE.Mesh(shardGeometry(p, field, rand), this.material);
      shards.visible = false;
      this.group.add(whole, shards);
      return { whole, shards };
    });
  }

  update(pots: readonly Pot[]): void {
    for (const p of pots) {
      const m = this.meshes[p.id];
      if (!m) continue;
      m.whole.visible = !p.broken;
      m.shards.visible = p.broken;
    }
  }
}

/** Round belly, narrow neck, flared lip; turned on a lathe. Height CONFIG.POT_HEIGHT_M, base on y = 0. */
function profile(): THREE.Vector2[] {
  const h = CONFIG.POT_HEIGHT_M;
  const r = CONFIG.POT_RADIUS_M;
  return [
    [0, 0],
    [r * 0.55, 0],
    [r * 0.85, h * 0.12],
    [r, h * 0.38],
    [r * 0.9, h * 0.62],
    [r * 0.5, h * 0.84],
    [r * 0.45, h * 0.92],
    [r * 0.6, h],
  ].map(([x, y]) => new THREE.Vector2(x, y));
}

function potGeometry(spin: number): THREE.BufferGeometry {
  const geo = new THREE.LatheGeometry(profile(), 14);
  geo.deleteAttribute('uv');
  return geo.rotateY(spin);
}

/** What's left: the bottom of the pot where it stood, and curved pieces of its wall flung outward. */
function shardGeometry(p: Pot, field: CaveField, rand: () => number): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  const base = new THREE.LatheGeometry(profile().slice(0, 3), 14);
  base.translate(p.x, floorAt(field, p.x, p.z), p.z);
  parts.push(base);
  const r = CONFIG.POT_RADIUS_M;
  for (let i = 0; i < CONFIG.POT_SHARDS; i++) {
    const a = rand() * Math.PI * 2;
    const d = r + rand() * CONFIG.POT_SHARD_SCATTER_M;
    const x = p.x + Math.sin(a) * d;
    const z = p.z + Math.cos(a) * d;
    // A curved piece of the pot's wall, lying roughly flat on the rock.
    const arc = 0.5 + rand() * 0.7;
    const piece = new THREE.CylinderGeometry(r, r, 0.06 + rand() * 0.1, 4, 1, true, 0, arc);
    piece.translate(0, 0, -r);
    m.makeRotationFromEuler(new THREE.Euler(Math.PI / 2 + (rand() - 0.5) * 0.6, rand() * Math.PI * 2, (rand() - 0.5) * 0.6, 'YXZ'));
    m.setPosition(x, floorAt(field, x, z) + 0.02, z);
    parts.push(piece.applyMatrix4(m));
  }
  const clean = parts.map((g) => {
    const n = g.index ? g.toNonIndexed() : g;
    if (n !== g) g.dispose();
    n.deleteAttribute('uv');
    return n;
  });
  const merged = mergeGeometries(clean, false);
  for (const g of clean) g.dispose();
  return merged ?? new THREE.BufferGeometry();
}
