import type { Sfx } from '../audio/Sfx';
import { CONFIG } from '../config';
import type { FaceFrame } from '../input/face/FaceTracker';
import { idleIntent, type PlayerIntent } from '../input/intent';
import { cellCenter, facingToYaw, lineOfSight, yawForward } from '../game/grid';
import { FIELD_MANUAL_LEVEL, FIELD_MANUAL_STAGE } from '../game/levels';
import { World, type WorldEvent } from '../game/World';
import { blendPose, shotPose } from '../render/CinematicCamera';
import type { Renderer } from '../render/Renderer';
import type { ManualGauges, ManualOverlay } from '../ui/ManualOverlay';
import type { Overlays } from '../ui/Overlays';
import { FieldManual, type ManualEvent, type ManualFrame } from './FieldManual';

/** Moves `from` toward `to` with time constant `tauS` (frame-rate independent). */
function ease(from: number, to: number, dtS: number, tauS: number): number {
  return from + (to - from) * (1 - Math.exp(-dtS / Math.max(tauS, 1e-3)));
}

/** Shortest signed angle from a to b. */
function angleTo(a: number, b: number): number {
  return Math.atan2(Math.sin(b - a), Math.cos(b - a));
}

/**
 * Runs the Field Manual: owns the practice cave's World (FIELD_MANUAL_LEVEL, a sandbox the real levels
 * never see), feeds FieldManual and stages what it asks for with the game's own renderer, sounds and
 * overlays: the cinematic camera, slow motion, the jar's close-up, the Hollow in the tunnel, the
 * Stalker's stare and the Hush's frost. The cave's rules are not changed: the Hollow hears and hunts
 * through World exactly as in the game, it is only switched on (monstersEnabled) while its lesson needs
 * it and switched off before it can come close. Creatures that are pure staging (the Stalker's face,
 * the Hush's pale shape) are drawn and voiced here, never simulated, so nothing can catch the player.
 */
export class ManualDirector {
  readonly world = new World(FIELD_MANUAL_LEVEL, 1);
  readonly manual: FieldManual;
  /** The manual's own game clock (s): it runs slow in bullet time, so pulses and dust slow down too. */
  clockS: number;
  /** 0..1 for the App's overlays: the hunting Hollow's red edge, and the Hush's frost. */
  danger = 0;
  frost = 0;
  private frame: ManualFrame | null = null;
  private timeScale = 1;
  private shotWeight = 0;
  private jarOffer = 0;
  private nextGlowS = 0;
  private nextHushShapeMs = 0;
  private stareShown = false;
  private stalkerOn = false;

  constructor(
    private readonly renderer: Renderer,
    private readonly overlays: Overlays,
    private readonly ui: ManualOverlay,
    private readonly sfx: Sfx | null,
    sim: boolean,
    startClockS: number,
  ) {
    this.manual = new FieldManual(sim);
    this.clockS = startClockS;
    renderer.loadLevel(this.world.level);
    if (sfx) {
      sfx.stalkerStop();
      sfx.clearVoices();
      sfx.resetDread();
      for (const m of this.world.monsters) sfx.addVoice(m.id);
      sfx.startDrone();
    }
    ui.show(true);
  }

  get phase(): string {
    return this.frame ? `${this.frame.beat ?? 'end'}/${this.frame.phase}` : 'start';
  }

  get learnedBasics(): boolean {
    return this.manual.learnedBasics;
  }

  /** One animation frame. @returns true once the manual is over (the App then starts the first level). */
  update(nowMs: number, dtS: number, intent: PlayerIntent, gauges: ManualGauges, face: FaceFrame | null): boolean {
    const hollow = this.world.monsters[0];
    const p = this.world.player;
    const f = this.manual.update(dtS * 1000, intent, {
      hollowDistanceM: this.frame?.beat === 'hear' ? Math.hypot(hollow.x - p.x, hollow.z - p.z) : null,
      hollowAlerted: hollow.state === 'alert',
    });
    this.frame = f;
    for (const e of f.events) this.onEvent(e);

    if (!f.paused) {
      // Bullet time: slow down gently, but snap back to full speed the moment the player acts.
      const target = f.slow ? CONFIG.MANUAL_SLOWMO : 1;
      this.timeScale = target >= this.timeScale ? target : ease(this.timeScale, target, dtS, CONFIG.MANUAL_TIME_EASE_S);
      const dt = dtS * this.timeScale;
      this.clockS += dt;
      // Before it has heard anything it is only switched on for the frame of a sound (so it never wanders
      // up the tunnel while the player reads), and never once it is within MANUAL_HOLLOW_HALT_M of them.
      const listening = f.phase === 'await' && f.step?.id === 'clapReveal' && hollow.state !== 'alert';
      const near = Math.hypot(hollow.x - p.x, hollow.z - p.z) <= CONFIG.MANUAL_HOLLOW_HALT_M;
      this.world.monstersEnabled = f.hollowActive && !near && (!listening || intent.pulses.length > 0);
      if (f.aim) p.yaw += angleTo(p.yaw, facingToYaw(FIELD_MANUAL_STAGE.facing)) * (1 - Math.exp(-dtS / CONFIG.MANUAL_AIM_EASE_S));
      if (f.glow && this.clockS >= this.nextGlowS) {
        this.world.pulses.add(p.x, CONFIG.EYE_HEIGHT, p.z, this.clockS, CONFIG.MANUAL_GLOW_LOUDNESS);
        this.nextGlowS = this.clockS + CONFIG.MANUAL_GLOW_PULSE_MS / 1000;
      }
      const events = this.world.update(dt, nowMs, this.clockS, f.held ? { ...idleIntent(), facePresent: intent.facePresent } : intent);
      this.route(events);
      this.stage(f, nowMs, dtS);
    }
    this.ui.update(f, gauges, intent, face, nowMs);
    return f.phase === 'done';
  }

  /** Leaves the manual: everything it staged is put away (the App loads the first level next). */
  exit(): void {
    this.renderer.setCinematic(null);
    this.renderer.setJarOffer(0);
    if (this.stareShown) this.renderer.hideJumpscare();
    this.stareShown = false;
    this.stopStalker();
    this.sfx?.updateHush(0, 0, 0);
    this.world.monstersEnabled = false;
    this.danger = 0;
    this.frost = 0;
    this.ui.show(false);
  }

  /** Sound for this frame (the App's normal audio update is skipped while the manual runs). */
  updateAudio(nowMs: number): void {
    const sfx = this.sfx;
    const f = this.frame;
    if (!sfx || !f) return;
    const w = this.world;
    const p = w.player;
    sfx.setListener(p.x, CONFIG.EYE_HEIGHT, p.z, p.yaw);
    for (const m of w.monsters) {
      sfx.updateVoice(m.id, m.x, m.z, w.monstersEnabled && m.moving, Math.hypot(m.x - p.x, m.z - p.z), m.speed);
    }
    if (this.stalkerOn) {
      // Its steps come from behind, closing in over the setup; then its face is in yours.
      const d = CONFIG.MANUAL_STALKER_FROM_M + (CONFIG.STALKER_STARE_M - CONFIG.MANUAL_STALKER_FROM_M) * f.stalker;
      const dir = yawForward(f.stare ? p.yaw : p.yaw + Math.PI);
      const speed = f.stare ? 0 : (CONFIG.MANUAL_STALKER_FROM_M - CONFIG.STALKER_STARE_M) / (CONFIG.MANUAL_STALKER_APPROACH_MS / 1000);
      sfx.updateStalker(p.x + dir.x * d, p.z + dir.z * d, f.stalker, speed, f.stare);
    }
    const hush = this.frost / CONFIG.MANUAL_FROST;
    const behind = yawForward(p.yaw + Math.PI * 0.8);
    sfx.updateHush(p.x + behind.x * CONFIG.MANUAL_HUSH_WHISPER_M, p.z + behind.z * CONFIG.MANUAL_HUSH_WHISPER_M, hush);
    sfx.updateHeartbeat(nowMs, Math.max(this.danger, f.stare ? 1 : f.stalker * 0.6));
    sfx.setDroneLevel(f.stare || this.stalkerOn ? 0 : Math.max(0, 1 - hush) * w.droneLevel());
  }

  // ------------------------------------------------------------------ manual events

  private onEvent(e: ManualEvent): void {
    const w = this.world;
    const hollow = w.monsters[0];
    switch (e.type) {
      case 'beatStart':
        if (e.beat !== 'dark') this.sfx?.tick();
        // The Hollow only leaves its sealed pocket for its own lesson, facing away down the tunnel.
        if (e.beat === 'hear') {
          hollow.placeAt(FIELD_MANUAL_STAGE.hollow);
          const c = cellCenter(FIELD_MANUAL_STAGE.hollow);
          const away = yawForward(facingToYaw(FIELD_MANUAL_STAGE.facing));
          hollow.faceToward(c.x + away.x, c.z + away.z);
        } else {
          hollow.placeAt(w.level.monsterSpawns[0]);
        }
        if (e.beat === 'freeze' && this.sfx) {
          this.sfx.stalkerStart();
          this.stalkerOn = true;
        }
        break;
      case 'place': {
        const s = cellCenter(FIELD_MANUAL_STAGE.start);
        w.player.x = s.x;
        w.player.z = s.z;
        w.player.yaw = facingToYaw(FIELD_MANUAL_STAGE.facing);
        this.renderer.afterimages.clear();
        break;
      }
      case 'stepDone':
        this.sfx?.confirm();
        break;
      case 'freezeFail':
        // "It saw that": the same red flash and a jolt, then the stillness count starts over.
        this.overlays.flash();
        this.renderer.shake(0.05, 0.3, this.clockS);
        break;
      case 'end':
        hollow.placeAt(w.level.monsterSpawns[0]);
        break;
      case 'stepStart':
      case 'timeout':
      case 'beatDone':
      case 'skip':
      case 'finished':
        break;
    }
  }

  // ------------------------------------------------------------------ the game's own feedback

  /** The manual's World speaks through the same channels as the game (no ambient lies, no bats). */
  private route(events: WorldEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'pulse':
          this.sfx?.ping(e.pulse.loudness);
          break;
        case 'footstep':
          this.sfx?.footstep(e.loudness);
          break;
        case 'reveal':
          this.renderer.afterimages.spawn(e.x, e.z, e.facing, e.strength, this.clockS, e.who, e.pose);
          break;
        case 'alerted':
          this.overlays.flash();
          this.sfx?.alerted(e.x, e.z);
          break;
        default:
          break;
      }
    }
  }

  /** Camera, jar, the Stalker's face and the Hush's frost, eased toward what the manual asks for. */
  private stage(f: ManualFrame, nowMs: number, dtS: number): void {
    this.shotWeight = ease(this.shotWeight, f.shotOn ? 1 : 0, dtS, CONFIG.MANUAL_SHOT_EASE_S);
    const shotS = (f.phase === 'end' ? f.phaseMs : f.beatMs) / 1000;
    this.renderer.setCinematic(blendPose(shotPose(f.shot, shotS), this.shotWeight));

    if (f.jarShown) this.renderer.showJarOnce(this.clockS);
    this.jarOffer = ease(this.jarOffer, f.jarOffer, dtS, CONFIG.MANUAL_JAR_EASE_S);
    this.renderer.setJarOffer(this.jarOffer);

    if (f.stare && !this.stareShown) {
      this.stareShown = true;
      this.renderer.showStare(this.clockS);
      this.overlays.flash();
      this.sfx?.stalkerHit();
    } else if (!f.stare && this.stareShown) {
      this.stareShown = false;
      this.renderer.hideJumpscare();
    }
    // It turns away when its stare ends (or the lesson is skipped mid-approach).
    if (this.stalkerOn && (f.beat !== 'freeze' || f.phase === 'confirm')) this.stopStalker();

    this.frost = ease(this.frost, f.frost, dtS, CONFIG.MANUAL_SHOT_EASE_S);
    if (f.beat === 'hush' && f.phase === 'await' && nowMs >= this.nextHushShapeMs) {
      // A pale shape at the edge of the light, never simulated: only the frost and the whisper are "real".
      this.nextHushShapeMs = nowMs + CONFIG.MANUAL_HUSH_FLICKER_MS;
      const p = this.world.player;
      const ahead = yawForward(p.yaw + 0.35);
      const x = p.x + ahead.x * CONFIG.MANUAL_HUSH_SHAPE_M;
      const z = p.z + ahead.z * CONFIG.MANUAL_HUSH_SHAPE_M;
      if (lineOfSight(this.world.level, p.x, p.z, x, z)) {
        this.renderer.afterimages.spawn(x, z, Math.atan2(p.x - x, p.z - z), 0.55, this.clockS, 'hush', { pose: 'stand', mirror: false });
      }
    }
    this.danger = this.world.danger();
  }

  private stopStalker(): void {
    if (!this.stalkerOn) return;
    this.stalkerOn = false;
    this.sfx?.stalkerStop();
  }
}
