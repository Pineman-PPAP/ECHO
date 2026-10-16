import type { MicFrame } from '../src/input/audio/MicAnalyzer';
import type { FaceFrame } from '../src/input/face/FaceTracker';
import { idleIntent, type PlayerIntent } from '../src/input/intent';

export function faceFrame(timeMs: number, o: { yaw?: number; depth?: number; blink?: number; present?: boolean } = {}): FaceFrame {
  const present = o.present ?? true;
  return {
    timeMs,
    present,
    blink: present ? (o.blink ?? 0.1) : 0,
    blinkL: present ? (o.blink ?? 0.1) : 0,
    blinkR: present ? (o.blink ?? 0.1) : 0,
    pose: present ? { yawDeg: o.yaw ?? 0, pitchDeg: 0, rollDeg: 0, depth: o.depth ?? 50 } : null,
    landmarks: null,
    inferenceMs: 5,
  };
}

export function micFrame(o: Partial<MicFrame> = {}): MicFrame {
  return {
    levelDb: -60,
    floorDb: -60,
    aboveDb: 0,
    onsets: [],
    pitch: null,
    humActive: false,
    humPitchHz: 0,
    hopsProcessed: 6,
    ...o,
  };
}

export function intent(o: Partial<PlayerIntent> = {}): PlayerIntent {
  return { ...idleIntent(), ...o };
}
