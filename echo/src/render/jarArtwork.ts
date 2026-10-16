import * as THREE from 'three';
import { CONFIG } from '../config';

/** Registration measured on the original 1254px cutout: jar axis x=648, body centre y=610.
 * Keep the original alpha. The surrounding hand and sleeve are part of the same viewmodel,
 * while fireflies remain live particles. No texture readback, canvas processing or remote assets.
 */
export class JarArtwork {
  readonly mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.ShaderMaterial>;
  ready = false;

  constructor() {
    const texture = new THREE.TextureLoader().load(
      new URL('../assets/firefly-jar-hand.png', import.meta.url).href,
      () => { this.ready = true; },
      undefined,
      () => { this.ready = false; },
    );
    texture.colorSpace = THREE.SRGBColorSpace;
    const material = new THREE.ShaderMaterial({
      uniforms: {
        uMap: { value: texture },
        uGlow: { value: 0 },
        uExposureDark: { value: CONFIG.JAR_ART_DARK_EXPOSURE },
        uExposureLit: { value: CONFIG.JAR_ART_LIT_EXPOSURE },
      },
      transparent: true,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D uMap;
        uniform float uGlow;
        uniform float uExposureDark;
        uniform float uExposureLit;
        varying vec2 vUv;
        void main() {
          vec4 art = texture2D(uMap, vUv);
          if (art.a < 0.005) discard;
          // Preserve the texture's natural skin and metal instead of washing them green.
          float exposure = mix(uExposureDark, uExposureLit, clamp(uGlow, 0.0, 1.0));
          float nearGlass = exp(-dot((vUv - vec2(0.52, 0.51)) * vec2(3.0, 2.2),
                                    (vUv - vec2(0.52, 0.51)) * vec2(3.0, 2.2)));
          vec3 tint = mix(vec3(1.0), vec3(1.04, 1.06, 0.86), nearGlass * uGlow * 0.45);
          gl_FragColor = vec4(art.rgb * exposure * tint, art.a);
          #include <colorspace_fragment>
        }
      `,
    });
    const width = CONFIG.JAR_ART_WIDTH_M;
    this.mesh = new THREE.Mesh(new THREE.PlaneGeometry(width, width), material);
    this.mesh.position.set((627 - 648) / 1254 * width, (610 - 627) / 1254 * width, 0.065);
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
  }

  update(glow: number): void {
    this.mesh.visible = this.ready;
    this.mesh.material.uniforms.uGlow.value = glow;
  }

  /** Project the existing 3D flight paths into the photographed glass interior. Keeping emission
   * on the glass plane prevents perspective from putting flies on the fingers or outside the jar.
   * Only the render buffer changes: flight positions, blinking and world-light strength do not.
   */
  projectFireflies(positions: Float32Array): void {
    const scale = CONFIG.JAR_ART_WIDTH_M / 1254;
    const radius = CONFIG.JAR_RADIUS_M * 0.78;
    const lo = -CONFIG.JAR_HEIGHT_M / 2 + 0.01;
    const hi = CONFIG.JAR_HEIGHT_M / 2 - 0.03;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i] / radius;
      const depth = positions[i + 2] / radius;
      const height = THREE.MathUtils.clamp((positions[i + 1] - lo) / (hi - lo), 0, 1);
      // Inset inside the glass highlights, away from the thumb and curled fingertips.
      positions[i] = (x * 125 + depth * 8) * scale;
      positions[i + 1] = (610 - THREE.MathUtils.lerp(770, 400, height)) * scale;
      positions[i + 2] = 0.066;
    }
  }
}
