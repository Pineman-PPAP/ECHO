import { CONFIG } from '../config';
import type { PlayerIntent } from '../input/intent';
import type { BeamParams } from '../input/mapping';
import { Ambience, type AmbientCue } from './ambience';
import { batRoosts, type Roost } from './caveLife';
import { cellCenter, lineOfSight, parseLevel, yawForward, type Level, type LevelDef } from './grid';
import { canHear, type SoundEvent, type SoundKind } from './hearing';
import { Hush } from './Hush';
import { Moments, type MomentKind } from './moments';
import { Monster } from './Monster';
import { Player } from './Player';
import { Pots } from './pots';
import { PulseManager, type Pulse } from './PulseManager';
import { choosePose, type PoseChoice } from './poses';
import { Stalker, type StalkerEvent } from './Stalker';
import { mulberry32 } from './rng';
import { eyeGlow, hollowSpeed, inView, sideOf } from './sight';

export type Creature = 'hollow' | 'hush';
/** What can catch the player: a creature, or the Stalker (never seen except as the face in yours). */
export type Catcher = Creature | 'stalker';
/** monsterId used for the Hush in events. */
export const HUSH_ID = -1;
/** EyeSpot id of the tutorial watcher. */
export const WATCHER_ID = -2;
/** monsterId used for the Stalker in events. */
export const STALKER_ID = -3;

export type WorldEvent =
  | { type: 'pulse'; pulse: Pulse }
  | { type: 'footstep'; loudness: number }
  | { type: 'heard'; monsterId: number; kind: SoundKind }
  /** A Hollow heard the player and started hunting (it wasn't hunting before). */
  | { type: 'alerted'; monsterId: number; x: number; z: number }
  | { type: 'monsterMoveStart'; monsterId: number }
  | { type: 'monsterMoveStop'; monsterId: number }
  /** A pulse wavefront or the beam touched a creature: draw an afterimage at (x, z) facing the player, in this pose. */
  | { type: 'reveal'; who: Creature; monsterId: number; x: number; z: number; facing: number; strength: number; pose: PoseChoice }
  | { type: 'hush'; what: 'appear' | 'gone' }
  | { type: 'moment'; kind: MomentKind; prompt: string | null }
  | { type: 'ambient'; cue: AmbientCue }
  /** A loud clap woke the bats roosting at (x, z). */
  | { type: 'bats'; x: number; z: number }
  /**
   * The player walked into a pot and it shattered at (x, z). Where there are monsters the crash summons
   * the Stalker (a 'stalker' start event follows) and the Hollows don't hear it; in the tutorial nothing does.
   */
  | { type: 'potKicked'; potId: number; x: number; z: number; loudness: number }
  /** The Stalker's story: see Stalker.ts. */
  | { type: 'stalker'; what: Exclude<StalkerEvent, 'caught'> }
  | { type: 'caught'; by: Catcher; monsterId: number }
  | { type: 'exit' };

export type WorldStatus = 'playing' | 'caught' | 'escaped';

/** A pair of glowing eyes the renderer draws in the dark (no pulse needed). */
export interface EyeSpot {
  id: number;
  x: number;
  z: number;
  /** Facing, atan2(dx, dz). */
  heading: number;
  /** 0..1 */
  glow: number;
  /** Where its head (and so its eyes) is. */
  pose: PoseChoice;
}

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
  /** The Hush, on levels that have it (null otherwise). */
  readonly hush: Hush | null;
  readonly moments: Moments;
  readonly pots: Pots;
  /** Summoned by a broken pot on levels with monsters. */
  readonly stalker = new Stalker();
  /** Current hum beam (null when not humming). Read by the renderer. */
  beam: BeamParams | null = null;
  status: WorldStatus = 'playing';
  /** False during the tutorial: monsters neither hear nor move, and the Hush and fake sounds stay away. */
  monstersEnabled: boolean;
  /** Stats for the end screen. */
  pulsesEmitted = 0;
  private readonly rand: () => number;
  private readonly hushRand: () => number;
  private readonly stalkerRand: () => number;
  private readonly ambience: Ambience;
  private lastHumNoiseMs = -Infinity;
  private readonly lastBeamRevealMs = new Map<number, number>();
  private readonly roosts: Roost[];
  private readonly roostsFlown = new Set<number>();

  constructor(def: LevelDef, seed = 1) {
    this.level = parseLevel(def);
    this.player = new Player(this.level);
    this.monsters = this.level.monsterSpawns.map((cell, i) => new Monster(i, cell));
    this.monstersEnabled = !def.tutorial && this.monsters.length > 0;
    this.rand = mulberry32(seed);
    this.hushRand = mulberry32(seed * 7919 + 1);
    this.stalkerRand = mulberry32(seed * 6151 + 3);
    this.ambience = new Ambience(mulberry32(seed * 104729 + 2));
    this.hush = def.hush && !def.tutorial ? new Hush() : null;
    this.moments = new Moments(def.moments ?? []);
    this.pots = new Pots(def);
    this.roosts = batRoosts(this.level);
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

    // 1b. Walking into a pot shatters it: a loud crash at the pot that also lights the cave around it.
    //     Where there are monsters the crash summons the Stalker, and it is the Stalker's alone. A crash
    //     while it is already coming is just a crash (and a sound, if it is staring at you).
    for (const k of this.pots.update(p.x, p.z, p.speed)) {
      events.push({ type: 'potKicked', potId: k.id, x: k.x, z: k.z, loudness: k.loudness });
      this.pulses.add(k.x, CONFIG.POT_LIGHT_Y_M, k.z, clockS, k.loudness * CONFIG.POT_LIGHT_SCALE);
      if (this.monstersEnabled && this.stalker.start(p.x, p.z, p.yaw, this.stalkerRand)) events.push({ type: 'stalker', what: 'start' });
      else sounds.push({ kind: 'pot', x: k.x, z: k.z, loudness: k.loudness, timeMs: nowMs });
    }

    // 2. Claps / clicks / shouts -> sonar pulses.
    for (const loudness of intent.pulses) {
      const pulse = this.pulses.add(p.x, CONFIG.EYE_HEIGHT, p.z, clockS, loudness);
      this.pulsesEmitted++;
      events.push({ type: 'pulse', pulse });
      sounds.push({ kind: 'pulse', x: p.x, z: p.z, loudness, timeMs: nowMs });
      if (loudness >= CONFIG.BAT_MIN_LOUDNESS) {
        const roost = this.wakeRoost();
        if (roost) events.push({ type: 'bats', x: roost.x, z: roost.z });
      }
    }

    // 3. Humming lights the beam and makes a little noise every HUM_NOISE_INTERVAL_MS (heard only up close).
    this.beam = intent.beam;
    if (this.beam && nowMs - this.lastHumNoiseMs >= CONFIG.HUM_NOISE_INTERVAL_MS) {
      this.lastHumNoiseMs = nowMs;
      sounds.push({ kind: 'hum', x: p.x, z: p.z, loudness: this.beam.level * CONFIG.HUM_NOISE_SCALE, timeMs: nowMs });
    }
    // Loudest sound the player made this frame (the Hush is driven back by it).
    let loudest = 0;
    for (const s of sounds) loudest = Math.max(loudest, s.loudness);

    // 4. Authored moments (may place monsters out of sight).
    for (const m of this.moments.update(this, nowMs, intent.pulses.length > 0)) events.push({ type: 'moment', kind: m.kind, prompt: m.prompt });

    // 4b. The Stalker. While it comes and stares, the Hollows and the Hush hold still.
    if (this.stalker.phase !== 'idle') {
      const moved = p.speed > CONFIG.STALKER_MOVE_LIMIT_MPS || Math.abs(intent.turnRate) > CONFIG.STALKER_TURN_LIMIT_RAD_S;
      const sounded = loudest > 0 || intent.pulses.length > 0 || intent.beam !== null;
      for (const what of this.stalker.update(dtS, p.x, p.z, p.yaw, moved, sounded)) {
        if (what === 'caught') {
          this.status = 'caught';
          events.push({ type: 'caught', by: 'stalker', monsterId: STALKER_ID });
          return events;
        }
        events.push({ type: 'stalker', what });
      }
    }

    if (this.monstersEnabled && !this.stalker.holding) {
      // 5. Hearing. Hollows are blind: sound is the only way they find you.
      for (const ev of sounds) {
        for (const m of this.monsters) {
          if (canHear(this.level, ev, m.x, m.z)) {
            const wasHunting = m.state === 'alert';
            m.hear(this.level, ev.x, ev.z);
            events.push({ type: 'heard', monsterId: m.id, kind: ev.kind });
            if (!wasHunting && m.state === 'alert') events.push({ type: 'alerted', monsterId: m.id, x: m.x, z: m.z });
          }
        }
      }

      // 6. Movement: a hunting Hollow runs to what it heard, any other one creeps.
      for (const m of this.monsters) {
        const hunt = m.state === 'alert' ? Math.hypot(m.x - p.x, m.z - p.z) : null;
        const was = m.moving;
        m.update(dtS, hollowSpeed(this.moments.finale, hunt), this.level, nowMs, this.rand);
        if (m.moving && !was) events.push({ type: 'monsterMoveStart', monsterId: m.id });
        if (!m.moving && was) events.push({ type: 'monsterMoveStop', monsterId: m.id });
      }

      // 7. Caught?
      for (const m of this.monsters) {
        if (Math.hypot(m.x - p.x, m.z - p.z) < CONFIG.CATCH_DISTANCE) {
          this.status = 'caught';
          events.push({ type: 'caught', by: 'hollow', monsterId: m.id });
          return events;
        }
      }

      // 8. The Hush.
      if (this.hush) {
        for (const what of this.hush.update(dtS, p.x, p.z, p.yaw, loudest, this.hushRand)) {
          if (what === 'caught') {
            this.status = 'caught';
            events.push({ type: 'caught', by: 'hush', monsterId: HUSH_ID });
            return events;
          }
          events.push({ type: 'hush', what });
        }
      }
    }

    // 9. Escaped?
    const exit = cellCenter(this.level.exit);
    if (Math.hypot(exit.x - p.x, exit.z - p.z) < CONFIG.EXIT_REACH_M) {
      this.status = 'escaped';
      events.push({ type: 'exit' });
      return events;
    }

    // 10. Reveals: each pulse reveals each creature once, when its wavefront reaches it.
    const creatures = this.revealables();
    for (const pulse of this.pulses.pulses) {
      const front = PulseManager.frontRadius(pulse, clockS);
      for (const c of creatures) {
        if (pulse.revealed.has(c.id)) continue;
        const d = Math.hypot(c.x - pulse.x, c.z - pulse.z);
        if (d <= front && d <= pulse.maxRadius) {
          pulse.revealed.add(c.id);
          events.push({ type: 'reveal', who: c.who, monsterId: c.id, x: c.x, z: c.z, facing: Math.atan2(p.x - c.x, p.z - c.z), strength: pulse.strength, pose: c.pose });
        }
      }
    }
    //     The beam refreshes an afterimage every BEAM_AFTERIMAGE_INTERVAL_MS while a creature is inside the cone.
    if (this.beam) {
      const f = yawForward(p.yaw);
      const cosHalf = Math.cos(this.beam.halfAngleRad);
      for (const c of creatures) {
        const dx = c.x - p.x;
        const dz = c.z - p.z;
        const d = Math.hypot(dx, dz);
        if (d < 1e-6 || d > this.beam.range) continue;
        if ((dx * f.x + dz * f.z) / d < cosHalf) continue;
        const last = this.lastBeamRevealMs.get(c.id) ?? -Infinity;
        if (nowMs - last < CONFIG.BEAM_AFTERIMAGE_INTERVAL_MS) continue;
        this.lastBeamRevealMs.set(c.id, nowMs);
        events.push({ type: 'reveal', who: c.who, monsterId: c.id, x: c.x, z: c.z, facing: Math.atan2(p.x - c.x, p.z - c.z), strength: this.beam.strength, pose: c.pose });
      }
    }

    // 11. The cave's lies (fake scrapes, a copied clap).
    if (this.monstersEnabled && !this.stalker.holding) {
      for (const cue of this.ambience.update(nowMs, p.x, p.z, p.yaw, this.nearestHollowM(), intent.pulses, this.moments.quiet)) {
        events.push({ type: 'ambient', cue });
      }
    }

    this.pulses.prune(clockS);
    return events;
  }

  /** 0..1: how close the nearest hunting monster or the Stalker is (drives heartbeat and red vignette). */
  danger(): number {
    let best = this.stalkerCloseness();
    for (const m of this.monsters) {
      if (m.state === 'idle' || m.state === 'patrol') continue;
      const d = Math.hypot(m.x - this.player.x, m.z - this.player.z);
      best = Math.max(best, 1 - d / CONFIG.DANGER_RADIUS);
    }
    return Math.min(Math.max(best, 0), 1);
  }

  /** 0..1: how close the Hush is (frost overlay, whisper, drone cut). */
  hushCloseness(): number {
    return this.hush ? this.hush.closeness(this.player.x, this.player.z) : 0;
  }

  /** 0..1: how close the Stalker is (its dread swells with it); 1 while it stares. */
  stalkerCloseness(): number {
    return this.stalker.closeness(this.player.x, this.player.z);
  }

  /** The player is in an authored silent stretch. */
  get quiet(): boolean {
    return this.moments.quiet;
  }

  /** Every pair of eyes visible in the dark right now: Hollows facing the player, plus the tutorial watcher. */
  eyes(): EyeSpot[] {
    const p = this.player;
    const out: EyeSpot[] = [];
    for (const m of this.monsters) {
      const glow = eyeGlow(this.level, p.x, p.z, m.x, m.z, m.heading);
      if (glow > 0) out.push({ id: m.id, x: m.x, z: m.z, heading: m.heading, glow, pose: this.poseOf(m) });
    }
    const w = this.moments.watcher;
    if (w) {
      const glow = eyeGlow(this.level, p.x, p.z, w.x, w.z, w.heading);
      if (glow > 0) out.push({ id: WATCHER_ID, x: w.x, z: w.z, heading: w.heading, glow, pose: { pose: 'stand', mirror: false } });
    }
    return out;
  }

  /**
   * Ambient drone level 0..1. Silence is the warning: it fades as a Hollow comes close, as the Hush
   * nears, and in quiet stretches.
   */
  droneLevel(): number {
    if (this.moments.quiet || this.stalker.holding) return 0;
    const span = CONFIG.DRONE_CUT_RADIUS_M - CONFIG.DRONE_SILENT_RADIUS_M;
    const near = this.monstersEnabled ? Math.min(Math.max((this.nearestHollowM() - CONFIG.DRONE_SILENT_RADIUS_M) / span, 0), 1) : 1;
    return near * (1 - this.hushCloseness());
  }

  /**
   * Breathing in one ear: the nearest Hollow within EAR_BREATH_RADIUS_M that isn't in front of the player.
   * @returns side (+1 right, -1 left) and closeness 0..1, or null
   */
  earBreath(): { side: 1 | -1; closeness: number } | null {
    if (!this.monstersEnabled) return null;
    const p = this.player;
    let best: { side: 1 | -1; closeness: number } | null = null;
    for (const m of this.monsters) {
      const d = Math.hypot(m.x - p.x, m.z - p.z);
      if (d > CONFIG.EAR_BREATH_RADIUS_M) continue;
      if (inView(p.x, p.z, p.yaw, m.x, m.z)) continue;
      const closeness = 1 - d / CONFIG.EAR_BREATH_RADIUS_M;
      if (!best || closeness > best.closeness) best = { side: sideOf(p.x, p.z, p.yaw, m.x, m.z), closeness };
    }
    return best;
  }

  nearestHollowM(): number {
    let best = Infinity;
    for (const m of this.monsters) best = Math.min(best, Math.hypot(m.x - this.player.x, m.z - this.player.z));
    return best;
  }

  /** The nearest roost within BAT_WAKE_RADIUS_M that can see the player and hasn't flown yet. */
  private wakeRoost(): Roost | null {
    const p = this.player;
    let best: Roost | null = null;
    let bestD: number = CONFIG.BAT_WAKE_RADIUS_M;
    for (const r of this.roosts) {
      if (this.roostsFlown.has(r.id)) continue;
      const d = Math.hypot(r.x - p.x, r.z - p.z);
      if (d > bestD || d < CONFIG.CELL_SIZE || !lineOfSight(this.level, p.x, p.z, r.x, r.z)) continue;
      best = r;
      bestD = d;
    }
    if (best) this.roostsFlown.add(best.id);
    return best;
  }

  /** The pose a Hollow is seen in right now. */
  private poseOf(m: Monster): PoseChoice {
    return choosePose(m.state, Math.hypot(m.x - this.player.x, m.z - this.player.z), m.id, m.x, m.z);
  }

  /** Creatures a pulse or the beam can reveal this frame. */
  private revealables(): Array<{ who: Creature; id: number; x: number; z: number; pose: PoseChoice }> {
    const list: Array<{ who: Creature; id: number; x: number; z: number; pose: PoseChoice }> = this.monsters.map((m) => ({
      who: 'hollow',
      id: m.id,
      x: m.x,
      z: m.z,
      pose: this.poseOf(m),
    }));
    if (this.hush?.present) list.push({ who: 'hush', id: HUSH_ID, x: this.hush.x, z: this.hush.z, pose: { pose: 'stand', mirror: this.hush.x > this.player.x } });
    return list;
  }
}
