import { CONFIG } from '../config';
import type { PlayerIntent } from '../input/intent';
import type { BeamParams } from '../input/mapping';
import { cellCenter, parseLevel, yawForward, type Level, type LevelDef } from './grid';
import { canHear, type SoundEvent, type SoundKind } from './hearing';
import { Monster } from './Monster';
import { Player } from './Player';
import { PulseManager, type Pulse } from './PulseManager';
import { mulberry32 } from './rng';

export type WorldEvent =
  | { type: 'pulse'; pulse: Pulse }
  | { type: 'footstep'; loudness: number }
  | { type: 'heard'; monsterId: number; kind: SoundKind }
  | { type: 'monsterMoveStart'; monsterId: number }
  | { type: 'monsterMoveStop'; monsterId: number }
  /** A pulse wavefront or the beam touched a monster: draw an afterimage at (x, z) facing the player. */
  | { type: 'reveal'; monsterId: number; x: number; z: number; facing: number; strength: number }
  | { type: 'caught'; monsterId: number }
  | { type: 'exit' };

export type WorldStatus = 'playing' | 'caught' | 'escaped';

/**
 * One level's simulation. Pure logic (no three.js, no DOM, no audio) so it is unit-testable.
 * Time bases: nowMs = performance.now() milliseconds (logic timers);
 *             clockS = game clock seconds (anything the shader sees, i.e. pulses).
 */
export class World {
  readonly level: Level;
  readonly player: Player;
  readonly monsters: Monster[];
  readonly pulses = new PulseManager();
  /** Current hum beam (null when not humming). Read by the renderer. */
  beam: BeamParams | null = null;
  status: WorldStatus = 'playing';
  /** False during the tutorial and the level intro: monsters neither hear nor move. */
  monstersEnabled: boolean;
  /** Stats for the end screen. */
  pulsesEmitted = 0;
  private readonly rand: () => number;
  private lastHumNoiseMs = -Infinity;
  private lastClosedAlertMs = -Infinity;
  private readonly lastBeamRevealMs = new Map<number, number>();

  constructor(def: LevelDef, seed = 1) {
    this.level = parseLevel(def);
    this.player = new Player(this.level);
    this.monsters = this.level.monsterSpawns.map((cell, i) => new Monster(i, cell));
    this.monstersEnabled = !def.tutorial && this.monsters.length > 0;
    this.rand = mulberry32(seed);
  }

  update(dtS: number, nowMs: number, clockS: number, intent: PlayerIntent): WorldEvent[] {
    const events: WorldEvent[] = [];
    if (this.status !== 'playing') return events;
    const p = this.player;
    const sounds: SoundEvent[] = [];

    // 1. Player movement (+ footsteps make noise).
    const step = p.update(dtS, intent.turnRate, intent.moveSpeed, this.level);
    if (step !== null) {
      events.push({ type: 'footstep', loudness: step });
      if (step >= CONFIG.FOOTSTEP_MIN_AUDIBLE) sounds.push({ kind: 'footstep', x: p.x, z: p.z, loudness: step, timeMs: nowMs });
    }

    // 2. Claps / clicks / shouts -> sonar pulses.
    for (const loudness of intent.pulses) {
      const pulse = this.pulses.add(p.x, CONFIG.EYE_HEIGHT, p.z, clockS, loudness);
      this.pulsesEmitted++;
      events.push({ type: 'pulse', pulse });
      sounds.push({ kind: 'pulse', x: p.x, z: p.z, loudness, timeMs: nowMs });
    }

    // 3. Humming lights the beam and makes a little noise every HUM_NOISE_INTERVAL_MS.
    this.beam = intent.beam;
    if (this.beam && nowMs - this.lastHumNoiseMs >= CONFIG.HUM_NOISE_INTERVAL_MS) {
      this.lastHumNoiseMs = nowMs;
      sounds.push({ kind: 'hum', x: p.x, z: p.z, loudness: this.beam.level * CONFIG.HUM_NOISE_SCALE, timeMs: nowMs });
    }

    // 4. Keeping the eyes closed too long tells nearby monsters where you are.
    if (intent.eyesClosedMs >= CONFIG.CLOSED_EYES_ALERT_MS && nowMs - this.lastClosedAlertMs >= CONFIG.CLOSED_EYES_ALERT_INTERVAL_MS) {
      this.lastClosedAlertMs = nowMs;
      sounds.push({ kind: 'closedEyes', x: p.x, z: p.z, loudness: CONFIG.CLOSED_EYES_ALERT_LOUDNESS, timeMs: nowMs });
    }

    if (this.monstersEnabled) {
      // 5. Hearing.
      for (const ev of sounds) {
        for (const m of this.monsters) {
          if (canHear(this.level, ev, m.x, m.z)) {
            m.hear(this.level, ev.x, ev.z);
            events.push({ type: 'heard', monsterId: m.id, kind: ev.kind });
          }
        }
      }

      // 6. Movement: ONLY while the eyes are closed.
      const speed = !intent.eyesClosed
        ? CONFIG.MONSTER_SPEED_EYES_OPEN
        : intent.eyesClosedMs >= CONFIG.LONG_CLOSE_MS
          ? CONFIG.MONSTER_SPEED_LONG_CLOSE
          : CONFIG.MONSTER_SPEED_BLINK;
      for (const m of this.monsters) {
        const was = m.moving;
        m.update(dtS, speed, this.level, nowMs, this.rand);
        if (m.moving && !was) events.push({ type: 'monsterMoveStart', monsterId: m.id });
        if (!m.moving && was) events.push({ type: 'monsterMoveStop', monsterId: m.id });
      }

      // 7. Caught?
      for (const m of this.monsters) {
        if (Math.hypot(m.x - p.x, m.z - p.z) < CONFIG.CATCH_DISTANCE) {
          this.status = 'caught';
          events.push({ type: 'caught', monsterId: m.id });
          return events;
        }
      }
    }

    // 8. Escaped?
    const exit = cellCenter(this.level.exit);
    if (Math.hypot(exit.x - p.x, exit.z - p.z) < CONFIG.EXIT_REACH_M) {
      this.status = 'escaped';
      events.push({ type: 'exit' });
      return events;
    }

    // 9. Reveals: each pulse reveals each monster once, when its wavefront reaches it.
    for (const pulse of this.pulses.pulses) {
      const front = PulseManager.frontRadius(pulse, clockS);
      for (const m of this.monsters) {
        if (pulse.revealed.has(m.id)) continue;
        const d = Math.hypot(m.x - pulse.x, m.z - pulse.z);
        if (d <= front && d <= pulse.maxRadius) {
          pulse.revealed.add(m.id);
          events.push({ type: 'reveal', monsterId: m.id, x: m.x, z: m.z, facing: Math.atan2(p.x - m.x, p.z - m.z), strength: pulse.strength });
        }
      }
    }
    //    The beam refreshes an afterimage every BEAM_AFTERIMAGE_INTERVAL_MS while a monster is inside the cone.
    if (this.beam) {
      const f = yawForward(p.yaw);
      const cosHalf = Math.cos(this.beam.halfAngleRad);
      for (const m of this.monsters) {
        const dx = m.x - p.x;
        const dz = m.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-6 || d > this.beam.range) continue;
        if ((dx * f.x + dz * f.z) / d < cosHalf) continue;
        const last = this.lastBeamRevealMs.get(m.id) ?? -Infinity;
        if (nowMs - last < CONFIG.BEAM_AFTERIMAGE_INTERVAL_MS) continue;
        this.lastBeamRevealMs.set(m.id, nowMs);
        events.push({ type: 'reveal', monsterId: m.id, x: m.x, z: m.z, facing: Math.atan2(p.x - m.x, p.z - m.z), strength: this.beam.strength });
      }
    }

    this.pulses.prune(clockS);
    return events;
  }

  /** 0..1: how close the nearest hunting monster is (drives heartbeat and red vignette). */
  danger(): number {
    let best = 0;
    for (const m of this.monsters) {
      if (m.state === 'idle') continue;
      const d = Math.hypot(m.x - this.player.x, m.z - this.player.z);
      best = Math.max(best, 1 - d / CONFIG.DANGER_RADIUS);
    }
    return Math.min(Math.max(best, 0), 1);
  }
}
