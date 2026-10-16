import { CONFIG } from '../config';
import { cellCenter, facingToYaw, moveWithCollision, yawForward, type Level } from './grid';

/** The player: a circle on the XZ plane with a yaw. Pure logic (no three.js). */
export class Player {
  x: number;
  z: number;
  /** three.js camera yaw (rotation.y) in radians. Forward = (-sin yaw, -cos yaw). */
  yaw: number;
  /** Actual speed achieved last update (m/s), after collisions. */
  speed = 0;
  /** Advances with distance walked; drives head bob. */
  bobPhase = 0;
  /** Total metres walked (for the tutorial and stats). */
  distanceWalked = 0;
  private stepAccum = 0;

  constructor(level: Level) {
    const p = cellCenter(level.start);
    this.x = p.x;
    this.z = p.z;
    this.yaw = facingToYaw(level.def.startFacing);
  }

  /**
   * @param turnRate rad/s (+ = left)   @param moveSpeed m/s (+ = forward)
   * @returns footstep loudness (0..FOOTSTEP_NOISE_MAX) when a stride completes this frame, else null
   */
  update(dtS: number, turnRate: number, moveSpeed: number, level: Level): number | null {
    this.yaw += turnRate * dtS;
    const f = yawForward(this.yaw);
    const moved = moveWithCollision(level, this.x, this.z, f.x * moveSpeed * dtS, f.z * moveSpeed * dtS, CONFIG.PLAYER_RADIUS);
    const dist = Math.hypot(moved.x - this.x, moved.z - this.z);
    this.x = moved.x;
    this.z = moved.z;
    this.speed = dtS > 0 ? dist / dtS : 0;
    this.distanceWalked += dist;
    this.bobPhase += (dist / CONFIG.FOOTSTEP_STRIDE_M) * Math.PI;
    this.stepAccum += dist;
    if (this.stepAccum >= CONFIG.FOOTSTEP_STRIDE_M) {
      this.stepAccum -= CONFIG.FOOTSTEP_STRIDE_M;
      const r = Math.min(Math.abs(moveSpeed) / CONFIG.MAX_SPEED_FWD, 1);
      return CONFIG.FOOTSTEP_NOISE_MAX * r * r;
    }
    return null;
  }
}
