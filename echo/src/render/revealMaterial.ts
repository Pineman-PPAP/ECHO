import * as THREE from 'three';
import { CONFIG } from '../config';

/**
 * Uniforms shared by every reveal material. Create ONE object with createRevealUniforms() and pass
 * it to every createRevealMaterial() call: the spread below copies references to the same
 * { value } objects, so updating shared.uTime.value once updates every material.
 */
export interface RevealUniforms {
  [name: string]: THREE.IUniform;
  uTime: THREE.IUniform<number>;
  /** Per pulse: xyz = origin (world), w = start time (seconds, game clock). */
  uPulseA: THREE.IUniform<THREE.Vector4[]>;
  /** Per pulse: x = max radius (m), y = strength (0 = slot unused), z/w unused. */
  uPulseB: THREE.IUniform<THREE.Vector4[]>;
  uPulseSpeed: THREE.IUniform<number>;
  uPulseFade: THREE.IUniform<number>;
  uBeamOn: THREE.IUniform<number>;
  uBeamOrigin: THREE.IUniform<THREE.Vector3>;
  uBeamDir: THREE.IUniform<THREE.Vector3>;
  /** cos(half angle) of the beam cone. */
  uBeamCos: THREE.IUniform<number>;
  uBeamRange: THREE.IUniform<number>;
  uBeamStrength: THREE.IUniform<number>;
  /** Light a surface facing AWAY from the pulse still gets (relief shading). */
  uWrap: THREE.IUniform<number>;
  /** Colour of the thin bright line at the wavefront, and its width (m). */
  uRingColor: THREE.IUniform<THREE.Color>;
  uRingWidth: THREE.IUniform<number>;
  /** Sonar light / (1 + distance² * this). */
  uFalloff: THREE.IUniform<number>;
  /** Relief light comes from this much (x distance) above the sound's source. */
  uLightLift: THREE.IUniform<number>;
  /** A pulse's light is a quick flash (decaying at uFlashDecay per second) plus a dim afterglow of this share (fading over uPulseFade). */
  uAfterglow: THREE.IUniform<number>;
  uFlashDecay: THREE.IUniform<number>;
  /** Rock grain: base frequency (cycles per metre) and bump height (m). */
  uGrainScale: THREE.IUniform<number>;
  uBump: THREE.IUniform<number>;
  /** Strength of the soft rock-layer banding in the rock's colour (0 = none). */
  uStrata: THREE.IUniform<number>;
  /** Overall brightness of lit rock, and the strength of the wet-stone glints that face you. */
  uExposure: THREE.IUniform<number>;
  uGloss: THREE.IUniform<number>;
  /** 0..1: how much the rock is shaded by its flat mesh faces (angular stone) rather than smooth normals. */
  uFacet: THREE.IUniform<number>;
}

export function createRevealUniforms(): RevealUniforms {
  return {
    uTime: { value: 0 },
    uPulseA: { value: Array.from({ length: CONFIG.MAX_PULSES }, () => new THREE.Vector4()) },
    uPulseB: { value: Array.from({ length: CONFIG.MAX_PULSES }, () => new THREE.Vector4()) },
    uPulseSpeed: { value: CONFIG.PULSE_SPEED },
    uPulseFade: { value: CONFIG.PULSE_FADE_S },
    uBeamOn: { value: 0 },
    uBeamOrigin: { value: new THREE.Vector3() },
    uBeamDir: { value: new THREE.Vector3(0, 0, -1) },
    uBeamCos: { value: Math.cos(0.3) },
    uBeamRange: { value: 10 },
    uBeamStrength: { value: 0 },
    uWrap: { value: CONFIG.CAVE_WRAP_LIGHT },
    uRingColor: { value: new THREE.Color(CONFIG.CAVE_RING_COLOR) },
    uRingWidth: { value: CONFIG.CAVE_RING_WIDTH_M },
    uFalloff: { value: CONFIG.CAVE_DISTANCE_FALLOFF },
    uLightLift: { value: CONFIG.CAVE_LIGHT_LIFT },
    uAfterglow: { value: CONFIG.CAVE_AFTERGLOW },
    uFlashDecay: { value: CONFIG.CAVE_FLASH_DECAY_PER_S },
    uGrainScale: { value: CONFIG.CAVE_GRAIN_PER_M },
    uBump: { value: CONFIG.CAVE_GRAIN_BUMP_M },
    uStrata: { value: CONFIG.CAVE_STRATA },
    uExposure: { value: CONFIG.CAVE_EXPOSURE },
    uGloss: { value: CONFIG.CAVE_GLOSS },
    uFacet: { value: CONFIG.CAVE_FACET },
  };
}

/**
 * GLSL shared by every reveal shader: how much sonar light reaches world point p.
 * With a normal n (|n| = 1) the side of the rock facing the sound gets more light than the side
 * turned away, so every clap shows the rock's relief; pass vec3(0) for points (dust, drops).
 * Returns vec2(light, wavefront ring).
 */
export const REVEAL_LIGHT_GLSL = /* glsl */ `
uniform float uTime;
uniform vec4 uPulseA[MAX_PULSES];
uniform vec4 uPulseB[MAX_PULSES];
uniform float uPulseSpeed;
uniform float uPulseFade;
uniform float uBeamOn;
uniform vec3 uBeamOrigin;
uniform vec3 uBeamDir;
uniform float uBeamCos;
uniform float uBeamRange;
uniform float uBeamStrength;
uniform float uWrap;
uniform float uFalloff;
uniform float uLightLift;
uniform float uRingWidth;
uniform float uAfterglow;
uniform float uFlashDecay;

vec2 revealLight(vec3 p, vec3 n) {
  float light = 0.0;
  float ring = 0.0;
  bool shaded = dot(n, n) > 0.5;
  // Sonar pulses: an expanding sphere. Surfaces light up when the wavefront passes them, then fade.
  for (int i = 0; i < MAX_PULSES; i++) {
    vec4 a = uPulseA[i];
    vec4 b = uPulseB[i];
    if (b.y <= 0.0) continue;
    float age = uTime - a.w;
    if (age < 0.0) continue;
    vec3 toSource = a.xyz - p;
    float d = length(toSource);
    float front = age * uPulseSpeed;
    if (d > b.x || d > front) continue;
    float since = age - d / uPulseSpeed;  // seconds since the wavefront passed this point
    // A quick flash, then a dim afterglow (~5% of it left after uPulseFade): darkness comes back fast.
    float fade = (1.0 - uAfterglow) * exp(-uFlashDecay * since) + uAfterglow * exp(-3.0 * since / uPulseFade);
    float rim = 1.0 - smoothstep(0.75 * b.x, b.x, d);
    float face = shaded ? mix(uWrap, 1.0, max(dot(n, normalize(toSource + vec3(0.0, d * uLightLift, 0.0))), 0.0)) : 1.0;
    // Far rock stays dim (the cave swallows the sound); rock right beside you is dimmed too, so the
    // edges of the view stay dark and the eye goes to the passage ahead.
    float reach = (0.35 + 0.65 * smoothstep(0.4, 2.0, d)) / (1.0 + d * d * uFalloff);
    light += b.y * fade * rim * face * reach;
    ring += b.y * (1.0 - smoothstep(0.0, uRingWidth, front - d)) * rim * face * mix(0.35, 1.0, reach);  // thin line at the wavefront
  }
  // Hum beam: a cone from the player's head along the view direction.
  if (uBeamOn > 0.5) {
    vec3 v = p - uBeamOrigin;
    float d = length(v);
    if (d < uBeamRange && d > 0.001) {
      float c = dot(v / d, uBeamDir);
      float cone = smoothstep(uBeamCos, mix(uBeamCos, 1.0, 0.3), c);
      float fall = 1.0 - smoothstep(0.6 * uBeamRange, uBeamRange, d);
      float face = shaded ? mix(uWrap, 1.0, max(dot(n, -v / d), 0.0)) : 1.0;
      light += uBeamStrength * cone * fall * face;
    }
  }
  return vec2(light, ring);
}
`;

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#ifdef ROCK
attribute float aLayer;
attribute float aShade;
varying float vLayer;
varying float vShade;
#endif

void main() {
  vec4 lp = vec4(position, 1.0);
  vec3 ln = normal;
  #ifdef USE_INSTANCING
  lp = instanceMatrix * lp;
  ln = mat3(instanceMatrix) * ln;
  #endif
  vec4 wp = modelMatrix * lp;
  vWorldPos = wp.xyz;
  vWorldNormal = mat3(modelMatrix) * ln;  // normalised per fragment; a zero normal means "no relief shading"
  #ifdef ROCK
  vLayer = aLayer;
  vShade = aShade;
  #endif
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
${REVEAL_LIGHT_GLSL}
uniform vec3 uRingColor;
uniform float uGrainScale;
uniform float uBump;
uniform float uStrata;
uniform float uExposure;
uniform float uGloss;
uniform float uFacet;
uniform vec3 uColor;
uniform vec3 uFloorColor;
uniform vec3 uCeilColor;
uniform float uAmbient;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;
#ifdef ROCK
varying float vLayer;
varying float vShade;
#endif

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

#ifdef ROCK
float vnoise(vec3 p) {
  vec3 i = floor(p);
  vec3 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  vec2 e = vec2(1.0, 0.0);
  return mix(
    mix(mix(hash13(i), hash13(i + e.xyy), f.x), mix(hash13(i + e.yxy), hash13(i + e.xxy), f.x), f.y),
    mix(mix(hash13(i + e.yyx), hash13(i + e.xyx), f.x), mix(hash13(i + e.yxx), hash13(i + e.xxx), f.x), f.y),
    f.z);
}

/**
 * Rock grain height (about -0.5..0.5): ridged noise, so the stone has sharp creases (fractures) rather
 * than soft blobs. Each octave fades out before it gets smaller than a pixel (fw = metres per pixel).
 */
float grain(vec3 p, float fw) {
  float h = 0.0;
  float amp = 0.55;
  float freq = uGrainScale;
  for (int i = 0; i < 3; i++) {
    float ridge = 1.0 - abs(2.0 * vnoise(p * freq) - 1.0);
    h += amp * (1.0 - smoothstep(0.12, 0.4, fw * freq)) * (ridge * ridge - 0.45);
    freq *= 2.3;
    amp *= 0.5;
  }
  return h;
}

/** Bump mapping without UVs (Mikkelsen 2010): tilt the normal by the screen-space slope of height h. */
vec3 bumped(vec3 n, vec3 p, float h) {
  vec3 dpdx = dFdx(p);
  vec3 dpdy = dFdy(p);
  vec3 r1 = cross(dpdy, n);
  vec3 r2 = cross(n, dpdx);
  float det = dot(dpdx, r1);
  vec3 g = sign(det) * (dFdx(h) * r1 + dFdy(h) * r2);
  return normalize(abs(det) * n - g);
}
#endif

void main() {
  vec3 n = dot(vWorldNormal, vWorldNormal) > 1e-6 ? normalize(vWorldNormal) : vec3(0.0);

  #ifdef ROCK
  // Rough stone: angular facets, a creased normal for the echo to catch, faint blotches and rock layers, dark crevices.
  vec3 nFace = normalize(cross(dFdx(vWorldPos), dFdy(vWorldPos)));
  if (dot(nFace, n) < 0.0) nFace = -nFace;
  n = normalize(mix(n, nFace, uFacet));
  float fw = length(fwidth(vWorldPos));
  float h = grain(vWorldPos, fw);
  // Less bump on rock seen edge-on (looking along a tunnel wall), where it would streak like fur.
  float edgeOn = smoothstep(0.08, 0.45, abs(dot(n, normalize(cameraPosition - vWorldPos))));
  n = bumped(n, vWorldPos, h * uBump * edgeOn);
  float stain = 0.8 + 0.2 * vnoise(vWorldPos * 0.45 + 7.0);
  float strata = 1.0 - uStrata * (0.5 + 0.5 * sin(vLayer * 6.2832));
  // Detail is kept where rock faces you; edge-on it is smoothed out (stretched blotches read as fur).
  float surface = vShade * mix(0.8, stain * strata * (0.85 + 0.6 * h), edgeOn);
  vec3 base = n.y > 0.0 ? mix(uColor, uFloorColor, smoothstep(0.45, 0.85, n.y)) : mix(uColor, uCeilColor, smoothstep(0.45, 0.85, -n.y));
  #else
  float surface = 1.0;  // markers and props read as solid shapes
  vec3 base = uColor;
  #endif

  vec2 lr = revealLight(vWorldPos, n);
  float light = (uAmbient + lr.x) * uExposure;

  vec3 col = base * light * surface + uRingColor * clamp(lr.y, 0.0, 1.0) * min(surface * 1.4, 1.0);
  #ifdef ROCK
  // Wet stone: the sound comes from where you stand, so the bumps that face you glint.
  float facing = max(dot(n, normalize(cameraPosition - vWorldPos)), 0.0);
  col += uRingColor * uGloss * pow(facing, 24.0) * light * vShade;
  #endif
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const pointsVertexShader = /* glsl */ `
${REVEAL_LIGHT_GLSL}
uniform float uSize;
uniform float uDrift;
uniform float uGravity;
uniform float uFallS;
#ifdef DRIP
attribute vec2 aDrip;  // x = period (s), y = phase offset (s)
#else
attribute float aSeed;
#endif
varying float vLight;

void main() {
  vec3 p = position;  // world space: the Points object sits at the origin
  float alive = 1.0;
  #ifdef DRIP
  // Same timing as dripImpacts() in game/caveLife.ts: the drop lands when tt reaches uFallS.
  float tt = mod(uTime + aDrip.y, aDrip.x);
  p.y -= 0.5 * uGravity * tt * tt;
  alive = tt < uFallS ? 1.0 : 0.0;
  #else
  p += vec3(sin(uTime * 0.23 + aSeed * 6.283), 0.6 * sin(uTime * 0.17 + aSeed * 12.9), cos(uTime * 0.19 + aSeed * 4.1)) * uDrift;
  #endif
  vLight = revealLight(p, vec3(0.0)).x * alive;
  vec4 mv = viewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_PointSize = vLight > 0.02 ? uSize * clamp(4.0 / max(-mv.z, 0.1), 0.4, 2.5) : 0.0;
}
`;

const pointsFragmentShader = /* glsl */ `
uniform vec3 uColor;
varying float vLight;

void main() {
  float r = length(gl_PointCoord - 0.5) * 2.0;
  if (r > 1.0) discard;
  gl_FragColor = vec4(uColor * min(vLight, 1.5) * (1.0 - r * r), 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * Points that only exist where sonar light reaches them: drifting dust (`aSeed` attribute) or falling
 * drops (`aDrip` = period, offset). Positions are world space. Additive, so they sparkle in a pulse.
 */
export function createRevealPointsMaterial(
  shared: RevealUniforms,
  color: THREE.ColorRepresentation,
  sizePx: number,
  kind: 'dust' | 'drip',
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: kind === 'drip' ? { MAX_PULSES: CONFIG.MAX_PULSES, DRIP: 1 } : { MAX_PULSES: CONFIG.MAX_PULSES },
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(color) },
      uSize: { value: sizePx },
      uDrift: { value: CONFIG.DUST_DRIFT_M },
      uGravity: { value: CONFIG.GRAVITY_MPS2 },
      uFallS: { value: Math.sqrt((2 * CONFIG.DRIP_TOP_M) / CONFIG.GRAVITY_MPS2) },
    },
    vertexShader: pointsVertexShader,
    fragmentShader: pointsFragmentShader,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
}

export interface RevealOptions {
  /** Light level with no pulse/beam (0 = invisible until revealed). */
  ambient?: number;
  /**
   * 'rock': rough stone (procedural grain + bump, soft layers from the mesh's aLayer attribute, crevice
   * darkening from aShade), coloured by facing (needs floorColor/ceilColor). 'solid' (default): the whole surface lit, for markers and props.
   */
  look?: 'rock' | 'solid';
  floorColor?: THREE.ColorRepresentation;
  ceilColor?: THREE.ColorRepresentation;
  /** Draw both faces (flat props such as bat wings). */
  doubleSided?: boolean;
}

/** @param color surface colour when fully lit (walls, for the rock look) */
export function createRevealMaterial(shared: RevealUniforms, color: THREE.ColorRepresentation, opts: RevealOptions = {}): THREE.ShaderMaterial {
  const rock = opts.look === 'rock';
  return new THREE.ShaderMaterial({
    defines: rock ? { MAX_PULSES: CONFIG.MAX_PULSES, ROCK: 1 } : { MAX_PULSES: CONFIG.MAX_PULSES },
    uniforms: {
      ...shared,
      uColor: { value: new THREE.Color(color) },
      uFloorColor: { value: new THREE.Color(opts.floorColor ?? color) },
      uCeilColor: { value: new THREE.Color(opts.ceilColor ?? color) },
      uAmbient: { value: opts.ambient ?? 0 },
    },
    vertexShader,
    fragmentShader,
    side: opts.doubleSided ? THREE.DoubleSide : THREE.FrontSide,
  });
}
