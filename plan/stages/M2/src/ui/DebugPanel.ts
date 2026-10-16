import { CONFIG } from '../config';
import type { MicFrame } from '../input/audio/MicAnalyzer';
import type { FaceFrame } from '../input/face/FaceTracker';
import type { PlayerIntent } from '../input/intent';

/** Everything the panel can show. Every section is optional; a missing section shows '–'. */
export interface DebugSnapshot {
  nowMs: number;
  renderFps: number;
  face?: {
    /** Latest face frame (kept between camera frames). */
    frame: FaceFrame | null;
    faceFps: number;
    delegate: string;
    blinkClose: number;
    blinkOpen: number;
    eyesClosed: boolean;
    blinkCount: number;
    relYawLeftDeg: number;
    lean: number;
  };
  mic?: {
    frame: MicFrame;
    sampleRate: number;
    onsetMinAboveDb: number;
    humMinAboveDb: number;
    gated: boolean;
  };
  intent?: PlayerIntent;
  game?: {
    status: string;
    danger: number;
    monsters: Array<{ id: number; state: string; distance: number; moving: boolean }>;
  };
}

const CHART_SAMPLES = 240;
/** Face mesh indices drawn brighter: eye contours (MediaPipe 478-point topology). */
const EYE_IDX = [33, 160, 158, 133, 153, 144, 362, 385, 387, 263, 373, 380];

/**
 * The "pipeline" panel judges look at: raw sensor -> processed signal -> mapped intent -> game.
 * Toggle with the backtick key (`). Development keyboard use is allowed for this panel.
 */
export class DebugPanel {
  private readonly el: HTMLElement;
  private readonly cam: HTMLCanvasElement;
  private readonly chart: HTMLCanvasElement;
  private readonly text: Record<string, HTMLElement> = {};
  private readonly logEl: HTMLElement;
  private readonly logLines: string[] = [];
  private readonly levels = new Float32Array(CHART_SAMPLES).fill(-120);
  private readonly floors = new Float32Array(CHART_SAMPLES).fill(-120);
  private readonly marks = new Uint8Array(CHART_SAMPLES);
  private chartIdx = 0;
  private lastTextMs = 0;
  private visible: boolean;

  private video: HTMLVideoElement | null = null;

  constructor(root: HTMLElement, visible: boolean) {
    this.visible = visible;
    this.el = document.createElement('aside');
    this.el.className = 'debug-panel';
    this.el.innerHTML = `
      <h3>① CAMERA → FACE</h3>
      <canvas class="dbg-cam" width="240" height="180"></canvas>
      <div data-k="face"></div>
      <div class="dbg-bar"><span>blink</span><div class="track"><i data-k="blinkFill"></i><b data-k="blinkClose"></b><b data-k="blinkOpen" class="open"></b></div></div>
      <div class="dbg-bar"><span>yaw L</span><div class="track center"><i data-k="yawFill"></i></div></div>
      <div class="dbg-bar"><span>lean</span><div class="track center"><i data-k="leanFill"></i></div></div>
      <h3>② MIC → SOUND</h3>
      <canvas class="dbg-chart" width="240" height="70"></canvas>
      <div data-k="mic"></div>
      <h3>③ INTENT</h3>
      <div data-k="intent"></div>
      <h3>④ GAME</h3>
      <div data-k="game"></div>
      <h3>EVENTS</h3>
      <pre data-k="log"></pre>`;
    root.appendChild(this.el);
    this.cam = this.el.querySelector<HTMLCanvasElement>('.dbg-cam')!;
    this.chart = this.el.querySelector<HTMLCanvasElement>('.dbg-chart')!;
    this.el.querySelectorAll<HTMLElement>('[data-k]').forEach((n) => (this.text[n.dataset.k!] = n));
    this.logEl = this.text.log;
    this.applyVisibility();
    window.addEventListener('keydown', (e) => {
      if (e.code === 'Backquote') this.toggle();
    });
  }

  /** The hidden camera <video> (from Sensors) to draw as the thumbnail. */
  setVideo(video: HTMLVideoElement): void {
    this.video = video;
  }

  toggle(): void {
    this.visible = !this.visible;
    this.applyVisibility();
  }

  /** Adds a timestamped line to the event log (keeps the last 10). */
  log(nowMs: number, line: string): void {
    this.logLines.unshift(`${(nowMs / 1000).toFixed(2).padStart(7)}  ${line}`);
    this.logLines.length = Math.min(this.logLines.length, 10);
    if (this.visible) this.logEl.textContent = this.logLines.join('\n');
  }

  update(s: DebugSnapshot): void {
    if (s.mic) this.pushChart(s.mic.frame);
    if (!this.visible) return;
    if (s.face) this.drawCamera(s.face.frame);
    if (s.mic) this.drawChart(s.mic.onsetMinAboveDb, s.mic.humMinAboveDb);
    if (s.face) this.updateBars(s.face);
    if (s.nowMs - this.lastTextMs < 100) return; // text at 10 Hz is plenty
    this.lastTextMs = s.nowMs;

    const t = this.text;
    if (s.face) {
      const f = s.face;
      const pose = f.frame?.pose;
      t.face.textContent =
        `${f.frame?.present ? 'face ✓' : 'face ✗'}  ${f.faceFps.toFixed(0)} fps  ${f.frame ? f.frame.inferenceMs.toFixed(1) : '–'} ms  ${f.delegate}\n` +
        `eyes ${f.eyesClosed ? 'CLOSED' : 'open'}  blinks ${f.blinkCount}  score ${f.frame ? f.frame.blink.toFixed(2) : '–'}\n` +
        `yaw raw ${pose ? pose.yawDeg.toFixed(1) : '–'}°  rel-left ${f.relYawLeftDeg.toFixed(1)}°\n` +
        `depth ${pose ? pose.depth.toFixed(1) : '–'}  lean ${f.lean.toFixed(2)}`;
    }
    if (s.mic) {
      const m = s.mic.frame;
      t.mic.textContent =
        `level ${m.levelDb.toFixed(1)} dB  floor ${m.floorDb.toFixed(1)}\n` +
        `above floor +${m.aboveDb.toFixed(1)} dB\n` +
        `pitch ${m.pitch ? `${m.pitch.hz.toFixed(0)} Hz ap ${m.pitch.aperiodicity.toFixed(2)}` : '–'}  hum ${m.humActive ? `ON ${m.humPitchHz.toFixed(0)} Hz` : 'off'}\n` +
        `${s.mic.sampleRate} Hz  hops ${m.hopsProcessed}${s.mic.gated ? '  GATED (speaker)' : ''}`;
    }
    if (s.intent) {
      const i = s.intent;
      t.intent.textContent =
        `turn ${((i.turnRate * 180) / Math.PI).toFixed(0)}°/s  move ${i.moveSpeed.toFixed(2)} m/s\n` +
        `eyes ${i.eyesClosed ? `closed ${i.eyesClosedMs.toFixed(0)} ms` : 'open'}  face ${i.facePresent ? 'yes' : 'NO'}\n` +
        `beam ${i.beam ? `${((i.beam.halfAngleRad * 180) / Math.PI).toFixed(0)}° ${i.beam.range.toFixed(1)} m` : 'off'}`;
    }
    if (s.game) {
      const g = s.game;
      t.game.textContent =
        `${g.status}  render ${s.renderFps.toFixed(0)} fps\n` +
        `danger ${g.danger.toFixed(2)}\n` +
        g.monsters.map((m) => `#${m.id} ${m.state.padEnd(6)} ${m.distance.toFixed(1).padStart(5)} m${m.moving ? '  MOVING' : ''}`).join('\n');
    } else {
      t.game.textContent = `render ${s.renderFps.toFixed(0)} fps`;
    }
  }

  private applyVisibility(): void {
    // visibility (not display) so canvases keep their size; the <video> lives elsewhere anyway.
    this.el.style.visibility = this.visible ? 'visible' : 'hidden';
  }

  private drawCamera(frame: FaceFrame | null): void {
    const g = this.cam.getContext('2d')!;
    const w = this.cam.width;
    const h = this.cam.height;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    if (this.video && this.video.readyState >= 2) {
      g.save();
      g.scale(-1, 1); // mirror, like a selfie view
      g.drawImage(this.video, -w, 0, w, h);
      g.restore();
    }
    const lm = frame?.landmarks;
    if (!lm) return;
    g.fillStyle = 'rgba(79,216,255,0.7)';
    for (const p of lm) g.fillRect((1 - p.x) * w, p.y * h, 1, 1);
    g.fillStyle = '#ffc94a';
    for (const i of EYE_IDX) {
      const p = lm[i];
      if (p) g.fillRect((1 - p.x) * w - 1, p.y * h - 1, 3, 3);
    }
  }

  private updateBars(f: NonNullable<DebugSnapshot['face']>): void {
    const pct = (v: number) => `${Math.max(0, Math.min(1, v)) * 100}%`;
    this.text.blinkFill.style.width = pct(f.frame?.blink ?? 0);
    this.text.blinkFill.classList.toggle('hot', f.eyesClosed);
    this.text.blinkClose.style.left = pct(f.blinkClose);
    this.text.blinkOpen.style.left = pct(f.blinkOpen);
    centered(this.text.yawFill, f.relYawLeftDeg / (CONFIG.YAW_FULL_DEG * 1.5));
    centered(this.text.leanFill, f.lean / (CONFIG.LEAN_FWD_FULL * 1.5));
  }

  private pushChart(m: MicFrame): void {
    this.levels[this.chartIdx] = m.levelDb;
    this.floors[this.chartIdx] = m.floorDb;
    this.marks[this.chartIdx] = m.onsets.length > 0 ? 1 : m.humActive ? 2 : 0;
    this.chartIdx = (this.chartIdx + 1) % CHART_SAMPLES;
  }

  private drawChart(onsetMin: number, humMin: number): void {
    const g = this.chart.getContext('2d')!;
    const w = this.chart.width;
    const h = this.chart.height;
    const y = (db: number) => h - ((Math.max(-100, Math.min(0, db)) + 100) / 100) * h;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    const at = (i: number) => (this.chartIdx + i) % CHART_SAMPLES;
    for (let i = 0; i < CHART_SAMPLES; i++) {
      const mk = this.marks[at(i)];
      if (mk === 0) continue;
      g.fillStyle = mk === 1 ? '#ffc94a' : 'rgba(79,216,255,0.25)';
      g.fillRect((i / CHART_SAMPLES) * w, 0, mk === 1 ? 2 : 1, h);
    }
    const line = (data: Float32Array, color: string, offset = 0) => {
      g.strokeStyle = color;
      g.beginPath();
      for (let i = 0; i < CHART_SAMPLES; i++) {
        const px = (i / (CHART_SAMPLES - 1)) * w;
        const py = y(data[at(i)] + offset);
        if (i === 0) g.moveTo(px, py);
        else g.lineTo(px, py);
      }
      g.stroke();
    };
    line(this.floors, '#5d7286');
    line(this.floors, 'rgba(255,201,74,0.5)', onsetMin);
    line(this.floors, 'rgba(79,216,255,0.35)', humMin);
    line(this.levels, '#4fd8ff');
  }
}

/** Fills a centred bar: v in -1..1, negative grows left, positive grows right. */
function centered(fill: HTMLElement, v: number): void {
  const c = Math.max(-1, Math.min(1, v));
  fill.style.left = c >= 0 ? '50%' : `${50 + c * 50}%`;
  fill.style.width = `${Math.abs(c) * 50}%`;
}
