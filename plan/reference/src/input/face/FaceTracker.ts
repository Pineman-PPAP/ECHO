import { FaceLandmarker, FilesetResolver, type NormalizedLandmark } from '@mediapipe/tasks-vision';
import { CONFIG } from '../../config';
import { blinkScore, headPoseFromMatrix, type HeadPose } from './faceMath';

export interface FaceFrame {
  /** performance.now() when processed. */
  timeMs: number;
  present: boolean;
  /** Mean blink score 0..1 (1 = closed). 0 when no face. */
  blink: number;
  blinkL: number;
  blinkR: number;
  /** null when no face (or no transformation matrix). */
  pose: HeadPose | null;
  /** 478 normalized landmarks (x, y in 0..1 of the video frame) for the debug overlay. */
  landmarks: NormalizedLandmark[] | null;
  /** Time spent inside detectForVideo (ms). */
  inferenceMs: number;
}

/**
 * Thin wrapper around MediaPipe FaceLandmarker (runs on the GPU via WebGL, CPU fallback).
 * Assets are served locally from public/ (see scripts/fetch-assets.mjs), so no network is needed.
 */
export class FaceTracker {
  delegate: 'GPU' | 'CPU' = CONFIG.FACE_DELEGATE;
  private landmarker: FaceLandmarker | null = null;
  private lastVideoTime = -1;
  private lastTimestamp = 0;

  async init(): Promise<void> {
    const fileset = await FilesetResolver.forVisionTasks(`${import.meta.env.BASE_URL}mediapipe/wasm`);
    const make = (delegate: 'GPU' | 'CPU') =>
      FaceLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${import.meta.env.BASE_URL}models/face_landmarker.task`, delegate },
        runningMode: 'VIDEO',
        numFaces: 1,
        outputFaceBlendshapes: true,
        outputFacialTransformationMatrixes: true,
      });
    try {
      this.landmarker = await make(CONFIG.FACE_DELEGATE);
      this.delegate = CONFIG.FACE_DELEGATE;
    } catch (err) {
      if (CONFIG.FACE_DELEGATE !== 'GPU') throw err;
      console.warn('[FaceTracker] GPU delegate failed, falling back to CPU', err);
      this.landmarker = await make('CPU');
      this.delegate = 'CPU';
    }
  }

  /** Runs detection if the video has a NEW frame since the last call; otherwise returns null. */
  update(video: HTMLVideoElement, nowMs: number): FaceFrame | null {
    if (!this.landmarker || video.readyState < 2) return null;
    if (video.currentTime === this.lastVideoTime) return null;
    this.lastVideoTime = video.currentTime;
    // MediaPipe throws if timestamps are not strictly increasing.
    const ts = Math.max(Math.round(nowMs), this.lastTimestamp + 1);
    this.lastTimestamp = ts;
    const t0 = performance.now();
    const r = this.landmarker.detectForVideo(video, ts);
    const inferenceMs = performance.now() - t0;
    if (r.faceLandmarks.length === 0) {
      return { timeMs: nowMs, present: false, blink: 0, blinkL: 0, blinkR: 0, pose: null, landmarks: null, inferenceMs };
    }
    const b = blinkScore(r.faceBlendshapes[0]?.categories ?? []);
    const matrix = r.facialTransformationMatrixes[0];
    return {
      timeMs: nowMs,
      present: true,
      blink: b.mean,
      blinkL: b.left,
      blinkR: b.right,
      pose: matrix ? headPoseFromMatrix(matrix.data) : null,
      landmarks: r.faceLandmarks[0],
      inferenceMs,
    };
  }

  close(): void {
    this.landmarker?.close();
    this.landmarker = null;
  }
}
