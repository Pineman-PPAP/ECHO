import { CONFIG } from '../config';
import { pulseRadius } from '../input/mapping';
import type { RevealUniforms } from '../render/revealMaterial';

export interface Pulse {
  id: number;
  x: number;
  y: number;
  z: number;
  /** Game-clock seconds when emitted. */
  startS: number;
  maxRadius: number;
  /** 0..1 brightness. */
  strength: number;
  loudness: number;
  /** Monster ids this pulse already revealed (each pulse reveals a monster once). */
  revealed: Set<number>;
}

/** Active sonar pulses. Logic only; writeUniforms() copies them into the shader uniforms. */
export class PulseManager {
  readonly pulses: Pulse[] = [];
  private nextId = 1;

  add(x: number, y: number, z: number, startS: number, loudness: number): Pulse {
    const p: Pulse = {
      id: this.nextId++,
      x,
      y,
      z,
      startS,
      maxRadius: pulseRadius(loudness),
      strength: 0.55 + 0.45 * Math.min(loudness, 1),
      loudness,
      revealed: new Set(),
    };
    this.pulses.push(p);
    if (this.pulses.length > CONFIG.MAX_PULSES) this.pulses.shift();
    return p;
  }

  /** Radius the wavefront has reached (clamped to maxRadius). */
  static frontRadius(p: Pulse, nowS: number): number {
    return Math.min(Math.max(nowS - p.startS, 0) * CONFIG.PULSE_SPEED, p.maxRadius);
  }

  prune(nowS: number): void {
    for (let i = this.pulses.length - 1; i >= 0; i--) {
      const p = this.pulses[i];
      if (nowS - p.startS > p.maxRadius / CONFIG.PULSE_SPEED + CONFIG.PULSE_FADE_S) this.pulses.splice(i, 1);
    }
  }

  clear(): void {
    this.pulses.length = 0;
  }

  writeUniforms(u: RevealUniforms): void {
    for (let i = 0; i < CONFIG.MAX_PULSES; i++) {
      const p = this.pulses[i];
      if (p) {
        u.uPulseA.value[i].set(p.x, p.y, p.z, p.startS);
        u.uPulseB.value[i].set(p.maxRadius, p.strength, 0, 0);
      } else {
        u.uPulseB.value[i].set(0, 0, 0, 0);
      }
    }
  }
}
