import { CONFIG } from '../../config';
import { ampToDb, clamp, nextPow2, rmsAndPeak } from './dsp';
import { HumDetector } from './HumDetector';
import { NoiseFloor } from './NoiseFloor';
import { OnsetDetector, type OnsetEvent } from './OnsetDetector';
import { Yin, type PitchResult } from './yin';

/** Where samples come from. The real one wraps an AnalyserNode; tests use a fake. */
export interface SampleSource {
  readonly sampleRate: number;
  /** Length of the buffer read() fills (AnalyserNode.fftSize). */
  readonly bufferSize: number;
  /** Seconds of audio rendered so far (AudioContext.currentTime). */
  currentTime(): number;
  /** Copies the most recent bufferSize samples (oldest first) into `into`. */
  read(into: Float32Array): void;
}

/** Real source: mic MediaStream -> AnalyserNode (NOT connected to the speakers). */
export class AnalyserSource implements SampleSource {
  readonly sampleRate: number;
  readonly bufferSize: number;
  private readonly analyser: AnalyserNode;

  constructor(
    private readonly ctx: AudioContext,
    stream: MediaStream,
    minBufferSize: number,
  ) {
    this.sampleRate = ctx.sampleRate;
    const src = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = Math.min(32768, Math.max(CONFIG.MIN_FFT_SIZE, nextPow2(minBufferSize)));
    this.analyser.smoothingTimeConstant = 0;
    src.connect(this.analyser);
    this.bufferSize = this.analyser.fftSize;
  }

  currentTime(): number {
    return this.ctx.currentTime;
  }

  read(into: Float32Array): void {
    this.analyser.getFloatTimeDomainData(into as Float32Array<ArrayBuffer>);
  }
}

export interface MicFrame {
  /** dBFS of the newest ~21 ms. */
  levelDb: number;
  floorDb: number;
  /** levelDb - floorDb */
  aboveDb: number;
  /** Onsets finalised during this poll (usually 0 or 1). */
  onsets: OnsetEvent[];
  /** Pitch computed this poll, or null. */
  pitch: PitchResult | null;
  humActive: boolean;
  humPitchHz: number;
  hopsProcessed: number;
}

/**
 * Polled once per animation frame. Processes every NEW 128-sample hop since the last poll
 * (counted from AudioContext.currentTime), so onset timing does not depend on the frame rate.
 */
export class MicAnalyzer {
  readonly yin: Yin;
  readonly floor: NoiseFloor;
  readonly onsets: OnsetDetector;
  readonly hum: HumDetector;
  private readonly buf: Float32Array;
  private lastSampleCount = -1;
  private pendingSamples = 0;
  private lastPitchMs = -Infinity;
  private lastOnsetMs = -Infinity;
  private humStartMs = 0;
  private gateUntilMs = -Infinity;

  constructor(private readonly src: SampleSource) {
    const sr = src.sampleRate;
    this.yin = new Yin(sr, CONFIG.YIN_WINDOW_S, CONFIG.YIN_MIN_HZ, CONFIG.YIN_MAX_HZ, CONFIG.YIN_THRESHOLD);
    if (src.bufferSize < this.yin.requiredSamples()) throw new Error('MicAnalyzer: source buffer too small for YIN');
    this.buf = new Float32Array(src.bufferSize);
    this.floor = new NoiseFloor(
      (CONFIG.FLOOR_WINDOW_S * sr) / CONFIG.HOP_SIZE,
      CONFIG.FLOOR_PERCENTILE,
      CONFIG.FLOOR_INIT_DB,
      CONFIG.FLOOR_MIN_DB,
      CONFIG.FLOOR_MAX_DB,
    );
    this.onsets = new OnsetDetector({
      minAboveFloorDb: CONFIG.ONSET_MIN_ABOVE_FLOOR_DB,
      riseDb: CONFIG.ONSET_RISE_DB,
      lookbackHops: CONFIG.ONSET_LOOKBACK_HOPS,
      peakHops: CONFIG.ONSET_PEAK_HOPS,
      decayDb: CONFIG.ONSET_DECAY_DB,
      decayHoldMs: CONFIG.ONSET_DECAY_HOLD_MS,
      maxDurationMs: CONFIG.ONSET_MAX_DURATION_MS,
      minCrestDb: CONFIG.ONSET_MIN_CREST_DB,
      refractoryMs: CONFIG.ONSET_REFRACTORY_MS,
    });
    this.hum = new HumDetector({
      minAboveFloorDb: CONFIG.HUM_MIN_ABOVE_FLOOR_DB,
      maxAperiodicity: CONFIG.YIN_MAX_APERIODICITY,
      minHz: CONFIG.YIN_MIN_HZ,
      maxHz: CONFIG.YIN_MAX_HZ,
      attackMs: CONFIG.HUM_ATTACK_MS,
      releaseMs: CONFIG.HUM_RELEASE_MS,
      maxPitchSpreadOct: CONFIG.HUM_MAX_PITCH_SPREAD_OCT,
      historySize: CONFIG.HUM_PITCH_HISTORY,
    });
  }

  get sampleRate(): number {
    return this.src.sampleRate;
  }

  /** Ignore onsets and hums until this time (game sounds leaking from speakers into the mic). */
  gate(untilMs: number): void {
    this.gateUntilMs = Math.max(this.gateUntilMs, untilMs);
    this.onsets.gate(untilMs);
  }

  update(nowMs: number): MicFrame {
    const sr = this.src.sampleRate;
    const hop = CONFIG.HOP_SIZE;
    const total = Math.round(this.src.currentTime() * sr);
    if (this.lastSampleCount < 0) this.lastSampleCount = total;
    const fresh = clamp(total - this.lastSampleCount, 0, this.buf.length);
    this.lastSampleCount = total;
    this.src.read(this.buf);

    // Whole hops among the fresh samples; a partial hop at the end waits for the next poll.
    this.pendingSamples = Math.min(this.pendingSamples + fresh, this.buf.length);
    const hops = Math.floor(this.pendingSamples / hop);
    this.pendingSamples -= hops * hop;
    const endIdx = this.buf.length - this.pendingSamples;

    const floorFrozen =
      (this.hum.active && nowMs - this.humStartMs < CONFIG.HUM_FLOOR_FREEZE_MAX_MS) || nowMs - this.lastOnsetMs < 300;
    const onsets: OnsetEvent[] = [];
    for (let k = 0; k < hops; k++) {
      const start = endIdx - (hops - k) * hop;
      if (start < 0) continue;
      const { rms, peak } = rmsAndPeak(this.buf, start, hop);
      const levelDb = ampToDb(rms);
      const hopTimeMs = nowMs - ((this.buf.length - (start + hop)) / sr) * 1000;
      if (!floorFrozen) this.floor.push(levelDb);
      const ev = this.onsets.processHop(levelDb, ampToDb(peak), this.floor.floorDb, hopTimeMs);
      if (ev) {
        onsets.push(ev);
        this.lastOnsetMs = nowMs;
      }
    }
    this.floor.recompute();

    const win = Math.min(1024, this.buf.length);
    const levelDb = ampToDb(rmsAndPeak(this.buf, this.buf.length - win, win).rms);
    const gated = nowMs < this.gateUntilMs;
    const aboveDb = gated ? 0 : levelDb - this.floor.floorDb;

    let pitch: PitchResult | null = null;
    if (aboveDb >= CONFIG.HUM_MIN_ABOVE_FLOOR_DB && nowMs - this.lastPitchMs >= CONFIG.PITCH_INTERVAL_MS) {
      pitch = this.yin.detect(this.buf);
      this.lastPitchMs = nowMs;
    }
    const wasActive = this.hum.active;
    this.hum.update(nowMs, aboveDb, pitch);
    if (this.hum.active && !wasActive) this.humStartMs = nowMs;

    return {
      levelDb,
      floorDb: this.floor.floorDb,
      aboveDb: levelDb - this.floor.floorDb,
      onsets,
      pitch,
      humActive: this.hum.active,
      humPitchHz: this.hum.pitchHz,
      hopsProcessed: hops,
    };
  }
}
