import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { batFlock, dripSpots, levelSeed, remainsSpots, type Bat, type RemainsSpot } from '../game/caveLife';
import { cellCenter, isWall, type Level } from '../game/grid';
import { mulberry32 } from '../game/rng';
import { floorAt, wallDistance, type CaveField } from './caveMesh';
import { createRevealMaterial, createRevealPointsMaterial, type RevealUniforms } from './revealMaterial';

const LIFE_COLORS = {
  dust: 0x8f938d,
  moth: 0x817765,
  drop: 0xa9bcc2,
  bat: 0x3e3b38,
  bone: 0xc4bfae,
  metal: 0x8a7046,
} as const;

interface ActiveBat extends Bat {
  startS: number;
}

/**
 * Everything alive (or once alive) in the cave, all lit only by sonar/jar: drifting dust, small moths, dripping water,
 * bats that burst off the ceiling at a loud clap, and remains of the last person who came down here.
 * Static parts are rebuilt per level; bats are one InstancedMesh (one draw call).
 */
export class CaveLife {
  private readonly levelGroup = new THREE.Group();
  private readonly bats: THREE.InstancedMesh;
  private active: ActiveBat[] = [];
  private readonly matrix = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly pos = new THREE.Vector3();
  private readonly scale = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private batSeed = 1;

  constructor(
    scene: THREE.Scene,
    private readonly uniforms: RevealUniforms,
  ) {
    scene.add(this.levelGroup);
    const batMat = createRevealMaterial(uniforms, LIFE_COLORS.bat, { doubleSided: true });
    this.bats = new THREE.InstancedMesh(batGeometry(CONFIG.BAT_SIZE_M), batMat, CONFIG.BAT_COUNT * 2);
    this.bats.count = 0;
    this.bats.frustumCulled = false;
    scene.add(this.bats);
  }

  setLevel(level: Level, field: CaveField): void {
    for (const child of [...this.levelGroup.children]) {
      this.levelGroup.remove(child);
      if (child instanceof THREE.Mesh || child instanceof THREE.Points) {
        child.geometry.dispose();
        (child.material as THREE.Material).dispose();
      }
    }
    this.active = [];
    this.bats.count = 0;
    const seed = levelSeed(level);
    this.levelGroup.add(dust(level, seed, this.uniforms));
    this.levelGroup.add(moths(level, seed, this.uniforms));
    this.levelGroup.add(drips(level, seed, this.uniforms));
    for (const m of remains(remainsSpots(level, seed), field, this.uniforms)) this.levelGroup.add(m);
  }

  /** A flock bursts from the roost at (rx, rz) over the player's head. */
  spawnBats(rx: number, rz: number, px: number, pz: number, clockS: number): Bat[] {
    const flock = batFlock(rx, rz, px, pz, mulberry32(this.batSeed++));
    for (const b of flock) this.active.push({ ...b, startS: clockS });
    if (this.active.length > CONFIG.BAT_COUNT * 2) this.active.splice(0, this.active.length - CONFIG.BAT_COUNT * 2);
    return flock;
  }

  update(clockS: number): void {
    this.active = this.active.filter((b) => clockS - b.startS - b.delayS < b.durationS);
    let n = 0;
    for (const b of this.active) {
      const t = (clockS - b.startS - b.delayS) / b.durationS;
      if (t < 0) continue;
      // Drop off the ceiling, dip over the player's head, climb away.
      this.pos.set(
        b.x0 + (b.x1 - b.x0) * t,
        b.y0 + (b.y1 - b.y0) * t - 0.45 * Math.sin(Math.PI * t),
        b.z0 + (b.z1 - b.z0) * t,
      );
      this.q.setFromAxisAngle(this.up, Math.atan2(-(b.x1 - b.x0), -(b.z1 - b.z0)));
      const flap = Math.cos(b.phase + (clockS - b.startS) * CONFIG.BAT_FLAP_HZ * Math.PI * 2);
      this.scale.set(1, flap, 1);
      this.matrix.compose(this.pos, this.q, this.scale);
      this.bats.setMatrixAt(n++, this.matrix);
    }
    this.bats.count = n;
    this.bats.instanceMatrix.needsUpdate = true;
  }
}

/**
 * A bat: small body and two broad wings with a scalloped trailing edge (the finger bones). The wing
 * tips sit `size * 0.5` up, so scaling y by cos() flaps them. Faces -z.
 */
function batGeometry(size: number): THREE.BufferGeometry {
  const h = size * 0.5;
  const wing = (s: number) => {
    const root = [0.03 * s, 0, -0.06];
    const edge = [
      [size * s, h, -0.03], // tip
      [size * 0.86 * s, h * 0.85, 0.05], // notch
      [size * 0.74 * s, h * 0.72, 0.14],
      [size * 0.58 * s, h * 0.56, 0.1], // notch
      [size * 0.42 * s, h * 0.4, 0.19],
      [0.03 * s, 0, 0.13], // root, back
    ];
    const tris: number[][] = [];
    for (let i = 0; i < edge.length - 1; i++) tris.push(root, edge[i], edge[i + 1]);
    return tris;
  };
  const body = [
    [0, 0, -0.11],
    [0.04, 0, 0],
    [-0.04, 0, 0],
    [-0.04, 0, 0],
    [0.04, 0, 0],
    [0, 0, 0.12],
  ];
  const pts = [...wing(1), ...wing(-1), ...body].flat();
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pts), 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(pts.length), 3)); // zero = unshaded
  return geo;
}

/** Dust motes scattered through the open air of every floor cell. */
function dust(level: Level, seed: number, uniforms: RevealUniforms): THREE.Points {
  const rand = mulberry32(seed + 303);
  const pos: number[] = [];
  const seeds: number[] = [];
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      if (isWall(level, c, r)) continue;
      const p = cellCenter({ c, r });
      for (let i = 0; i < CONFIG.DUST_PER_CELL; i++) {
        pos.push(p.x + (rand() - 0.5) * 2.4, 0.3 + rand() * 2.4, p.z + (rand() - 0.5) * 2.4);
        seeds.push(rand());
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
  const pts = new THREE.Points(geo, createRevealPointsMaterial(uniforms, LIFE_COLORS.dust, CONFIG.DUST_POINT_PX, 'dust'));
  pts.frustumCulled = false;
  return pts;
}

/** A few quiet insects in open air, not luminous fireflies. Motion and wingbeats run on the GPU. */
function moths(level: Level, seed: number, uniforms: RevealUniforms): THREE.Points {
  const rand = mulberry32(seed + 404);
  const pos: number[] = [];
  const seeds: number[] = [];
  let open = 0;
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      if (isWall(level, c, r)) continue;
      if (open++ % CONFIG.MOTH_EVERY_CELLS !== 0) continue;
      const p = cellCenter({ c, r });
      pos.push(p.x + (rand() - 0.5) * 0.7, 1.1 + rand() * 0.9, p.z + (rand() - 0.5) * 0.7);
      seeds.push(rand());
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(pos), 3));
  geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(seeds), 1));
  const points = new THREE.Points(geo, createRevealPointsMaterial(uniforms, LIFE_COLORS.moth, CONFIG.MOTH_POINT_PX, 'moth'));
  points.frustumCulled = false;
  return points;
}

/** Falling drops at the drip spots (the shader animates them; App plays the matching drip sounds). */
function drips(level: Level, seed: number, uniforms: RevealUniforms): THREE.Points {
  const spots = dripSpots(level, seed);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(spots.flatMap((s) => [s.x, CONFIG.DRIP_TOP_M, s.z])), 3));
  geo.setAttribute('aDrip', new THREE.BufferAttribute(new Float32Array(spots.flatMap((s) => [s.periodS, s.offsetS])), 2));
  const pts = new THREE.Points(geo, createRevealPointsMaterial(uniforms, LIFE_COLORS.drop, CONFIG.DRIP_POINT_PX, 'drip'));
  pts.frustumCulled = false;
  return pts;
}

/** Bones, a lantern and claw marks, placed on the real rock surface. Two merged meshes (bone, metal). */
function remains(spots: readonly RemainsSpot[], field: CaveField, uniforms: RevealUniforms): THREE.Mesh[] {
  const bone: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const m = new THREE.Matrix4();
  for (const s of spots) {
    // Local frame: u along the wall, v away from it (into the corridor), y up.
    const ux = -s.wz;
    const uz = s.wx;
    const toFace = wallDistance(field, s.x, 0.2, s.z, s.wx, s.wz);
    const bx = s.x + s.wx * (toFace - 0.32);
    const bz = s.z + s.wz * (toFace - 0.32);
    const yaw = Math.atan2(ux, uz); // local +z -> u
    const place = (geo: THREE.BufferGeometry, u: number, v: number, lift: number, rx = 0, ry = 0, rz = 0) => {
      const x = bx + ux * u - s.wx * v;
      const z = bz + uz * u - s.wz * v;
      const y = floorAt(field, x, z) + lift;
      m.makeRotationFromEuler(new THREE.Euler(rx, yaw + ry, rz, 'YXZ'));
      m.setPosition(x, y, z);
      return clean(geo).applyMatrix4(m);
    };
    if (s.kind === 'bones') {
      bone.push(place(new THREE.SphereGeometry(0.1, 9, 7).scale(1, 0.85, 1.2), 0.62, 0.05, 0.08));
      for (let k = 0; k < 4; k++) bone.push(place(new THREE.TorusGeometry(0.14 - k * 0.012, 0.014, 4, 10, Math.PI), 0.32 - k * 0.08, 0.12, 0.02));
      bone.push(place(new THREE.CylinderGeometry(0.02, 0.02, 0.5, 5), 0.2, 0.12, 0.03, 0, 0, Math.PI / 2));
      bone.push(place(new THREE.SphereGeometry(0.1, 7, 5).scale(1, 0.4, 0.6), -0.1, 0.12, 0.04));
      bone.push(place(new THREE.CylinderGeometry(0.026, 0.02, 0.46, 5), -0.38, 0.02, 0.03, 0, 0.25, Math.PI / 2));
      bone.push(place(new THREE.CylinderGeometry(0.026, 0.02, 0.44, 5), -0.36, 0.26, 0.03, 0, -0.35, Math.PI / 2));
      bone.push(place(new THREE.CylinderGeometry(0.02, 0.016, 0.36, 5), 0.5, 0.36, 0.03, 0, 0.9, Math.PI / 2));
      metal.push(place(new THREE.CylinderGeometry(0.075, 0.075, 0.2, 10), 0.15, 0.62, 0.075, 0, 0.6, Math.PI / 2));
      metal.push(place(new THREE.ConeGeometry(0.09, 0.08, 10), 0.27, 0.69, 0.075, 0, 0.6, -Math.PI / 2));
    } else if (s.kind === 'lantern') {
      metal.push(place(new THREE.CylinderGeometry(0.1, 0.1, 0.28, 10), 0, 0.15, 0.1, 0, 0.3, Math.PI / 2));
      metal.push(place(new THREE.ConeGeometry(0.12, 0.1, 10), 0.18, 0.15, 0.1, 0, 0.3, -Math.PI / 2));
      metal.push(place(new THREE.TorusGeometry(0.09, 0.012, 4, 12), -0.02, 0.15, 0.03, Math.PI / 2, 0.3, 0));
      bone.push(place(new THREE.SphereGeometry(0.1, 9, 7).scale(1, 0.85, 1.2), -0.5, 0.2, 0.08, 0.4, 1.2, 0));
    } else {
      // Claw marks: three groups of four parallel grooves, carved just inside the rock face.
      for (let g = 0; g < 3; g++) {
        for (let k = 0; k < 4; k++) {
          const u = -0.7 + g * 0.7 + k * 0.1;
          const y = 0.8 + g * 0.2;
          const x = s.x + ux * u;
          const z = s.z + uz * u;
          const d = wallDistance(field, x, y + 0.25, z, s.wx, s.wz);
          m.makeRotationFromEuler(new THREE.Euler(0, Math.atan2(s.wx, s.wz), 0.28, 'YXZ'));
          m.setPosition(x + s.wx * (d - 0.004), y + 0.25, z + s.wz * (d - 0.004));
          bone.push(clean(new THREE.BoxGeometry(0.035, 0.75, 0.02)).applyMatrix4(m));
        }
      }
    }
  }
  const out: THREE.Mesh[] = [];
  const merged = (list: THREE.BufferGeometry[], color: number) => {
    if (list.length === 0) return;
    const geo = mergeGeometries(list, false);
    for (const g of list) g.dispose();
    if (geo) out.push(new THREE.Mesh(geo, createRevealMaterial(uniforms, color)));
  };
  merged(bone, LIFE_COLORS.bone);
  merged(metal, LIFE_COLORS.metal);
  return out;
}

/** Position + normal only, non-indexed, so different primitives merge. */
function clean(geo: THREE.BufferGeometry): THREE.BufferGeometry {
  const g = geo.index ? geo.toNonIndexed() : geo;
  if (g !== geo) geo.dispose();
  g.deleteAttribute('uv');
  return g;
}
