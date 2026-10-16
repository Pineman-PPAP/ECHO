import * as THREE from 'three';
import { CONFIG } from '../config';
import { mulberry32 } from '../game/rng';
import { REVEAL_LIGHT_GLSL, type RevealUniforms } from './revealMaterial';

/** Air drifting close to the lens: real depth/parallax, with soft defocus on the nearest flecks.
 * A world-aligned volume follows the camera; wrapping cancels the camera offset, so existing
 * motes stay in world space as you walk/turn. Rocks occlude them; the jar is drawn over them.
 * One GPU-animated draw call, no per-frame arrays, textures, scene lights or gameplay effects.
 */
export class NearDust {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.ShaderMaterial>;

  constructor(scene: THREE.Scene, shared: RevealUniforms) {
    const rand = mulberry32(8093);
    const positions = new Float32Array(CONFIG.LENS_DUST_COUNT * 3);
    const seeds = new Float32Array(CONFIG.LENS_DUST_COUNT);
    for (let i = 0; i < seeds.length; i++) {
      positions[i * 3] = rand() * CONFIG.LENS_DUST_SPAN_M;
      positions[i * 3 + 1] = rand() * CONFIG.LENS_DUST_HEIGHT_M;
      positions[i * 3 + 2] = rand() * CONFIG.LENS_DUST_SPAN_M;
      seeds[i] = rand();
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('aSeed', new THREE.BufferAttribute(seeds, 1));
    const material = new THREE.ShaderMaterial({
      defines: { MAX_PULSES: CONFIG.MAX_PULSES },
      uniforms: {
        ...shared,
        uAnchor: { value: new THREE.Vector3() },
        uSpan: { value: new THREE.Vector3(CONFIG.LENS_DUST_SPAN_M, CONFIG.LENS_DUST_HEIGHT_M, CONFIG.LENS_DUST_SPAN_M) },
        uBreeze: { value: CONFIG.LENS_DUST_BREEZE_MPS },
        uOpacity: { value: CONFIG.LENS_DUST_OPACITY },
        uDiameter: { value: CONFIG.LENS_DUST_DIAMETER_M },
        uDefocus: { value: CONFIG.LENS_DUST_DEFOCUS_PX },
        uPixelScale: { value: 1 },
      },
      vertexShader: /* glsl */ `
        ${REVEAL_LIGHT_GLSL}
        attribute float aSeed;
        uniform vec3 uAnchor;
        uniform vec3 uSpan;
        uniform float uBreeze;
        uniform float uDiameter;
        uniform float uDefocus;
        uniform float uPixelScale;
        varying float vLight;
        varying float vAlpha;
        varying float vSeed;
        varying float vBlur;
        void main() {
          vSeed = aSeed;
          float phase = aSeed * 37.0;
          vec3 drift = vec3(uTime * uBreeze * (0.5 + aSeed),
                            -uTime * uBreeze * (0.12 + aSeed * 0.22),
                            -uTime * uBreeze * 0.3);
          drift += vec3(sin(uTime * 0.37 + phase), cos(uTime * 0.29 + phase),
                        sin(uTime * 0.21 + phase * 2.0)) * 0.12;
          vec3 p = uAnchor + mod(position + drift - uAnchor + uSpan * 0.5, uSpan) - uSpan * 0.5;
          vec4 mv = viewMatrix * vec4(p, 1.0);
          float d = length(mv.xyz);
          // Wrapping happens outside the visible radius, with no popping at the volume edge.
          float fade = (1.0 - smoothstep(uSpan.x * 0.32, uSpan.x * 0.48, d))
            * smoothstep(0.10, 0.26, d);
          vBlur = 1.0 - smoothstep(0.3, 1.6, d);
          vec2 pulse = revealLight(p, vec3(0.0));
          vLight = pulse.x + pulse.y * 0.8 + jarLight(p, vec3(0.0));
          vAlpha = fade * mix(0.6, 1.0, aSeed) * mix(1.0, 0.55, vBlur);
          float diameter = uDiameter * mix(0.45, 1.6, aSeed);
          gl_PointSize = clamp(diameter * uPixelScale / max(-mv.z, 0.1)
            + vBlur * uDefocus * mix(0.5, 1.2, aSeed), 1.5, 42.0);
          gl_Position = projectionMatrix * mv;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform float uOpacity;
        varying float vLight;
        varying float vAlpha;
        varying float vSeed;
        varying float vBlur;
        void main() {
          vec2 p = (gl_PointCoord - 0.5) * 2.0;
          float angle = vSeed * 6.2831853;
          p = mat2(cos(angle), -sin(angle), sin(angle), cos(angle)) * p;
          p.y *= mix(0.75, 1.25, vSeed);
          float r = length(p);
          if (r >= 1.0) discard;
          // Soft, slightly uneven translucent flakes. No spark core or star-shaped glints.
          float shape = exp(-r * r * mix(3.6, 1.6, vBlur))
            * (1.0 - smoothstep(0.55, 1.0, r));
          float lit = 1.0 - exp(-vLight * 3.0);
          vec3 color = mix(vec3(0.7, 0.71, 0.65), vec3(0.92, 0.92, 0.80), vSeed);
          gl_FragColor = vec4(color, shape * vAlpha * lit * uOpacity);
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthTest: true,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    scene.add(this.points);
  }

  update(camera: THREE.PerspectiveCamera, drawingHeight: number): void {
    this.points.material.uniforms.uAnchor.value.copy(camera.position);
    this.points.material.uniforms.uPixelScale.value = drawingHeight * camera.projectionMatrix.elements[5] * 0.5;
  }
}
