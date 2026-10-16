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
  uLineDensity: THREE.IUniform<number>;
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
    uLineDensity: { value: CONFIG.LINE_DENSITY },
  };
}

const vertexShader = /* glsl */ `
varying vec3 vWorldPos;
varying vec3 vWorldNormal;

void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorldPos = wp.xyz;
  vWorldNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`;

const fragmentShader = /* glsl */ `
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
uniform float uLineDensity;
uniform vec3 uColor;
uniform float uAmbient;

varying vec3 vWorldPos;
varying vec3 vWorldNormal;

float hash13(vec3 p) {
  p = fract(p * 0.1031);
  p += dot(p, p.zyx + 31.32);
  return fract((p.x + p.y) * p.z);
}

void main() {
  float light = uAmbient;
  float ring = 0.0;

  // Sonar pulses: an expanding sphere. Surfaces light up when the wavefront passes them, then fade.
  for (int i = 0; i < MAX_PULSES; i++) {
    vec4 a = uPulseA[i];
    vec4 b = uPulseB[i];
    if (b.y <= 0.0) continue;
    float age = uTime - a.w;
    if (age < 0.0) continue;
    float d = distance(vWorldPos, a.xyz);
    float front = age * uPulseSpeed;
    if (d > b.x || d > front) continue;
    float since = age - d / uPulseSpeed;          // seconds since the wavefront passed this point
    float fade = exp(-3.0 * since / uPulseFade);  // ~5% left after uPulseFade seconds
    float rim = 1.0 - smoothstep(0.75 * b.x, b.x, d);
    light += b.y * fade * rim;
    ring += b.y * (1.0 - smoothstep(0.0, 0.8, front - d)) * rim;  // bright band at the wavefront
  }

  // Hum beam: a cone from the player's head along the view direction.
  if (uBeamOn > 0.5) {
    vec3 v = vWorldPos - uBeamOrigin;
    float d = length(v);
    if (d < uBeamRange && d > 0.001) {
      float c = dot(v / d, uBeamDir);
      float cone = smoothstep(uBeamCos, mix(uBeamCos, 1.0, 0.3), c);
      float fall = 1.0 - smoothstep(0.6 * uBeamRange, uBeamRange, d);
      light += uBeamStrength * cone * fall;
    }
  }

  // Sonar grid lines in world space. The axis along the surface normal is pushed out of the min().
  vec3 coord = vWorldPos * uLineDensity;
  vec3 g = abs(fract(coord - 0.5) - 0.5) / max(fwidth(coord), vec3(1e-4));
  g += abs(vWorldNormal) * 1e4;
  float lineMask = 1.0 - clamp(min(min(g.x, g.y), g.z), 0.0, 1.0);
  // Sparse sonar "return" dots: one candidate dot per 1/6 m cell, ~4% of cells lit.
  vec3 dotCoord = coord * 4.0;
  vec3 dotOffset = (fract(dotCoord) - 0.5) * (1.0 - abs(vWorldNormal));
  float dotMask = step(0.96, hash13(floor(dotCoord))) * (1.0 - smoothstep(0.08, 0.16, length(dotOffset)));
  float surface = 0.1 + 0.9 * max(lineMask, dotMask);

  vec3 col = uColor * light * surface + vec3(0.85, 0.95, 1.0) * clamp(ring, 0.0, 1.0) * surface;
  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

/**
 * @param color surface colour when fully lit
 * @param ambient light level with no pulse/beam (0 = invisible until revealed)
 */
export function createRevealMaterial(shared: RevealUniforms, color: THREE.ColorRepresentation, ambient = 0): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    defines: { MAX_PULSES: CONFIG.MAX_PULSES },
    uniforms: { ...shared, uColor: { value: new THREE.Color(color) }, uAmbient: { value: ambient } },
    vertexShader,
    fragmentShader,
  });
}
