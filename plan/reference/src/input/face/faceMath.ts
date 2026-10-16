import { Euler, Matrix4, Quaternion, Vector3 } from 'three';

const RAD2DEG = 180 / Math.PI;
const m = new Matrix4();
const pos = new Vector3();
const quat = new Quaternion();
const scl = new Vector3();
const euler = new Euler();

export interface HeadPose {
  /** Rotation about the vertical axis. Sign depends on camera; calibration measures which sign is "left". */
  yawDeg: number;
  pitchDeg: number;
  rollDeg: number;
  /** Distance from camera along the view axis (|tz|, MediaPipe metric units ~cm). Smaller = closer. */
  depth: number;
}

/**
 * Converts MediaPipe's facialTransformationMatrixes[0].data (16 numbers, column-major,
 * the same layout three.js Matrix4.fromArray expects) into yaw/pitch/roll and depth.
 */
export function headPoseFromMatrix(data: ArrayLike<number>): HeadPose {
  m.fromArray(Array.from(data));
  m.decompose(pos, quat, scl);
  euler.setFromQuaternion(quat, 'YXZ');
  return {
    yawDeg: euler.y * RAD2DEG,
    pitchDeg: euler.x * RAD2DEG,
    rollDeg: euler.z * RAD2DEG,
    depth: Math.abs(pos.z),
  };
}

/** Mean of eyeBlinkLeft and eyeBlinkRight from a blendshape category list. Returns 0 if absent. */
export function blinkScore(categories: ReadonlyArray<{ categoryName: string; score: number }>): {
  left: number;
  right: number;
  mean: number;
} {
  let left = 0;
  let right = 0;
  for (const c of categories) {
    if (c.categoryName === 'eyeBlinkLeft') left = c.score;
    else if (c.categoryName === 'eyeBlinkRight') right = c.score;
  }
  return { left, right, mean: (left + right) / 2 };
}
