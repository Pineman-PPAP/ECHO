import type { Sfx } from '../audio/Sfx';
import { CONFIG } from '../config';
import type { FaceFrame } from '../input/face/FaceTracker';
import { idleIntent, type PlayerIntent } from '../input/intent';
import { cellCenter, facingToYaw, yawForward } from '../game/grid';
import { FIELD_MANUAL_LEVEL, FIELD_MANUAL_STAGE } from '../game/levels';
import { World, type WorldEvent } from '../game/World';
import { blendPose, shotPose } from '../render/CinematicCamera';
import type { Renderer } from '../render/Renderer';
import type { ManualGauges, ManualOverlay } from '../ui/ManualOverlay';
import type { Overlays } from '../ui/Overlays';
import { FieldManual, type ManualFrame } from './FieldManual';

function ease(from: number, to: number, dtS: number, tauS: number): number {
  return from + (to - from) * (1 - Math.exp(-dtS / tauS));
}

/** Four short live shots in a separate safe World, using the existing renderer and input stream. */
export class ManualDirector {
  readonly world = new World(FIELD_MANUAL_LEVEL, 1);
  readonly manual: FieldManual;
  clockS: number;
  danger = 0;
  frost = 0;
  private frame: ManualFrame | null = null;
  private shotWeight = 0;
  private jarOffer = 0;
  private nextGlowS = 0;
  private nextGlimpseS = 0;
  private readonly sfx: Sfx | null;

  constructor(
    private readonly renderer: Renderer,
    private readonly overlays: Overlays,
    private readonly ui: ManualOverlay,
    sfx: Sfx | null,
    sim: boolean,
    startClockS: number,
    speakerLeak = false,
  ) {
    this.manual = new FieldManual(sim);
    this.clockS = startClockS;
    this.sfx = speakerLeak ? null : sfx;
    sfx?.stalkerStop();
    sfx?.clearVoices();
    sfx?.resetDread();
    if (speakerLeak) { sfx?.stopDrone(); sfx?.silence(true); }
    else { for (const m of this.world.monsters) sfx?.addVoice(m.id); sfx?.startDrone(); }
    renderer.loadLevel(this.world.level);
    renderer.showJarOnce(this.clockS);
    ui.show(true);
  }

  get phase(): string { return this.frame ? `${this.frame.beat ?? 'end'}/${this.frame.phase}` : 'start'; }
  get learnedBasics(): boolean { return this.manual.learnedBasics; }

  update(nowMs: number, dtS: number, intent: PlayerIntent, gauges: ManualGauges, face: FaceFrame | null): boolean {
    const h = this.world.monsters[0], p = this.world.player;
    const input = document.hidden ? { ...idleIntent(), facePresent: false } : intent;
    const f = this.manual.update(dtS * 1000, input, {
      hollowDistanceM: this.frame?.beat === 'hear' ? Math.hypot(h.x - p.x, h.z - p.z) : null,
      hollowAlerted: h.state === 'alert',
    });
    this.frame = f;
    if (!f.paused) {
      for (const e of f.events) {
        if (e.type === 'place') {
          const c = cellCenter(FIELD_MANUAL_STAGE.start);
          p.x = c.x; p.z = c.z; p.yaw = facingToYaw(FIELD_MANUAL_STAGE.facing);
          this.world.pulses.clear(); this.renderer.afterimages.clear();
        }
        if (e.type === 'beatStart' && e.beat === 'hear') {
          h.placeAt(FIELD_MANUAL_STAGE.hollow);
          const c = cellCenter(FIELD_MANUAL_STAGE.hollow), away = yawForward(facingToYaw(FIELD_MANUAL_STAGE.facing));
          h.faceToward(c.x + away.x, c.z + away.z);
        }
        if (e.type === 'stepDone') this.sfx?.confirm();
      }
      // Keep hum/sonar effects at real speed; only idle waiting slows the cave down.
      const dt = dtS * (f.slow ? CONFIG.MANUAL_SLOWMO : 1);
      this.clockS += dt;
      if (f.aim) {
        const delta = facingToYaw(FIELD_MANUAL_STAGE.facing) - p.yaw;
        p.yaw += Math.atan2(Math.sin(delta), Math.cos(delta)) * (1 - Math.exp(-dtS / CONFIG.MANUAL_AIM_EASE_S));
      }
      if (f.glow && this.clockS >= this.nextGlowS) {
        this.world.pulses.add(p.x, CONFIG.EYE_HEIGHT, p.z, this.clockS, CONFIG.MANUAL_GLOW_LOUDNESS);
        this.nextGlowS = this.clockS + CONFIG.MANUAL_GLOW_PULSE_MS / 1000;
      }
      const distance = Math.hypot(h.x - p.x, h.z - p.z);
      this.world.monstersEnabled = f.hollowActive && distance > CONFIG.MANUAL_HOLLOW_HALT_M && (h.state === 'alert' || intent.pulses.length > 0);
      // Hold the framing of the final encounter; the actor stops far outside catching distance.
      const held = f.held || f.beat === 'hear';
      const sceneIntent = held ? { ...intent, turnRate: 0, moveSpeed: 0, ...(f.held ? { pulses: [], hum: null } : {}) } : intent;
      this.route(this.world.update(dt, nowMs, this.clockS, sceneIntent));
      if (f.beat === 'hear' && f.step?.id === 'watch' && this.clockS >= this.nextGlimpseS) {
        // Scripted red glimpses make the real hunt's changing location readable in this safe shot.
        this.nextGlimpseS = this.clockS + CONFIG.MANUAL_HOLLOW_GLIMPSE_MS / 1000;
        this.renderer.afterimages.spawn(h.x, h.z, Math.atan2(p.x - h.x, p.z - h.z), CONFIG.MANUAL_HOLLOW_GLIMPSE_STRENGTH, this.clockS, 'hollow', { pose: 'stalk', mirror: false });
      }
      this.shotWeight = ease(this.shotWeight, f.shotOn ? 1 : 0, dtS, CONFIG.MANUAL_SHOT_EASE_S);
      this.renderer.setCinematic(blendPose(shotPose(f.shot, f.beatMs / 1000), this.shotWeight));
      this.jarOffer = ease(this.jarOffer, f.jarOffer, dtS, CONFIG.MANUAL_JAR_EASE_S);
      this.renderer.setJarOffer(this.jarOffer);
      this.danger = this.world.danger();
    }
    this.ui.update(f, gauges, intent, face, nowMs);
    return f.phase === 'done';
  }

  exit(): void {
    this.renderer.setCinematic(null); this.renderer.setJarOffer(0);
    this.world.monstersEnabled = false; this.danger = 0; this.ui.show(false);
  }

  updateAudio(nowMs: number): void {
    if (!this.sfx || !this.frame || this.frame.paused) return;
    const p = this.world.player;
    this.sfx.setListener(p.x, CONFIG.EYE_HEIGHT, p.z, p.yaw);
    for (const m of this.world.monsters) this.sfx.updateVoice(m.id, m.x, m.z, this.world.monstersEnabled && m.moving, Math.hypot(m.x - p.x, m.z - p.z), m.speed);
    this.sfx.updateHeartbeat(nowMs, this.danger);
    this.sfx.setDroneLevel(this.world.droneLevel());
  }

  private route(events: WorldEvent[]): void {
    for (const e of events) {
      if (e.type === 'pulse') this.sfx?.ping(e.pulse.loudness);
      else if (e.type === 'footstep') this.sfx?.footstep(e.loudness);
      else if (e.type === 'reveal') this.renderer.afterimages.spawn(e.x, e.z, e.facing, e.strength, this.clockS, e.who, e.pose);
      else if (e.type === 'alerted') { this.overlays.flash(); this.sfx?.alerted(e.x, e.z); }
    }
  }
}
