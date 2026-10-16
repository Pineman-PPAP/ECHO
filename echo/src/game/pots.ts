import { CONFIG } from '../config';
import { cellCenter, type LevelDef } from './grid';

/**
 * Clay pots left on the cave floor (placed per level in levels.ts). Walk into one and it shatters:
 * a loud crash every Hollow in earshot hears, and a brief flash of sonar light from where it broke.
 * Pots stand to one side of the corridor, so a player who lights the way can steer around them.
 * Pure logic (no three.js, no audio); render/Pots.ts draws them, Sfx plays the crash.
 */
export interface PotDef {
  c: number;
  r: number;
  /** Offset from the cell centre in metres (puts it against one wall, out of the walking line). */
  dx: number;
  dz: number;
}

export interface Pot {
  id: number;
  x: number;
  z: number;
  broken: boolean;
}

export interface PotKick {
  id: number;
  x: number;
  z: number;
  /** Same scale as a clap (1.0 = the player's normal clap). */
  loudness: number;
}

/** World positions of a level's pots, in definition order (id = index). Shared by World and the renderer. */
export function potSpots(def: LevelDef): Pot[] {
  return (def.pots ?? []).map((p, id) => {
    const centre = cellCenter(p);
    return { id, x: centre.x + p.dx, z: centre.z + p.dz, broken: false };
  });
}

/** How loud a kicked pot is: never quiet (it's a clay pot on rock), louder the faster you walk into it. */
export function potLoudness(speedMps: number): number {
  const t = Math.min(Math.max(speedMps / CONFIG.MAX_SPEED_FWD, 0), 1);
  return CONFIG.POT_LOUDNESS_SOFT + (CONFIG.POT_LOUDNESS_HARD - CONFIG.POT_LOUDNESS_SOFT) * t;
}

export class Pots {
  readonly list: Pot[];

  constructor(def: LevelDef) {
    this.list = potSpots(def);
  }

  /**
   * @param speedMps the player's actual speed this frame (standing still next to a pot never breaks it)
   * @returns pots broken this frame
   */
  update(px: number, pz: number, speedMps: number): PotKick[] {
    const out: PotKick[] = [];
    if (speedMps < CONFIG.POT_KICK_MIN_SPEED) return out;
    for (const p of this.list) {
      if (p.broken || Math.hypot(p.x - px, p.z - pz) >= CONFIG.POT_KICK_RADIUS_M) continue;
      p.broken = true;
      out.push({ id: p.id, x: p.x, z: p.z, loudness: potLoudness(speedMps) });
    }
    return out;
  }
}
