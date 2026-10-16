import * as THREE from 'three';
import { CONFIG } from '../config';
import { COLORS } from './buildLevelMesh';
import { createMonsterModel } from './monsterModel';

interface Slot {
  group: THREE.Group;
  body: THREE.MeshBasicMaterial;
  eyes: THREE.MeshBasicMaterial;
  bornS: number;
  strength: number;
  active: boolean;
}

/**
 * Monsters are NEVER drawn live. A pulse wavefront or the beam leaves a red "afterimage" where the
 * monster was at that instant, which then fades. If it moves while you blink, the afterimage stays
 * behind: you only learn where it went from the next echo.
 */
export class Afterimages {
  private readonly slots: Slot[] = [];

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < CONFIG.MAX_AFTERIMAGES; i++) {
      const common = { transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false };
      const body = new THREE.MeshBasicMaterial({ color: COLORS.monster, ...common });
      const eyes = new THREE.MeshBasicMaterial({ color: 0xffffff, ...common });
      const group = createMonsterModel(body, eyes);
      group.visible = false;
      scene.add(group);
      this.slots.push({ group, body, eyes, bornS: 0, strength: 0, active: false });
    }
  }

  /** @param facing radians, rotation.y so the figure faces the player at that moment */
  spawn(x: number, z: number, facing: number, strength: number, clockS: number): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots.reduce((a, b) => (a.bornS <= b.bornS ? a : b));
    slot.group.position.set(x, 0, z);
    slot.group.rotation.y = facing;
    slot.bornS = clockS;
    slot.strength = strength;
    slot.active = true;
    slot.group.visible = true;
  }

  update(clockS: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      const age = clockS - s.bornS;
      if (age > CONFIG.AFTERIMAGE_FADE_S) {
        s.active = false;
        s.group.visible = false;
        continue;
      }
      const k = s.strength * Math.exp((-3 * age) / CONFIG.AFTERIMAGE_FADE_S);
      s.body.opacity = k;
      s.eyes.opacity = k;
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.active = false;
      s.group.visible = false;
    }
  }
}
