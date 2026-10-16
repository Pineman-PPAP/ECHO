import type { ManualFrame } from '../app/FieldManual';
import { CONFIG } from '../config';
import type { FaceFrame } from '../input/face/FaceTracker';
import type { PlayerIntent } from '../input/intent';
import { MANUAL_ICONS } from './icons';

/** What the game perceives right now, for the live meters (App fills it from IntentBuilder / the mic, or SimInput). */
export interface ManualGauges {
  /** Head turn: +1 = turned fully to the player's LEFT (YAW_FULL_DEG), -1 = fully right. */
  turn: number;
  /** Lean: +1 = leaning in fully (LEAN_FWD_FULL), -1 = leaning back fully (LEAN_BACK_FULL). */
  lean: number;
  /** Mic level 0..1 relative to the player's calibrated clap (0 in sim). */
  sound: number;
  /** Where a sound starts counting as a clap on that scale (null in sim). */
  soundThreshold: number | null;
  /** Hum pitch while humming, else null. */
  humHz: number | null;
  /** 0..1.3 hum loudness relative to the calibrated hum. */
  humLevel: number;
}

const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX'];

const RECAP: ReadonlyArray<{ key: 'turn' | 'lean' | 'clap' | 'hum'; title: string; text: string }> = [
  { key: 'turn', title: 'Turn your head', text: 'look around' },
  { key: 'lean', title: 'Lean in · out', text: 'forward · neutral stops · backward' },
  { key: 'clap', title: 'Clap', text: 'see the cave, and be heard' },
  { key: 'hum', title: 'Hum', text: 'firefly light, heard up close' },
];

/** Thin-line gesture guides drawn over the webcam picture (320×240, mirrored like a mirror: your left is on the left). */
const GESTURES = `
<svg class="mn-gesture" viewBox="0 0 320 240" aria-hidden="true" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">
  <g data-g="turnLeft"><path class="g-arc" d="M224 62 Q160 22 96 62"/><path d="M96 62 l15 -1 M96 62 l6 13"/><text x="40" y="66">LEFT</text></g>
  <g data-g="turnRight"><path class="g-arc" d="M96 62 Q160 22 224 62"/><path d="M224 62 l-15 -1 M224 62 l-6 13"/><text x="236" y="66">RIGHT</text></g>
  <g data-g="leanIn"><rect class="g-grow" x="104" y="46" width="112" height="140" rx="44"/><text x="128" y="226">CLOSER</text></g>
  <g data-g="leanBack"><rect class="g-shrink" x="104" y="46" width="112" height="140" rx="44"/><text x="138" y="226">BACK</text></g>
  <g data-g="clap"><g class="g-hand g-hand-l"><rect x="116" y="150" width="24" height="52" rx="11"/></g><g class="g-hand g-hand-r"><rect x="180" y="150" width="24" height="52" rx="11"/></g>
    <circle class="g-ripple" cx="160" cy="176" r="14"/><circle class="g-ripple g-late" cx="160" cy="176" r="14"/><text x="140" y="226">CLAP</text></g>
  <g data-g="clickClap"><circle class="g-ripple g-soft" cx="110" cy="176" r="10"/><circle class="g-ripple g-loud" cx="210" cy="176" r="16"/>
    <text x="90" y="226">soft</text><text x="186" y="226">LOUD</text></g>
  <g data-g="hum"><path class="g-wave" d="M178 160 q12 12 0 24"/><path class="g-wave g-w2" d="M188 152 q20 20 0 40"/><path class="g-wave g-w3" d="M198 144 q28 28 0 56"/>
    <path class="g-wave" d="M142 160 q-12 12 0 24"/><path class="g-wave g-w2" d="M132 152 q-20 20 0 40"/><path class="g-wave g-w3" d="M122 144 q-28 28 0 56"/><text x="136" y="226">mmmm</text></g>
  <g data-g="quiet"><path class="g-fade" d="M178 160 q12 12 0 24 M142 160 q-12 12 0 24"/><text x="140" y="226">quiet</text></g>
  <g data-g="freeze"><path class="g-lock" d="M96 40 h-20 v20 M224 40 h20 v20 M244 180 v20 h-20 M76 180 v20 h20"/><text x="118" y="226">HOLD STILL</text></g>
  <g data-g="sound"><circle class="g-ripple" cx="160" cy="176" r="14"/><path class="g-wave" d="M188 152 q20 20 0 40"/><path class="g-wave" d="M132 152 q-20 20 0 40"/><text x="112" y="226">clap · or · hum</text></g>
</svg>`;

/**
 * The Field Manual's screen: letterbox bars, chapter titles and narration, the instruction in the lower
 * bar (with its hint and progress), a picture-in-picture of the player's own webcam with the real-life
 * motion drawn over it and live meters of what the game perceives, a hands-free skip indicator, the
 * "I can't see you" notice and the recap card. Plain DOM; text only changes when it changes.
 */
export class ManualOverlay {
  private readonly el: HTMLElement;
  private readonly q: Record<string, HTMLElement> = {};
  private readonly cam: HTMLCanvasElement;
  private readonly gesture: SVGElement;
  private readonly meters: Record<string, { row: HTMLElement; fill: HTMLElement; peak?: HTMLElement; value?: HTMLElement }> = {};
  private readonly tiles: Record<string, HTMLElement> = {};
  /** Where a sound starts to count as a clap (real sensors only). */
  private readonly soundThreshold: HTMLElement;
  private video: HTMLVideoElement | null = null;
  private key = '';
  private pulseFlash = 0;
  private pulsePeak = 0;
  private pulseTag = '';
  private pulseAtMs = -Infinity;
  private readonly litAtMs: Record<string, number> = { turn: -Infinity, lean: -Infinity, clap: -Infinity, hum: -Infinity };

  constructor(root: HTMLElement, private readonly sim: boolean) {
    this.el = document.createElement('div');
    this.el.className = 'manual';
    this.el.hidden = true;
    const meter = (m: string, label: string, center: boolean) =>
      `<div class="mm" data-m="${m}"><span class="mm-label">${label}</span><div class="mm-track${center ? ' mid' : ''}"><i></i>${m === 'sound' ? '<b class="mm-peak" hidden></b>' : ''}</div><span class="mm-value"></span></div>`;
    this.el.innerHTML = `
      <div class="mn-tint"></div>
      <div class="mn-bar mn-top"><span class="mn-kicker" data-q="kicker"></span><span class="mn-skip" data-q="skip"><span data-q="skipText"></span><i><b data-q="skipFill"></b></i></span></div>
      <div class="mn-bar mn-bottom">
        <p class="mn-instr" data-q="instr"></p>
        <p class="mn-hint" data-q="hint"></p>
        <div class="mn-progress" data-q="progress"><i data-q="progressFill"></i></div>
      </div>
      <div class="mn-title" data-q="titleBox"><p class="mn-chapter" data-q="chapter"></p><h2 data-q="title"></h2><div class="mn-lines" data-q="lines"></div></div>
      <div class="mn-done" data-q="doneBox"><span class="mn-check" data-q="check">✓</span><p data-q="done"></p></div>
      <aside class="mn-pip" data-q="pip">
        <div class="mn-cam"><canvas width="320" height="240"></canvas>${GESTURES}<span class="mn-cam-label" data-q="camLabel"></span></div>
        <div class="mn-meters">
          ${meter('turn', 'TURN', true)}${meter('lean', 'LEAN', true)}${meter('sound', 'SOUND', false)}${meter('hum', 'HUM', false)}${meter('still', 'STILL', false)}
        </div>
      </aside>
      <div class="mn-lost" data-q="lost"><b>I can’t see you</b><span>Come back in front of the camera. Everything waits for you.</span></div>
      <section class="mn-end" data-q="end">
        <p class="mn-chapter">ECHO</p>
        <h2>Find the way out</h2>
        <div class="mn-tiles" hidden>${RECAP.map((r) => `<div class="mn-tile" data-t="${r.key}"><span class="mn-icon">${MANUAL_ICONS[r.key]}</span><b>${r.title}</b><span>${r.text}</span></div>`).join('')}</div>
        <div class="mn-rules" hidden>
          <p><span class="mn-icon">${MANUAL_ICONS.freeze}</span>When it stares: freeze. No movement, no sound.</p>
          <p><span class="mn-icon">${MANUAL_ICONS.hush}</span>Silent too long, and the Hush comes. Make a sound.</p>
        </div>
        <p class="mn-go">Find the way out. Follow the red arrows on the walls.</p>
        <p class="mn-end-hint" data-q="endHint"></p>
      </section>
      <div class="mn-fade" data-q="fade"></div>`;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>('[data-q]').forEach((n) => (this.q[n.dataset.q!] = n));
    this.cam = this.el.querySelector('.mn-cam canvas')!;
    this.gesture = this.el.querySelector('.mn-gesture')!;
    this.el.querySelectorAll<HTMLElement>('.mm').forEach((row) => {
      this.meters[row.dataset.m!] = {
        row,
        fill: row.querySelector('i')!,
        peak: row.querySelector<HTMLElement>('.mm-peak') ?? undefined,
        value: row.querySelector<HTMLElement>('.mm-value') ?? undefined,
      };
    });
    this.el.querySelectorAll<HTMLElement>('.mn-tile').forEach((t) => (this.tiles[t.dataset.t!] = t));
    this.markThresholds();
    this.soundThreshold = document.createElement('u');
    this.meters.sound.row.querySelector('.mm-track')!.appendChild(this.soundThreshold);
    this.q.camLabel.textContent = sim ? 'DEV SIM · NO CAMERA' : 'YOU · LIVE';
    this.q.skipText.textContent = sim ? 'DOUBLE SPACE TO SKIP' : 'DOUBLE CLAP TO SKIP';
    this.q.endHint.textContent = 'Entering the cave…';
  }

  setVideo(video: HTMLVideoElement): void {
    this.video = video;
  }

  show(on: boolean): void {
    this.el.hidden = !on;
    if (!on) this.key = '';
  }

  update(f: ManualFrame, gauges: ManualGauges, intent: PlayerIntent, face: FaceFrame | null, nowMs: number): void {
    if (this.el.hidden) return;
    const el = this.el;
    const atEnd = f.phase === 'end' || f.phase === 'done';
    const waiting = f.phase === 'await' || f.phase === 'stepOk';
    const step = f.step;

    // ---- every frame: fades, meters, the webcam picture
    this.q.fade.style.opacity = String(f.fade);
    if (step) this.q.progressFill.style.width = `${step.progress * 100}%`;
    this.q.skipFill.style.width = `${Math.min(f.skip.progress, 1) * 100}%`;
    this.trackPulses(intent, nowMs);
    this.updateMeters(gauges, f, nowMs);
    if (!atEnd && !f.paused) this.drawCamera(face, gauges);
    if (atEnd) this.updateTiles(gauges, intent, nowMs);

    // ---- only when something changes
    const lineCount = f.phase === 'setup' ? Math.min(f.lines.length, 1 + Math.floor(f.phaseMs / CONFIG.MANUAL_LINE_MS)) : f.lines.length;
    const key = JSON.stringify([
      f.phase,
      f.beat,
      step?.id,
      step?.text,
      step?.hint,
      f.done,
      f.paused,
      f.slow,
      f.letterbox,
      f.skip.shown,
      lineCount,
      waiting,
    ]);
    if (key === this.key) return;
    this.key = key;
    el.dataset.phase = f.phase;
    el.dataset.bars = f.letterbox ? '1' : '0';
    el.dataset.slow = f.slow ? '1' : '0';
    el.dataset.lost = f.paused ? '1' : '0';
    el.dataset.beat = f.beat ?? 'end';
    this.q.kicker.textContent = atEnd ? '' : f.chapter === 0 ? 'Field Manual' : `Field Manual · ${ROMAN[f.chapter]} of ${ROMAN[f.chapterCount]}`;
    this.q.chapter.textContent = f.chapter === 0 ? 'ECHO · Field Manual' : `Chapter ${ROMAN[f.chapter] ?? ''}`;
    this.q.title.textContent = f.title;
    this.q.lines.replaceChildren(
      ...f.lines.slice(0, lineCount).map((t) => {
        const p = document.createElement('p');
        p.textContent = t;
        return p;
      }),
    );
    this.q.titleBox.hidden = f.phase !== 'setup' && f.phase !== 'cut';
    this.q.instr.textContent = waiting && step ? step.text : '';
    this.q.instr.dataset.auto = step?.auto ? '1' : '0';
    this.q.hint.textContent = f.phase === 'await' && step ? step.hint : '';
    this.q.progress.hidden = !(waiting && step && !step.auto);
    this.q.doneBox.hidden = !(f.phase === 'confirm' || f.phase === 'stepOk');
    this.q.check.dataset.tone = f.phase === 'confirm' && f.timedOut ? 'skip' : 'ok';
    this.q.check.textContent = f.phase === 'confirm' && f.timedOut ? '›' : '✓';
    this.q.done.textContent = f.phase === 'confirm' ? f.done : '';
    this.q.pip.hidden = !(waiting && step && !step.auto);
    this.gesture.dataset.g = step?.gesture ?? 'none';
    for (const [m, r] of Object.entries(this.meters)) {
      r.row.dataset.on = step?.meter === m ? '1' : '0';
      r.row.hidden = m === 'still' ? step?.meter !== 'still' : step?.meter === 'still';
    }
    this.q.skip.hidden = !f.skip.shown;
    this.q.lost.hidden = !f.paused;
    this.q.end.hidden = !atEnd;
  }

  // ------------------------------------------------------------------ live feedback

  private trackPulses(intent: PlayerIntent, nowMs: number): void {
    if (intent.pulses.length > 0) {
      const loud = Math.max(...intent.pulses);
      // Pulse loudness runs 0..1.5 (1 = the player's calibrated clap), see mapping.onsetLoudness.
      this.pulseFlash = Math.min(loud / CONFIG.MANUAL_METER_LOUDNESS_MAX, 1);
      this.pulsePeak = this.pulseFlash;
      this.pulseAtMs = nowMs;
      this.pulseTag = loud >= CONFIG.MANUAL_LOUD_MIN ? 'LOUD' : loud < CONFIG.MANUAL_SOFT_MAX ? 'soft' : 'clap';
    }
    this.pulseFlash *= CONFIG.MANUAL_METER_FLASH_DECAY;
  }

  private updateMeters(g: ManualGauges, f: ManualFrame, nowMs: number): void {
    const center = (r: { fill: HTMLElement }, v: number, leftIsPositive: boolean) => {
      const x = Math.max(-1, Math.min(1, v)) * (leftIsPositive ? -1 : 1);
      r.fill.style.left = `${50 + Math.min(x, 0) * 50}%`;
      r.fill.style.width = `${Math.abs(x) * 50}%`;
    };
    // The picture is mirrored, so the player's LEFT is on the left of the turn meter.
    center(this.meters.turn, g.turn, true);
    center(this.meters.lean, g.lean, false);
    const sound = this.meters.sound;
    sound.fill.style.width = `${Math.min(Math.max(g.sound, this.pulseFlash), 1) * 100}%`;
    const recent = nowMs - this.pulseAtMs < CONFIG.MANUAL_SOUND_TAG_MS;
    sound.peak!.style.left = `${this.pulsePeak * 100}%`;
    sound.peak!.hidden = !recent;
    sound.value!.textContent = recent ? this.pulseTag : '';
    this.soundThreshold.hidden = g.soundThreshold === null;
    if (g.soundThreshold !== null) this.soundThreshold.style.left = `${Math.min(Math.max(g.soundThreshold, 0), 1) * 100}%`;
    const hum = this.meters.hum;
    hum.fill.style.width = `${Math.min(g.humLevel / CONFIG.MANUAL_METER_HUM_MAX, 1) * 100}%`; // humFromMic's level runs 0..1.3
    hum.value!.textContent = g.humHz ? `${Math.round(g.humHz)} Hz` : '';
    const still = this.meters.still;
    still.fill.style.width = `${(f.step?.meter === 'still' ? f.step.progress : 0) * 100}%`;
    this.meters.turn.value!.textContent = Math.abs(g.turn) * CONFIG.YAW_FULL_DEG > CONFIG.YAW_DEADZONE_DEG ? (g.turn > 0 ? 'LEFT' : 'RIGHT') : '';
    this.meters.lean.value!.textContent = g.lean > CONFIG.LEAN_FWD_DEADZONE / CONFIG.LEAN_FWD_FULL ? 'WALK' : g.lean < -CONFIG.LEAN_BACK_DEADZONE / CONFIG.LEAN_BACK_FULL ? 'BACK' : '';
  }

  /** Tick marks where each input starts to count (the dead zones, the clap threshold). */
  private markThresholds(): void {
    const mark = (m: string, positions: number[]) => {
      const track = this.meters[m].row.querySelector('.mm-track')!;
      for (const p of positions) {
        const b = document.createElement('u');
        b.style.left = `${p * 100}%`;
        track.appendChild(b);
      }
    };
    const yawDz = CONFIG.YAW_DEADZONE_DEG / CONFIG.YAW_FULL_DEG;
    mark('turn', [0.5 - yawDz / 2, 0.5 + yawDz / 2]);
    mark('lean', [0.5 - CONFIG.LEAN_BACK_DEADZONE / CONFIG.LEAN_BACK_FULL / 2, 0.5 + CONFIG.LEAN_FWD_DEADZONE / CONFIG.LEAN_FWD_FULL / 2]);
  }

  private updateTiles(g: ManualGauges, intent: PlayerIntent, nowMs: number): void {
    const did = {
      turn: Math.abs(g.turn) * CONFIG.YAW_FULL_DEG > CONFIG.YAW_DEADZONE_DEG || intent.turnRate !== 0,
      lean: intent.moveSpeed !== 0,
      clap: intent.pulses.length > 0,
      hum: intent.hum !== null,
    };
    for (const k of Object.keys(did) as Array<keyof typeof did>) {
      if (did[k]) this.litAtMs[k] = nowMs;
      this.tiles[k].dataset.lit = nowMs - this.litAtMs[k] < CONFIG.MANUAL_ICON_LIT_MS ? '1' : '0';
    }
  }

  /** The player's own webcam (mirrored, like a mirror), with the face box the tracker sees. In sim: a stand-in head that follows the keys. */
  private drawCamera(face: FaceFrame | null, g: ManualGauges): void {
    if (this.q.pip.hidden) return;
    const c = this.cam.getContext('2d')!;
    const w = this.cam.width;
    const h = this.cam.height;
    c.fillStyle = '#050505';
    c.fillRect(0, 0, w, h);
    if (this.video && this.video.readyState >= 2) {
      c.save();
      c.scale(-1, 1);
      c.drawImage(this.video, -w, 0, w, h);
      c.restore();
      const lm = face?.landmarks;
      if (lm && lm.length > 0) {
        let x0 = 1;
        let y0 = 1;
        let x1 = 0;
        let y1 = 0;
        for (const p of lm) {
          x0 = Math.min(x0, p.x);
          y0 = Math.min(y0, p.y);
          x1 = Math.max(x1, p.x);
          y1 = Math.max(y1, p.y);
        }
        c.strokeStyle = 'rgba(217, 214, 204, 0.55)';
        c.lineWidth = 2;
        c.strokeRect((1 - x1) * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
      }
      return;
    }
    if (!this.sim) {
      c.fillStyle = '#d9d6cc';
      c.font = '16px sans-serif';
      c.fillText('Waiting for camera…', 60, h / 2);
      return;
    }
    // Sim stand-in: a head outline that turns with the turn keys and grows as you "lean in".
    const s = 1 + 0.16 * Math.max(-1, Math.min(1, g.lean));
    const turn = Math.max(-1, Math.min(1, g.turn));
    const cx = w / 2 - turn * 18;
    const cy = h * 0.47;
    c.strokeStyle = 'rgba(217, 214, 204, 0.5)';
    c.lineWidth = 2;
    c.beginPath();
    c.ellipse(cx, cy, 44 * s * (1 - 0.18 * Math.abs(turn)), 56 * s, 0, 0, Math.PI * 2);
    c.stroke();
    c.beginPath();
    c.moveTo(cx - turn * 30 * s, cy - 4 * s);
    c.lineTo(cx - turn * 38 * s, cy + 12 * s);
    c.stroke();
    c.beginPath();
    c.moveTo(cx - 70 * s, h);
    c.quadraticCurveTo(cx, cy + 70 * s, cx + 70 * s, h);
    c.stroke();
  }
}
