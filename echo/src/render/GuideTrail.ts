import * as THREE from 'three';
import { CONFIG } from '../config';
import { worldToCell, type Level } from '../game/grid';
import { guideTrail } from '../game/guide';
import { COLORS } from './buildLevelMesh';
import { createRevealMaterial, type RevealUniforms } from './revealMaterial';

/**
 * Gold chevrons on the floor along the shortest route to the exit. They glow faintly in the dark and
 * flare up when a pulse or the beam reaches them, so every clap answers "which way?".
 * The route is recomputed only when the player enters a new cell.
 */
export class GuideTrail {
  private readonly group = new THREE.Group();
  private readonly geometry: THREE.BufferGeometry;
  private readonly material: THREE.ShaderMaterial;
  private readonly marks: THREE.Mesh[] = [];
  private level: Level | null = null;
  private cellKey = -1;

  constructor(scene: THREE.Scene, uniforms: RevealUniforms) {
    this.geometry = chevronGeometry(CONFIG.GUIDE_TRAIL_SIZE_M);
    this.material = createRevealMaterial(uniforms, COLORS.exit, { ambient: CONFIG.GUIDE_TRAIL_AMBIENT });
    for (let i = 0; i < CONFIG.GUIDE_TRAIL_CELLS; i++) {
      const m = new THREE.Mesh(this.geometry, this.material);
      m.visible = false;
      this.marks.push(m);
      this.group.add(m);
    }
    scene.add(this.group);
  }

  setLevel(level: Level): void {
    this.level = level;
    this.cellKey = -1;
  }

  update(x: number, z: number): void {
    const level = this.level;
    if (!level) return;
    const cell = worldToCell(x, z);
    const key = cell.r * level.cols + cell.c;
    if (key === this.cellKey) return;
    this.cellKey = key;
    const trail = guideTrail(level, x, z, this.marks.length);
    this.marks.forEach((m, i) => {
      const t = trail[i];
      m.visible = t !== undefined;
      if (!t) return;
      m.position.set(t.x, CONFIG.CAVE_MARKER_Y_M, t.z);
      m.rotation.set(0, t.yaw, 0);
    });
  }
}

/** A flat ">" chevron lying on the floor, pointing along -z (yaw 0), centred on the origin. */
function chevronGeometry(size: number): THREE.BufferGeometry {
  const a = size * 0.5; // half width
  const t = size * 0.28; // stroke thickness
  const h = (a + t) / 2; // centre the shape vertically
  const s = new THREE.Shape();
  s.moveTo(0, h);
  s.lineTo(a, h - a);
  s.lineTo(a, h - a - t);
  s.lineTo(0, h - t);
  s.lineTo(-a, h - a - t);
  s.lineTo(-a, h - a);
  s.closePath();
  // Shape +y -> world -z (forward at yaw 0); the face normal ends up pointing up.
  return new THREE.ShapeGeometry(s).rotateX(-Math.PI / 2);
}
