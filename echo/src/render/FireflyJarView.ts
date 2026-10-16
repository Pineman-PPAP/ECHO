import * as THREE from 'three';
import { CONFIG } from '../config';
import { mulberry32 } from '../game/rng';
import { JarArtwork } from './jarArtwork';

interface Fly {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  /** Wander frequencies (Hz) and phases, so every firefly flies its own path. */
  f: [number, number, number];
  s: [number, number, number];
  flashPhase: number;
  flashRate: number;
  /** Past positions (newest first) for the light trail. */
  trail: Float32Array;
}

/** How far below its held position the jar starts and ends the intro (m). */
const LOWERED_M = 0.32;

/**
 * A firefly's light: a quick double flash, then a dark pause (the pattern real fireflies use).
 * @param phase 0..1 through one cycle
 */
function flashCurve(phase: number): number {
  const a = (phase - 0.1) / 0.035;
  const b = (phase - 0.22) / 0.035;
  return Math.exp(-a * a) + 0.75 * Math.exp(-b * b);
}
/** Mean of flashCurve over a cycle (used to keep `blink` averaging 0.5). */
const FLASH_MEAN = 1.75 * 0.035 * Math.sqrt(Math.PI);

const viewVertex = /* glsl */ `
varying vec3 vN;
varying vec3 vPos;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vPos = mv.xyz;
  vN = normalize(normalMatrix * normal);
  gl_Position = projectionMatrix * mv;
}
`;

/**
 * Thin glass: the face of it is near black (the sRGB output makes small values show); its rims, two
 * vertical streaks of reflected light and the glow inside show the shape. Additive.
 */
const glassFragment = /* glsl */ `
uniform vec3 uGlass;
uniform vec3 uFly;
uniform float uGlow;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vPos);
  float rim = 1.0 - abs(dot(n, v));
  // Reflection streaks near the jar's left and right edges as you see it.
  vec3 side = normalize(cross(vec3(0.0, 1.0, 0.0), v));
  float sx = dot(n, side);
  float streak = (smoothstep(0.55, 0.6, sx) * (1.0 - smoothstep(0.66, 0.74, sx))
    + 0.5 * smoothstep(-0.8, -0.75, sx) * (1.0 - smoothstep(-0.72, -0.66, sx)));
  vec3 col = uGlass * (0.003 + 0.16 * rim * rim * rim + 0.045 * streak)
    + uFly * uGlow * (0.004 + 0.2 * rim * rim * rim + 0.08 * streak);
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Skin, sleeve and lid lit only by the fireflies: dark shapes with the jar's glow on the sides facing
 * it, a warm glow where the light shines through thin skin toward you, and a faint rim. Opaque.
 */
const backlitFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uFly;
uniform vec3 uLight;
uniform float uGlow;
uniform float uTranslucent;
varying vec3 vN;
varying vec3 vPos;
void main() {
  vec3 n = normalize(vN);
  vec3 v = normalize(-vPos);
  vec3 toL = uLight - vPos;
  float d = length(toL);
  vec3 l = toL / d;
  float atten = 1.0 / (1.0 + d * d * 700.0);
  float diff = max(dot(n, l), 0.0) * atten;
  float through = pow(max(dot(v, -l), 0.0), 3.0) * atten * uTranslucent;
  float rim = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec3 warm = mix(uFly, vec3(1.0, 0.6, 0.4), 0.3);
  vec3 col = uColor * 0.03
    + uColor * warm * diff * uGlow * 0.8
    + vec3(0.9, 0.3, 0.15) * through * uGlow * 0.35
    + warm * rim * uGlow * atten * 0.5;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const flyVertex = /* glsl */ `
attribute float aBright;
attribute float aSize;
attribute float aHead;
attribute float aSeed;
uniform float uSize;
varying float vB;
varying float vHead;
varying float vSeed;
void main() {
  vB = aBright;
  vHead = aHead;
  vSeed = aSeed;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = uSize * aSize * (0.45 + 0.55 * min(aBright, 1.0));
}
`;

/** Tiny luminous abdomens and fluttering wing glints, with a soft halo; trails stay soft points. */
const flyFragment = /* glsl */ `
uniform vec3 uColor;
uniform vec3 uHalo;
uniform float uTime;
uniform float uExposure;
varying float vB;
varying float vHead;
varying float vSeed;
void main() {
  vec2 p = (gl_PointCoord - 0.5) * 2.0;
  float r = length(p);
  if (r > 1.0) discard;
  float angle = vSeed * 6.2831853;
  p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
  // A small elongated abdomen is readable without turning every insect into a large orb.
  vec2 belly = (p - vec2(0.0, 0.055)) * vec2(1.6, 1.0);
  float core = exp(-dot(belly, belly) * 65.0);
  float inner = exp(-r * r * 15.0);
  float halo = exp(-r * r * 4.5) * pow(1.0 - r, 2.0);
  float flutter = 0.5 + 0.5 * sin(uTime * 43.0 + vSeed * 37.0);
  vec2 wing = (abs(p) - vec2(0.19 + flutter * 0.035, 0.07)) * vec2(1.0, 2.4);
  float wings = exp(-dot(wing, wing) * 95.0) * vHead;
  vec3 gold = mix(uColor, vec3(1.0, 0.83, 0.3), 0.25 + 0.3 * vSeed);
  vec3 col = vec3(1.0, 0.98, 0.77) * core * mix(0.5, 1.25, vHead)
    + gold * inner * 0.6 + uHalo * halo * 0.16
    + vec3(0.72, 0.85, 0.56) * wings * (0.09 + flutter * 0.12);
  gl_FragColor = vec4(col * vB * uExposure, 1.0);
  #include <colorspace_fragment>
}
`;

const haloVertex = /* glsl */ `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

/** Soft glow filling the jar and spilling around it; exactly 0 before the quad's edge. Additive. */
const haloFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uStrength;
varying vec2 vUv;
void main() {
  float r = length((vUv - 0.5) * 2.0);
  float edge = 1.0 - smoothstep(0.35, 1.0, r);
  gl_FragColor = vec4(uColor * uStrength * (exp(-r * r * 14.0) * 0.03 + 0.012 * edge * edge), 1.0);
  #include <colorspace_fragment>
}
`;

function additive(vertexShader: string, fragmentShader: string, uniforms: Record<string, THREE.IUniform>, side: THREE.Side = THREE.FrontSide): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms,
    vertexShader,
    fragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    side,
  });
}

/** Merges two indexed geometries (position + normal only) into one. */
function mergeTwo(a: THREE.BufferGeometry, b: THREE.BufferGeometry): THREE.BufferGeometry {
  const out = new THREE.BufferGeometry();
  const na = a.attributes.position.count;
  const pos = new Float32Array((na + b.attributes.position.count) * 3);
  const nor = new Float32Array(pos.length);
  pos.set(a.attributes.position.array as Float32Array, 0);
  pos.set(b.attributes.position.array as Float32Array, na * 3);
  nor.set(a.attributes.normal.array as Float32Array, 0);
  nor.set(b.attributes.normal.array as Float32Array, na * 3);
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  out.setIndex([...Array.from(a.index!.array), ...Array.from(b.index!.array, (i) => i + na)]);
  return out;
}

/**
 * A tube along a smooth curve whose radius tapers from r0 to r1, swelling a little at each `knuckles`
 * position (0..1 along it), with a round cap on the end. Used for the fingers, thumb, arm and sleeve.
 */
function taperedTube(points: THREE.Vector3[], r0: number, r1: number, knuckles: number[] = []): THREE.BufferGeometry {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const tubular = 28;
  const radial = 12;
  const geo = new THREE.TubeGeometry(curve, tubular, 1, radial, false);
  const pos = geo.attributes.position;
  const c = new THREE.Vector3();
  const v = new THREE.Vector3();
  for (let i = 0; i <= tubular; i++) {
    const t = i / tubular;
    curve.getPointAt(t, c);
    let rad = r0 + (r1 - r0) * t;
    for (const k of knuckles) rad *= 1 + 0.13 * Math.exp(-(((t - k) / 0.05) ** 2));
    for (let j = 0; j <= radial; j++) {
      const idx = i * (radial + 1) + j;
      v.fromBufferAttribute(pos, idx).sub(c).multiplyScalar(rad).add(c);
      pos.setXYZ(idx, v.x, v.y, v.z);
    }
  }
  geo.computeVertexNormals();
  const tip = new THREE.SphereGeometry(r1, 12, 8);
  curve.getPointAt(1, c);
  tip.translate(c.x, c.y, c.z);
  const merged = mergeTwo(geo, tip);
  geo.dispose();
  tip.dispose();
  return merged;
}

/**
 * The jar of fireflies held in the player's left hand (first-person view model). It lives in its own
 * scene, drawn after the cave with a cleared depth buffer so it never sinks into the rock; `root`
 * follows the camera. Everything in it is lit only by the fireflies (the backlit shader), so the hand
 * is a dark shape with the glow on its edges. The jar's light on the rock is the reveal shader's
 * jarLight(), placed at worldCenter() whether or not the jar is on screen.
 */
export class FireflyJarView {
  readonly root = new THREE.Group();
  /** 0..1: how many of the fireflies are flashing right now, averaging about 0.5 (the light breathes with it). */
  blink = 0.5;
  private readonly hold = new THREE.Group();
  /** Original geometry is retained while the local artwork loads, or if it fails. */
  private readonly fallback = new THREE.Group();
  private readonly artwork = new JarArtwork();
  private readonly flies: Fly[] = [];
  private readonly positions: Float32Array;
  private readonly brights: Float32Array;
  private readonly flyGeometry = new THREE.BufferGeometry();
  private readonly flyMat: THREE.ShaderMaterial;
  private readonly glassMats: THREE.ShaderMaterial[] = [];
  private readonly backlitMats: THREE.ShaderMaterial[] = [];
  private readonly haloMat: THREE.ShaderMaterial;
  private readonly heldAt = new THREE.Vector3();
  private turnLag = 0;
  private readonly innerR = CONFIG.JAR_RADIUS_M * 0.78;
  private readonly yLo = -CONFIG.JAR_HEIGHT_M / 2 + 0.01;
  private readonly yHi = CONFIG.JAR_HEIGHT_M / 2 - 0.03;

  constructor(scene: THREE.Scene, private readonly useArtwork = true) {
    scene.add(this.root);
    this.root.add(this.hold);
    this.hold.add(this.fallback, this.artwork.mesh);
    const fly = new THREE.Color(CONFIG.FIREFLY_COLOR);

    // Glass: a mason-jar profile turned on a lathe, with a lip under the lid.
    const r = CONFIG.JAR_RADIUS_M;
    const h = CONFIG.JAR_HEIGHT_M;
    const profile = [
      [0, -h / 2 + 0.004],
      [r * 0.82, -h / 2],
      [r * 0.97, -h / 2 + 0.004],
      [r, -h / 2 + 0.014],
      [r, h / 2 - 0.032],
      [r * 0.93, h / 2 - 0.02],
      [r * 0.8, h / 2 - 0.012],
      [r * 0.78, h / 2 - 0.009],
      [r * 0.8, h / 2 - 0.006],
      [r * 0.78, h / 2],
    ].map(([x, y]) => new THREE.Vector2(x, y));
    // Only the outer surface is drawn: thin glass barely shows its far wall, and drawing it washed the jar green.
    const glassMat = additive(viewVertex, glassFragment, {
      uGlass: { value: new THREE.Color(0xa9c1cc) },
      uFly: { value: fly },
      uGlow: { value: 0 },
    });
    this.glassMats.push(glassMat);
    const glass = new THREE.Mesh(new THREE.LatheGeometry(profile, 48), glassMat);
    glass.renderOrder = 5;
    this.fallback.add(glass);

    // Lid: a dull tin screw cap with ridges, and a loop of twine around the neck.
    const lidMat = this.backlit(0x6a6258, 0);
    const lid = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.83, r * 0.83, 0.017, 40), lidMat);
    lid.position.y = h / 2 + 0.0075;
    this.fallback.add(lid);
    for (const y of [h / 2 + 0.002, h / 2 + 0.008, h / 2 + 0.014]) {
      const ridge = new THREE.Mesh(new THREE.TorusGeometry(r * 0.835, 0.0013, 6, 40), lidMat);
      ridge.rotation.x = Math.PI / 2;
      ridge.position.y = y;
      this.fallback.add(ridge);
    }
    const twine = new THREE.Mesh(new THREE.TorusGeometry(r * 0.8, 0.0022, 6, 40), this.backlit(0x8a6a44, 0.4));
    twine.rotation.x = Math.PI / 2;
    twine.position.y = h / 2 - 0.009;
    this.fallback.add(twine);

    // The glow inside the jar, spilling a little around it.
    this.haloMat = additive(haloVertex, haloFragment, { uColor: { value: fly }, uStrength: { value: 0 } });
    const halo = new THREE.Mesh(new THREE.PlaneGeometry(h * 2.4, h * 2.4), this.haloMat);
    halo.renderOrder = 2;
    this.hold.add(halo);

    // Fireflies: each one a point plus a short trail of fading points behind it.
    const rand = mulberry32(7);
    const n = CONFIG.FIREFLY_COUNT;
    const trail = CONFIG.FIREFLY_TRAIL;
    this.positions = new Float32Array(n * trail * 3);
    this.brights = new Float32Array(n * trail);
    const sizes = new Float32Array(n * trail);
    const heads = new Float32Array(n * trail);
    const seeds = new Float32Array(n * trail);
    for (let i = 0; i < n; i++) {
      const a = rand() * Math.PI * 2;
      const rr = Math.sqrt(rand()) * this.innerR;
      const f: Fly = {
        x: Math.cos(a) * rr,
        y: this.flightHeight(i),
        z: Math.sin(a) * rr,
        vx: 0,
        vy: 0,
        vz: 0,
        f: [0.4 + rand() * 0.9, 0.3 + rand() * 0.8, 0.4 + rand() * 0.9],
        s: [rand() * 6.28, rand() * 6.28, rand() * 6.28],
        flashPhase: rand(),
        flashRate: 0.7 + rand() * 0.6,
        trail: new Float32Array(trail * 3),
      };
      for (let k = 0; k < trail; k++) f.trail.set([f.x, f.y, f.z], k * 3);
      this.flies.push(f);
      for (let k = 0; k < trail; k++) {
        sizes[i * trail + k] = k === 0 ? 0.8 + rand() * 0.4 : 0.45 * (1 - k / trail);
        heads[i * trail + k] = k === 0 ? 1 : 0;
        seeds[i * trail + k] = (i * 0.618033989) % 1;
      }
    }
    this.flyGeometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    this.flyGeometry.setAttribute('aBright', new THREE.BufferAttribute(this.brights, 1));
    this.flyGeometry.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    this.flyGeometry.setAttribute('aHead', new THREE.BufferAttribute(heads, 1));
    this.flyGeometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    this.flyMat = additive(flyVertex, flyFragment, {
      uColor: { value: fly },
      uHalo: { value: new THREE.Color(CONFIG.FIREFLY_HALO_COLOR) },
      uSize: { value: CONFIG.FIREFLY_POINT_PX },
      uTime: { value: 0 },
      uExposure: { value: CONFIG.FIREFLY_VISUAL_EXPOSURE },
    });
    const points = new THREE.Points(this.flyGeometry, this.flyMat);
    points.frustumCulled = false;
    // Emission is composited through the glass artwork; the hand lies outside their bounds.
    points.renderOrder = 4;
    this.hold.add(points);

    this.buildHand();
  }

  /** A material lit only by the fireflies (see backlitFragment). @param translucent how much light shines through it */
  private backlit(color: number, translucent: number): THREE.ShaderMaterial {
    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uColor: { value: new THREE.Color(color) },
        uFly: { value: new THREE.Color(CONFIG.FIREFLY_COLOR) },
        uLight: { value: new THREE.Vector3() },
        uGlow: { value: 0 },
        uTranslucent: { value: translucent },
      },
      vertexShader: viewVertex,
      fragmentShader: backlitFragment,
    });
    this.backlitMats.push(mat);
    return mat;
  }

  /**
   * A left hand cradling the jar from below, palm up: the palm under the base, four fingers curling up
   * the far side (seen through the glass against the glow, the little finger peeking round the right
   * edge), the thumb up the left side in front of the glass, and the forearm coming in from the
   * bottom-left of the screen into a sleeve.
   */
  private buildHand(): void {
    const skin = this.backlit(0x6e4a3a, 1);
    const sleeve = this.backlit(0x2a2c30, 0);
    const r = CONFIG.JAR_RADIUS_M;
    const base = -CONFIG.JAR_HEIGHT_M / 2;
    const deg = Math.PI / 180;
    /** A point around the jar: angle (0 = +x right, 90 = toward the camera, -90 = far side), distance from the axis, height. */
    const at = (angleDeg: number, dist: number, y: number) =>
      new THREE.Vector3(Math.cos(angleDeg * deg) * dist, y, Math.sin(angleDeg * deg) * dist);
    const add = (geo: THREE.BufferGeometry, mat: THREE.Material) => this.fallback.add(new THREE.Mesh(geo, mat));
    const v3 = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

    /** A finger from inside the palm, round the base's rim, then up the jar's side to its tip. */
    const finger = (angleDeg: number, length: number, r0: number): void => {
      const pts = [
        at(angleDeg + 22, r * 0.3, base - 0.014),
        at(angleDeg + 8, r * 0.82, base - 0.012),
        at(angleDeg + 2, r + r0 * 0.95, base + 0.002),
        at(angleDeg - 2, r + r0 * 0.85, base + length * 0.55),
        at(angleDeg - 5, r + r0 * 0.7, base + length),
      ];
      add(taperedTube(pts, r0, r0 * 0.72, [0.4, 0.68]), skin);
    };
    finger(-128, 0.044, 0.0085);
    finger(-101, 0.05, 0.009);
    finger(-74, 0.046, 0.0086);
    finger(-48, 0.036, 0.0075);
    // Thumb: from the heel of the palm up the left side, its tip leaning toward you.
    const thumb = [at(160, r * 0.45, base - 0.014), at(170, r * 0.98, base - 0.006), at(168, r + 0.011, base + 0.016), at(156, r + 0.01, base + 0.038), at(144, r + 0.008, base + 0.053)];
    add(taperedTube(thumb, 0.0118, 0.0086, [0.45]), skin);

    // Palm: a broad pad under the base, thicker at the heel (toward you and the wrist).
    const palm = new THREE.SphereGeometry(1, 24, 14);
    palm.scale(r * 1.02, 0.015, r * 1.08);
    palm.translate(-0.004, base - 0.016, 0.002);
    add(palm, skin);
    const heel = new THREE.SphereGeometry(1, 20, 12);
    heel.scale(0.03, 0.019, 0.028);
    heel.translate(-r * 0.45, base - 0.021, r * 0.55);
    add(heel, skin);

    // Wrist and forearm, down and out of the bottom-left of the screen, into a sleeve.
    const arm = [v3(-r * 0.4, base - 0.02, r * 0.55), v3(-r * 0.9, base - 0.07, r + 0.03), v3(-r - 0.06, base - 0.19, r + 0.09), v3(-r - 0.12, base - 0.34, r + 0.15)];
    add(taperedTube(arm, 0.026, 0.034), skin);
    const cuff = [v3(-r - 0.07, base - 0.22, r + 0.105), v3(-r - 0.13, base - 0.37, r + 0.165), v3(-r - 0.2, base - 0.56, r + 0.23)];
    add(taperedTube(cuff, 0.039, 0.047), sleeve);
  }

  /** Where the jar is held, in world space, whether or not it is on screen (the light comes from here). */
  worldCenter(out: THREE.Vector3): THREE.Vector3 {
    return this.root.localToWorld(out.copy(this.heldAt));
  }

  /** One home height per insect, with independent horizontal paths and wandering phases.
   * No random draws: this layout leaves the original flash phases unchanged. */
  private flightHeight(index: number): number {
    return this.yLo + (this.yHi - this.yLo) * (index + 0.5) / CONFIG.FIREFLY_COUNT;
  }

  /**
   * @param glow 0..1 how awake the fireflies are   @param excitement 0..1 (hum pitch)
   * @param turnRate rad/s the view is turning (+ = left): the jar lags behind
   * @param presence 0 = lowered out of view, 1 = held up in view
   * @param offer 0 = held in the left hand, 1 = brought forward for the Field Manual's close-up
   */
  update(dtS: number, clockS: number, glow: number, excitement: number, bobPhase: number, turnRate: number, presence: number, offer = 0): void {
    const dt = Math.min(Math.max(dtS, 0), CONFIG.MAX_DT_S);
    this.turnLag += (turnRate * CONFIG.JAR_TURN_LAG - this.turnLag) * (1 - Math.exp(-dt * 6));
    const o = Math.min(Math.max(offer, 0), 1);
    const k = o * o * (3 - 2 * o);
    this.heldAt.set(
      CONFIG.JAR_HOLD_X_M + (CONFIG.JAR_OFFER_X_M - CONFIG.JAR_HOLD_X_M) * k + Math.sin(bobPhase * 0.5) * CONFIG.JAR_SWAY_M + this.turnLag,
      CONFIG.JAR_HOLD_Y_M + (CONFIG.JAR_OFFER_Y_M - CONFIG.JAR_HOLD_Y_M) * k + Math.sin(bobPhase) * CONFIG.JAR_SWAY_M * 0.6,
      CONFIG.JAR_HOLD_Z_M + (CONFIG.JAR_OFFER_Z_M - CONFIG.JAR_HOLD_Z_M) * k,
    );
    const lower = 1 - presence;
    this.hold.position.copy(this.heldAt);
    this.hold.position.y -= LOWERED_M * lower * lower;
    this.hold.rotation.set(0.12 + 0.5 * lower, 0.3 - CONFIG.JAR_OFFER_TURN_RAD * k, 0.1 - this.turnLag * 2 + 0.3 * lower);

    const speed = (CONFIG.FIREFLY_SLEEP_SPEED + (CONFIG.FIREFLY_AWAKE_SPEED - CONFIG.FIREFLY_SLEEP_SPEED) * glow) * (1 + CONFIG.FIREFLY_EXCITED_BOOST * excitement);
    const flashHz = (CONFIG.FIREFLY_SLEEP_BLINK_HZ + (CONFIG.FIREFLY_AWAKE_BLINK_HZ - CONFIG.FIREFLY_SLEEP_BLINK_HZ) * glow) * (1 + excitement);
    const steer = 1 - Math.exp(-dt * 4);
    const buzz = CONFIG.FIREFLY_BUZZ_M * glow * (0.5 + excitement);
    const trail = CONFIG.FIREFLY_TRAIL;
    let flashSum = 0;
    this.flies.forEach((f, i) => {
      let dx = Math.sin(clockS * f.f[0] + f.s[0]) + 0.5 * Math.sin(clockS * f.f[0] * 2.3 + f.s[1]);
      let dy = 0.7 * Math.sin(clockS * f.f[1] + f.s[1]);
      let dz = Math.cos(clockS * f.f[2] + f.s[2]) + 0.5 * Math.cos(clockS * f.f[2] * 1.9 + f.s[0]);
      const len = Math.hypot(dx, dy, dz) || 1;
      dx /= len;
      dy /= len;
      dz /= len;
      f.vx += (dx * speed - f.vx) * steer;
      // Each insect wanders around its own height band. Random velocity plus gravity used to
      // pin most of the swarm to the floor, especially during the short introduction.
      const home = this.flightHeight(i) + Math.sin(clockS * f.f[1] + f.s[1])
        * (this.yHi - this.yLo) * CONFIG.FIREFLY_HEIGHT_WANDER;
      const verticalSpeed = dy * speed * 0.2 + (home - f.y) * CONFIG.FIREFLY_HEIGHT_RETURN_PER_S;
      f.vy += (verticalSpeed - f.vy) * steer;
      f.vz += (dz * speed - f.vz) * steer;
      f.x += f.vx * dt;
      f.y += f.vy * dt;
      f.z += f.vz * dt;
      // Bounce off the glass, the bottom and the lid.
      const rr = Math.hypot(f.x, f.z);
      if (rr > this.innerR) {
        const nx = f.x / rr;
        const nz = f.z / rr;
        f.x = nx * this.innerR;
        f.z = nz * this.innerR;
        const out = f.vx * nx + f.vz * nz;
        if (out > 0) {
          f.vx -= 2 * out * nx;
          f.vz -= 2 * out * nz;
        }
      }
      if (f.y < this.yLo) {
        f.y = this.yLo;
        f.vy = Math.abs(f.vy) * 0.3;
      } else if (f.y > this.yHi) {
        f.y = this.yHi;
        f.vy = -Math.abs(f.vy);
      }
      f.flashPhase = (f.flashPhase + dt * flashHz * f.flashRate) % 1;
      const flash = flashCurve(f.flashPhase);
      if (i < CONFIG.FIREFLY_LIGHT_SAMPLE_COUNT) flashSum += flash;
      // No hum means no emission, including the cores, wings and trails.
      const bright = glow * (0.35 + 0.65 * Math.min(flash, 1));

      // Trail: shift the history, newest first.
      f.trail.copyWithin(3, 0, (trail - 1) * 3);
      f.trail[0] = f.x + buzz * Math.sin(clockS * 47 + i * 1.7);
      f.trail[1] = f.y + buzz * Math.sin(clockS * 53 + i * 2.9);
      f.trail[2] = f.z + buzz * Math.cos(clockS * 41 + i * 0.7);
      this.positions.set(f.trail, i * trail * 3);
      for (let k = 0; k < trail; k++) {
        const fade = 1 - k / trail;
        this.brights[i * trail + k] = k === 0 ? bright : bright * 0.4 * fade * fade * glow;
      }
    });
    if (this.useArtwork && this.artwork.ready) this.artwork.projectFireflies(this.positions);
    this.blink = Math.min((flashSum / Math.min(this.flies.length, CONFIG.FIREFLY_LIGHT_SAMPLE_COUNT) / FLASH_MEAN) * 0.5, 1);
    this.flyMat.uniforms.uTime.value = clockS;
    this.flyGeometry.attributes.position.needsUpdate = true;
    this.flyGeometry.attributes.aBright.needsUpdate = true;

    const shine = glow;
    const breathe = 1 - CONFIG.JAR_FLICKER + CONFIG.JAR_FLICKER * this.blink * 2;
    this.artwork.update(shine * breathe);
    this.artwork.mesh.visible = this.useArtwork && this.artwork.ready;
    this.fallback.visible = !this.artwork.mesh.visible;
    for (const m of this.glassMats) m.uniforms.uGlow.value = shine;
    this.haloMat.uniforms.uStrength.value = shine * breathe;
    for (const m of this.backlitMats) {
      m.uniforms.uGlow.value = shine * breathe;
      // The light comes from the middle of the jar, in camera space (root is the camera's frame).
      m.uniforms.uLight.value.copy(this.hold.position);
    }
  }
}
