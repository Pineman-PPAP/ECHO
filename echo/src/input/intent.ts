import type { HumParams } from './mapping';

/**
 * Everything the game needs from the player for one frame. Produced by IntentBuilder (real sensors)
 * or SimInput (?sim=1 keyboard, development only). Game code never touches sensors directly.
 */
export interface PlayerIntent {
  /** Face seen within FACE_LOST_PAUSE_MS. When false the App pauses the simulation. */
  facePresent: boolean;
  eyesClosed: boolean;
  /** How long the eyes have been continuously closed (0 when open). */
  eyesClosedMs: number;
  /** rad/s, positive = turn left (three.js rotation.y increases). */
  turnRate: number;
  /** m/s, positive = forward. */
  moveSpeed: number;
  /** Loudness (0.05..1.5) of every sharp sound (clap / click / shout) detected this frame. Usually empty. */
  pulses: number[];
  /** The hum (wakes the fireflies in the jar) while humming, else null. */
  hum: HumParams | null;
  /** True only on the frame a hum starts (menus use it as a second "button"). */
  humStarted: boolean;
}

export function idleIntent(): PlayerIntent {
  return {
    facePresent: true,
    eyesClosed: false,
    eyesClosedMs: 0,
    turnRate: 0,
    moveSpeed: 0,
    pulses: [],
    hum: null,
    humStarted: false,
  };
}
