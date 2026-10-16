import * as THREE from 'three';
import { CONFIG } from '../config';
import type { PoseChoice } from '../game/poses';
import type { EyeSpot } from '../game/World';
import { eyeOffsets } from './monsterModel';

/** Eye pairs drawn at most (Hollows + the tutorial watcher). */
const MAX_PAIRS = 8;

const vertexShader = /* glsl */ `
attribute float aGlow;
uniform float uSize;
uniform float uRefDist;
uniform vec2 uScaleRange;
varying float vGlow;

void main() {
  vGlow = aGlow;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  // Closer eyes are bigger, but never vanish to a sub-pixel speck far away.
  float k = clamp(uRefDist / max(-mv.z, 0.1), uScaleRange.x, uScaleRange.y);
  gl_PointSize = aGlow > 0.001 ? uSize * k : 0.0;
}
`;

const fragmentShader = /* glsl */ `
varying float vGlow;

void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  float core = 1.0 - smoothstep(0.0, 0.42, r);
  float halo = (1.0 - r) * 0.45;
  vec3 col = vec3(1.0, 0.1, 0.06) * (core + halo) * vGlow + vec3(1.0, 0.75, 0.6) * core * core * vGlow * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

interface Pair {
  x: number;
  z: number;
  heading: number;
  pose: PoseChoice;
  /** Displayed glow, eased toward the target so eyes open and close instead of popping. */
  shown: number;
  target: number;
}

/**
 * The Hollows' red eyes, visible in total darkness whenever one faces the player (World.eyes()).
 * Drawn LIVE at the creature's real position, unlike the afterimages: their motion follows the
 * creature as it hunts by sound. One Points draw call for every pair.
 */
export class EyeGlow {
  private readonly points: THREE.Points;
  private readonly position: THREE.BufferAttribute;
  private readonly glow: THREE.BufferAttribute;
  private readonly pairs = new Map<number, Pair>();
  private lastS = 0;

  constructor(scene: THREE.Scene) {
    const geo = new THREE.BufferGeometry();
    this.position = new THREE.BufferAttribute(new Float32Array(MAX_PAIRS * 2 * 3), 3);
    this.glow = new THREE.BufferAttribute(new Float32Array(MAX_PAIRS * 2), 1);
    this.position.setUsage(THREE.DynamicDrawUsage);
    this.glow.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.position);
    geo.setAttribute('aGlow', this.glow);
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uSize: { value: CONFIG.EYES_POINT_PX },
        uRefDist: { value: CONFIG.EYES_FULL_DISTANCE_M },
        uScaleRange: { value: new THREE.Vector2(CONFIG.EYES_MIN_SCALE, CONFIG.EYES_MAX_SCALE) },
      },
      vertexShader,
      fragmentShader,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  clear(): void {
    this.pairs.clear();
  }

  update(spots: readonly EyeSpot[], clockS: number): void {
    const dt = Math.min(Math.max(clockS - this.lastS, 0), CONFIG.MAX_DT_S);
    this.lastS = clockS;
    for (const p of this.pairs.values()) p.target = 0;
    for (const s of spots) {
      const p = this.pairs.get(s.id);
      if (p) {
        p.x = s.x;
        p.z = s.z;
        p.heading = s.heading;
        p.pose = s.pose;
        p.target = s.glow;
      } else if (this.pairs.size < MAX_PAIRS) {
        this.pairs.set(s.id, { x: s.x, z: s.z, heading: s.heading, pose: s.pose, shown: 0, target: s.glow });
      }
    }
    const step = dt / CONFIG.EYES_FADE_S;
    let i = 0;
    for (const [id, p] of this.pairs) {
      p.shown += Math.max(Math.min(p.target - p.shown, step), -step);
      if (p.shown <= 0 && p.target <= 0) {
        this.pairs.delete(id);
        continue;
      }
      // Where the eyes are in the pose it is standing in, turned by its heading (rotation.y = heading:
      // model +z goes to (sin h, cos h), model +x to (cos h, -sin h)).
      const s = Math.sin(p.heading);
      const c = Math.cos(p.heading);
      for (const e of eyeOffsets(p.pose)) {
        this.position.setXYZ(i, p.x + e.x * c + e.z * s, e.y, p.z - e.x * s + e.z * c);
        this.glow.setX(i, p.shown);
        i++;
      }
    }
    for (; i < MAX_PAIRS * 2; i++) this.glow.setX(i, 0);
    this.position.needsUpdate = true;
    this.glow.needsUpdate = true;
  }
}
