import { CONFIG } from '../config';
import type { PlayerIntent } from '../input/intent';
import { manualStepIntent } from './manualIntent';

/** Shot identifiers; the short intro uses jar → look → move → hear. */
export type BeatId = 'dark' | 'look' | 'move' | 'clap' | 'jar' | 'hear' | 'freeze' | 'hush';

/**
 * cut     fade to black and back (the player is moved to the start mark at the midpoint)
 * setup   the lesson's cinematic: title, narration, camera move; the player's input is held
 * await   the cave waits (in slow motion) for the player to do the step; it runs live once they act
 * stepOk  a short tick between two steps of one lesson
 * confirm the lesson's consequence line
 * end     the recap card; a clap (or time) starts the game
 * done    finished
 */
export type ManualPhase = 'cut' | 'setup' | 'await' | 'stepOk' | 'confirm' | 'end' | 'done';

/** The real-life motion drawn over the webcam picture. */
export type Gesture = 'none' | 'turnLeft' | 'turnRight' | 'leanIn' | 'leanBack' | 'clap' | 'clickClap' | 'hum' | 'quiet' | 'freeze' | 'sound';

/** The live meter a step is judged on (highlighted next to the webcam picture). */
export type Meter = 'none' | 'turn' | 'lean' | 'sound' | 'hum' | 'still';

export type StepId =
  | 'turnLeft'
  | 'turnRight'
  | 'leanIn'
  | 'sitBack'
  | 'leanBack'
  | 'clap'
  | 'softLoud'
  | 'hum'
  | 'quiet'
  | 'clapReveal'
  | 'watch'
  | 'clapAgain'
  | 'hold'
  | 'sound';

interface StepDef {
  id: StepId;
  text: string;
  /** ?sim=1 only: the keys that do it. */
  keys: string;
  hint: string;
  gesture: Gesture;
  meter: Meter;
  /** The cave waits in slow motion until the player acts. */
  slow: boolean;
  /** Runs by itself (nothing is asked of the player): no hint, no timeout. */
  auto?: boolean;
}

interface BeatDef {
  id: BeatId;
  title: string;
  /** Narration during the setup, revealed one line at a time. */
  lines: string[];
  steps: StepDef[];
  /** The consequence, shown with the tick when the lesson is done. */
  done: string;
  /** Keep the cinematic framing while waiting (otherwise the normal first-person view comes back). */
  holdShot: boolean;
  /** The setup turns the player to face down the tunnel. */
  aim?: boolean;
  /** The lesson opens with a cut to black that puts the player back on the start mark. */
  cut?: boolean;
  /** Faint breathing light, so turning and walking can be seen before the player has any light. */
  glow?: boolean;
  setupMs?: number;
}

const BEATS: BeatDef[] = [
  {
    id: 'jar', title: 'Wake the light', lines: ['Your hum wakes the fireflies.'], holdShot: true,
    steps: [
      { id: 'hum', text: 'Hum “Mmmmm” to wake them. Louder means brighter.', keys: '[hold H]', hint: 'Hold one steady note with your mouth closed.', gesture: 'hum', meter: 'hum', slow: true },
      { id: 'quiet', text: 'Stop humming. Watch the light fade.', keys: '[release H]', hint: 'Let the note go. The jar stays in your hand.', gesture: 'quiet', meter: 'hum', slow: false },
    ],
    done: 'Soft light. Only creatures nearby can hear your hum.',
  },
  {
    id: 'look', title: 'Look around', lines: ['Your head steers.'], holdShot: false, glow: true,
    steps: [
      { id: 'turnLeft', text: 'Turn your head left.', keys: '[hold ←]', hint: 'Turn slightly past the marker and hold.', gesture: 'turnLeft', meter: 'turn', slow: true },
      { id: 'turnRight', text: 'Now turn right. Face forward to stop.', keys: '[hold →]', hint: 'Turn right past the marker.', gesture: 'turnRight', meter: 'turn', slow: true },
    ],
    done: 'Hold a turn to keep turning. Centre your head to stop.',
  },
  {
    id: 'move', title: 'Keep moving', lines: ['Lean to walk.'], holdShot: false, aim: true, glow: true,
    steps: [
      { id: 'leanIn', text: 'Lean toward the screen to walk forward.', keys: '[hold ↑]', hint: 'Lean closer than your calibrated resting position.', gesture: 'leanIn', meter: 'lean', slow: true },
      { id: 'leanBack', text: 'Lean back to reverse. Rest in the middle to stop.', keys: '[hold ↓]', hint: 'Lean farther back than where you started.', gesture: 'leanBack', meter: 'lean', slow: true },
    ],
    done: 'Forward. Back. Rest in the middle to stop.',
  },
  {
    id: 'hear', title: 'It hears you', lines: ['The Hollow is blind. It hunts sound.'], holdShot: true, cut: true,
    steps: [
      { id: 'clapReveal', text: 'Clap once. See the cave—and what hears you.', keys: '[Space]', hint: 'One sharp clap. Louder reveals farther and travels farther.', gesture: 'clap', meter: 'sound', slow: true },
      { id: 'watch', text: 'It heard you. It follows the sound to where you clapped.', keys: '', hint: '', gesture: 'none', meter: 'none', slow: false, auto: true },
    ],
    done: 'Every way of seeing makes a sound. Keep moving.',
  },
];

/** The lessons that teach the four controls; when all four were done by the player, the tutorial level skips its own teaching. */
const BASICS: readonly BeatId[] = ['jar', 'look', 'move', 'hear'];

const TIMEOUT_TEXT = 'Take your time. Try again, or double clap to skip the manual.';

/** What the manual needs to know about its scene (the director reads it from the World each frame). */
export interface ManualWorldView {
  /** Distance from the player to the Hollow while it is out in the tunnel, else null. */
  hollowDistanceM: number | null;
  /** The Hollow heard the player and is hunting. */
  hollowAlerted: boolean;
}

export type ManualEvent =
  | { type: 'beatStart'; beat: BeatId }
  /** Midpoint of a cut: put the player back on the start mark. */
  | { type: 'place'; beat: BeatId }
  | { type: 'stepStart'; beat: BeatId; step: StepId }
  | { type: 'stepDone'; beat: BeatId; step: StepId }
  /** Repeat assistance without falsely marking the action as learned. */
  | { type: 'timeout'; beat: BeatId; step: StepId }
  | { type: 'beatDone'; beat: BeatId; learned: boolean }
  /** They moved or made a sound during the Stalker's stare. */
  | { type: 'freezeFail' }
  | { type: 'skip' }
  /** The recap card appears (after the last lesson or a skip). */
  | { type: 'end' }
  | { type: 'finished' };

export interface ManualStepView {
  id: StepId;
  text: string;
  /** '' until the hint is due. */
  hint: string;
  gesture: Gesture;
  meter: Meter;
  /** 0..1 */
  progress: number;
  /** 1-based, of `count` steps in this lesson. */
  index: number;
  count: number;
  auto: boolean;
}

/** Everything the director and the overlay need for one frame. */
export interface ManualFrame {
  phase: ManualPhase;
  /** null on the end card. */
  beat: BeatId | null;
  /** 0 = the opening, 1..chapterCount = lessons I..VII. */
  chapter: number;
  chapterCount: number;
  title: string;
  lines: string[];
  /** The current step (await / stepOk / confirm), else null. */
  step: ManualStepView | null;
  /** The consequence line while confirming ('' otherwise). */
  done: string;
  /** This lesson was passed for the player. */
  timedOut: boolean;
  /** ms in the current phase / lesson (frozen while paused). */
  phaseMs: number;
  beatMs: number;
  /** The cinematic camera's shot, and whether it should be on. */
  shot: BeatId | 'end';
  shotOn: boolean;
  /** Run the cave in slow motion. */
  slow: boolean;
  /** Hold the player's input (cuts and setups are cinematics). */
  held: boolean;
  /** The face left the camera: everything waits. */
  paused: boolean;
  /** The setup turns the player to face down the tunnel. */
  aim: boolean;
  glow: boolean;
  /** The Hollow may hear and move (only while its lesson needs it). */
  hollowActive: boolean;
  /** The jar has been raised into view (it stays). */
  jarShown: boolean;
  /** 1 = the jar is brought forward for its close-up. */
  jarOffer: number;
  /** 0..1 how far the Stalker has come during its approach (1 while it stares), else 0. */
  stalker: number;
  stare: boolean;
  /** Target frost (the Hush's lesson). */
  frost: number;
  /** 0..1 black (opening fade-in and cuts). */
  fade: number;
  letterbox: boolean;
  skip: { shown: boolean; progress: number };
  /** Events since the last frame. */
  events: ManualEvent[];
}

/**
 * The Field Manual: a cinematic, hands-free onboarding that teaches every control live. Pure logic: feed
 * it the frame time, the PlayerIntent and two facts about the scene; it says what to show and when the
 * scene must change. Success is judged ONLY from PlayerIntent, the same stream the game uses, so a lesson
 * passes exactly when the game itself would have reacted. Every waiting step shows a hint after
 * MANUAL_HINT_MS, repeats help after MANUAL_TIMEOUT_MS, and supports a double clap to skip. Nothing
 * advances while the face is away: it can never soft-lock.
 */
export class FieldManual {
  private phase: ManualPhase = 'setup';
  private beatIdx = 0;
  private stepIdx = 0;
  private phaseMs = 0;
  private beatMs = 0;
  private stepMs = 0;
  /** Per-step progress accumulator (radians, metres, ms or a count, depending on the step). */
  private acc = 0;
  private sinceActionMs = Infinity;
  private timedOut = false;
  private placed = false;
  private hollowHalted = false;
  private tooQuiet = false;
  private lastClapMs: number | null = null;
  private sinceFlinchMs = 0;
  private jarSeen = true;
  private skipMs = 0;
  private elapsedMs = 0;
  private skipClapMs = -Infinity;
  private nextHintMs: number = CONFIG.MANUAL_TIMEOUT_MS;
  /** A skip hum must START while skipping is allowed (a hum carried over from the jar lesson doesn't count). */
  private skipEligible = true;
  private readonly learned = new Set<BeatId>();
  private events: ManualEvent[] = [{ type: 'beatStart', beat: 'jar' }];

  constructor(private readonly sim: boolean) {}

  /** The player did the four basic lessons themselves (not passed for them, not skipped). */
  get learnedBasics(): boolean {
    return BASICS.every((b) => this.learned.has(b));
  }

  get finished(): boolean {
    return this.phase === 'done';
  }

  update(dtMs: number, intent: PlayerIntent, view: ManualWorldView): ManualFrame {
    if (this.phase === 'done') return this.frame(false);
    if (!intent.facePresent) {
      this.skipMs = 0;
      return this.frame(true);
    }
    const dt = Math.max(0, dtMs);
    this.elapsedMs += dt;
    this.phaseMs += dt;
    this.beatMs += dt;
    if (this.updateSkip(dt, intent)) return this.frame(false);

    switch (this.phase) {
      case 'cut':
        if (!this.placed && this.phaseMs >= CONFIG.MANUAL_CUT_MS / 2) {
          this.placed = true;
          this.emit({ type: 'place', beat: this.beat.id });
        }
        if (this.phaseMs >= CONFIG.MANUAL_CUT_MS) this.enter('setup');
        break;
      case 'setup':
        if (this.phaseMs >= this.setupMs) {
          if (this.beat.steps.length === 0) this.nextBeat();
          else this.startStep(0);
        }
        break;
      case 'await':
        this.judge(dt, manualStepIntent({ phase: this.phase, step: this.step }, intent), view);
        break;
      case 'stepOk':
        if (this.phaseMs >= CONFIG.MANUAL_STEP_OK_MS) this.startStep(this.stepIdx + 1);
        break;
      case 'confirm':
        if (this.phaseMs >= CONFIG.MANUAL_CONFIRM_MS) this.nextBeat();
        break;
      case 'end':
        if ((intent.pulses.length > 0 && this.phaseMs >= CONFIG.MANUAL_END_MIN_MS) || this.phaseMs >= CONFIG.MANUAL_END_AUTO_MS) {
          this.phase = 'done';
          this.emit({ type: 'finished' });
        }
        break;
    }
    return this.frame(false);
  }

  // ------------------------------------------------------------------ judging

  private judge(dt: number, intent: PlayerIntent, view: ManualWorldView): void {
    const step = this.step!;
    this.stepMs += dt;
    const acting = intent.pulses.length > 0 || intent.hum !== null || intent.turnRate !== 0 || intent.moveSpeed !== 0;
    this.sinceActionMs = acting ? 0 : this.sinceActionMs + dt;
    const s = dt / 1000;
    let done = false;
    switch (step.id) {
      case 'turnLeft':
        this.acc = intent.turnRate > 0 ? this.acc + intent.turnRate * s : 0;
        done = this.acc >= CONFIG.MANUAL_LOOK_RAD;
        break;
      case 'turnRight':
        this.acc = intent.turnRate < 0 ? this.acc - intent.turnRate * s : 0;
        done = this.acc >= CONFIG.MANUAL_LOOK_RAD;
        break;
      case 'leanIn':
        this.acc += Math.max(intent.moveSpeed, 0) * s;
        done = this.acc >= CONFIG.MANUAL_WALK_M;
        break;
      case 'leanBack':
        this.acc += Math.max(-intent.moveSpeed, 0) * s;
        done = this.acc >= CONFIG.MANUAL_BACK_M;
        break;
      case 'sitBack':
        this.acc = intent.moveSpeed <= 0 ? this.acc + dt : 0;
        done = this.acc >= CONFIG.MANUAL_STOP_MS;
        break;
      case 'clap':
      case 'clapAgain':
        done = intent.pulses.length > 0;
        break;
      case 'softLoud':
        for (const loudness of intent.pulses) {
          if (this.acc === 0 && loudness < CONFIG.MANUAL_SOFT_MAX) this.acc = 1;
          else if (this.acc === 1 && loudness >= CONFIG.MANUAL_LOUD_MIN) this.acc = CONFIG.MANUAL_CLAP_EXTRA;
        }
        done = this.acc >= CONFIG.MANUAL_CLAP_EXTRA;
        break;
      case 'hum':
        this.acc = intent.hum ? this.acc + dt : 0;
        done = this.acc >= CONFIG.MANUAL_HUM_MS;
        break;
      case 'quiet':
        this.acc = intent.hum ? 0 : this.acc + dt;
        done = this.acc >= CONFIG.MANUAL_QUIET_MS;
        break;
      case 'clapReveal':
        // Only a clap the Hollow actually heard counts: too soft a sound teaches "louder". (The World hears
        // a clap in the same frame it is made, so give it MANUAL_HEARD_WAIT_MS before calling it too quiet.)
        if (intent.pulses.length > 0) this.lastClapMs = this.stepMs;
        if (!view.hollowAlerted && this.lastClapMs !== null && this.stepMs - this.lastClapMs >= CONFIG.MANUAL_HEARD_WAIT_MS) this.tooQuiet = true;
        done = view.hollowAlerted;
        this.acc = done ? 1 : 0;
        break;
      case 'watch':
        done = (view.hollowDistanceM !== null && view.hollowDistanceM <= CONFIG.MANUAL_HOLLOW_HALT_M) || this.stepMs >= CONFIG.MANUAL_HOLLOW_RUN_MS;
        if (done) this.hollowHalted = true;
        break;
      case 'hold': {
        this.sinceFlinchMs += dt;
        if (this.sinceFlinchMs < CONFIG.MANUAL_FREEZE_GRACE_MS) break;
        const moved = Math.abs(intent.moveSpeed) > CONFIG.STALKER_MOVE_LIMIT_MPS || Math.abs(intent.turnRate) > CONFIG.STALKER_TURN_LIMIT_RAD_S;
        const sounded = intent.pulses.length > 0 || intent.hum !== null;
        if (moved || sounded) {
          this.acc = 0;
          this.sinceFlinchMs = 0;
          this.emit({ type: 'freezeFail' });
        } else {
          this.acc += dt;
        }
        done = this.acc >= CONFIG.MANUAL_FREEZE_MS;
        break;
      }
      case 'sound':
        if (intent.hum) this.acc += dt;
        done = intent.pulses.length > 0 || this.acc >= CONFIG.MANUAL_SOUND_HUM_MS;
        break;
    }

    if (done) {
      this.emit({ type: 'stepDone', beat: this.beat.id, step: step.id });
      if (this.stepIdx + 1 < this.beat.steps.length) this.enter('stepOk');
      else this.confirm();
    } else if (!step.auto && this.stepMs >= this.nextHintMs) {
      this.emit({ type: 'timeout', beat: this.beat.id, step: step.id });
      this.nextHintMs += CONFIG.MANUAL_TIMEOUT_MS;
    }
  }

  private progress(): number {
    const step = this.step;
    if (!step) return 0;
    let p = 0;
    switch (step.id) {
      case 'turnLeft':
      case 'turnRight':
        p = this.acc / CONFIG.MANUAL_LOOK_RAD;
        break;
      case 'leanIn':
        p = this.acc / CONFIG.MANUAL_WALK_M;
        break;
      case 'leanBack':
        p = this.acc / CONFIG.MANUAL_BACK_M;
        break;
      case 'sitBack':
        p = this.acc / CONFIG.MANUAL_STOP_MS;
        break;
      case 'softLoud':
        p = this.acc / CONFIG.MANUAL_CLAP_EXTRA;
        break;
      case 'hum':
        p = this.acc / CONFIG.MANUAL_HUM_MS;
        break;
      case 'quiet':
        p = this.acc / CONFIG.MANUAL_QUIET_MS;
        break;
      case 'watch':
        p = this.stepMs / CONFIG.MANUAL_HOLLOW_RUN_MS;
        break;
      case 'hold':
        p = this.acc / CONFIG.MANUAL_FREEZE_MS;
        break;
      case 'sound':
        p = this.acc / CONFIG.MANUAL_SOUND_HUM_MS;
        break;
      default:
        p = this.acc;
    }
    // Finished steps (stepOk / confirm) read as full.
    return this.phase === 'await' ? Math.min(Math.max(p, 0), 1) : this.timedOut ? Math.min(Math.max(p, 0), 1) : 1;
  }

  // ------------------------------------------------------------------ skipping

  /** @returns true if the hum skipped to the recap this frame */
  private updateSkip(dt: number, intent: PlayerIntent): boolean {
    if (this.phase !== 'end' && intent.pulses.length > 0) {
      if (this.elapsedMs - this.skipClapMs <= CONFIG.MANUAL_SKIP_CLAP_WINDOW_MS) {
        this.emit({ type: 'skip' });
        this.enterEnd();
        return true;
      }
      this.skipClapMs = this.elapsedMs;
    }
    const armed = this.skipArmed;
    if (!intent.hum) {
      this.skipEligible = true;
      this.skipMs = 0;
      return false;
    }
    if (!armed) {
      this.skipEligible = false;
      this.skipMs = 0;
      return false;
    }
    if (!this.skipEligible) return false;
    this.skipMs += dt;
    if (this.skipMs < CONFIG.MANUAL_SKIP_HUM_MS) return false;
    this.skipMs = 0;
    this.emit({ type: 'skip' });
    this.enterEnd();
    return true;
  }

  private get skipArmed(): boolean {
    return this.phase !== 'end' && this.phase !== 'done' && this.beat.id !== 'jar';
  }

  // ------------------------------------------------------------------ transitions

  private get beat(): BeatDef {
    return BEATS[Math.min(this.beatIdx, BEATS.length - 1)];
  }

  private get step(): StepDef | null {
    return this.phase === 'await' || this.phase === 'stepOk' || this.phase === 'confirm' ? (this.beat.steps[this.stepIdx] ?? null) : null;
  }

  private get setupMs(): number {
    return this.beat.setupMs ?? CONFIG.MANUAL_SETUP_MS;
  }

  private emit(e: ManualEvent): void {
    this.events.push(e);
  }

  private enter(phase: ManualPhase): void {
    this.phase = phase;
    this.phaseMs = 0;
  }

  private startStep(index: number): void {
    this.stepIdx = index;
    this.stepMs = 0;
    this.nextHintMs = CONFIG.MANUAL_TIMEOUT_MS;
    this.acc = 0;
    this.tooQuiet = false;
    this.lastClapMs = null;
    this.sinceFlinchMs = 0;
    this.sinceActionMs = Infinity;
    this.enter('await');
    this.emit({ type: 'stepStart', beat: this.beat.id, step: this.beat.steps[index].id });
  }

  private confirm(): void {
    const learned = !this.timedOut;
    if (learned) this.learned.add(this.beat.id);
    this.emit({ type: 'beatDone', beat: this.beat.id, learned });
    this.enter('confirm');
  }

  private nextBeat(): void {
    if (this.beatIdx + 1 >= BEATS.length) {
      this.enterEnd();
      return;
    }
    this.beatIdx++;
    this.stepIdx = 0;
    this.beatMs = 0;
    this.timedOut = false;
    this.placed = false;
    if (this.beat.id === 'jar') this.jarSeen = true;
    this.emit({ type: 'beatStart', beat: this.beat.id });
    this.enter(this.beat.cut ? 'cut' : 'setup');
  }

  private enterEnd(): void {
    this.beatIdx = BEATS.length;
    this.beatMs = 0;
    this.enter('end');
    this.emit({ type: 'end' });
  }

  // ------------------------------------------------------------------ output

  private frame(paused: boolean): ManualFrame {
    const events = this.events;
    this.events = [];
    const atEnd = this.phase === 'end' || this.phase === 'done';
    const beat = atEnd ? null : this.beat;
    const step = atEnd ? null : this.step;
    const id = beat?.id ?? null;
    const p = this.phase;
    const waiting = p === 'await' || p === 'stepOk';

    let fade = 0;
    if (p === 'cut') fade = 1 - Math.abs(this.phaseMs / (CONFIG.MANUAL_CUT_MS / 2) - 1);
    else if (id === 'jar' && p === 'setup') fade = 1 - Math.min(this.phaseMs / CONFIG.MANUAL_OPEN_FADE_MS, 1);

    let stalker = 0;
    if (id === 'freeze') stalker = p === 'setup' ? Math.min(this.phaseMs / this.setupMs, 1) : p === 'await' ? 1 : 0;

    let frost = 0;
    if (id === 'hush') frost = p === 'setup' ? CONFIG.MANUAL_FROST * Math.min(this.phaseMs / this.setupMs, 1) : p === 'await' ? CONFIG.MANUAL_FROST : 0;

    const stepView: ManualStepView | null =
      step && beat
        ? {
            id: step.id,
            text: this.sim && step.keys ? `${step.text} ${step.keys}` : step.text,
            hint: p === 'await' && !step.auto ? (this.stepMs >= CONFIG.MANUAL_TIMEOUT_MS ? `${step.hint} ${TIMEOUT_TEXT}` : this.stepMs >= CONFIG.MANUAL_HINT_MS || this.tooQuiet ? step.hint : '') : '',
            gesture: step.gesture,
            meter: step.meter,
            progress: this.progress(),
            index: this.stepIdx + 1,
            count: beat.steps.length,
            auto: !!step.auto,
          }
        : null;

    return {
      phase: p,
      beat: id,
      chapter: atEnd ? BEATS.length : this.beatIdx + 1,
      chapterCount: BEATS.length,
      title: beat?.title ?? 'Find the way out',
      lines: beat?.lines ?? [],
      step: stepView,
      done: p === 'confirm' && beat ? (this.timedOut ? TIMEOUT_TEXT : beat.done) : '',
      timedOut: this.timedOut,
      phaseMs: this.phaseMs,
      beatMs: this.beatMs,
      shot: id ?? 'end',
      shotOn: p === 'setup' || p === 'end' || (waiting && !!beat?.holdShot),
      slow: p === 'await' && !!step?.slow && this.sinceActionMs >= CONFIG.MANUAL_ACTION_HOLD_MS,
      held: p === 'cut' || p === 'setup',
      paused,
      aim: !!beat?.aim && p === 'setup',
      glow: !!beat?.glow && p !== 'cut',
      hollowActive: id === 'hear' && waiting && this.stepIdx <= 1 && !this.hollowHalted,
      jarShown: this.jarSeen,
      jarOffer: id === 'jar' && (p === 'setup' || waiting) ? 1 : 0,
      stalker,
      stare: id === 'freeze' && p === 'await',
      frost,
      fade: Math.min(Math.max(fade, 0), 1),
      letterbox: !atEnd,
      skip: { shown: !atEnd, progress: this.skipMs / CONFIG.MANUAL_SKIP_HUM_MS },
      events,
    };
  }
}
