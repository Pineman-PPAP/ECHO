import { CONFIG } from '../config';
import { idleIntent, type PlayerIntent } from './intent';
import { humFromMic } from './mapping';

/**
 * DEVELOPMENT ONLY (?sim=1). Keyboard -> PlayerIntent so the game can be built and tested without
 * a camera or microphone. Never used in real play (the hackathon forbids keyboard gameplay).
 *
 *   Arrow keys / WASD  turn and walk (hold Left Shift to sneak)
 *   Space              clap (pulse, loudness 1.0)    Shift+Space  soft click (loudness 0.3)
 *   H (hold)           hum (jar)                     [ and ]      lower / raise hum pitch
 *   B (hold)           eyes closed                   F            toggle "face lost"
 */
export class SimInput {
  private readonly down = new Set<string>();
  private pendingPulses: number[] = [];
  private humPitchHz = 220;
  private faceHidden = false;
  private prevHum = false;
  private closedSinceMs: number | null = null;

  constructor(target: Window = window) {
    target.addEventListener('keydown', (e) => this.onKey(e, true));
    target.addEventListener('keyup', (e) => this.onKey(e, false));
    target.addEventListener('blur', () => this.down.clear());
  }

  get pitchHz(): number {
    return this.humPitchHz;
  }

  update(nowMs: number): PlayerIntent {
    const d = (code: string) => this.down.has(code);
    const intent = idleIntent();
    intent.facePresent = !this.faceHidden;

    const turn = (d('ArrowLeft') || d('KeyA') ? 1 : 0) - (d('ArrowRight') || d('KeyD') ? 1 : 0);
    const fwd = d('ArrowUp') || d('KeyW');
    const back = d('ArrowDown') || d('KeyS');
    if (intent.facePresent) {
      intent.turnRate = turn * ((CONFIG.MAX_TURN_RATE_DEG * Math.PI) / 180) * 0.6;
      intent.moveSpeed = fwd ? CONFIG.MAX_SPEED_FWD * (d('ShiftLeft') ? 0.35 : 1) : back ? -CONFIG.MAX_SPEED_BACK : 0;
    }

    const closed = d('KeyB') && intent.facePresent;
    if (closed) this.closedSinceMs ??= nowMs;
    else this.closedSinceMs = null;
    intent.eyesClosed = closed;
    intent.eyesClosedMs = closed && this.closedSinceMs !== null ? nowMs - this.closedSinceMs : 0;

    intent.pulses = this.pendingPulses;
    this.pendingPulses = [];

    const humming = d('KeyH');
    const humAboveDb =
      CONFIG.HUM_MIN_ABOVE_FLOOR_DB + 0.8 * (CONFIG.HUM_REF_ABOVE_DB_DEFAULT - CONFIG.HUM_MIN_ABOVE_FLOOR_DB);
    intent.hum = humming ? humFromMic(humAboveDb, this.humPitchHz, CONFIG.HUM_REF_ABOVE_DB_DEFAULT) : null;
    intent.humStarted = humming && !this.prevHum;
    this.prevHum = humming;
    return intent;
  }

  private onKey(e: KeyboardEvent, isDown: boolean): void {
    const k = e.code;
    if (isDown) {
      if (k === 'Space' && !e.repeat) this.pendingPulses.push(e.shiftKey ? 0.3 : 1);
      if (k === 'KeyF' && !e.repeat) this.faceHidden = !this.faceHidden;
      if (k === 'BracketLeft') this.humPitchHz = Math.max(90, this.humPitchHz / 1.12);
      if (k === 'BracketRight') this.humPitchHz = Math.min(700, this.humPitchHz * 1.12);
      this.down.add(k);
    } else {
      this.down.delete(k);
    }
    if (k === 'Space' || k.startsWith('Arrow')) e.preventDefault();
  }
}
