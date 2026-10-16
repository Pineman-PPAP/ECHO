import * as THREE from 'three';
import { CONFIG } from '../config';
import type { PoseChoice, PoseId } from '../game/poses';

/** Pixel measurements of the generated atlas. Bounds and eyes are asset data, not gameplay tuning. */
const ATLAS_SIZE = 1254;
const POSES: Record<Exclude<PoseId, 'lunge'>, { bounds: readonly [number, number, number, number]; eyes: readonly [number, number, number, number] }> = {
  stand: { bounds: [182, 6, 470, 626], eyes: [391, 59, 417, 73] },
  stalk: { bounds: [780, 16, 1081, 622], eyes: [945, 93, 976, 93] },
  crouch: { bounds: [77, 628, 589, 1208], eyes: [337, 805, 373, 805] },
  reach: { bounds: [659, 636, 1218, 1228], eyes: [916, 723, 956, 723] },
};

interface ArtworkGeometry {
  body: THREE.BufferGeometry;
  eyes: THREE.BufferGeometry;
  eyePts: readonly [THREE.Vector3, THREE.Vector3];
}

const geometryCache = new Map<PoseId, ArtworkGeometry>();
const textureCache = new Map<'poses' | 'catch', { texture: THREE.Texture; ready: boolean }>();

/** Two local textures, shared by the entire afterimage pool. No remote URLs or per-figure loads. */
export function artworkTexture(pose: PoseId): { texture: THREE.Texture; ready: boolean } {
  const key = pose === 'lunge' ? 'catch' : 'poses';
  let asset = textureCache.get(key);
  if (!asset) {
    const url = key === 'catch'
      ? new URL('../assets/hollow-catch.png', import.meta.url).href
      : new URL('../assets/hollow-poses.png', import.meta.url).href;
    const state = { texture: new THREE.Texture(), ready: false };
    state.texture = new THREE.TextureLoader().load(url, () => { state.ready = true; }, undefined, () => {
      // If a file cannot load, callers keep the procedural geometry rather than rendering a blank.
      state.ready = false;
    });
    state.texture.colorSpace = THREE.SRGBColorSpace;
    state.texture.minFilter = THREE.LinearMipmapLinearFilter;
    state.texture.magFilter = THREE.LinearFilter;
    textureCache.set(key, state);
    asset = state;
  }
  return asset;
}

export function artworkGeometry(pose: PoseId): ArtworkGeometry {
  const cached = geometryCache.get(pose);
  if (cached) return cached;
  const data = POSES[pose === 'lunge' ? 'reach' : pose];
  const [left, top, right, bottom] = pose === 'lunge' ? [0, 0, ATLAS_SIZE, ATLAS_SIZE] : data.bounds;
  const height = pose === 'lunge' ? CONFIG.HOLLOW_CATCH_SIZE_M
    : pose === 'crouch' ? CONFIG.HOLLOW_CROUCH_HEIGHT_M : CONFIG.HOLLOW_HEIGHT_M;
  const width = height * (right - left) / (bottom - top);
  const body = new THREE.PlaneGeometry(width, height);
  // The pivot stays at the feet, so every pose remains grounded at the creature's actual location.
  body.translate(0, height / 2, 0);
  const uv = body.getAttribute('uv');
  for (let i = 0; i < uv.count; i++) {
    uv.setXY(i, (left + uv.getX(i) * (right - left)) / ATLAS_SIZE,
      1 - (bottom - uv.getY(i) * (bottom - top)) / ATLAS_SIZE);
  }
  const point = (x: number, y: number) => new THREE.Vector3(
    ((x - left) / (right - left) - 0.5) * width,
    (bottom - y) / (bottom - top) * height, CONFIG.HOLLOW_EYE_FORWARD_M,
  );
  const eyePts: [THREE.Vector3, THREE.Vector3] = pose === 'lunge'
    ? [point(576, 365), point(737, 383)]
    : [point(data.eyes[0], data.eyes[1]), point(data.eyes[2], data.eyes[3])];
  // Eye colour is already in the artwork; these small meshes keep the existing figure API intact.
  const eyes = new THREE.BufferGeometry();
  eyes.setDrawRange(0, 0);
  const built = { body, eyes, eyePts };
  geometryCache.set(pose, built);
  return built;
}

/** The live eye pinpoints use exactly the same atlas measurements as the revealed silhouette. */
export function artworkEyeOffsets(pose: PoseChoice): [THREE.Vector3, THREE.Vector3] {
  const [a, b] = artworkGeometry(pose.pose).eyePts;
  const m = pose.mirror ? -1 : 1;
  return [new THREE.Vector3(a.x * m, a.y, a.z), new THREE.Vector3(b.x * m, b.y, b.z)];
}
