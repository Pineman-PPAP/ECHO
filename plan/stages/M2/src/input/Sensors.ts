import { CONFIG } from '../config';
import { AnalyserSource, MicAnalyzer, type MicFrame } from './audio/MicAnalyzer';
import { Yin } from './audio/yin';
import { attachVideo, openCameraAndMic } from './camera';
import { FaceTracker, type FaceFrame } from './face/FaceTracker';

export interface SensorFrames {
  /** Non-null only on animation frames where the camera delivered a new image. */
  face: FaceFrame | null;
  mic: MicFrame;
}

/**
 * Owns the AudioContext, camera + mic stream, the hidden <video>, FaceTracker and MicAnalyzer.
 * Create it with Sensors.open() called DIRECTLY inside a click handler (autoplay policy).
 */
export class Sensors {
  /** Face frames per second actually processed. */
  faceFps = 0;
  /** Latest face frame, kept between camera frames (for UI). */
  lastFace: FaceFrame | null = null;
  private faceCount = 0;
  private faceCountStartMs = 0;

  private constructor(
    readonly audio: AudioContext,
    readonly stream: MediaStream,
    readonly video: HTMLVideoElement,
    readonly face: FaceTracker,
    readonly mic: MicAnalyzer,
  ) {}

  /**
   * The synchronous part (creating and resuming the AudioContext) runs inside the click handler,
   * which is what the browser's autoplay policy requires. Throws SensorError (camera.ts) on
   * permission or device problems, or Error if the face model cannot load.
   */
  static async open(audio: AudioContext, onStatus: (msg: string) => void): Promise<Sensors> {
    onStatus('Waiting for camera and microphone permission…');
    const stream = await openCameraAndMic();
    onStatus('Starting camera…');
    const video = await attachVideo(stream);
    // The <video> must stay in the document and "rendered" or some browsers stop decoding frames.
    // Keep it as a 2x2 invisible element; the UI draws it onto canvases instead.
    Object.assign(video.style, {
      position: 'fixed',
      right: '0',
      bottom: '0',
      width: '2px',
      height: '2px',
      opacity: '0',
      pointerEvents: 'none',
    });
    document.body.appendChild(video);
    onStatus('Loading face tracker…');
    const face = new FaceTracker();
    await face.init();
    onStatus('Starting microphone…');
    const need = new Yin(audio.sampleRate, CONFIG.YIN_WINDOW_S, CONFIG.YIN_MIN_HZ, CONFIG.YIN_MAX_HZ, CONFIG.YIN_THRESHOLD).requiredSamples();
    const mic = new MicAnalyzer(new AnalyserSource(audio, stream, need));
    return new Sensors(audio, stream, video, face, mic);
  }

  update(nowMs: number): SensorFrames {
    const face = this.face.update(this.video, nowMs);
    if (face) {
      this.lastFace = face;
      this.faceCount++;
    }
    if (nowMs - this.faceCountStartMs >= 1000) {
      this.faceFps = (this.faceCount * 1000) / Math.max(nowMs - this.faceCountStartMs, 1);
      this.faceCount = 0;
      this.faceCountStartMs = nowMs;
    }
    return { face, mic: this.mic.update(nowMs) };
  }
}
