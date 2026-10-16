import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import type { PoseChoice, PoseId } from '../game/poses';
import { artworkEyeOffsets, artworkGeometry, artworkTexture } from './hollowArtwork';

type V = readonly [number, number, number];

interface Arm {
  shoulder: V;
  elbow: V;
  wrist: V;
  /** Three long fingers ending in claws. */
  fingers: readonly [V, V, V];
}

interface Leg {
  hip: V;
  knee: V;
  ankle: V;
  toe: V;
}

/** One frozen pose of a Hollow. Model space: metres, origin at its feet, it FACES +z, +x is its left. */
interface PoseSpec {
  pelvis: V;
  chest: V;
  neck: V;
  /** Centre of the skull. */
  head: V;
  /** Head roll (tilted to one side) and pitch (+ = looking down), radians. */
  tilt: number;
  pitch: number;
  /** 0 = mouth shut, 1 = jaw hanging wide open. */
  jaw: number;
  armL: Arm;
  armR: Arm;
  legL: Leg;
  legR: Leg;
}

/**
 * A Hollow is ~2.3 m of starved, too-long body: hunched, head pushed forward and tilted, arms that
 * hang past its knees, three-clawed hands. Each pose is what you catch it doing when the echo
 * reaches it; it never moves while watched, so the pose changing IS the movement you see.
 */
const POSES: Record<PoseId, PoseSpec> = {
  // Idle: standing too still, head cocked, arms hanging to its knees.
  stand: {
    pelvis: [0, 1.08, 0],
    chest: [0, 1.62, 0.1],
    neck: [0, 1.86, 0.22],
    head: [0.06, 1.98, 0.32],
    tilt: 0.45,
    pitch: 0.18,
    jaw: 0.15,
    armL: { shoulder: [0.24, 1.73, 0.08], elbow: [0.31, 1.27, 0.06], wrist: [0.3, 0.78, 0.13], fingers: [[0.26, 0.46, 0.2], [0.31, 0.44, 0.19], [0.36, 0.47, 0.15]] },
    armR: { shoulder: [-0.24, 1.71, 0.08], elbow: [-0.33, 1.25, 0.02], wrist: [-0.34, 0.75, 0.06], fingers: [[-0.3, 0.43, 0.12], [-0.35, 0.42, 0.1], [-0.4, 0.45, 0.06]] },
    legL: { hip: [0.11, 1.02, 0], knee: [0.15, 0.56, 0.1], ankle: [0.13, 0.08, -0.02], toe: [0.14, 0.02, 0.17] },
    legR: { hip: [-0.11, 1.02, 0], knee: [-0.14, 0.56, 0.12], ankle: [-0.13, 0.08, 0], toe: [-0.15, 0.02, 0.19] },
  },
  // Hunting: mid-stride, bent forward, one arm already reaching ahead.
  stalk: {
    pelvis: [0, 0.98, -0.05],
    chest: [0, 1.42, 0.3],
    neck: [0, 1.6, 0.47],
    head: [0, 1.66, 0.62],
    tilt: 0.25,
    pitch: -0.2,
    jaw: 0.35,
    armL: { shoulder: [0.24, 1.5, 0.32], elbow: [0.34, 1.32, 0.68], wrist: [0.36, 1.12, 0.98], fingers: [[0.31, 0.95, 1.22], [0.37, 0.93, 1.24], [0.43, 0.96, 1.2]] },
    armR: { shoulder: [-0.24, 1.48, 0.28], elbow: [-0.32, 1.06, 0.18], wrist: [-0.3, 0.62, 0.22], fingers: [[-0.27, 0.32, 0.3], [-0.31, 0.31, 0.28], [-0.35, 0.33, 0.25]] },
    legL: { hip: [0.11, 0.94, -0.05], knee: [0.15, 0.6, 0.38], ankle: [0.14, 0.1, 0.42], toe: [0.15, 0.02, 0.6] },
    legR: { hip: [-0.11, 0.94, -0.05], knee: [-0.14, 0.48, -0.18], ankle: [-0.13, 0.12, -0.52], toe: [-0.13, 0.02, -0.38] },
  },
  // Hunting / searching: low like a spider, knees higher than its hips, hands flat on the ground, looking up.
  crouch: {
    pelvis: [0, 0.7, -0.2],
    chest: [0, 0.95, 0.25],
    neck: [0, 1.08, 0.45],
    head: [0, 1.12, 0.6],
    tilt: 0.6,
    pitch: -0.35,
    jaw: 0.25,
    armL: { shoulder: [0.24, 1.0, 0.25], elbow: [0.5, 0.95, 0.45], wrist: [0.4, 0.12, 0.7], fingers: [[0.35, 0.02, 0.95], [0.42, 0.02, 0.97], [0.49, 0.02, 0.92]] },
    armR: { shoulder: [-0.24, 0.98, 0.22], elbow: [-0.52, 0.9, 0.35], wrist: [-0.42, 0.1, 0.55], fingers: [[-0.37, 0.02, 0.8], [-0.44, 0.02, 0.81], [-0.51, 0.02, 0.76]] },
    legL: { hip: [0.12, 0.68, -0.2], knee: [0.33, 1.05, 0.1], ankle: [0.24, 0.08, -0.15], toe: [0.25, 0.02, 0.05] },
    legR: { hip: [-0.12, 0.68, -0.2], knee: [-0.35, 1.0, 0.05], ankle: [-0.26, 0.08, -0.2], toe: [-0.27, 0.02, 0] },
  },
  // Close: upright, both arms out toward your face, fingers spread, mouth open.
  reach: {
    pelvis: [0, 1.05, -0.05],
    chest: [0, 1.6, 0.12],
    neck: [0, 1.84, 0.26],
    head: [0.05, 1.95, 0.4],
    tilt: 0.35,
    pitch: -0.05,
    jaw: 0.65,
    armL: { shoulder: [0.24, 1.72, 0.12], elbow: [0.3, 1.62, 0.55], wrist: [0.26, 1.58, 0.98], fingers: [[0.17, 1.63, 1.3], [0.26, 1.6, 1.33], [0.35, 1.55, 1.28]] },
    armR: { shoulder: [-0.24, 1.7, 0.12], elbow: [-0.32, 1.52, 0.5], wrist: [-0.3, 1.44, 0.92], fingers: [[-0.21, 1.41, 1.24], [-0.3, 1.38, 1.27], [-0.39, 1.35, 1.2]] },
    legL: { hip: [0.11, 1.0, -0.05], knee: [0.14, 0.56, 0.14], ankle: [0.13, 0.08, 0.05], toe: [0.14, 0.02, 0.24] },
    legR: { hip: [-0.11, 1.0, -0.05], knee: [-0.14, 0.52, -0.12], ankle: [-0.13, 0.1, -0.35], toe: [-0.13, 0.02, -0.18] },
  },
  // The catch: thrown at you, arms wide, jaw unhinged.
  lunge: {
    pelvis: [0, 1.0, -0.4],
    chest: [0, 1.5, 0],
    neck: [0, 1.68, 0.18],
    head: [0, 1.72, 0.34],
    tilt: 0.2,
    pitch: -0.25,
    jaw: 1,
    armL: { shoulder: [0.26, 1.6, 0.02], elbow: [0.62, 1.78, 0.2], wrist: [0.78, 1.7, 0.55], fingers: [[0.78, 1.85, 0.82], [0.85, 1.72, 0.85], [0.87, 1.57, 0.8]] },
    armR: { shoulder: [-0.26, 1.58, 0], elbow: [-0.6, 1.4, 0.25], wrist: [-0.74, 1.62, 0.55], fingers: [[-0.74, 1.78, 0.8], [-0.82, 1.64, 0.83], [-0.85, 1.49, 0.76]] },
    legL: { hip: [0.11, 0.96, -0.4], knee: [0.16, 0.6, -0.05], ankle: [0.14, 0.12, -0.2], toe: [0.15, 0.02, -0.02] },
    legR: { hip: [-0.11, 0.96, -0.4], knee: [-0.15, 0.62, -0.75], ankle: [-0.13, 0.3, -1.1], toe: [-0.13, 0.12, -1.0] },
  },
};

/** Eye centres in head space: close-set pinpoints just proud of the front of the skull. */
const EYE_IN_HEAD: V = [0.033, 0.03, 0.118];

const UP = new THREE.Vector3(0, 1, 0);
const v3 = (p: V) => new THREE.Vector3(p[0], p[1], p[2]);

/** A tapered limb from a (radius ra) to b (radius rb). */
function tube(a: THREE.Vector3, b: THREE.Vector3, ra: number, rb: number, seg = 6): THREE.BufferGeometry {
  const dir = new THREE.Vector3().subVectors(b, a);
  const len = Math.max(dir.length(), 1e-4);
  const g = new THREE.CylinderGeometry(rb, ra, len, seg, 1, true);
  g.translate(0, len / 2, 0);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, dir.normalize()));
  g.translate(a.x, a.y, a.z);
  return g;
}

/** A flat disc of radius r at c, facing `normal`. */
function disc(c: THREE.Vector3, r: number, normal: THREE.Vector3): THREE.BufferGeometry {
  const g = new THREE.CircleGeometry(r, 12);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), normal.clone().normalize()));
  g.translate(c.x, c.y, c.z);
  return g;
}

function ball(c: THREE.Vector3, r: number, seg = 6): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(r, seg, Math.max(4, seg - 2));
  g.translate(c.x, c.y, c.z);
  return g;
}

/** An ellipsoid with radii (rx, ry, rz), its y axis turned to `axis`, centred at c. */
function blob(c: THREE.Vector3, rx: number, ry: number, rz: number, axis: THREE.Vector3 | THREE.Matrix4 = UP): THREE.BufferGeometry {
  const g = new THREE.SphereGeometry(1, 10, 8);
  g.scale(rx, ry, rz);
  if (axis instanceof THREE.Matrix4) g.applyMatrix4(axis);
  else g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(UP, axis.clone().normalize()));
  g.translate(c.x, c.y, c.z);
  return g;
}

interface Built {
  body: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  /** Eye centres, model space (unmirrored). */
  eyePts: [THREE.Vector3, THREE.Vector3];
}

function build(s: PoseSpec): Built {
  const parts: THREE.BufferGeometry[] = [];
  const pelvis = v3(s.pelvis);
  const chest = v3(s.chest);
  const neck = v3(s.neck);
  const spine = new THREE.Vector3().subVectors(chest, pelvis);
  const waist = pelvis.clone().addScaledVector(spine, 0.45);

  // Torso: a thin waist under a narrow ribcage, a small pelvis, a long neck.
  parts.push(tube(pelvis, waist, 0.07, 0.055));
  parts.push(tube(waist, chest, 0.06, 0.08));
  parts.push(blob(pelvis.clone().addScaledVector(spine, 0.72), 0.15, 0.22, 0.105, spine));
  parts.push(blob(pelvis, 0.13, 0.075, 0.09, spine));
  parts.push(tube(chest, neck, 0.05, 0.04));

  // Head: a tall, narrow, tilted skull; pinpoint eyes; under them a round gaping mouth, dark inside,
  // ringed with needle teeth pointing in. `jaw` opens the mouth wider.
  const headM = new THREE.Matrix4()
    .makeTranslation(s.head[0], s.head[1], s.head[2])
    .multiply(new THREE.Matrix4().makeRotationFromEuler(new THREE.Euler(s.pitch, 0, s.tilt, 'YXZ')));
  const rot = new THREE.Matrix4().extractRotation(headM);
  const H = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).applyMatrix4(headM);
  parts.push(tube(neck, H(0, -0.06, -0.05), 0.04, 0.035));
  parts.push(blob(H(0, 0.04, -0.02), 0.082, 0.14, 0.125, rot));
  const mouthR = 0.026 + 0.03 * s.jaw;
  const back = H(0, -0.07, 0.03);
  const front = H(0, -0.08, 0.125);
  const axis = new THREE.Vector3().subVectors(front, back).normalize();
  parts.push(tube(back, front, mouthR * 0.75, mouthR, 12)); // open-ended: seen from the front it is a ring
  parts.push(disc(back.clone().lerp(front, 0.5), mouthR * 0.85, axis)); // the dark throat inside it
  const u = new THREE.Vector3().crossVectors(axis, new THREE.Vector3(0, 1, 0).applyMatrix4(rot)).normalize();
  const w = new THREE.Vector3().crossVectors(u, axis);
  for (let i = 0; i < 14; i++) {
    const ang = (i / 14) * Math.PI * 2;
    const out = u.clone().multiplyScalar(Math.cos(ang)).addScaledVector(w, Math.sin(ang));
    const root = front.clone().addScaledVector(out, mouthR * 1.05);
    const tip = front.clone().addScaledVector(out, mouthR * (i % 2 ? 0.45 : 0.2)).addScaledVector(axis, 0.012);
    parts.push(tube(root, tip, 0.0035, 0.0004, 4));
  }

  // Arms: clavicle, long bones, knobbly joints, three claws.
  for (const arm of [s.armL, s.armR]) {
    const sh = v3(arm.shoulder);
    const el = v3(arm.elbow);
    const wr = v3(arm.wrist);
    parts.push(tube(chest.clone().add(new THREE.Vector3(0, 0.08, 0)), sh, 0.03, 0.03));
    parts.push(tube(sh, el, 0.042, 0.03));
    parts.push(ball(el, 0.034));
    parts.push(tube(el, wr, 0.03, 0.022));
    parts.push(ball(wr, 0.025));
    const tips = arm.fingers.map(v3);
    const centre = tips.reduce((acc, t) => acc.add(t), new THREE.Vector3()).multiplyScalar(1 / tips.length);
    const knuckles = wr.clone().lerp(centre, 0.3);
    parts.push(tube(wr, knuckles, 0.026, 0.02));
    for (const tip of tips) parts.push(tube(knuckles, tip, 0.011, 0.0015, 4));
  }

  // Legs: hips, knees that stick out, thin shins, long feet.
  for (const leg of [s.legL, s.legR]) {
    const hp = v3(leg.hip);
    const kn = v3(leg.knee);
    const an = v3(leg.ankle);
    parts.push(tube(pelvis, hp, 0.045, 0.045));
    parts.push(tube(hp, kn, 0.055, 0.038));
    parts.push(ball(kn, 0.042));
    parts.push(tube(kn, an, 0.035, 0.024));
    parts.push(tube(an, v3(leg.toe), 0.025, 0.008));
  }

  const body = mergeGeometries(parts.map((g) => g.toNonIndexed()));
  for (const g of parts) g.dispose();
  const eyePts: [THREE.Vector3, THREE.Vector3] = [H(-EYE_IN_HEAD[0], EYE_IN_HEAD[1], EYE_IN_HEAD[2]), H(EYE_IN_HEAD[0], EYE_IN_HEAD[1], EYE_IN_HEAD[2])];
  const eyeParts = eyePts.map((p) => ball(p, 0.0045, 6));
  const eyes = mergeGeometries(eyeParts);
  for (const g of eyeParts) g.dispose();
  return { body, eyes, eyePts };
}

/** Built once per pose and shared by every figure (afterimage pool + jumpscare). Never dispose them. */
const built = new Map<PoseId, Built>();
function poseGeometry(id: PoseId): Built {
  let b = built.get(id);
  if (!b) {
    b = build(POSES[id]);
    built.set(id, b);
  }
  return b;
}

export interface HollowFigure {
  group: THREE.Group;
  body: THREE.Mesh;
  eyes: THREE.Mesh;
  artwork: boolean;
}

/** A sound snapshot: generated Hollow art when loaded, procedural geometry for the Hush or a missing asset. */
export function createMonsterModel(bodyMaterial: THREE.Material, eyeMaterial: THREE.Material, pose: PoseChoice = { pose: 'stand', mirror: false }): HollowFigure {
  const b = poseGeometry(pose.pose);
  const group = new THREE.Group();
  const body = new THREE.Mesh(b.body, bodyMaterial);
  const eyes = new THREE.Mesh(b.eyes, eyeMaterial);
  group.add(body, eyes);
  const fig = { group, body, eyes, artwork: false };
  setPose(fig, pose);
  return fig;
}

export function setPose(fig: HollowFigure, pose: PoseChoice, who: 'hollow' | 'hush' = 'hollow'): void {
  const asset = who === 'hollow' ? artworkTexture(pose.pose) : null;
  fig.artwork = asset?.ready ?? false;
  const b = fig.artwork ? artworkGeometry(pose.pose) : poseGeometry(pose.pose);
  fig.body.geometry = b.body;
  fig.eyes.geometry = b.eyes;
  fig.group.scale.x = pose.mirror ? -1 : 1;
  if (fig.body.material instanceof THREE.ShaderMaterial) {
    fig.body.material.uniforms.uArtworkOn.value = fig.artwork ? 1 : 0;
    fig.body.material.uniforms.uMap.value = asset?.texture ?? null;
    const image = asset?.texture.image as { width?: number; height?: number } | undefined;
    if (image?.width && image.height) fig.body.material.uniforms.uTexel.value.set(1 / image.width, 1 / image.height);
    const solid = 'SOLID' in fig.body.material.defines;
    fig.body.material.blending = solid || fig.artwork ? THREE.NormalBlending : THREE.AdditiveBlending;
  }
}

/** Eye centres in model space for a pose (mirror applied): where the live red eyes are drawn. */
export function eyeOffsets(pose: PoseChoice): [THREE.Vector3, THREE.Vector3] {
  return artworkEyeOffsets(pose);
}

const echoVertex = /* glsl */ `
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;
void main() {
  vUv = uv;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vW = wp.xyz;
  vN = mat3(modelMatrix) * normal;
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const echoFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uSeed;
uniform float uScan;
uniform float uArtworkOn;
uniform sampler2D uMap;
uniform vec2 uTexel;
uniform vec3 uArtEdge;
uniform float uArtExposure;
uniform float uAlphaCutoff;
varying vec3 vW;
varying vec3 vN;
varying vec2 vUv;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(cameraPosition - vW);
  // Sound comes back strongest off the edges you see side-on: a glowing outline over a dark body.
  float rim = pow(1.0 - abs(dot(n, v)), 2.4);
  // Horizontal scan lines, about 1.5 px wide at any distance.
  float y = vW.y * uScan;
  float scan = 1.0 - smoothstep(0.0, 1.5 * fwidth(y), 0.5 - abs(fract(y) - 0.5));
  if (uArtworkOn > 0.5) {
    vec4 art = texture2D(uMap, vUv);
    if (art.a < uAlphaCutoff) discard;
    float neighbour = min(min(texture2D(uMap, vUv + vec2(uTexel.x, 0.0)).a,
      texture2D(uMap, vUv - vec2(uTexel.x, 0.0)).a),
      min(texture2D(uMap, vUv + vec2(0.0, uTexel.y)).a, texture2D(uMap, vUv - vec2(0.0, uTexel.y)).a));
    float edge = clamp(art.a - neighbour, 0.0, 1.0);
    vec3 surface = art.rgb * uArtExposure + uArtEdge * edge;
    #ifdef SOLID
    gl_FragColor = vec4(surface, art.a);
    #else
    float keep = step(hash13(floor(vW * 45.0) + uSeed), uOpacity * 1.2 + 0.05);
    gl_FragColor = vec4(surface * (0.85 + 0.15 * scan), art.a * uOpacity * keep);
    #endif
    #include <colorspace_fragment>
    return;
  }
  #ifdef SOLID
  // In your face: a black shape, only a thin outline (and the thin teeth) lit.
  float edge = pow(1.0 - abs(dot(n, v)), 3.5);
  float k = 1.7 * edge + 0.12 * scan * edge;
  gl_FragColor = vec4(uColor * k, 1.0);
  #else
  float k = 0.05 + 1.15 * rim + 0.35 * scan * (0.25 + rim);
  // As the afterimage fades it breaks up into specks instead of turning transparent evenly.
  float keep = step(hash13(floor(vW * 45.0) + uSeed), uOpacity * 1.2 + 0.05);
  gl_FragColor = vec4(uColor * k * uOpacity * keep, 1.0);
  #endif
  #include <colorspace_fragment>
}
`;

/**
 * Detailed Hollow artwork with subtle red edges, or the procedural Hush's dark echo silhouette.
 * 'afterimage': fades with uOpacity by breaking into specks (Afterimages sets it).
 * 'solid': the catch portrait or opaque Hush, drawn in the jumpscare pass.
 */
export function createEchoMaterial(color: THREE.ColorRepresentation, mode: 'afterimage' | 'solid'): THREE.ShaderMaterial {
  const solid = mode === 'solid';
  return new THREE.ShaderMaterial({
    defines: solid ? { SOLID: 1 } : {},
    uniforms: {
      uColor: { value: new THREE.Color(color) },
      uOpacity: { value: 0 },
      uSeed: { value: 0 },
      uScan: { value: CONFIG.HOLLOW_SCAN_LINES_PER_M },
      uArtworkOn: { value: 0 },
      uMap: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uArtEdge: { value: new THREE.Color(CONFIG.HOLLOW_ART_EDGE_COLOR) },
      uArtExposure: { value: CONFIG.HOLLOW_ART_EXPOSURE },
      uAlphaCutoff: { value: CONFIG.HOLLOW_ART_ALPHA_CUTOFF },
    },
    vertexShader: echoVertex,
    fragmentShader: echoFragment,
    transparent: !solid,
    blending: solid ? THREE.NormalBlending : THREE.AdditiveBlending,
    depthWrite: solid,
  });
}
