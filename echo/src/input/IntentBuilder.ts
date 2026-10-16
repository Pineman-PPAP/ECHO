import { CONFIG } from '../config';
import type { MicFrame } from './audio/MicAnalyzer';
import type { CalibrationData } from './calibration';
import { EyeState } from './face/EyeState';
import type { FaceFrame } from './face/FaceTracker';
import { OneEuroFilter } from './filters/OneEuro';
import type { PlayerIntent } from './intent';
import { humFromMic, leanToSpeed, onsetLoudness, yawToTurnRate } from './mapping';

/**
 * Turns raw sensor frames into a PlayerIntent using the player's calibration.
 * This is the "mapping" stage of the pipeline: sensor -> signal processing -> MAPPING -> game.
 */
export class IntentBuilder {
  readonly eyes: EyeState;
  /** Latest values, exposed for the debug panel. */
  relYawLeftDeg = 0;
  lean = 0;
  private readonly yawFilter = new OneEuroFilter(CONFIG.HEAD_FILTER_MIN_CUTOFF, CONFIG.HEAD_FILTER_BETA, CONFIG.HEAD_FILTER_D_CUTOFF);
  private readonly leanFilter = new OneEuroFilter(CONFIG.HEAD_FILTER_MIN_CUTOFF, CONFIG.HEAD_FILTER_BETA, CONFIG.HEAD_FILTER_D_CUTOFF);
  private lastPresentMs = -Infinity;
  private prevHum = false;

  constructor(private calib: CalibrationData) {
    this.eyes = new EyeState(calib.blinkClose, calib.blinkOpen);
  }

  get calibration(): CalibrationData {
    return this.calib;
  }

  setCalibration(calib: CalibrationData): void {
    this.calib = calib;
    this.eyes.setThresholds(calib.blinkClose, calib.blinkOpen);
    this.eyes.reset();
    this.yawFilter.reset();
    this.leanFilter.reset();
  }

  /**
   * @param face the FaceFrame produced THIS animation frame, or null if the camera had no new frame
   * @param mic this frame's MicFrame, or null if there is no mic
   */
  update(nowMs: number, face: FaceFrame | null, mic: MicFrame | null): PlayerIntent {
    if (face && face.present && face.pose) {
      this.lastPresentMs = nowMs;
      this.eyes.update(nowMs, face.blink);
      const yaw = this.yawFilter.filter(face.pose.yawDeg, nowMs / 1000);
      this.relYawLeftDeg = (yaw - this.calib.neutralYawDeg) * this.calib.leftSign;
      this.lean = this.leanFilter.filter(this.calib.neutralDepth / face.pose.depth - 1, nowMs / 1000);
    }
    const facePresent = nowMs - this.lastPresentMs <= CONFIG.FACE_LOST_PAUSE_MS;
    if (!facePresent) {
      this.yawFilter.reset();
      this.leanFilter.reset();
    }
    const eyesClosed = facePresent && this.eyes.closed;
    const humActive = mic?.humActive ?? false;
    const intent: PlayerIntent = {
      facePresent,
      eyesClosed,
      eyesClosedMs: eyesClosed ? this.eyes.closedForMs(nowMs) : 0,
      turnRate: facePresent ? yawToTurnRate(this.relYawLeftDeg) : 0,
      moveSpeed: facePresent ? leanToSpeed(this.lean) : 0,
      pulses: mic ? mic.onsets
        .filter((o) => o.peakAboveDb >= Math.max(CONFIG.ONSET_MIN_ABOVE_FLOOR_DB, this.calib.clapRefAboveDb - CONFIG.CLAP_REJECT_BELOW_REF_DB))
        .map((o) => onsetLoudness(o.peakAboveDb, this.calib.clapRefAboveDb)) : [],
      hum: humActive && mic ? humFromMic(mic.aboveDb, mic.humPitchHz, this.calib.humRefAboveDb) : null,
      humStarted: humActive && !this.prevHum,
    };
    this.prevHum = humActive;
    return intent;
  }
}
