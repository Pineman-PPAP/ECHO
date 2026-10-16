import { CONFIG } from '../config';
import type { MonsterState } from './Monster';

/**
 * How a Hollow is caught standing when you see it. You only ever see it in flashes (a pulse or the
 * beam), so every glimpse is a still pose; a new spot (or a closer distance) means a new pose. That is
 * what sells "it moved".
 */
export type PoseId = 'stand' | 'stalk' | 'crouch' | 'reach' | 'lunge';
// 'lunge' (arms flung wide, jaw open) is only for the jumpscare, where the claws frame your view.

export interface PoseChoice {
  pose: PoseId;
  /** Left-right flip, so the same pose doesn't look identical twice in a row. */
  mirror: boolean;
}

/** Deterministic 0..1 from integers (a Hollow standing on the same spot always gets the same pose). */
function variant(id: number, a: number, b: number): number {
  let h = Math.imul(id + 0x9e37, 0x85ebca6b) ^ Math.imul(a, 0xc2b2ae35) ^ Math.imul(b, 0x27d4eb2f);
  h ^= h >>> 15;
  h = Math.imul(h, 0x2c1b3c6d);
  h ^= h >>> 12;
  return (h >>> 0) / 4294967296;
}

/**
 * The pose a Hollow is seen in.
 *   close (<= POSE_REACH_M): reaching for you
 *   hunting (alert): stalking or crouched
 *   searching: crouched or standing, head tilted
 *   idle / scripted walk: standing
 * The choice is fixed per POSE_CELL_M square, so the beam's repeated reveals don't flicker between poses.
 */
export function choosePose(state: MonsterState, distanceM: number, id: number, x: number, z: number): PoseChoice {
  const v = variant(id, Math.floor(x / CONFIG.POSE_CELL_M), Math.floor(z / CONFIG.POSE_CELL_M));
  const mirror = v < 0.5;
  const alt = (v * 4) % 1 < 0.5;
  if (distanceM <= CONFIG.POSE_REACH_M) return { pose: 'reach', mirror };
  if (state === 'alert') return { pose: alt ? 'stalk' : 'crouch', mirror };
  if (state === 'search') return { pose: alt ? 'crouch' : 'stand', mirror };
  return { pose: 'stand', mirror };
}
