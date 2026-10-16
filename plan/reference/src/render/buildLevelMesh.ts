import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { CONFIG } from '../config';
import { cellCenter, isWall, type Level } from '../game/grid';
import { createRevealMaterial, type RevealUniforms } from './revealMaterial';

export const COLORS = {
  wall: 0x4fd8ff,
  floor: 0x2a8cff,
  ceiling: 0x1b4f8a,
  exit: 0xffc94a,
  monster: 0xff2a2a,
} as const;

/**
 * Builds the static level: one merged wall mesh (one draw call), floor, ceiling and exit portal.
 * Only wall cells that touch a floor cell get geometry; fully enclosed walls are never visible.
 */
export function buildLevelMeshes(level: Level, uniforms: RevealUniforms): THREE.Group {
  const cs = CONFIG.CELL_SIZE;
  const h = CONFIG.WALL_HEIGHT;
  const group = new THREE.Group();

  const boxes: THREE.BufferGeometry[] = [];
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      if (!isWall(level, c, r)) continue;
      const touchesFloor =
        !isWall(level, c + 1, r) || !isWall(level, c - 1, r) || !isWall(level, c, r + 1) || !isWall(level, c, r - 1);
      if (!touchesFloor) continue;
      boxes.push(new THREE.BoxGeometry(cs, h, cs).translate((c + 0.5) * cs, h / 2, (r + 0.5) * cs));
    }
  }
  const wallGeo = mergeGeometries(boxes, false);
  if (!wallGeo) throw new Error('buildLevelMeshes: failed to merge wall geometry');
  group.add(new THREE.Mesh(wallGeo, createRevealMaterial(uniforms, COLORS.wall)));

  const w = level.cols * cs;
  const d = level.rows * cs;
  const floor = new THREE.PlaneGeometry(w, d).rotateX(-Math.PI / 2).translate(w / 2, 0, d / 2);
  group.add(new THREE.Mesh(floor, createRevealMaterial(uniforms, COLORS.floor)));
  const ceiling = new THREE.PlaneGeometry(w, d).rotateX(Math.PI / 2).translate(w / 2, h, d / 2);
  group.add(new THREE.Mesh(ceiling, createRevealMaterial(uniforms, COLORS.ceiling)));

  const e = cellCenter(level.exit);
  const exitMat = createRevealMaterial(uniforms, COLORS.exit, 0.03);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.07, 12, 48), exitMat);
  ring.position.set(e.x, 1.3, e.z);
  group.add(ring);
  const pad = new THREE.Mesh(new THREE.CircleGeometry(1.2, 32).rotateX(-Math.PI / 2), exitMat);
  pad.position.set(e.x, 0.01, e.z);
  group.add(pad);

  for (const b of boxes) b.dispose();
  return group;
}
