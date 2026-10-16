import { CONFIG } from '../config';
import { lineOfSight, yawForward, type Level } from './grid';

const DEG2RAD = Math.PI / 180;

/** True if world point (x, z) lies inside the player's view cone (about the width of the screen). */
export function inView(px: number, pz: number, yaw: number, x: number, z: number): boolean {
  const dx = x - px;
  const dz = z - pz;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return true;
  const f = yawForward(yaw);
  return (dx * f.x + dz * f.z) / d >= Math.cos(CONFIG.VIEW_HALF_ANGLE_DEG * DEG2RAD);
}

/** Which side of the player (x, z) is on: +1 = right, -1 = left. */
export function sideOf(px: number, pz: number, yaw: number, x: number, z: number): 1 | -1 {
  // Right vector for forward (-sin yaw, -cos yaw) is (cos yaw, -sin yaw).
  return (x - px) * Math.cos(yaw) - (z - pz) * Math.sin(yaw) >= 0 ? 1 : -1;
}

/**
 * How brightly a Hollow's red eyes glow for the player: 0 = not visible, up to 1.
 * The eyes show without any pulse whenever the Hollow FACES the player (heading within
 * EYES_FACING_HALF_ANGLE_DEG) and nothing blocks the line between them. A Hollow that turns away
 * vanishes. Closer = brighter.
 * @param heading the Hollow's facing, atan2(dx, dz) of its last movement
 */
export function eyeGlow(level: Level, px: number, pz: number, mx: number, mz: number, heading: number): number {
  const dx = px - mx;
  const dz = pz - mz;
  const d = Math.hypot(dx, dz);
  if (d > CONFIG.EYES_MAX_DISTANCE_M) return 0;
  if (d > 1e-6) {
    const facing = (Math.sin(heading) * dx + Math.cos(heading) * dz) / d;
    if (facing < Math.cos(CONFIG.EYES_FACING_HALF_ANGLE_DEG * DEG2RAD)) return 0;
  }
  if (!lineOfSight(level, mx, mz, px, pz)) return 0;
  const span = CONFIG.EYES_MAX_DISTANCE_M - CONFIG.EYES_FULL_DISTANCE_M;
  const t = Math.min(Math.max((d - CONFIG.EYES_FULL_DISTANCE_M) / span, 0), 1);
  return 1 + (CONFIG.EYES_FAR_GLOW - 1) * t;
}

/**
 * How fast a hunting Hollow runs at the sound it heard. It is a "rubber band" on your distance: far
 * away it sprints (HUNT_SPEED_FAR, faster than you can walk) so you hear it coming; close up it
 * slows (HUNT_SPEED_NEAR, slower than you), so a player who keeps moving stays just ahead of it,
 * about where the two speeds cross, and one who stops where it heard them gets caught.
 */
export function chaseSpeed(distanceM: number): number {
  const t = (distanceM - CONFIG.HUNT_NEAR_M) / (CONFIG.HUNT_FAR_M - CONFIG.HUNT_NEAR_M);
  return CONFIG.HUNT_SPEED_NEAR + (CONFIG.HUNT_SPEED_FAR - CONFIG.HUNT_SPEED_NEAR) * Math.min(Math.max(t, 0), 1);
}

/**
 * Hollow speed (m/s, before its state factor) for this frame. Hollows are blind: nothing the player
 * does with their eyes matters. A hunting Hollow runs (chaseSpeed); any other one creeps (faster in
 * a level's finale).
 * @param huntDistanceM distance to the player if the Hollow is hunting (alert), else null
 */
export function hollowSpeed(finale: boolean, huntDistanceM: number | null = null): number {
  if (huntDistanceM !== null) return chaseSpeed(huntDistanceM);
  return CONFIG.MONSTER_SPEED_UNSEEN * (finale ? CONFIG.FINALE_SPEED_FACTOR : 1);
}
