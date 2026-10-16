import { CONFIG } from '../config';
import { clamp } from './audio/dsp';

const DEG2RAD = Math.PI / 180;

/**
 * Head yaw relative to the calibrated neutral, signed so POSITIVE = player turned to THEIR LEFT,
 * mapped to a camera turn rate in rad/s (positive = turn left, matching three.js rotation.y).
 * Rate control (not absolute angle) so the player can keep looking at the screen while turning.
 */
export function yawToTurnRate(relYawLeftDeg: number): number {
  const a = Math.abs(relYawLeftDeg);
  if (a <= CONFIG.YAW_DEADZONE_DEG) return 0;
  const t = clamp((a - CONFIG.YAW_DEADZONE_DEG) / (CONFIG.YAW_FULL_DEG - CONFIG.YAW_DEADZONE_DEG), 0, 1);
  return Math.sign(relYawLeftDeg) * Math.pow(t, 1.5) * CONFIG.MAX_TURN_RATE_DEG * DEG2RAD;
}

/** lean = neutralDepth / depth - 1 (positive = closer). Returns signed speed in m/s (positive = forward). */
export function leanToSpeed(lean: number): number {
  if (lean > CONFIG.LEAN_FWD_DEADZONE) {
    const t = clamp((lean - CONFIG.LEAN_FWD_DEADZONE) / (CONFIG.LEAN_FWD_FULL - CONFIG.LEAN_FWD_DEADZONE), 0, 1);
    return t * CONFIG.MAX_SPEED_FWD;
  }
  if (lean < -CONFIG.LEAN_BACK_DEADZONE) {
    const t = clamp((-lean - CONFIG.LEAN_BACK_DEADZONE) / (CONFIG.LEAN_BACK_FULL - CONFIG.LEAN_BACK_DEADZONE), 0, 1);
    return -t * CONFIG.MAX_SPEED_BACK;
  }
  return 0;
}

/**
 * Onset loudness -> 0..1.5 (1.0 = the player's calibrated normal clap).
 * @param clapRefAboveDb calibrated clap peak above floor
 */
export function onsetLoudness(peakAboveDb: number, clapRefAboveDb: number): number {
  const lo = CONFIG.ONSET_MIN_ABOVE_FLOOR_DB;
  const span = Math.max(clapRefAboveDb - lo, 6);
  return clamp((peakAboveDb - lo) / span, 0.05, 1.5);
}

/** Pulse radius for a loudness in 0..1.5. */
export function pulseRadius(loudness: number): number {
  const t = clamp(loudness, 0, 1.5) / 1.5;
  return CONFIG.PULSE_MIN_RADIUS + (CONFIG.PULSE_MAX_RADIUS - CONFIG.PULSE_MIN_RADIUS) * t;
}

export interface HumParams {
  /** 0..1.3 hum loudness relative to the calibrated hum */
  level: number;
  /** 0..1: where the pitch sits between HUM_LOW_PITCH_HZ and HUM_HIGH_PITCH_HZ (log scale) */
  pitch01: number;
}

/**
 * Hum -> firefly jar. Loudness wakes the fireflies (brighter, wider light); pitch excites them
 * (a higher note makes them swirl and blink faster).
 */
export function humFromMic(aboveDb: number, pitchHz: number, humRefAboveDb: number): HumParams {
  const lo = CONFIG.HUM_MIN_ABOVE_FLOOR_DB;
  const level = clamp((aboveDb - lo) / Math.max(humRefAboveDb - lo, 6), 0, 1.3);
  const pitch01 = clamp(
    (Math.log2(Math.max(pitchHz, 1)) - Math.log2(CONFIG.HUM_LOW_PITCH_HZ)) /
      (Math.log2(CONFIG.HUM_HIGH_PITCH_HZ) - Math.log2(CONFIG.HUM_LOW_PITCH_HZ)),
    0,
    1,
  );
  return { level, pitch01 };
}
