import { CONFIG } from '../config';

/** Mic-gating durations (ms) reported through onSound when a sound starts. */
const GATE = { ping: 900, footstep: 150, chime: 400, beep: 300, scream: 1500, scrape: 300, ui: 400, heartbeat: 200 };

interface Voice {
  panner: PannerNode;
  scrapeGain: GainNode;
  breathAmp: GainNode;
  sources: AudioScheduledSourceNode[];
  moving: boolean;
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
  private readonly exitPanner: PannerNode;
  private readonly voices = new Map<number, Voice>();
  private drone: AudioScheduledSourceNode[] = [];
  private nextBeatMs = 0;

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

    this.exitPanner = this.makePanner();
    this.exitPanner.connect(this.master);
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

  setExitPosition(x: number, y: number, z: number): void {
    setPannerPosition(this.exitPanner, x, y, z, this.ctx.currentTime);
  }

  // ---------------------------------------------------------------- UI / calibration cues

  beep(freq = 660, durS = 0.15, gain = 0.25): void {
    this.tone(freq, durS, gain, 'sine', this.ctx.currentTime);
    this.onSound(GATE.beep);
  }

  doubleBeep(): void {
    const t = this.ctx.currentTime;
    this.tone(660, 0.12, 0.25, 'sine', t);
    this.tone(880, 0.12, 0.25, 'sine', t + 0.2);
    this.onSound(GATE.beep + 200);
  }

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

  /** The exit's guiding chime (positioned with setExitPosition). */
  chime(): void {
    const t = this.ctx.currentTime;
    for (const [f, d] of [
      [880, 0],
      [1320, 0.09],
    ] as const) {
      const osc = this.ctx.createOscillator();
      osc.frequency.value = f;
      const g = this.ctx.createGain();
      envelope(g.gain, t + d, 0.005, 0.3, 1.4);
      osc.connect(g).connect(this.exitPanner);
      osc.start(t + d);
      osc.stop(t + d + 1.5);
    }
    this.onSound(GATE.chime);
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
    saw.connect(shaper).connect(g).connect(this.master);
    n.connect(ng).connect(this.master);
    saw.start(t);
    saw.stop(t + 1.3);
    n.start(t);
    n.stop(t + 1.0);
    this.onSound(GATE.scream);
  }

  /** Low ambient drone for atmosphere. Idempotent. */
  startDrone(): void {
    if (this.drone.length > 0) return;
    const g = this.ctx.createGain();
    g.gain.value = 0.035;
    g.connect(this.master);
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
    this.voices.set(id, { panner, scrapeGain, breathAmp, sources: [scrapeSrc, breathSrc, lfo], moving: false });
  }

  /** Call every frame per monster. */
  updateVoice(id: number, x: number, z: number, moving: boolean, distanceToPlayer: number): void {
    const v = this.voices.get(id);
    if (!v) return;
    const t = this.ctx.currentTime;
    setPannerPosition(v.panner, x, 1.6, z, t);
    v.scrapeGain.gain.setTargetAtTime(moving ? 0.55 : 0, t, 0.03);
    const breath = distanceToPlayer < 9 ? 0.35 * (1 - distanceToPlayer / 9) : 0;
    v.breathAmp.gain.setTargetAtTime(breath, t, 0.2);
    if (moving && !v.moving) this.onSound(GATE.scrape);
    v.moving = moving;
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
