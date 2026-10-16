import type { BeatId } from '../app/FieldManual';
import { CONFIG } from '../config';

/**
 * An offset from the normal first-person camera: forward / up / right in metres in the camera's frame
 * (forward along the player's yaw), extra pitch / yaw / roll in radians, and the field of view in degrees.
 */
export interface CameraPose {
  forward: number;
  up: number;
  right: number;
  pitch: number;
  yaw: number;
  roll: number;
  fov: number;
}

export type ShotId = BeatId | 'end';

interface Keyframe {
  readonly t: number;
  readonly forward?: number;
  readonly up?: number;
  readonly right?: number;
  readonly pitch?: number;
  readonly yaw?: number;
  readonly roll?: number;
  readonly fov?: number;
}

const SHOTS: Record<ShotId, readonly Keyframe[]> = CONFIG.MANUAL_SHOTS;

/** The plain first-person view (no offset, normal field of view). */
export function restPose(): CameraPose {
  return { forward: 0, up: 0, right: 0, pitch: 0, yaw: 0, roll: 0, fov: CONFIG.CAMERA_FOV_DEG };
}

function keyPose(k: Keyframe): CameraPose {
  return {
    forward: k.forward ?? 0,
    up: k.up ?? 0,
    right: k.right ?? 0,
    pitch: k.pitch ?? 0,
    yaw: k.yaw ?? 0,
    roll: k.roll ?? 0,
    fov: k.fov ?? CONFIG.CAMERA_FOV_DEG,
  };
}

function lerpPose(a: CameraPose, b: CameraPose, t: number): CameraPose {
  const m = (x: number, y: number) => x + (y - x) * t;
  return {
    forward: m(a.forward, b.forward),
    up: m(a.up, b.up),
    right: m(a.right, b.right),
    pitch: m(a.pitch, b.pitch),
    yaw: m(a.yaw, b.yaw),
    roll: m(a.roll, b.roll),
    fov: m(a.fov, b.fov),
  };
}

/**
 * The shot's camera pose `tS` seconds after its lesson started: eased (smoothstep) between keyframes,
 * holding the first before it and the last after it. Pure, so the camera moves are unit-testable.
 */
export function shotPose(shot: ShotId, tS: number): CameraPose {
  const keys = SHOTS[shot];
  if (keys.length === 0) return restPose();
  if (tS <= keys[0].t) return keyPose(keys[0]);
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1];
    const b = keys[i];
    if (tS <= b.t) {
      const u = b.t > a.t ? (tS - a.t) / (b.t - a.t) : 1;
      return lerpPose(keyPose(a), keyPose(b), u * u * (3 - 2 * u));
    }
  }
  return keyPose(keys[keys.length - 1]);
}

/** Blend between the plain view (weight 0) and a shot (weight 1), so the camera eases in and out of shots. */
export function blendPose(pose: CameraPose, weight: number): CameraPose {
  return lerpPose(restPose(), pose, Math.min(Math.max(weight, 0), 1));
}
