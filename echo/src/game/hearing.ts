import { CONFIG } from '../config';
import { lineOfSight, type Level } from './grid';

export type SoundKind = 'pulse' | 'hum' | 'footstep' | 'pot';

/** Something a monster might hear. */
export interface SoundEvent {
  kind: SoundKind;
  x: number;
  z: number;
  /** 0..1.5, 1.0 = the player's normal clap. */
  loudness: number;
  timeMs: number;
}

/** Sound always carries further than the pulse can reveal: HEAR_MAX_RADIUS > PULSE_MAX_RADIUS. */
export function hearingRadius(loudness: number): number {
  const t = Math.min(Math.max(loudness, 0), 1.5) / 1.5;
  return CONFIG.HEAR_MIN_RADIUS + (CONFIG.HEAR_MAX_RADIUS - CONFIG.HEAR_MIN_RADIUS) * t;
}

/** Straight-line distance, multiplied by WALL_MUFFLE when walls block the line. */
export function effectiveDistance(level: Level, sx: number, sz: number, lx: number, lz: number): number {
  const d = Math.hypot(lx - sx, lz - sz);
  return lineOfSight(level, sx, sz, lx, lz) ? d : d * CONFIG.WALL_MUFFLE;
}

export function canHear(level: Level, ev: SoundEvent, lx: number, lz: number): boolean {
  return effectiveDistance(level, ev.x, ev.z, lx, lz) <= hearingRadius(ev.loudness);
}
