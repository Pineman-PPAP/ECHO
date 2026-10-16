import { CONFIG } from '../config';
import { blinkThresholdsFromCalibration } from './face/EyeState';
import type { FaceFrame } from './face/FaceTracker';
import type { MicFrame } from './audio/MicAnalyzer';

/** Per-player numbers measured at the start of a session. */
export interface CalibrationData {
  neutralYawDeg: number;
  /** Multiply (yaw - neutral) by this to get "positive = player's LEFT". */
  leftSign: 1 | -1;
  /** Head depth (MediaPipe units) when sitting normally. */
  neutralDepth: number;
  blinkOpenScore: number;
  blinkClosedScore: number;
  blinkClose: number;
  blinkOpen: number;
  clapRefAboveDb: number;
  humRefAboveDb: number;
  /** True if game sounds from the speakers reach the mic (then the mic is gated while sounds play). */
  speakerLeak: boolean;
  /** Human-readable problems; shown on the "Calibrated" card and in the debug panel. */
  warnings: string[];
}

export function defaultCalibration(): CalibrationData {
  return {
    neutralYawDeg: 0,
    leftSign: 1,
    neutralDepth: 50,
    blinkOpenScore: 0.1,
    blinkClosedScore: 0.8,
    blinkClose: CONFIG.BLINK_CLOSE_DEFAULT,
    blinkOpen: CONFIG.BLINK_OPEN_DEFAULT,
    clapRefAboveDb: CONFIG.CLAP_REF_ABOVE_DB_DEFAULT,
    humRefAboveDb: CONFIG.HUM_REF_ABOVE_DB_DEFAULT,
    speakerLeak: false,
    warnings: [],
  };
}

export type CalibStepId = 'face' | 'quiet' | 'neutral' | 'left' | 'eyes' | 'clap' | 'hum' | 'speakers' | 'done';

/** Sounds the App must play when the runner asks (the player may have their eyes closed). */
export type CalibCue = 'beep' | 'doubleBeep' | 'testTone' | 'tick';

export interface CalibView {
  step: CalibStepId;
  /** 1-based step number and total, for "Step 3 / 8". */
  index: number;
  total: number;
  title: string;
  prompt: string;
  /** 0..1 progress of the current step. */
  progress: number;
}

export interface CalibUpdate {
  view: CalibView;
  cues: CalibCue[];
  finished: boolean;
}

const ORDER: CalibStepId[] = ['face', 'quiet', 'neutral', 'left', 'eyes', 'clap', 'hum', 'speakers', 'done'];

const TEXT: Record<CalibStepId, { title: string; prompt: string }> = {
  face: { title: 'Find your face', prompt: 'Sit about an arm’s length from the screen and look at it.' },
  quiet: { title: 'Listening to the room', prompt: 'Stay quiet for two seconds…' },
  neutral: { title: 'Rest position', prompt: 'Look at the centre of the screen and relax.' },
  left: { title: 'Turn', prompt: 'Slowly turn your head to your LEFT and hold it there.' },
  eyes: { title: 'Eyes', prompt: 'At the beep, CLOSE your eyes. Open them at the double beep.' },
  clap: { title: 'Clap', prompt: 'Clap your hands twice.' },
  hum: { title: 'Hum', prompt: 'Hum one steady note — “mmmmm” — for two seconds.' },
  speakers: { title: 'Speaker check', prompt: 'Stay quiet — testing whether the speakers reach the mic…' },
  done: { title: 'Calibrated', prompt: 'You are ready.' },
};

/** Step durations / timeouts in ms. */
const T = {
  faceHold: 1000,
  quiet: 2000,
  neutral: 1500,
  neutralCollectFrom: 500,
  left: 2200,
  leftCollectFrom: 1200,
  eyes: 2400,
  eyesCollectFrom: 900,
  eyesCollectTo: 2100,
  clapTimeout: 6000,
  clapGrace: 300,
  humTarget: 1500,
  humTimeout: 7000,
  speakers: 1400,
  toneAt: 400,
  toneMeasureFrom: 450,
  toneMeasureTo: 1150,
  done: 1800,
};

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(xs: number[], p: number): number {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(p * (s.length - 1))))];
}

/**
 * Hands-free calibration. Pure logic: feed it the latest face/mic frames every animation frame;
 * it returns what to show, which cue sounds to play, and when it is finished.
 * Total time ~15 s when the player follows the prompts.
 */
export class CalibrationRunner {
  readonly data: CalibrationData = defaultCalibration();
  private stepIdx = 0;
  private stepStartMs: number;
  private lastNowMs: number;
  private faceSinceMs: number | null = null;
  private yaws: number[] = [];
  private depths: number[] = [];
  private blinks: number[] = [];
  private retriedNeutral = false;
  private retriedLeft = false;
  private leftHint = '';
  private onsetPeaks: number[] = [];
  private secondClapAtMs: number | null = null;
  private humMs = 0;
  private humLevels: number[] = [];
  private baseline: number[] = [];
  private toneMax = -Infinity;
  private toneCued = false;
  private pendingCues: CalibCue[] = [];

  constructor(startMs: number) {
    this.stepStartMs = startMs;
    this.lastNowMs = startMs;
  }

  get step(): CalibStepId {
    return ORDER[this.stepIdx];
  }

  update(nowMs: number, face: FaceFrame | null, mic: MicFrame | null): CalibUpdate {
    const dt = Math.max(0, nowMs - this.lastNowMs);
    this.lastNowMs = nowMs;
    const elapsed = nowMs - this.stepStartMs;
    const hasPose = !!face && face.present && face.pose !== null;
    let progress = 0;
    let finished = false;

    switch (this.step) {
      case 'face': {
        if (face) this.faceSinceMs = hasPose ? (this.faceSinceMs ?? nowMs) : null;
        const held = this.faceSinceMs === null ? 0 : nowMs - this.faceSinceMs;
        progress = Math.min(held / T.faceHold, 1);
        if (held >= T.faceHold) this.next(nowMs);
        break;
      }
      case 'quiet': {
        progress = Math.min(elapsed / T.quiet, 1);
        if (elapsed >= T.quiet) this.next(nowMs);
        break;
      }
      case 'neutral': {
        progress = Math.min(elapsed / T.neutral, 1);
        if (hasPose && elapsed >= T.neutralCollectFrom) {
          this.yaws.push(face!.pose!.yawDeg);
          this.depths.push(face!.pose!.depth);
          this.blinks.push(face!.blink);
        }
        if (elapsed >= T.neutral) {
          if (this.yaws.length >= 5) {
            this.data.neutralYawDeg = median(this.yaws);
            this.data.neutralDepth = median(this.depths);
            this.data.blinkOpenScore = median(this.blinks);
            this.next(nowMs);
          } else if (!this.retriedNeutral) {
            this.retriedNeutral = true;
            this.restart(nowMs);
          } else {
            this.data.warnings.push('Could not see your face clearly; using default head position.');
            this.next(nowMs);
          }
        }
        break;
      }
      case 'left': {
        progress = Math.min(elapsed / T.left, 1);
        if (hasPose && elapsed >= T.leftCollectFrom) this.yaws.push(face!.pose!.yawDeg);
        if (elapsed >= T.left) {
          const delta = this.yaws.length >= 5 ? median(this.yaws) - this.data.neutralYawDeg : 0;
          if (Math.abs(delta) >= CONFIG.CALIB_MIN_YAW_DELTA_DEG) {
            this.data.leftSign = delta > 0 ? 1 : -1;
            this.next(nowMs);
          } else if (!this.retriedLeft) {
            this.retriedLeft = true;
            this.leftHint = 'A bit further — turn your head LEFT and hold.';
            this.restart(nowMs);
          } else {
            this.data.warnings.push('Head turn was too small to measure; turning direction may be inverted.');
            this.next(nowMs);
          }
        }
        break;
      }
      case 'eyes': {
        progress = Math.min(elapsed / T.eyes, 1);
        if (hasPose && elapsed >= T.eyesCollectFrom && elapsed <= T.eyesCollectTo) this.blinks.push(face!.blink);
        if (elapsed >= T.eyes) {
          this.pendingCues.push('doubleBeep');
          const closed = this.blinks.length >= 5 ? median(this.blinks) : NaN;
          const th = Number.isNaN(closed)
            ? null
            : blinkThresholdsFromCalibration(
                this.data.blinkOpenScore,
                closed,
                CONFIG.BLINK_CLOSE_FRACTION,
                CONFIG.BLINK_OPEN_FRACTION,
                CONFIG.BLINK_MIN_CALIBRATED_RANGE,
              );
          if (th) {
            this.data.blinkClosedScore = closed;
            this.data.blinkClose = th.close;
            this.data.blinkOpen = th.open;
          } else {
            this.data.warnings.push('Could not measure closed eyes; using default blink thresholds.');
          }
          this.next(nowMs);
        }
        break;
      }
      case 'clap': {
        if (mic) for (const o of mic.onsets) this.onsetPeaks.push(o.peakAboveDb);
        if (this.onsetPeaks.length >= 2 && this.secondClapAtMs === null) this.secondClapAtMs = nowMs;
        progress = Math.min(this.onsetPeaks.length / 2, 1);
        const done = this.secondClapAtMs !== null && nowMs - this.secondClapAtMs >= T.clapGrace;
        if (done || elapsed >= T.clapTimeout) {
          if (this.onsetPeaks.length > 0) {
            this.data.clapRefAboveDb = Math.min(Math.max(median(this.onsetPeaks), CONFIG.ONSET_MIN_ABOVE_FLOOR_DB + 8), 60);
          } else {
            this.data.warnings.push('Did not hear a clap; using default clap loudness.');
          }
          this.next(nowMs);
        }
        break;
      }
      case 'hum': {
        if (mic?.humActive) {
          this.humMs += dt;
          this.humLevels.push(mic.aboveDb);
        }
        progress = Math.min(this.humMs / T.humTarget, 1);
        if (this.humMs >= T.humTarget || elapsed >= T.humTimeout) {
          if (this.humLevels.length >= 10) {
            this.data.humRefAboveDb = Math.min(
              Math.max(percentile(this.humLevels, 0.8), CONFIG.HUM_MIN_ABOVE_FLOOR_DB + 6),
              60,
            );
          } else {
            this.data.warnings.push('Did not hear a steady hum; using default hum loudness.');
          }
          this.next(nowMs);
        }
        break;
      }
      case 'speakers': {
        progress = Math.min(elapsed / T.speakers, 1);
        if (mic && elapsed < T.toneAt) this.baseline.push(mic.levelDb);
        if (!this.toneCued && elapsed >= T.toneAt) {
          this.toneCued = true;
          this.pendingCues.push('testTone');
        }
        if (mic && elapsed >= T.toneMeasureFrom && elapsed <= T.toneMeasureTo) this.toneMax = Math.max(this.toneMax, mic.levelDb);
        if (elapsed >= T.speakers) {
          const base = this.baseline.length > 0 ? median(this.baseline) : -120;
          this.data.speakerLeak = this.toneMax - base > CONFIG.SPEAKER_LEAK_RISE_DB;
          if (this.data.speakerLeak) this.data.warnings.push('Speakers reach the mic: wear headphones for the best experience.');
          this.next(nowMs);
        }
        break;
      }
      case 'done': {
        progress = Math.min(elapsed / T.done, 1);
        finished = elapsed >= T.done;
        break;
      }
    }

    const cues = this.pendingCues;
    this.pendingCues = [];
    const text = TEXT[this.step];
    const prompt =
      this.step === 'left' && this.leftHint
        ? this.leftHint
        : this.step === 'done' && this.data.warnings.length > 0
          ? `Ready, with notes: ${this.data.warnings.join(' ')}`
          : text.prompt;
    return {
      view: { step: this.step, index: this.stepIdx + 1, total: ORDER.length, title: text.title, prompt, progress },
      cues,
      finished,
    };
  }

  private next(nowMs: number): void {
    this.stepIdx = Math.min(this.stepIdx + 1, ORDER.length - 1);
    this.restart(nowMs);
    if (this.step === 'eyes') this.pendingCues.push('beep');
    else if (this.pendingCues.length === 0) this.pendingCues.push('tick');
  }

  private restart(nowMs: number): void {
    this.stepStartMs = nowMs;
    this.yaws = [];
    this.depths = [];
    this.blinks = [];
  }
}
