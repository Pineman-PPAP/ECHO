import { CONFIG } from '../config';
import { yawForward } from './grid';

export type StalkerPhase = 'idle' | 'approach' | 'warn' | 'stare' | 'leave';
/** start: a pot summoned it · warn: STAND STILL · stare: its face is in yours · spared: it turns away · gone: out of earshot */
export type StalkerEvent = 'start' | 'warn' | 'stare' | 'spared' | 'gone' | 'caught';

const DEG2RAD = Math.PI / 180;

/**
 * The Stalker: an invisible thing a broken pot summons. It is never seen walking, only heard: heavy
 * footsteps coming straight at the player through the rock. Close up, the player is told to stand
 * still, then its face is right in theirs for STALKER_STARE_MS. Any movement or sound then and it
 * takes them; perfect stillness and it walks away. Pure logic (no three.js, no audio).
 */
export class Stalker {
  phase: StalkerPhase = 'idle';
  x = 0;
  z = 0;
  /** Time in the current phase (accumulated from dt, so a pause doesn't count). */
  phaseMs = 0;
  /** How fast it walked this update (m/s), for its footsteps. */
  speed = 0;

  /** While it comes and while it stares, everything else in the cave holds its breath (World freezes the Hollows and the Hush). */
  get holding(): boolean {
    return this.phase === 'approach' || this.phase === 'warn' || this.phase === 'stare';
  }

  /**
   * A pot broke. Summons it behind the player unless it is already coming or staring.
   * @returns true when it started (the crash is its, not the Hollows')
   */
  start(px: number, pz: number, yaw: number, rand: () => number): boolean {
    if (this.holding) return false;
    const a = yaw + Math.PI + (rand() * 2 - 1) * CONFIG.STALKER_SPAWN_SPREAD_DEG * DEG2RAD;
    const f = yawForward(a);
    this.x = px + f.x * CONFIG.STALKER_SPAWN_M;
    this.z = pz + f.z * CONFIG.STALKER_SPAWN_M;
    this.enter('approach');
    return true;
  }

  /**
   * @param moved the player walked or turned this frame (beyond the STALKER_*_LIMIT thresholds)
   * @param sounded the player made any sound this frame (clap, hum, footstep, another pot)
   */
  update(dtS: number, px: number, pz: number, yaw: number, moved: boolean, sounded: boolean): StalkerEvent[] {
    const out: StalkerEvent[] = [];
    this.speed = 0;
    if (this.phase === 'idle') return out;
    this.phaseMs += dtS * 1000;

    switch (this.phase) {
      case 'approach':
        this.walkToward(px, pz, CONFIG.STALKER_SPEED, dtS, CONFIG.STALKER_STARE_M);
        if (this.distanceTo(px, pz) <= CONFIG.STALKER_WARN_M) {
          this.enter('warn');
          out.push('warn');
        }
        break;
      case 'warn':
        this.walkToward(px, pz, CONFIG.STALKER_CREEP_SPEED, dtS, CONFIG.STALKER_STARE_M);
        if (this.phaseMs >= CONFIG.STALKER_WARN_MS) {
          // Its face is in front of yours, wherever it was: you can't turn away from it.
          const f = yawForward(yaw);
          this.x = px + f.x * CONFIG.STALKER_STARE_M;
          this.z = pz + f.z * CONFIG.STALKER_STARE_M;
          this.enter('stare');
          out.push('stare');
        }
        break;
      case 'stare':
        if (this.phaseMs >= CONFIG.STALKER_STARE_GRACE_MS && (moved || sounded)) {
          out.push('caught');
          return out;
        }
        if (this.phaseMs >= CONFIG.STALKER_STARE_MS) {
          this.enter('leave');
          out.push('spared');
        }
        break;
      case 'leave': {
        let dx = this.x - px;
        let dz = this.z - pz;
        const d = Math.hypot(dx, dz);
        if (d < 1e-6) {
          const f = yawForward(yaw);
          dx = f.x;
          dz = f.z;
        }
        const n = Math.hypot(dx, dz);
        this.x += (dx / n) * CONFIG.STALKER_LEAVE_SPEED * dtS;
        this.z += (dz / n) * CONFIG.STALKER_LEAVE_SPEED * dtS;
        this.speed = CONFIG.STALKER_LEAVE_SPEED;
        if (this.distanceTo(px, pz) >= CONFIG.STALKER_LEAVE_M) {
          this.enter('idle');
          out.push('gone');
        }
        break;
      }
    }
    return out;
  }

  distanceTo(px: number, pz: number): number {
    return Math.hypot(this.x - px, this.z - pz);
  }

  /** 0 when idle or at its spawn distance, 1 when it is staring at you. Drives the dread and the heartbeat. */
  closeness(px: number, pz: number): number {
    if (this.phase === 'idle') return 0;
    if (this.phase === 'stare') return 1;
    const span = CONFIG.STALKER_SPAWN_M - CONFIG.STALKER_STARE_M;
    return Math.min(Math.max((CONFIG.STALKER_SPAWN_M - this.distanceTo(px, pz)) / span, 0), 1);
  }

  private enter(phase: StalkerPhase): void {
    this.phase = phase;
    this.phaseMs = 0;
  }

  private walkToward(px: number, pz: number, speed: number, dtS: number, stopAtM: number): void {
    const d = this.distanceTo(px, pz);
    const step = Math.min(speed * dtS, Math.max(d - stopAtM, 0));
    if (step <= 0 || d < 1e-6) return;
    this.x += ((px - this.x) / d) * step;
    this.z += ((pz - this.z) / d) * step;
    this.speed = dtS > 0 ? step / dtS : 0;
  }
}
