import * as THREE from 'three';
import { CONFIG } from '../config';
import type { PoseChoice } from '../game/poses';
import type { Creature } from '../game/World';
import { COLORS } from './buildLevelMesh';
import { createEchoMaterial, createMonsterModel, setPose, type HollowFigure } from './monsterModel';

interface Slot {
  fig: HollowFigure;
  body: THREE.ShaderMaterial;
  eyes: THREE.MeshBasicMaterial;
  bornS: number;
  strength: number;
  active: boolean;
}

/**
 * Monsters are NEVER drawn live (only a Hollow's eyes are, see EyeGlow). A pulse wavefront or the jar light
 * leaves an "afterimage" where the creature was at that instant, in the pose it was caught in, which
 * then breaks up and fades: red for a Hollow, pale and eyeless for the Hush. If it moves while you
 * blink, the afterimage stays behind.
 */
export class Afterimages {
  private readonly slots: Slot[] = [];
  private seed = 0;

  constructor(scene: THREE.Scene) {
    for (let i = 0; i < CONFIG.MAX_AFTERIMAGES; i++) {
      const body = createEchoMaterial(COLORS.monster, 'afterimage');
      const eyes = new THREE.MeshBasicMaterial({ color: COLORS.monsterEyes, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false });
      const fig = createMonsterModel(body, eyes);
      fig.group.visible = false;
      scene.add(fig.group);
      this.slots.push({ fig, body, eyes, bornS: 0, strength: 0, active: false });
    }
  }

  /** @param facing radians, rotation.y so the figure faces the player at that moment */
  spawn(x: number, z: number, facing: number, strength: number, clockS: number, who: Creature, pose: PoseChoice): void {
    let slot = this.slots.find((s) => !s.active);
    if (!slot) slot = this.slots.reduce((a, b) => (a.bornS <= b.bornS ? a : b));
    slot.body.uniforms.uColor.value.setHex(who === 'hush' ? COLORS.hush : COLORS.monster);
    slot.body.uniforms.uSeed.value = (this.seed = (this.seed + 17.31) % 997);
    slot.eyes.color.setHex(who === 'hush' ? 0x000000 : COLORS.monsterEyes); // additive black = no eyes
    setPose(slot.fig, pose, who);
    slot.fig.group.position.set(x, 0, z);
    slot.fig.group.rotation.y = facing;
    slot.bornS = clockS;
    slot.strength = strength;
    slot.active = true;
    slot.fig.group.visible = true;
  }

  update(clockS: number): void {
    for (const s of this.slots) {
      if (!s.active) continue;
      const age = clockS - s.bornS;
      if (age > CONFIG.AFTERIMAGE_FADE_S) {
        s.active = false;
        s.fig.group.visible = false;
        continue;
      }
      const k = Math.min(s.strength, 1) * Math.exp((-3 * age) / CONFIG.AFTERIMAGE_FADE_S);
      s.body.uniforms.uOpacity.value = k;
      s.eyes.opacity = k;
    }
  }

  clear(): void {
    for (const s of this.slots) {
      s.active = false;
      s.fig.group.visible = false;
    }
  }
}
