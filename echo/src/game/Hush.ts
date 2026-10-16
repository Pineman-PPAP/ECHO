import { CONFIG } from '../config';
import { yawForward } from './grid';

export type HushEvent = 'appear' | 'gone' | 'caught';

const DEG2RAD = Math.PI / 180;

/**
 * The Hush: a second creature that hunts SILENCE, the opposite of the Hollows. It appears behind the
 * player after HUSH_SILENCE_MS without a sound and drifts toward them straight through the rock. Every
 * sound the player makes pushes it back (a clap a long way, a footstep a little) and the Hollows hear
 * those sounds too, so hiding silently is never safe.
 * Pure logic (no three.js, no audio).
 */
export class Hush {
  present = false;
  x = 0;
  z = 0;
  /** Time since the player's last sound (accumulated from dt so a pause doesn't count). */
  silenceMs = 0;

  /**
   * @param loudness loudest sound the player made this frame (0 = none)
   * @param rand seeded RNG (spawn direction)
   */
  update(dtS: number, px: number, pz: number, yaw: number, loudness: number, rand: () => number): HushEvent[] {
    const out: HushEvent[] = [];
    if (loudness > 0) {
      this.silenceMs = 0;
      if (this.present) {
        this.pushBack(px, pz, yaw, CONFIG.HUSH_PUSH_M * loudness);
        if (this.distanceTo(px, pz) >= CONFIG.HUSH_GONE_DISTANCE_M) {
          this.present = false;
          out.push('gone');
        }
      }
    } else {
      this.silenceMs += dtS * 1000;
    }

    if (!this.present && this.silenceMs >= CONFIG.HUSH_SILENCE_MS) {
      // Behind the player, a little to one side: it arrives from where you aren't looking.
      const a = yaw + Math.PI + (rand() * 2 - 1) * CONFIG.HUSH_SPAWN_SPREAD_DEG * DEG2RAD;
      const f = yawForward(a);
      this.x = px + f.x * CONFIG.HUSH_SPAWN_DISTANCE_M;
      this.z = pz + f.z * CONFIG.HUSH_SPAWN_DISTANCE_M;
      this.present = true;
      out.push('appear');
    }

    if (this.present && this.silenceMs >= CONFIG.HUSH_RESUME_MS) {
      const d = this.distanceTo(px, pz);
      const step = Math.min(CONFIG.HUSH_SPEED * dtS, d);
      if (d > 1e-6) {
        this.x += ((px - this.x) / d) * step;
        this.z += ((pz - this.z) / d) * step;
      }
    }

    if (this.present && this.distanceTo(px, pz) < CONFIG.HUSH_CATCH_M) out.push('caught');
    return out;
  }

  distanceTo(px: number, pz: number): number {
    return Math.hypot(this.x - px, this.z - pz);
  }

  /** 0 when absent or at its spawn distance, 1 when it reaches the player. Drives the frost, the whisper and the drone cut. */
  closeness(px: number, pz: number): number {
    if (!this.present) return 0;
    const span = CONFIG.HUSH_SPAWN_DISTANCE_M - CONFIG.HUSH_CATCH_M;
    return Math.min(Math.max((CONFIG.HUSH_SPAWN_DISTANCE_M - this.distanceTo(px, pz)) / span, 0), 1);
  }

  private pushBack(px: number, pz: number, yaw: number, metres: number): void {
    let dx = this.x - px;
    let dz = this.z - pz;
    let d = Math.hypot(dx, dz);
    if (d < 1e-6) {
      const b = yawForward(yaw + Math.PI);
      dx = b.x;
      dz = b.z;
      d = 1;
    }
    this.x += (dx / d) * metres;
    this.z += (dz / d) * metres;
  }
}
