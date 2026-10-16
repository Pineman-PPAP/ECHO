import { CONFIG } from '../config';
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


export type CalibStepId = 'face' | 'quiet' | 'neutral' | 'left' | 'clap' | 'hum' | 'speakers' | 'done';

/**
 * Each step runs in three phases so a first-time player (and anyone watching) can follow it:
 * 'intro' (what to do and why, with a countdown; nothing is measured), 'measure' (do it, with a live
 * reading) and 'result' (what was measured). 'face' starts straight in 'measure' (it just waits for
 * a face); 'done' is one 'measure' phase showing the controls summary.
 */
export type CalibPhase = 'intro' | 'measure' | 'result';

/** Sounds the App must play when the runner asks. */
export type CalibCue = 'testTone' | 'tick' | 'ok';

export interface CalibView {
  step: CalibStepId;
  phase: CalibPhase;
  /** 1-based step number and the number of steps, for "Step 3 of 8" (the final 'done' screen isn't counted). */
  index: number;
  total: number;
  title: string;
  /** What to do. */
  prompt: string;
  /** Why the game needs it: what this input does in the cave. */
  why: string;
  /** Countdown (intro), live reading (measure) or what was measured (result). */
  status: string;
  statusTone: 'live' | 'ok' | 'warn';
  /** 0..1: the countdown during the intro, the step's progress while measuring, 1 on the result. */
  progress: number;
}

export interface CalibUpdate {
  view: CalibView;
  cues: CalibCue[];
  finished: boolean;
}

const ORDER: CalibStepId[] = ['face', 'quiet', 'neutral', 'left', 'clap', 'hum', 'speakers', 'done'];

/** Every input and what it does (the last calibration screen and the title screen). */
export const CONTROLS: ReadonlyArray<readonly [input: string, effect: string]> = [
  ['Turn your head', 'look around'],
  ['Lean in · lean back', 'walk · step back (lean gently to sneak)'],
  ['Clap', 'lights up the cave, and they hear it'],
  ['Hum', 'wakes the fireflies in your jar: light all around you, heard only up close'],
];

const TEXT: Record<CalibStepId, { title: string; prompt: string; why: string }> = {
  face: {
    title: 'Find your face',
    prompt: 'Sit about an arm’s length from the screen and look at it.',
    why: 'The camera watches your head. Nothing is recorded or sent anywhere.',
  },
  quiet: {
    title: 'Room noise',
    prompt: 'Stay quiet for two seconds.',
    why: 'This measures how loud your room is, so your claps stand out from the background.',
  },
  neutral: {
    title: 'Rest position',
    prompt: 'Look at the middle of the screen and relax.',
    why: 'This is “standing still”. Lean in to walk, lean back to step back.',
  },
  left: {
    title: 'Turn',
    prompt: 'Slowly turn your head to your LEFT and hold it there.',
    why: 'Your head steers. This tells the game which way is left on your camera.',
  },
  clap: {
    title: 'Clap',
    prompt: 'Clap your hands twice.',
    why: 'In the cave a clap is your sonar: its echo lights up the rock around you. Everything down there hears it too.',
  },
  hum: {
    title: 'Hum',
    prompt: 'Hum one steady note, “mmmmm”, for two seconds.',
    why: 'Humming wakes the fireflies in the jar in your hand: they light the rock around you. It is quiet: only something right next to you hears it.',
  },
  speakers: {
    title: 'Headphone check',
    prompt: 'Stay quiet. A short test tone will play.',
    why: 'Game sounds must not leak into the microphone. Keep your headphones on.',
  },
  done: { title: 'You’re ready', prompt: '', why: '' },
};

/** Measuring durations / timeouts in ms (phase lengths are in CONFIG.CALIB_*). */
const T = {
  faceHold: 1000,
  quiet: 2000,
  neutral: 1500,
  neutralCollectFrom: 500,
  left: 2200,
  leftCollectFrom: 1200,
  clapTimeout: 6000,
  clapGrace: 300,
  humTarget: 1500,
  humTimeout: 7000,
  speakers: 1400,
  toneAt: 400,
  toneMeasureFrom: 450,
  toneMeasureTo: 1150,
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
 * About 45 s when the player follows the prompts (most of it is reading time).
 */
export class CalibrationRunner {
  readonly data: CalibrationData = defaultCalibration();
  private stepIdx = 0;
  private phaseNow: CalibPhase = 'measure';
  private phaseStartMs: number;
  /** Start of the current measuring attempt (reset by retries). */
  private stepStartMs: number;
  private lastNowMs: number;
  private result = { text: '', ok: true };
  private faceSinceMs: number | null = null;
  private yaws: number[] = [];
  private depths: number[] = [];
  private blinks: number[] = [];
  private retriedNeutral = false;
  private retriedLeft = false;
  private leftHint = '';
  private floorDb: number | null = null;
  private onsetPeaks: number[] = [];
  private secondClapAtMs: number | null = null;
  private humMs = 0;
  private humLevels: number[] = [];
  private humPitches: number[] = [];
  private baseline: number[] = [];
  private toneMax = -Infinity;
  private toneCued = false;
  private pendingCues: CalibCue[] = [];

  constructor(startMs: number) {
    this.phaseStartMs = startMs;
    this.stepStartMs = startMs;
    this.lastNowMs = startMs;
  }

  get step(): CalibStepId {
    return ORDER[this.stepIdx];
  }

  get phase(): CalibPhase {
    return this.phaseNow;
  }

  update(nowMs: number, face: FaceFrame | null, mic: MicFrame | null): CalibUpdate {
    const dt = Math.max(0, nowMs - this.lastNowMs);
    this.lastNowMs = nowMs;
    const hasPose = !!face && face.present && face.pose !== null;

    if (this.phaseNow === 'result' && nowMs - this.phaseStartMs >= CONFIG.CALIB_RESULT_MS) this.advance(nowMs);
    // Measuring starts on the frame AFTER the countdown ends (with the "go" tick), so nothing done
    // during the countdown is ever counted.
    const justStarted = this.phaseNow === 'intro' && nowMs - this.phaseStartMs >= CONFIG.CALIB_INTRO_MS;
    if (justStarted) this.beginMeasure(nowMs);

    let progress = 1;
    let status = this.result.text;
    let tone: CalibView['statusTone'] = this.result.ok ? 'ok' : 'warn';
    let finished = false;

    if (this.phaseNow === 'intro') {
      const left = CONFIG.CALIB_INTRO_MS - (nowMs - this.phaseStartMs);
      progress = 1 - left / CONFIG.CALIB_INTRO_MS;
      status = `Starts in ${Math.max(1, Math.ceil(left / 1000))}…`;
      tone = 'live';
    } else if (this.phaseNow === 'measure') {
      const live = justStarted ? { progress: 0, status: 'Go!', finished: false } : this.measure(nowMs, dt, face, mic, hasPose);
      progress = live.progress;
      finished = live.finished;
      if (this.phaseNow === 'measure') {
        status = live.status;
        tone = this.step === 'done' && this.data.warnings.length > 0 ? 'warn' : 'live';
      } else {
        status = this.result.text;
        tone = this.result.ok ? 'ok' : 'warn';
        progress = 1;
      }
    }

    const cues = this.pendingCues;
    this.pendingCues = [];
    const text = TEXT[this.step];
    const prompt = this.step === 'left' && this.leftHint ? this.leftHint : text.prompt;
    return {
      view: {
        step: this.step,
        phase: this.phaseNow,
        index: Math.min(this.stepIdx + 1, ORDER.length - 1),
        total: ORDER.length - 1,
        title: text.title,
        prompt,
        why: text.why,
        status,
        statusTone: tone,
        progress: Math.min(Math.max(progress, 0), 1),
      },
      cues,
      finished,
    };
  }

  /** One frame of the current step's measurement. May call finish() (switches to the result phase). */
  private measure(
    nowMs: number,
    dt: number,
    face: FaceFrame | null,
    mic: MicFrame | null,
    hasPose: boolean,
  ): { progress: number; status: string; finished: boolean } {
    const elapsed = nowMs - this.stepStartMs;
    const noFace = 'I can’t see your face';
    switch (this.step) {
      case 'face': {
        if (face) this.faceSinceMs = hasPose ? (this.faceSinceMs ?? nowMs) : null;
        const held = this.faceSinceMs === null ? 0 : nowMs - this.faceSinceMs;
        if (held >= T.faceHold) this.finish(nowMs, 'Got you.', true);
        return { progress: held / T.faceHold, status: hasPose ? 'Found you. Hold still…' : 'Looking for your face…', finished: false };
      }
      case 'quiet': {
        if (mic) this.floorDb = mic.floorDb;
        if (elapsed >= T.quiet) {
          this.finish(nowMs, this.floorDb === null ? 'Room noise measured.' : `Room noise measured: ${Math.round(this.floorDb)} dB.`, true);
        }
        return { progress: elapsed / T.quiet, status: 'Listening to the room…', finished: false };
      }
      case 'neutral': {
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
            this.finish(nowMs, 'Rest position saved.', true);
          } else if (!this.retriedNeutral) {
            this.retriedNeutral = true;
            this.restart(nowMs);
          } else {
            this.data.warnings.push('Could not see your face clearly; using default head position.');
            this.finish(nowMs, 'Couldn’t see your face clearly. Using a default position.', false);
          }
        }
        return { progress: elapsed / T.neutral, status: hasPose ? 'Hold still…' : noFace, finished: false };
      }
      case 'left': {
        if (hasPose && elapsed >= T.leftCollectFrom) this.yaws.push(face!.pose!.yawDeg);
        if (elapsed >= T.left) {
          const delta = this.yaws.length >= 5 ? median(this.yaws) - this.data.neutralYawDeg : 0;
          if (Math.abs(delta) >= CONFIG.CALIB_MIN_YAW_DELTA_DEG) {
            this.data.leftSign = delta > 0 ? 1 : -1;
            this.finish(nowMs, `Turned ${Math.round(Math.abs(delta))}° to the left. Saved.`, true);
          } else if (!this.retriedLeft) {
            this.retriedLeft = true;
            this.leftHint = 'A bit further: turn your head LEFT and hold.';
            this.restart(nowMs);
          } else {
            this.data.warnings.push('Head turn was too small to measure; turning direction may be inverted.');
            this.finish(nowMs, 'The turn was too small to measure. Using the default direction.', false);
          }
        }
        const turned = hasPose ? Math.round(Math.abs(face!.pose!.yawDeg - this.data.neutralYawDeg)) : null;
        return { progress: elapsed / T.left, status: turned === null ? noFace : `Turned ${turned}°`, finished: false };
      }
      case 'clap': {
        if (mic) for (const o of mic.onsets) this.onsetPeaks.push(o.peakAboveDb);
        if (this.onsetPeaks.length >= 2 && this.secondClapAtMs === null) this.secondClapAtMs = nowMs;
        const heard = this.onsetPeaks.length;
        const done = this.secondClapAtMs !== null && nowMs - this.secondClapAtMs >= T.clapGrace;
        if (done || elapsed >= T.clapTimeout) {
          if (heard > 0) {
            this.data.clapRefAboveDb = Math.min(Math.max(median(this.onsetPeaks), CONFIG.ONSET_MIN_ABOVE_FLOOR_DB + 8), 60);
            this.finish(nowMs, `Heard ${heard === 1 ? 'one clap' : `${heard} claps`}, ${Math.round(median(this.onsetPeaks))} dB above the room.`, true);
          } else {
            this.data.warnings.push('Did not hear a clap; using default clap loudness.');
            this.finish(nowMs, 'Didn’t hear a clap. Using the default loudness.', false);
          }
        }
        return { progress: heard / 2, status: `Claps heard: ${Math.min(heard, 2)} of 2`, finished: false };
      }
      case 'hum': {
        if (mic?.humActive) {
          this.humMs += dt;
          this.humLevels.push(mic.aboveDb);
          this.humPitches.push(mic.humPitchHz);
        }
        if (this.humMs >= T.humTarget || elapsed >= T.humTimeout) {
          if (this.humLevels.length >= 10) {
            this.data.humRefAboveDb = Math.min(Math.max(percentile(this.humLevels, 0.8), CONFIG.HUM_MIN_ABOVE_FLOOR_DB + 6), 60);
            this.finish(nowMs, `Heard your hum at ${Math.round(median(this.humPitches))} Hz.`, true);
          } else {
            this.data.warnings.push('Did not hear a steady hum; using default hum loudness.');
            this.finish(nowMs, 'Didn’t hear a steady hum. Using the default loudness.', false);
          }
        }
        return {
          progress: this.humMs / T.humTarget,
          status: mic?.humActive ? `Hearing your hum: ${Math.round(mic.humPitchHz)} Hz` : 'Listening for a hum…',
          finished: false,
        };
      }
      case 'speakers': {
        if (mic && elapsed < T.toneAt) this.baseline.push(mic.levelDb);
        if (!this.toneCued && elapsed >= T.toneAt) {
          this.toneCued = true;
          this.pendingCues.push('testTone');
        }
        if (mic && elapsed >= T.toneMeasureFrom && elapsed <= T.toneMeasureTo) this.toneMax = Math.max(this.toneMax, mic.levelDb);
        if (elapsed >= T.speakers) {
          const base = this.baseline.length > 0 ? median(this.baseline) : -120;
          this.data.speakerLeak = this.toneMax - base > CONFIG.SPEAKER_LEAK_RISE_DB;
          if (this.data.speakerLeak) {
            this.data.warnings.push('Speakers reach the mic: wear headphones for the best experience.');
            this.finish(nowMs, 'The speakers reach the microphone. Please wear headphones.', false);
          } else {
            this.finish(nowMs, 'No sound leaking into the mic. Good.', true);
          }
        }
        return { progress: elapsed / T.speakers, status: 'Testing…', finished: false };
      }
      case 'done': {
        const clapped = !!mic && mic.onsets.length > 0 && elapsed >= CONFIG.CALIB_DONE_SKIP_MS;
        const status =
          this.data.warnings.length > 0
            ? 'Some steps used default values. The game still works.'
            : elapsed >= CONFIG.CALIB_DONE_SKIP_MS
              ? 'Clap when you’re ready'
              : '';
        return { progress: elapsed / CONFIG.CALIB_DONE_MS, status, finished: clapped || elapsed >= CONFIG.CALIB_DONE_MS };
      }
    }
  }

  private beginMeasure(nowMs: number): void {
    this.phaseNow = 'measure';
    this.phaseStartMs = nowMs;
    this.restart(nowMs);
    this.pendingCues.push('tick');
  }

  /** The step's measurement is over: show what was measured for CALIB_RESULT_MS. */
  private finish(nowMs: number, text: string, ok: boolean, cue: CalibCue | null = 'ok'): void {
    this.phaseNow = 'result';
    this.phaseStartMs = nowMs;
    this.result = { text, ok };
    if (cue) this.pendingCues.push(cue);
  }

  private advance(nowMs: number): void {
    this.stepIdx = Math.min(this.stepIdx + 1, ORDER.length - 1);
    this.phaseStartMs = nowMs;
    if (this.step === 'done') {
      this.phaseNow = 'measure';
      this.restart(nowMs);
    } else {
      this.phaseNow = 'intro';
    }
  }

  private restart(nowMs: number): void {
    this.stepStartMs = nowMs;
    this.yaws = [];
    this.depths = [];
    this.blinks = [];
  }
}
