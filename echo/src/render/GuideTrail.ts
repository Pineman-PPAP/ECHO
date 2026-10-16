import * as THREE from 'three';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { cellCenter, type Level } from '../game/grid';
import { wallGuideMarks } from '../game/guide';
import { REVEAL_LIGHT_GLSL, type RevealUniforms } from './revealMaterial';

/** Permanent scratched paint, clipped onto actual rock triangles. One merged draw call. */
export class GuideTrail {
  private readonly group = new THREE.Group();
  private readonly material: THREE.ShaderMaterial;

  constructor(scene: THREE.Scene, uniforms: RevealUniforms) {
    scene.add(this.group);
    this.material = new THREE.ShaderMaterial({
      defines: { MAX_PULSES: CONFIG.MAX_PULSES },
      uniforms: {
        ...uniforms,
        uPaint: { value: new THREE.Color(CONFIG.GUIDE_WALL_COLOR) },
        uPulsePaint: { value: new THREE.Color(CONFIG.GUIDE_WALL_PULSE_COLOR) },
        uPaintAmbient: { value: CONFIG.GUIDE_WALL_AMBIENT },
        uJarNear: { value: CONFIG.GUIDE_WALL_JAR_NEAR_M },
        uPulseBoost: { value: CONFIG.GUIDE_WALL_PULSE_BOOST },
      },
      vertexShader: /* glsl */ `
        attribute float aSeed;
        attribute float aDirection;
        varying vec2 vUv;
        varying vec3 vP;
        varying vec3 vN;
        varying float vSeed;
        void main() {
          vUv = vec2((uv.x - 0.5) * aDirection + 0.5, uv.y);
          vSeed = aSeed;
          vP = (modelMatrix * vec4(position, 1.0)).xyz;
          vN = mat3(modelMatrix) * normal;
          gl_Position = projectionMatrix * viewMatrix * vec4(vP, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        ${REVEAL_LIGHT_GLSL}
        uniform vec3 uPaint;
        uniform vec3 uPulsePaint;
        uniform float uPaintAmbient;
        uniform float uJarNear;
        uniform float uPulseBoost;
        varying vec2 vUv;
        varying vec3 vP;
        varying vec3 vN;
        varying float vSeed;
        float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
        float noise(vec2 p) {
          vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
          return mix(mix(hash(i), hash(i + vec2(1,0)), f.x),
                     mix(hash(i + vec2(0,1)), hash(i + vec2(1,1)), f.x), f.y);
        }
        float stroke(vec2 p, vec2 a, vec2 b, float width) {
          vec2 ab = b - a;
          float t = clamp(dot(p - a, ab) / dot(ab, ab), 0.0, 1.0);
          float wobble = (noise(p * 25.0 + vSeed * 71.0) - 0.5) * width * 0.7;
          float d = length(p - a - t * ab);
          float aa = max(fwidth(d), 0.002);
          return 1.0 - smoothstep(width + wobble - aa, width + wobble + aa, d);
        }
        void main() {
          vec2 p = (vUv - 0.5) * 2.0;
          p.y += sin(p.x * 3.0 + vSeed * 17.0) * 0.025;
          float paint = max(stroke(p, vec2(-0.77,-0.035), vec2(0.60,0.02), 0.065),
            max(stroke(p, vec2(0.18,0.43), vec2(0.66,0.015), 0.07),
                stroke(p, vec2(0.66,0.015), vec2(0.14,-0.39), 0.062)));
          // Worn brush strokes expose the rock through chips and thin scratches.
          float wear = noise(p * 65.0 + vSeed * 103.0);
          float scratches = smoothstep(0.025, 0.11, abs(sin(p.y * 135.0 + p.x * 17.0 + vSeed * 31.0)));
          paint *= smoothstep(0.18, 0.48, wear) * mix(0.28, 1.0, scratches);
          if (paint < 0.015) discard;
          vec3 n = normalize(vN);
          float d = distance(cameraPosition, vP);
          float pulse = clamp(revealLight(vP, n).x * uPulseBoost, 0.0, 1.0);
          // Nearby hum shows matte paint. Only sonar adds the stronger red contrast.
          float nearJar = (1.0 - smoothstep(uJarNear * 0.55, uJarNear, d))
            * clamp(jarLight(vP, n) * 6.0, 0.0, 1.0);
          float ambient = uPaintAmbient * (1.0 - smoothstep(4.0, 10.0, d));
          vec3 base = uPaint * max(ambient, nearJar * 0.7);
          vec3 col = mix(base, uPulsePaint, pulse) * mix(0.55, 1.0, wear);
          gl_FragColor = vec4(col, paint * mix(0.72, 0.94, pulse));
          #include <colorspace_fragment>
        }
      `,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
      polygonOffsetUnits: -2,
    });
  }

  setLevel(level: Level, rock: THREE.Group): void {
    for (const child of [...this.group.children]) {
      this.group.remove(child);
      if (child instanceof THREE.Mesh) child.geometry.dispose();
    }
    rock.updateMatrixWorld(true);
    const surfaces = rock.children.filter((o): o is THREE.Mesh => o instanceof THREE.Mesh && o.geometry.hasAttribute('aShade'));
    const ray = new THREE.Raycaster();
    ray.far = CONFIG.CELL_SIZE;
    const decals: THREE.BufferGeometry[] = [];
    const up = new THREE.Vector3(0, 1, 0);
    const size = CONFIG.GUIDE_WALL_SIZE_M;
    for (const mark of wallGuideMarks(level)) {
      const p = cellCenter(mark.cell);
      ray.set(new THREE.Vector3(p.x, CONFIG.GUIDE_WALL_HEIGHT_M + (mark.seed - 0.5) * 0.25, p.z), new THREE.Vector3(mark.wx, 0, mark.wz));
      const hit = ray.intersectObjects(surfaces, false)[0];
      if (!hit) continue;
      const n = new THREE.Vector3(-mark.wx, 0, -mark.wz);
      const right = new THREE.Vector3().crossVectors(up, n);
      const orientation = new THREE.Euler().setFromRotationMatrix(new THREE.Matrix4().makeBasis(right, up, n));
      const patch = nearbyTriangles(hit.object as THREE.Mesh, hit.point, size);
      const geo = new DecalGeometry(patch, hit.point, orientation, new THREE.Vector3(size, size * 0.78, size));
      patch.geometry.dispose();
      const count = geo.getAttribute('position').count;
      if (count === 0) { geo.dispose(); continue; }
      geo.setAttribute('aSeed', new THREE.BufferAttribute(new Float32Array(count).fill(mark.seed), 1));
      geo.setAttribute('aDirection', new THREE.BufferAttribute(new Float32Array(count).fill(mark.direction), 1));
      decals.push(geo);
    }
    if (decals.length) {
      const geometry = mergeGeometries(decals, false);
      for (const decal of decals) decal.dispose();
      if (geometry) this.group.add(new THREE.Mesh(geometry, this.material));
    }
  }
}

/** Limit decal clipping to nearby rock triangles instead of processing a whole cave chunk. */
function nearbyTriangles(mesh: THREE.Mesh, center: THREE.Vector3, radius: number): THREE.Mesh {
  const source = mesh.geometry;
  const p = source.getAttribute('position'), n = source.getAttribute('normal');
  const index = source.getIndex()!;
  const positions: number[] = [], normals: number[] = [];
  const v = new THREE.Vector3();
  for (let i = 0; i < index.count; i += 3) {
    const ids = [index.getX(i), index.getX(i + 1), index.getX(i + 2)];
    if (!ids.some(id => v.fromBufferAttribute(p, id).distanceToSquared(center) < radius * radius)) continue;
    for (const id of ids) {
      positions.push(p.getX(id), p.getY(id), p.getZ(id));
      normals.push(n.getX(id), n.getY(id), n.getZ(id));
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normals, 3));
  return new THREE.Mesh(geometry);
}
