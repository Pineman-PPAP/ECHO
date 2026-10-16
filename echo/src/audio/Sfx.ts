import { CONFIG } from '../config';

/** Mic-gating durations (ms) reported through onSound when a sound starts. */
const GATE = {
  ping: 900,
  footstep: 150,
  draft: 900,
  beep: 300,
  scream: 1500,
  scrape: 300,
  ui: 400,
  heartbeat: 200,
  sting: 900,
  roar: 2000,
  mimic: 900,
  bats: 1500,
  drip: 200,
  step: 120,
  alerted: 600,
  pot: 800,
  stalkerHit: 1200,
  thud: 1200,
};

/** The Stalker's high scraping strings (Hz), a semitone apart. */
const RISER_HZ = [1244, 1318.5];

interface Voice {
  panner: PannerNode;
  scrapeGain: GainNode;
  breathAmp: GainNode;
  sources: AudioScheduledSourceNode[];
  moving: boolean;
  /** AudioContext time of its next running footstep. */
  nextStepS: number;
}

/**
 * Procedural sound: there are no audio files. Positional sounds use HRTF panners, so wear headphones.
 * Every sound that could leak from speakers into the mic reports itself through `onSound(gateMs)`;
 * App uses that to gate the mic when calibration found `speakerLeak`.
 */
export class Sfx {
  readonly master: GainNode;
  private readonly noise: AudioBuffer;
  private readonly echoIn: GainNode;
  private readonly guidePanner: PannerNode;
  private readonly voices = new Map<number, Voice>();
  private drone: AudioScheduledSourceNode[] = [];
  private readonly droneGain: GainNode;
  private earBreath: { amp: GainNode; pan: StereoPannerNode } | null = null;
  private hushVoice: { amp: GainNode; panner: PannerNode } | null = null;
  private nextBeatMs = 0;
  /** The Stalker's rising dread and its footsteps (null while it is away). */
  private stalker: {
    dread: GainNode;
    filter: BiquadFilterNode;
    detune: AudioParam[];
    riser: GainNode;
    riserFreqs: AudioParam[];
    breath: GainNode;
    panner: PannerNode;
    sources: AudioScheduledSourceNode[];
    nextStepS: number;
    stepIndex: number;
    nextWhisperS: number;
    /** The STAND STILL swell, cut dead when the face appears. */
    swell: AudioScheduledSourceNode[] | null;
  } | null = null;
  /** The current scream goes through this, so the jumpscare can cut it dead. */
  private screamBus: GainNode | null = null;

  constructor(
    private readonly ctx: AudioContext,
    private readonly onSound: (gateMs: number) => void = () => {},
  ) {
    this.master = ctx.createGain();
    this.master.gain.value = CONFIG.MASTER_VOLUME;
    this.master.connect(ctx.destination);
    this.noise = makeNoiseBuffer(ctx, 2);

    // Persistent "cave answers" echo bus: echoIn -> delay <-> (lowpass -> feedback) -> master.
    this.echoIn = ctx.createGain();
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.13;
    const fb = ctx.createGain();
    fb.gain.value = 0.42;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 2200;
    this.echoIn.connect(delay);
    delay.connect(lp);
    lp.connect(fb);
    fb.connect(delay);
    lp.connect(this.master);

    this.guidePanner = this.makePanner();
    this.guidePanner.refDistance = CONFIG.DRAFT_REF_DISTANCE_M;
    this.guidePanner.connect(this.master);

    this.droneGain = ctx.createGain();
    this.droneGain.gain.value = CONFIG.DRONE_GAIN;
    this.droneGain.connect(this.master);
  }

  // ---------------------------------------------------------------- listener / positions

  /** Call every frame with the player's head position and yaw. */
  setListener(x: number, y: number, z: number, yaw: number): void {
    const l = this.ctx.listener;
    const t = this.ctx.currentTime;
    const fx = -Math.sin(yaw);
    const fz = -Math.cos(yaw);
    if (l.positionX) {
      l.positionX.setValueAtTime(x, t);
      l.positionY.setValueAtTime(y, t);
      l.positionZ.setValueAtTime(z, t);
      l.forwardX.setValueAtTime(fx, t);
      l.forwardY.setValueAtTime(0, t);
      l.forwardZ.setValueAtTime(fz, t);
      l.upX.setValueAtTime(0, t);
      l.upY.setValueAtTime(1, t);
      l.upZ.setValueAtTime(0, t);
    } else {
      l.setPosition(x, y, z);
      l.setOrientation(fx, 0, fz, 0, 1, 0);
    }
  }

  /** Where the draft blows from (a few cells ahead on the route to the exit). */
  setGuidePosition(x: number, y: number, z: number): void {
    setPannerPosition(this.guidePanner, x, y, z, this.ctx.currentTime);
  }

  // ---------------------------------------------------------------- UI / calibration cues

  tick(): void {
    this.tone(1200, 0.04, 0.08, 'sine', this.ctx.currentTime);
    this.onSound(GATE.beep);
  }

  /** Calibration speaker check: 1 kHz for 0.6 s. Deliberately does NOT gate the mic. */
  testTone(): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.value = 1000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.01);
    g.gain.setValueAtTime(0.5, t + 0.59);
    g.gain.linearRampToValueAtTime(0, t + 0.6);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + 0.62);
  }

  /** Menu confirm: a rising two-note chime. */
  confirm(): void {
    const t = this.ctx.currentTime;
    this.tone(660, 0.18, 0.2, 'triangle', t);
    this.tone(990, 0.3, 0.2, 'triangle', t + 0.12);
    this.onSound(GATE.ui);
  }

  // ---------------------------------------------------------------- gameplay

  /** The cave "answers" a clap: a short sonar chirp plus decaying echoes. */
  ping(loudness: number): void {
    const t = this.ctx.currentTime;
    const l = Math.min(Math.max(loudness, 0.05), 1.5);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(1500, t);
    osc.frequency.exponentialRampToValueAtTime(900, t + 0.4);
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.005, 0.07 * l, 0.6);
    osc.connect(g);
    g.connect(this.master);
    g.connect(this.echoIn);
    osc.start(t);
    osc.stop(t + 0.7);
    this.onSound(GATE.ping);
  }

  footstep(loudness: number): void {
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 700;
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.004, 0.05 + loudness, 0.07);
    src.connect(lp).connect(g).connect(this.master);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.1);
    this.onSound(GATE.footstep);
  }

  /** A gust of cold air from the way out (positioned with setGuidePosition): breathy noise sweeping through a band-pass. */
  draft(): void {
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(380, t);
    bp.frequency.linearRampToValueAtTime(900, t + 0.9);
    bp.frequency.linearRampToValueAtTime(450, t + 1.8);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(CONFIG.DRAFT_GAIN, t + 0.7);
    g.gain.linearRampToValueAtTime(0.0001, t + 1.9);
    src.connect(bp).connect(g).connect(this.guidePanner);
    src.start(t, Math.random() * 0.1);
    src.stop(t + 2);
    this.onSound(GATE.draft);
  }

  /** Heartbeat speeds up and gets louder with danger (0..1). Call every frame while playing. */
  updateHeartbeat(nowMs: number, danger: number): void {
    if (danger <= 0.02 || nowMs < this.nextBeatMs) return;
    const interval = 1100 + (380 - 1100) * danger;
    this.nextBeatMs = nowMs + interval;
    const t = this.ctx.currentTime;
    const peak = 0.25 + 0.5 * danger;
    this.tone(55, 0.12, peak, 'sine', t);
    this.tone(50, 0.12, peak * 0.8, 'sine', t + 0.16);
    this.onSound(GATE.heartbeat);
  }

  scream(): void {
    const t = this.ctx.currentTime;
    const bus = this.newScreamBus();
    // A high, wavering shriek over the growl.
    const shriek = this.ctx.createOscillator();
    shriek.type = 'square';
    shriek.frequency.setValueAtTime(1150, t);
    shriek.frequency.exponentialRampToValueAtTime(620, t + 0.9);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 31;
    const vibDepth = this.ctx.createGain();
    vibDepth.gain.value = 70;
    vib.connect(vibDepth).connect(shriek.frequency);
    const sbp = this.ctx.createBiquadFilter();
    sbp.type = 'bandpass';
    sbp.frequency.value = 1500;
    sbp.Q.value = 2;
    const sg = this.ctx.createGain();
    envelope(sg.gain, t, 0.01, 0.35, 1.0);
    shriek.connect(sbp).connect(sg).connect(bus);
    shriek.start(t);
    vib.start(t);
    shriek.stop(t + 1.1);
    vib.stop(t + 1.1);
    const saw = this.ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(220, t);
    saw.frequency.exponentialRampToValueAtTime(40, t + 1.2);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(400);
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.01, 0.8, 1.2);
    const n = this.noiseSource();
    const ng = this.ctx.createGain();
    envelope(ng.gain, t, 0.005, 0.5, 0.9);
    saw.connect(shaper).connect(g).connect(bus);
    n.connect(ng).connect(bus);
    saw.start(t);
    saw.stop(t + 1.3);
    n.start(t);
    n.stop(t + 1.0);
    this.onSound(GATE.scream);
  }

  private newScreamBus(): GainNode {
    const bus = this.ctx.createGain();
    bus.connect(this.master);
    setTimeout(() => bus.disconnect(), 3000);
    this.screamBus = bus;
    return bus;
  }

  /** Plays a media element's sound through the master bus, so silence() cuts it with everything else. Once per element. */
  playThrough(el: HTMLMediaElement, gain: number): void {
    const g = this.ctx.createGain();
    g.gain.value = gain;
    this.ctx.createMediaElementSource(el).connect(g).connect(this.master);
  }

  /**
   * Laid over the thud and the clip when you're caught: a distorted, dissonant orchestra stab, a
   * metallic shriek tearing downward, an inhuman ring-modulated growl, and smaller stabs on the
   * clip's two face flickers (JUMPSCARE_FLICKER_HITS_S). A high ringing is left in your ears after.
   */
  jumpscareSting(): void {
    const t = this.ctx.currentTime;
    const l = CONFIG.JUMPSCARE_STING_GAIN;
    const bus = this.ctx.createGain();
    bus.connect(this.master);
    setTimeout(() => bus.disconnect(), 8000);
    this.stingStab(bus, t, l);
    this.stingShriek(bus, t, l, 1.3);
    // The growl: a low saw ring-modulated by a slow sine, so it sounds like a throat, not an instrument.
    const growl = this.ctx.createOscillator();
    growl.type = 'sawtooth';
    growl.frequency.setValueAtTime(70, t);
    growl.frequency.exponentialRampToValueAtTime(42, t + 1.8);
    const ring = this.ctx.createGain();
    ring.gain.value = 0;
    const mod = this.ctx.createOscillator();
    mod.frequency.value = 37;
    mod.connect(ring.gain);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(250);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const gg = this.ctx.createGain();
    envelope(gg.gain, t, 0.02, l * 0.7, 2);
    growl.connect(ring).connect(shaper).connect(lp).connect(gg).connect(bus);
    growl.start(t);
    mod.start(t);
    growl.stop(t + 2.2);
    mod.stop(t + 2.2);
    for (const at of CONFIG.JUMPSCARE_FLICKER_HITS_S) {
      this.stingStab(bus, t + at, l * 0.65);
      this.stingShriek(bus, t + at, l * 0.5, 0.5);
    }
    // Tinnitus: a thin high whine that outlasts everything and fades away.
    const tin = this.ctx.createOscillator();
    tin.frequency.value = 6200;
    const tg = this.ctx.createGain();
    tg.gain.setValueAtTime(0.0001, t);
    tg.gain.exponentialRampToValueAtTime(l * 0.05, t + 0.4);
    tg.gain.exponentialRampToValueAtTime(0.0001, t + 5);
    tin.connect(tg).connect(bus);
    tin.start(t);
    tin.stop(t + 5.1);
  }

  /** A dissonant cluster (minor seconds and a tritone) of distorted saws, hit hard and let ring. */
  private stingStab(bus: AudioNode, t: number, l: number): void {
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(120);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'lowpass';
    bp.frequency.setValueAtTime(5000, t);
    bp.frequency.exponentialRampToValueAtTime(600, t + 1.2);
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.004, l * 0.45, 1.3);
    shaper.connect(bp).connect(g).connect(bus);
    for (const f of [116.5, 123.5, 164.8, 233, 246.9, 349.2]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.detune.setValueAtTime(0, t);
      o.detune.linearRampToValueAtTime(-60, t + 1.4); // the whole chord sags as it dies
      o.connect(shaper);
      o.start(t);
      o.stop(t + 1.5);
    }
  }

  /** A metallic FM shriek tearing downward. */
  private stingShriek(bus: AudioNode, t: number, l: number, durS: number): void {
    const carrier = this.ctx.createOscillator();
    carrier.frequency.setValueAtTime(2700, t);
    carrier.frequency.exponentialRampToValueAtTime(1300, t + durS);
    const mod = this.ctx.createOscillator();
    mod.frequency.setValueAtTime(311, t);
    mod.frequency.exponentialRampToValueAtTime(190, t + durS);
    const depth = this.ctx.createGain();
    depth.gain.value = 1600;
    mod.connect(depth).connect(carrier.frequency);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2200;
    bp.Q.value = 1.2;
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.006, l * 0.35, durS);
    carrier.connect(bp).connect(g).connect(bus);
    carrier.start(t);
    mod.start(t);
    carrier.stop(t + durS + 0.1);
    mod.stop(t + durS + 0.1);
  }

  /** You're caught: one heavy body-blow thud (sub drop, a dull knock and a short burst of low rumble) as the clip hits. */
  thud(): void {
    const t = this.ctx.currentTime;
    const l = CONFIG.JUMPSCARE_THUD_GAIN;
    const bus = this.newScreamBus();
    const sub = this.ctx.createOscillator();
    sub.frequency.setValueAtTime(110, t);
    sub.frequency.exponentialRampToValueAtTime(32, t + 0.5);
    const sg = this.ctx.createGain();
    envelope(sg.gain, t, 0.003, l, 0.7);
    sub.connect(sg).connect(bus);
    sub.start(t);
    sub.stop(t + 0.8);
    const knock = this.ctx.createOscillator();
    knock.type = 'triangle';
    knock.frequency.setValueAtTime(190, t);
    knock.frequency.exponentialRampToValueAtTime(70, t + 0.08);
    const kg = this.ctx.createGain();
    envelope(kg.gain, t, 0.001, l * 0.7, 0.12);
    knock.connect(kg).connect(bus);
    knock.start(t);
    knock.stop(t + 0.2);
    const n = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 0.4);
    const ng = this.ctx.createGain();
    envelope(ng.gain, t, 0.002, l * 0.8, 0.45);
    n.connect(lp).connect(ng).connect(bus);
    n.start(t);
    n.stop(t + 0.6);
    this.onSound(GATE.thud);
  }

  /** The jumpscare's hard cut: the scream stops dead and everything goes quiet until silence(false). */
  silence(on: boolean): void {
    const t = this.ctx.currentTime;
    if (on) {
      this.screamBus?.gain.setTargetAtTime(0, t, 0.006);
      this.master.gain.setTargetAtTime(0, t, 0.006);
    } else {
      this.master.gain.setTargetAtTime(CONFIG.MASTER_VOLUME, t, 0.25);
    }
  }

  /** A Hollow has heard you and starts hunting: three dry clicks and a rasp from where it stands. */
  alerted(x: number, z: number): void {
    const t = this.ctx.currentTime;
    const panner = this.oneShotPanner(x, z, t);
    for (let i = 0; i < 3; i++) {
      const src = this.noiseSource();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600 - i * 300;
      bp.Q.value = 3;
      const g = this.ctx.createGain();
      envelope(g.gain, t + i * 0.075, 0.002, CONFIG.ALERTED_GAIN, 0.03);
      src.connect(bp).connect(g).connect(panner);
      src.start(t + i * 0.075, Math.random());
      src.stop(t + i * 0.075 + 0.06);
    }
    const rasp = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'bandpass';
    lp.frequency.value = 380;
    lp.Q.value = 1.2;
    const rg = this.ctx.createGain();
    envelope(rg.gain, t + 0.25, 0.08, CONFIG.ALERTED_GAIN * 0.8, 0.45);
    rasp.connect(lp).connect(rg).connect(panner);
    rasp.start(t + 0.25, Math.random());
    rasp.stop(t + 0.85);
    this.onSound(GATE.alerted);
  }

  /** Low ambient drone for atmosphere. Idempotent. */
  startDrone(): void {
    if (this.drone.length > 0) return;
    const g = this.droneGain;
    for (const f of [55, 55.6]) {
      const o = this.ctx.createOscillator();
      o.frequency.value = f;
      o.connect(g);
      o.start();
      this.drone.push(o);
    }
    const n = this.noiseSource(true);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 140;
    n.connect(lp).connect(g);
    n.start();
    this.drone.push(n);
  }

  stopDrone(): void {
    for (const s of this.drone) s.stop();
    this.drone = [];
  }

  /** 0..1 of DRONE_GAIN. Silence is the warning: World.droneLevel() drops it as danger nears. */
  setDroneLevel(level: number): void {
    this.droneGain.gain.setTargetAtTime(CONFIG.DRONE_GAIN * level, this.ctx.currentTime, CONFIG.DRONE_FADE_S / 3);
  }

  // ---------------------------------------------------------------- sound design: dread

  /** Breathing in ONE ear (no 3D panning): side +1 = right, -1 = left; closeness 0 = silent. Call every frame. */
  updateEarBreath(side: number, closeness: number): void {
    if (!this.earBreath) {
      if (closeness <= 0) return;
      const src = this.noiseSource(true);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 650;
      bp.Q.value = 0.8;
      const rhythm = this.ctx.createGain();
      rhythm.gain.value = 0.5;
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.32;
      const depth = this.ctx.createGain();
      depth.gain.value = 0.5;
      lfo.connect(depth).connect(rhythm.gain);
      const amp = this.ctx.createGain();
      amp.gain.value = 0;
      const pan = new StereoPannerNode(this.ctx, { pan: side });
      src.connect(bp).connect(rhythm).connect(amp).connect(pan).connect(this.master);
      src.start(0, Math.random());
      lfo.start();
      this.earBreath = { amp, pan };
    }
    const t = this.ctx.currentTime;
    this.earBreath.pan.pan.setTargetAtTime(side, t, 0.05);
    this.earBreath.amp.gain.setTargetAtTime(CONFIG.EAR_BREATH_GAIN * closeness, t, 0.15);
  }

  /** The Hush's whisper: a hissing formant that wobbles, in 3D at (x, z). closeness 0 = silent. Call every frame. */
  updateHush(x: number, z: number, closeness: number): void {
    if (!this.hushVoice) {
      if (closeness <= 0) return;
      const src = this.noiseSource(true);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 5;
      const formant = this.ctx.createOscillator();
      formant.frequency.value = 0.7;
      const formantDepth = this.ctx.createGain();
      formantDepth.gain.value = 900;
      formant.connect(formantDepth).connect(bp.frequency);
      const amp = this.ctx.createGain();
      amp.gain.value = 0;
      const panner = this.makePanner();
      src.connect(bp).connect(amp).connect(panner).connect(this.master);
      src.start(0, Math.random());
      formant.start();
      this.hushVoice = { amp, panner };
    }
    const t = this.ctx.currentTime;
    setPannerPosition(this.hushVoice.panner, x, 1.6, z, t);
    this.hushVoice.amp.gain.setTargetAtTime(CONFIG.HUSH_WHISPER_GAIN * closeness * closeness, t, 0.25);
  }

  /** A scrape with nothing there, in 3D at (x, z). */
  fakeScrape(x: number, z: number): void {
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 0.9;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.45, t + 0.12);
    g.gain.setValueAtTime(0.45, t + 0.45);
    g.gain.linearRampToValueAtTime(0.0001, t + 0.7);
    const panner = this.oneShotPanner(x, z, t);
    src.connect(bp).connect(g).connect(panner);
    src.start(t, Math.random() * 1.2);
    src.stop(t + 0.75);
    this.onSound(GATE.scrape);
  }

  /**
   * A clay pot shattering on rock, in 3D at (x, z): a dull thud, a bright crack, then shards ringing
   * and skittering away over ~0.6 s. The cave echoes it, like a clap.
   */
  potShatter(x: number, z: number, loudness: number): void {
    const t = this.ctx.currentTime;
    const l = Math.min(Math.max(loudness, 0.3), 1.5) * CONFIG.POT_GAIN;
    const panner = this.oneShotPanner(x, z, t);
    // The body of the pot hitting the floor.
    const thud = this.ctx.createOscillator();
    thud.frequency.setValueAtTime(160, t);
    thud.frequency.exponentialRampToValueAtTime(55, t + 0.12);
    const tg = this.ctx.createGain();
    envelope(tg.gain, t, 0.003, 0.7 * l, 0.16);
    thud.connect(tg).connect(panner);
    thud.start(t);
    thud.stop(t + 0.22);
    // The crack: a burst of bright noise.
    const crack = this.noiseSource();
    const hp = this.ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 1800;
    const cg = this.ctx.createGain();
    envelope(cg.gain, t, 0.001, 0.9 * l, 0.09);
    crack.connect(hp).connect(cg).connect(panner);
    cg.connect(this.echoIn);
    crack.start(t, Math.random() * 1.5);
    crack.stop(t + 0.12);
    // Shards: short ringing clinks, denser at first, spreading out as the pieces skitter away.
    for (let i = 0; i < 9; i++) {
      const at = t + 0.02 + Math.pow(Math.random(), 1.6) * 0.6;
      const o = this.ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1900 + Math.random() * 2600;
      const og = this.ctx.createGain();
      envelope(og.gain, at, 0.001, (0.12 + Math.random() * 0.12) * l * (1 - (at - t) * 0.9), 0.05 + Math.random() * 0.07);
      o.connect(og).connect(panner);
      o.start(at);
      o.stop(at + 0.15);
    }
    this.onSound(GATE.pot);
  }

  /**
   * A pot summoned the Stalker. Far behind you something wakes with a long, broken groan; then an
   * intense dissonant drone starts under everything (it swells, brightens and sours with
   * updateStalker's intensity), and its own 3D voice carries a limping gait (a heavy step, then a
   * lighter one and a drag), wet breathing that grows as it nears, and now and then a whisper.
   */
  stalkerStart(x: number, z: number): void {
    if (this.stalker) return;
    const t = this.ctx.currentTime;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 300;
    filter.Q.value = 4;
    const dread = this.ctx.createGain();
    dread.gain.setValueAtTime(0.0001, t);
    filter.connect(dread).connect(this.master);
    const sources: AudioScheduledSourceNode[] = [];
    const detune: AudioParam[] = [];
    // A low cluster a semitone apart, beating against itself; the detune grows as it comes closer.
    for (const [f, type] of [[55, 'sawtooth'], [58.3, 'sawtooth'], [82.4, 'square'], [116.5, 'sawtooth']] as const) {
      const o = this.ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      o.connect(filter);
      o.start(t);
      sources.push(o);
      detune.push(o.detune);
    }
    // Strings scraping high above it, sliding slowly sharp: the riser.
    const riser = this.ctx.createGain();
    riser.gain.value = 0;
    riser.connect(this.master);
    const riserFreqs: AudioParam[] = [];
    for (const f of RISER_HZ) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      const vib = this.ctx.createOscillator();
      vib.frequency.value = 5.5 + Math.random();
      const vd = this.ctx.createGain();
      vd.gain.value = 9;
      vib.connect(vd).connect(o.frequency);
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f * 1.5;
      bp.Q.value = 2;
      o.connect(bp).connect(riser);
      o.start(t);
      vib.start(t);
      sources.push(o, vib);
      riserFreqs.push(o.frequency);
    }
    const panner = this.makePanner();
    panner.refDistance = 3;
    panner.rolloffFactor = 0.9;
    panner.connect(this.master);
    setPannerPosition(panner, x, 1.5, z, t);
    // Its breath: filtered noise drawn in and let out, slowly, wetly.
    const breathSrc = this.noiseSource(true);
    const breathBp = this.ctx.createBiquadFilter();
    breathBp.type = 'bandpass';
    breathBp.frequency.value = 650;
    breathBp.Q.value = 1.4;
    const breathCycle = this.ctx.createGain();
    breathCycle.gain.value = 0.5;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.42;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(breathCycle.gain);
    const lfoFilter = this.ctx.createGain();
    lfoFilter.gain.value = 260;
    lfo.connect(lfoFilter).connect(breathBp.frequency);
    const breath = this.ctx.createGain();
    breath.gain.value = 0;
    breathSrc.connect(breathBp).connect(breathCycle).connect(breath).connect(panner);
    breathSrc.start(t, Math.random());
    lfo.start(t);
    sources.push(breathSrc, lfo);
    this.stalker = { dread, filter, detune, riser, riserFreqs, breath, panner, sources, nextStepS: 0, stepIndex: 0, nextWhisperS: t + 2.5, swell: null };
    this.stalkerGroan(panner, t + 0.5);
  }

  /**
   * Call every frame while the Stalker is around.
   * @param intensity 0..1 (World.stalkerCloseness): louder, brighter and more sour as it comes
   * @param speedMps how fast it walks (0 = no footsteps)
   * @param held its face is in yours: the music drops away and there is only its breath, right in front of you
   */
  updateStalker(x: number, z: number, intensity: number, speedMps: number, held: boolean): void {
    const s = this.stalker;
    if (!s) return;
    const t = this.ctx.currentTime;
    setPannerPosition(s.panner, x, 1.5, z, t);
    const i = Math.min(Math.max(intensity, 0), 1);
    const level = held ? CONFIG.STALKER_DREAD_GAIN * 0.2 : CONFIG.STALKER_DREAD_GAIN * (0.25 + 0.75 * i * i);
    s.dread.gain.setTargetAtTime(level, t, held ? 0.04 : 0.3);
    s.filter.frequency.setTargetAtTime(held ? 140 : 300 + 2600 * i * i, t, 0.3);
    s.detune.forEach((d, k) => d.setTargetAtTime((k % 2 ? 1 : -1) * 40 * i, t, 0.5));
    s.riser.gain.setTargetAtTime(held ? 0.0001 : CONFIG.STALKER_RISER_GAIN * i * i, t, held ? 0.02 : 0.4);
    // The strings slide up to a semitone sharp as it closes in.
    s.riserFreqs.forEach((f, k) => f.setTargetAtTime(RISER_HZ[k] * Math.pow(2, i / 12), t, 0.6));
    s.breath.gain.setTargetAtTime(held ? CONFIG.STALKER_BREATH_GAIN : CONFIG.STALKER_BREATH_GAIN * 0.6 * i, t, 0.3);
    if (speedMps > 0.2) {
      if (t >= s.nextStepS) {
        // A limp: a heavy step, then a lighter one dragged after it.
        const heavy = s.stepIndex % 2 === 0;
        this.stalkerStep(s.panner, t, (0.5 + 0.5 * i) * (heavy ? 1 : 0.6), !heavy);
        s.stepIndex++;
        const stride = CONFIG.STALKER_STRIDE_M / speedMps;
        s.nextStepS = t + stride * (heavy ? 0.7 : 1.3) * (0.92 + 0.16 * Math.random());
      }
      if (!held && t >= s.nextWhisperS) {
        this.stalkerWhisper(s.panner, t, 0.4 + 0.6 * i);
        s.nextWhisperS = t + 2.2 + Math.random() * 2.8;
      }
    } else {
      s.nextStepS = 0;
    }
  }

  /**
   * STAND STILL: a reversed swell (air and a scraping chord pulled in backwards) that grows for durS
   * and is cut dead by stalkerHit, so the face lands on its peak.
   */
  stalkerSwell(durS: number): void {
    const s = this.stalker;
    if (!s) return;
    const t = this.ctx.currentTime;
    const end = t + durS;
    const src = this.noiseSource(true);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.2;
    bp.frequency.setValueAtTime(300, t);
    bp.frequency.exponentialRampToValueAtTime(5200, end);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(CONFIG.STALKER_SWELL_GAIN, end);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(end + 0.05);
    const nodes: AudioScheduledSourceNode[] = [src];
    for (const f of [146.8, 155.6, 207.7]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.06, end);
      const og = this.ctx.createGain();
      og.gain.setValueAtTime(0.0001, t);
      og.gain.exponentialRampToValueAtTime(CONFIG.STALKER_SWELL_GAIN * 0.3, end);
      o.connect(og).connect(this.master);
      o.start(t);
      o.stop(end + 0.05);
      nodes.push(o);
    }
    s.swell = nodes;
  }

  /**
   * Its face appears: the swell is cut, then a slam, a sub boom, a shrieking string stab and a
   * throat-tearing screech, all at once. After it, nothing but its breath in your face.
   */
  stalkerHit(): void {
    const t = this.ctx.currentTime;
    const s = this.stalker;
    if (s?.swell) {
      for (const n of s.swell) n.stop(t);
      s.swell = null;
    }
    const l = CONFIG.STALKER_HIT_GAIN;
    const boom = this.ctx.createOscillator();
    boom.frequency.setValueAtTime(90, t);
    boom.frequency.exponentialRampToValueAtTime(28, t + 1);
    const bg = this.ctx.createGain();
    envelope(bg.gain, t, 0.004, l, 1.1);
    boom.connect(bg).connect(this.master);
    boom.start(t);
    boom.stop(t + 1.2);
    const slam = this.noiseSource();
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 1400;
    const sg = this.ctx.createGain();
    envelope(sg.gain, t, 0.002, l * 0.8, 0.25);
    slam.connect(lp).connect(sg).connect(this.master);
    sg.connect(this.echoIn);
    slam.start(t, Math.random());
    slam.stop(t + 0.3);
    // The string stab: a tight cluster, bowed hard, falling.
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 1.5;
    const cg = this.ctx.createGain();
    envelope(cg.gain, t, 0.01, l * 0.4, 1.2);
    bp.connect(cg).connect(this.master);
    for (const f of [1244, 1318, 1396, 1975]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 0.92, t + 1.2);
      o.connect(bp);
      o.start(t);
      o.stop(t + 1.3);
    }
    // The screech: a distorted voice-like tone with a fast, ragged vibrato and a vowel sweeping open.
    const voice = this.ctx.createOscillator();
    voice.type = 'sawtooth';
    voice.frequency.setValueAtTime(420, t);
    voice.frequency.exponentialRampToValueAtTime(780, t + 0.12);
    voice.frequency.exponentialRampToValueAtTime(330, t + 1);
    const vib = this.ctx.createOscillator();
    vib.frequency.value = 23;
    const vd = this.ctx.createGain();
    vd.gain.value = 45;
    vib.connect(vd).connect(voice.frequency);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(300);
    const vowel = this.ctx.createBiquadFilter();
    vowel.type = 'bandpass';
    vowel.Q.value = 3;
    vowel.frequency.setValueAtTime(700, t);
    vowel.frequency.exponentialRampToValueAtTime(2600, t + 0.15);
    vowel.frequency.exponentialRampToValueAtTime(900, t + 1);
    const vg = this.ctx.createGain();
    envelope(vg.gain, t, 0.01, l * 0.55, 0.9);
    voice.connect(shaper).connect(vowel).connect(vg).connect(this.newScreamBus());
    voice.start(t);
    vib.start(t);
    voice.stop(t + 1.1);
    vib.stop(t + 1.1);
    this.onSound(GATE.stalkerHit);
  }

  /** It turns away: a long, low exhale right in front of you and a last groan as it goes. */
  stalkerExhale(): void {
    const s = this.stalker;
    if (!s) return;
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1;
    bp.frequency.setValueAtTime(900, t);
    bp.frequency.exponentialRampToValueAtTime(260, t + 1.6);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(CONFIG.STALKER_BREATH_GAIN * 1.6, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 1.7);
    src.connect(bp).connect(g).connect(s.panner);
    src.start(t, Math.random());
    src.stop(t + 1.8);
    this.stalkerGroan(s.panner, t + 0.3, 0.5);
  }

  /** It is gone (or the level ended): the drone fades and its voice is torn down. */
  stalkerStop(): void {
    const s = this.stalker;
    if (!s) return;
    this.stalker = null;
    const t = this.ctx.currentTime;
    s.dread.gain.setTargetAtTime(0.0001, t, 0.6);
    s.riser.gain.setTargetAtTime(0.0001, t, 0.3);
    s.breath.gain.setTargetAtTime(0.0001, t, 0.3);
    for (const n of s.swell ?? []) n.stop(t);
    for (const src of s.sources) src.stop(t + 3);
    setTimeout(() => {
      s.dread.disconnect();
      s.riser.disconnect();
      s.panner.disconnect();
    }, 3500);
  }

  /** One of its steps: a deep thud with grit crunching under it; a dragged step scrapes on after. */
  private stalkerStep(panner: PannerNode, t: number, intensity: number, drag: boolean): void {
    const g = CONFIG.STALKER_STEP_GAIN * intensity;
    const thud = this.ctx.createOscillator();
    thud.frequency.setValueAtTime(75, t);
    thud.frequency.exponentialRampToValueAtTime(36, t + 0.18);
    const tg = this.ctx.createGain();
    envelope(tg.gain, t, 0.004, g, 0.22);
    thud.connect(tg).connect(panner);
    tg.connect(this.echoIn);
    thud.start(t);
    thud.stop(t + 0.28);
    const grit = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700 + Math.random() * 400;
    bp.Q.value = 0.8;
    const ng = this.ctx.createGain();
    envelope(ng.gain, t + 0.01, 0.01, g * 0.5, 0.14);
    grit.connect(bp).connect(ng).connect(panner);
    grit.start(t, Math.random());
    grit.stop(t + 0.2);
    if (drag) {
      const scrape = this.noiseSource();
      const sb = this.ctx.createBiquadFilter();
      sb.type = 'bandpass';
      sb.Q.value = 1.1;
      sb.frequency.setValueAtTime(450, t + 0.08);
      sb.frequency.linearRampToValueAtTime(820, t + 0.55);
      const dg = this.ctx.createGain();
      dg.gain.setValueAtTime(0.0001, t + 0.08);
      dg.gain.linearRampToValueAtTime(g * 0.35, t + 0.2);
      dg.gain.linearRampToValueAtTime(0.0001, t + 0.6);
      scrape.connect(sb).connect(dg).connect(panner);
      scrape.start(t + 0.08, Math.random());
      scrape.stop(t + 0.62);
    }
    this.onSound(GATE.step);
  }

  /** A long groan from deep in a throat: a low voice cracking upward, then sliding down. */
  private stalkerGroan(panner: PannerNode, t: number, gain = 1): void {
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(96, t);
    o.frequency.linearRampToValueAtTime(118, t + 0.5);
    o.frequency.exponentialRampToValueAtTime(52, t + 2.2);
    const wobble = this.ctx.createOscillator();
    wobble.frequency.value = 7;
    const wd = this.ctx.createGain();
    wd.gain.value = 6;
    wobble.connect(wd).connect(o.frequency);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(120);
    const vowel = this.ctx.createBiquadFilter();
    vowel.type = 'bandpass';
    vowel.Q.value = 2.5;
    vowel.frequency.setValueAtTime(520, t);
    vowel.frequency.exponentialRampToValueAtTime(320, t + 2.2);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(CONFIG.STALKER_GROAN_GAIN * gain, t + 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    o.connect(shaper).connect(vowel).connect(g).connect(panner);
    g.connect(this.echoIn);
    o.start(t);
    wobble.start(t);
    o.stop(t + 2.5);
    wobble.stop(t + 2.5);
  }

  /** A breathy whisper, a few syllables of nothing, from wherever it is. */
  private stalkerWhisper(panner: PannerNode, t: number, gain: number): void {
    const syllables = 3 + Math.floor(Math.random() * 3);
    let at = t;
    for (let k = 0; k < syllables; k++) {
      const len = 0.08 + Math.random() * 0.14;
      const src = this.noiseSource();
      const bp = this.ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.Q.value = 7;
      bp.frequency.setValueAtTime(1800 + Math.random() * 1600, at);
      bp.frequency.linearRampToValueAtTime(1500 + Math.random() * 2200, at + len);
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(CONFIG.STALKER_WHISPER_GAIN * gain, at + len * 0.3);
      g.gain.linearRampToValueAtTime(0.0001, at + len);
      src.connect(bp).connect(g).connect(panner);
      src.start(at, Math.random());
      src.stop(at + len + 0.02);
      at += len + 0.03 + Math.random() * 0.06;
    }
  }

  /** The player's clap, copied: a clap transient plus a slightly flat sonar chirp, in 3D at (x, z). */
  mimic(x: number, z: number, loudness: number): void {
    const t = this.ctx.currentTime;
    const l = Math.min(Math.max(loudness, 0.2), 1.2);
    const panner = this.oneShotPanner(x, z, t);
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1400;
    bp.Q.value = 1.1;
    const cg = this.ctx.createGain();
    envelope(cg.gain, t, 0.002, 0.6 * l, 0.06);
    src.connect(bp).connect(cg).connect(panner);
    src.start(t, Math.random() * 1.5);
    src.stop(t + 0.1);
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(1350, t);
    osc.frequency.exponentialRampToValueAtTime(780, t + 0.45);
    const og = this.ctx.createGain();
    envelope(og.gain, t, 0.005, 0.1 * l, 0.6);
    osc.connect(og).connect(panner);
    og.connect(this.echoIn);
    osc.start(t);
    osc.stop(t + 0.7);
    this.onSound(GATE.mimic);
  }

  /** A short dissonant swell: "it moved", "it's there". */
  sting(): void {
    const t = this.ctx.currentTime;
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(400, t);
    lp.frequency.exponentialRampToValueAtTime(2400, t + 0.15);
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.03, 0.22, 0.9);
    lp.connect(g).connect(this.master);
    for (const f of [92.5, 98, 138.6]) {
      const o = this.ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      o.start(t);
      o.stop(t + 1);
    }
    this.onSound(GATE.sting);
  }

  /** The finale: a deep roar that everything is awake. */
  roar(): void {
    const t = this.ctx.currentTime;
    const saw = this.ctx.createOscillator();
    saw.type = 'sawtooth';
    saw.frequency.setValueAtTime(70, t);
    saw.frequency.exponentialRampToValueAtTime(42, t + 1.8);
    const shaper = this.ctx.createWaveShaper();
    shaper.curve = distortionCurve(200);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 600;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55, t + 0.35);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2);
    saw.connect(shaper).connect(lp).connect(g).connect(this.master);
    g.connect(this.echoIn);
    saw.start(t);
    saw.stop(t + 2.05);
    this.onSound(GATE.roar);
  }

  /** The Hush catching the player: an airy, rising shriek instead of the Hollows' growl. */
  hushScream(): void {
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 6;
    bp.frequency.setValueAtTime(1200, t);
    bp.frequency.exponentialRampToValueAtTime(5200, t + 0.9);
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.02, 1.2, 1.1);
    src.connect(bp).connect(g).connect(this.newScreamBus());
    src.start(t);
    src.stop(t + 1.2);
    this.onSound(GATE.scream);
  }

  /** A water drop landing in a puddle, in 3D at (x, z): a falling "plink". */
  drip(x: number, z: number): void {
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(1900 + Math.random() * 500, t);
    osc.frequency.exponentialRampToValueAtTime(700, t + 0.09);
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.002, CONFIG.DRIP_GAIN, 0.14);
    const panner = this.oneShotPanner(x, z, t);
    osc.connect(g).connect(panner);
    g.connect(this.echoIn);
    osc.start(t);
    osc.stop(t + 0.2);
    this.onSound(GATE.drip);
  }

  /** A flock of wings: fluttering noise that flies from (x0, z0) over the listener to (x1, z1). */
  bats(x0: number, z0: number, x1: number, z1: number, durS: number): void {
    const t = this.ctx.currentTime;
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 0.7;
    const flutter = this.ctx.createGain();
    flutter.gain.value = 0.5;
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = CONFIG.BAT_FLAP_HZ * 2;
    const depth = this.ctx.createGain();
    depth.gain.value = 0.5;
    lfo.connect(depth).connect(flutter.gain);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(CONFIG.BAT_GAIN, t + 0.12);
    g.gain.setValueAtTime(CONFIG.BAT_GAIN, t + durS * 0.6);
    g.gain.linearRampToValueAtTime(0.0001, t + durS);
    const panner = this.oneShotPanner(x0, z0, t);
    panner.positionX.linearRampToValueAtTime(x1, t + durS);
    panner.positionZ.linearRampToValueAtTime(z1, t + durS);
    src.connect(bp).connect(flutter).connect(g).connect(panner);
    src.start(t, Math.random() * 0.5);
    src.stop(t + durS + 0.05);
    lfo.start(t);
    lfo.stop(t + durS + 0.05);
    this.onSound(GATE.bats);
  }

  /** Silences the per-level dread voices (call on level change). */
  resetDread(): void {
    const t = this.ctx.currentTime;
    this.earBreath?.amp.gain.setTargetAtTime(0, t, 0.05);
    this.hushVoice?.amp.gain.setTargetAtTime(0, t, 0.05);
  }

  // ---------------------------------------------------------------- monster voices (3D)

  /** Creates the looping scrape + breath sounds for a monster (silent until updateVoice says otherwise). */
  addVoice(id: number): void {
    if (this.voices.has(id)) return;
    const panner = this.makePanner();
    panner.connect(this.master);

    const scrapeSrc = this.noiseSource(true);
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 500;
    bp.Q.value = 0.9;
    const scrapeGain = this.ctx.createGain();
    scrapeGain.gain.value = 0;
    scrapeSrc.connect(bp).connect(scrapeGain).connect(panner);

    const breathSrc = this.noiseSource(true);
    const lp = this.ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 350;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.5; // 0.5 +/- 0.5 from the LFO below
    const lfo = this.ctx.createOscillator();
    lfo.frequency.value = 0.28;
    const lfoDepth = this.ctx.createGain();
    lfoDepth.gain.value = 0.5;
    lfo.connect(lfoDepth).connect(lfoGain.gain);
    const breathAmp = this.ctx.createGain();
    breathAmp.gain.value = 0;
    breathSrc.connect(lp).connect(lfoGain).connect(breathAmp).connect(panner);

    const offset = Math.random() * 1.9;
    scrapeSrc.start(0, offset);
    breathSrc.start(0, (offset + 0.7) % 1.9);
    lfo.start();
    this.voices.set(id, { panner, scrapeGain, breathAmp, sources: [scrapeSrc, breathSrc, lfo], moving: false, nextStepS: 0 });
  }

  /**
   * Call every frame per monster.
   * @param speedMps how fast it moves: a creep scrapes softly; running adds quick bony footsteps
   */
  updateVoice(id: number, x: number, z: number, moving: boolean, distanceToPlayer: number, speedMps = 0): void {
    const v = this.voices.get(id);
    if (!v) return;
    const t = this.ctx.currentTime;
    setPannerPosition(v.panner, x, 1.6, z, t);
    const speedRatio = speedMps / CONFIG.HOLLOW_SCRAPE_FULL_SPEED;
    v.scrapeGain.gain.setTargetAtTime(moving ? 0.55 * Math.min(Math.max(speedRatio, 0.25), 1) : 0, t, 0.03);
    if (moving && speedMps >= CONFIG.HOLLOW_STEP_MIN_SPEED) {
      if (t >= v.nextStepS) {
        this.hollowStep(v.panner, t, Math.min(speedMps / CONFIG.HUNT_SPEED_FAR, 1));
        v.nextStepS = t + (CONFIG.HOLLOW_STRIDE_M / speedMps) * (0.85 + 0.3 * Math.random());
      }
    } else {
      v.nextStepS = 0;
    }
    const breath = distanceToPlayer < 9 ? 0.35 * (1 - distanceToPlayer / 9) : 0;
    v.breathAmp.gain.setTargetAtTime(breath, t, 0.2);
    if (moving && !v.moving) this.onSound(GATE.scrape);
    v.moving = moving;
  }

  /** One running footstep: a dry knock with a soft thud, louder the faster it runs. */
  private hollowStep(panner: PannerNode, t: number, intensity: number): void {
    const src = this.noiseSource();
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1300 + Math.random() * 500;
    bp.Q.value = 1.6;
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.002, CONFIG.HOLLOW_STEP_GAIN * (0.5 + 0.5 * intensity), 0.05);
    src.connect(bp).connect(g).connect(panner);
    src.start(t, Math.random());
    src.stop(t + 0.08);
    const thud = this.ctx.createOscillator();
    thud.frequency.setValueAtTime(110, t);
    thud.frequency.exponentialRampToValueAtTime(55, t + 0.06);
    const tg = this.ctx.createGain();
    envelope(tg.gain, t, 0.003, CONFIG.HOLLOW_STEP_GAIN * 0.8 * intensity, 0.07);
    thud.connect(tg).connect(panner);
    thud.start(t);
    thud.stop(t + 0.1);
    this.onSound(GATE.step);
  }

  clearVoices(): void {
    for (const v of this.voices.values()) {
      for (const s of v.sources) s.stop();
      v.panner.disconnect();
    }
    this.voices.clear();
  }

  // ---------------------------------------------------------------- helpers

  private tone(freq: number, durS: number, gain: number, type: OscillatorType, t: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    envelope(g.gain, t, 0.005, gain, durS);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + durS + 0.05);
  }

  private noiseSource(loop = false): AudioBufferSourceNode {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = loop;
    return src;
  }

  /** A 3D panner at (x, z) for a one-shot sound; it disconnects itself after a few seconds. */
  private oneShotPanner(x: number, z: number, t: number): PannerNode {
    const p = this.makePanner();
    setPannerPosition(p, x, 1.6, z, t);
    p.connect(this.master);
    setTimeout(() => p.disconnect(), 4000);
    return p;
  }

  private makePanner(): PannerNode {
    return new PannerNode(this.ctx, {
      panningModel: 'HRTF',
      distanceModel: 'inverse',
      refDistance: 2,
      rolloffFactor: 1.3,
      maxDistance: 60,
    });
  }
}

/** Exponential attack/decay. Exponential ramps cannot touch 0, hence the 0.0001 floor. */
function envelope(param: AudioParam, t: number, attackS: number, peak: number, decayS: number): void {
  const p = Math.max(peak, 0.0002);
  param.setValueAtTime(0.0001, t);
  param.exponentialRampToValueAtTime(p, t + attackS);
  param.exponentialRampToValueAtTime(0.0001, t + attackS + decayS);
}

function setPannerPosition(p: PannerNode, x: number, y: number, z: number, t: number): void {
  p.positionX.setValueAtTime(x, t);
  p.positionY.setValueAtTime(y, t);
  p.positionZ.setValueAtTime(z, t);
}

function makeNoiseBuffer(ctx: AudioContext, seconds: number): AudioBuffer {
  const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * seconds), ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
  return buf;
}

function distortionCurve(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(new ArrayBuffer(n * 4));
  for (let i = 0; i < n; i++) {
    const x = (i * 2) / n - 1;
    curve[i] = ((3 + amount) * x * 20 * (Math.PI / 180)) / (Math.PI + amount * Math.abs(x));
  }
  return curve;
}
