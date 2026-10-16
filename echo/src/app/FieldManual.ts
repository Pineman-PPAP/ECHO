import { CONFIG } from '../config';
import type { PlayerIntent } from '../input/intent';

/** The lessons, in order. 'dark' is the opening; the rest are chapters I to VII. */
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
    id: 'dark',
    title: 'You can’t see',
    lines: ['No controller. No keyboard.', 'Only your face and your voice.', 'Learn them here, where nothing can hurt you.'],
    steps: [],
    done: '',
    holdShot: true,
    setupMs: CONFIG.MANUAL_OPEN_MS,
  },
  {
    id: 'look',
    title: 'Look around',
    lines: ['Your head steers.'],
    steps: [
      {
        id: 'turnLeft',
        text: 'Turn your head to your LEFT, and hold it there.',
        keys: '[hold ←]',
        hint: 'Turn a little further, past the line, and hold.',
        gesture: 'turnLeft',
        meter: 'turn',
        slow: true,
      },
      {
        id: 'turnRight',
        text: 'Now turn to your RIGHT.',
        keys: '[hold →]',
        hint: 'Turn your head to the right, past the line, and hold.',
        gesture: 'turnRight',
        meter: 'turn',
        slow: true,
      },
    ],
    done: 'Hold a turn to keep turning. Face the screen to stop.',
    holdShot: false,
    glow: true,
  },
  {
    id: 'move',
    title: 'Walk',
    lines: ['Your body walks.'],
    steps: [
      {
        id: 'leanIn',
        text: 'Lean toward the screen.',
        keys: '[hold ↑]',
        hint: 'Lean in a little more, past the line.',
        gesture: 'leanIn',
        meter: 'lean',
        slow: true,
      },
      {
        id: 'sitBack',
        text: 'Sit back to stop.',
        keys: '[release ↑]',
        hint: 'Sit back to where you started.',
        gesture: 'leanBack',
        meter: 'lean',
        slow: true,
      },
    ],
    done: 'Lean further to go faster. Lean gently to sneak: footsteps make noise.',
    holdShot: false,
    aim: true,
    glow: true,
  },
  {
    id: 'clap',
    title: 'Sound is sight',
    lines: ['Down here, sound is your only light.'],
    steps: [
      {
        id: 'clap',
        text: 'Clap your hands once.',
        keys: '[Space]',
        hint: 'One sharp clap.',
        gesture: 'clap',
        meter: 'sound',
        slow: true,
      },
      {
        id: 'softLoud',
        text: 'Now a soft tongue click… then a LOUD clap.',
        keys: '[Shift+Space, then Space]',
        hint: 'Any two sharp sounds: one soft, one loud.',
        gesture: 'clickClap',
        meter: 'sound',
        slow: true,
      },
    ],
    done: 'Louder shows you more of the cave. It also carries further.',
    holdShot: true,
    aim: true,
  },
  {
    id: 'jar',
    title: 'The jar',
    lines: ['In your left hand: a jar of sleeping fireflies.'],
    steps: [
      {
        id: 'hum',
        text: 'Hum a steady note. “Mmmmm.”',
        keys: '[hold H]',
        hint: 'One steady note with your mouth closed: “mmmmm”.',
        gesture: 'hum',
        meter: 'hum',
        slow: true,
      },
      {
        id: 'quiet',
        text: 'Now stop. Watch them fall asleep.',
        keys: '[release H]',
        hint: 'Stop humming for a moment.',
        gesture: 'quiet',
        meter: 'hum',
        slow: false,
      },
    ],
    done: 'Humming is soft light all around you. Only something right beside you hears it.',
    holdShot: true,
  },
  {
    id: 'hear',
    title: 'They hear you',
    lines: ['Something lives down here.', 'It is blind. It hunts by sound.'],
    steps: [
      {
        id: 'clapReveal',
        text: 'It is somewhere down this tunnel. Clap, LOUD.',
        keys: '[Space]',
        hint: 'Louder. It didn’t hear that.',
        gesture: 'clap',
        meter: 'sound',
        slow: true,
      },
      {
        id: 'watch',
        text: 'It heard you. It is coming to where you clapped.',
        keys: '',
        hint: '',
        gesture: 'none',
        meter: 'none',
        slow: false,
        auto: true,
      },
      {
        id: 'clapAgain',
        text: 'It stopped. Clap again.',
        keys: '[Space]',
        hint: 'Clap to see where it is now.',
        gesture: 'clap',
        meter: 'sound',
        slow: true,
      },
    ],
    done: 'Every clap shows you the cave, and tells them where you are.',
    holdShot: true,
    cut: true,
  },
  {
    id: 'freeze',
    title: 'Freeze',
    lines: ['Break something down here,', 'and something else comes for you.'],
    steps: [
      {
        id: 'hold',
        text: 'It is staring at you. Don’t move. Don’t make a sound.',
        keys: '[no keys]',
        hint: 'Stay perfectly still and silent until it turns away.',
        gesture: 'freeze',
        meter: 'still',
        slow: false,
      },
    ],
    done: 'It turned away. When it stares, stillness is the only way out.',
    holdShot: true,
    setupMs: CONFIG.MANUAL_STALKER_APPROACH_MS,
  },
  {
    id: 'hush',
    title: 'Don’t stay silent',
    lines: ['Stay quiet too long,', 'and something else is drawn to the silence.'],
    steps: [
      {
        id: 'sound',
        text: 'Make a sound. Clap, or hum.',
        keys: '[Space or H]',
        hint: 'Any sound: a clap or a hum.',
        gesture: 'sound',
        meter: 'sound',
        slow: true,
      },
    ],
    done: 'Sound drives it back. Too much brings the others. Find the balance.',
    holdShot: true,
  },
];

/** The lessons that teach the four controls; when all four were done by the player, the tutorial level skips its own teaching. */
const BASICS: readonly BeatId[] = ['look', 'move', 'clap', 'jar'];

const TIMEOUT_TEXT = 'Let’s move on. You’ll get another chance in the cave.';

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
  /** The player didn't manage a step in MANUAL_TIMEOUT_MS: the lesson is passed for them. */
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
 * MANUAL_HINT_MS and is passed after MANUAL_TIMEOUT_MS, a held hum skips to the recap, and nothing
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
  private jarSeen = false;
  private skipMs = 0;
  /** A skip hum must START while skipping is allowed (a hum carried over from the jar lesson doesn't count). */
  private skipEligible = true;
  private readonly learned = new Set<BeatId>();
  private events: ManualEvent[] = [{ type: 'beatStart', beat: 'dark' }];

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
        this.judge(dt, intent, view);
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
        this.acc += Math.max(intent.turnRate, 0) * s;
        done = this.acc >= CONFIG.MANUAL_LOOK_RAD;
        break;
      case 'turnRight':
        this.acc += Math.max(-intent.turnRate, 0) * s;
        done = this.acc >= CONFIG.MANUAL_LOOK_RAD;
        break;
      case 'leanIn':
        this.acc += Math.max(intent.moveSpeed, 0) * s;
        done = this.acc >= CONFIG.MANUAL_WALK_M;
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
        this.acc += intent.pulses.length;
        done = this.acc >= CONFIG.MANUAL_CLAP_EXTRA;
        break;
      case 'hum':
        if (intent.hum) this.acc += dt;
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
    } else if (!step.auto && this.stepMs >= CONFIG.MANUAL_TIMEOUT_MS) {
      this.emit({ type: 'timeout', beat: this.beat.id, step: step.id });
      this.timedOut = true;
      this.confirm();
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
    else if (id === 'dark') fade = 1 - Math.min(this.phaseMs / CONFIG.MANUAL_OPEN_FADE_MS, 1);

    let stalker = 0;
    if (id === 'freeze') stalker = p === 'setup' ? Math.min(this.phaseMs / this.setupMs, 1) : p === 'await' ? 1 : 0;

    let frost = 0;
    if (id === 'hush') frost = p === 'setup' ? CONFIG.MANUAL_FROST * Math.min(this.phaseMs / this.setupMs, 1) : p === 'await' ? CONFIG.MANUAL_FROST : 0;

    const stepView: ManualStepView | null =
      step && beat
        ? {
            id: step.id,
            text: this.sim && step.keys ? `${step.text} ${step.keys}` : step.text,
            hint: p === 'await' && !step.auto && (this.stepMs >= CONFIG.MANUAL_HINT_MS || this.tooQuiet) ? step.hint : '',
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
      chapter: atEnd ? BEATS.length : this.beatIdx,
      chapterCount: BEATS.length - 1,
      title: beat?.title ?? 'You’re ready',
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
      skip: { shown: !atEnd && !!beat && beat.id !== 'jar', progress: this.skipMs / CONFIG.MANUAL_SKIP_HUM_MS },
      events,
    };
  }
}
