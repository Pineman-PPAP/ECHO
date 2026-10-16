import { CONFIG } from '../config';

export type SensorErrorCode = 'no-api' | 'denied' | 'not-found' | 'busy' | 'unknown';

/** Thrown by openCameraAndMic(); `code` picks the help text on the error screen. */
export class SensorError extends Error {
  constructor(
    readonly code: SensorErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'SensorError';
  }
}

/**
 * Asks for camera + microphone in ONE prompt. Browser audio processing is turned OFF on purpose:
 * echo cancellation, noise suppression and auto gain would flatten claps and distort loudness.
 * Must be called from a user gesture (click) so the AudioContext can start in the same gesture.
 */
export async function openCameraAndMic(): Promise<MediaStream> {
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new SensorError('no-api', 'Camera/microphone API unavailable. Use Chromium on http://127.0.0.1 (a secure context).');
  }
  const audio: MediaTrackConstraints = {
    echoCancellation: false,
    noiseSuppression: false,
    autoGainControl: false,
    channelCount: 1,
  };
  const video: MediaTrackConstraints = {
    width: { ideal: CONFIG.VIDEO_WIDTH },
    height: { ideal: CONFIG.VIDEO_HEIGHT },
    frameRate: { ideal: CONFIG.VIDEO_FPS },
    facingMode: 'user',
  };
  try {
    return await navigator.mediaDevices.getUserMedia({ video, audio });
  } catch (err) {
    const name = err instanceof DOMException ? err.name : '';
    if (name === 'OverconstrainedError') return navigator.mediaDevices.getUserMedia({ video: true, audio });
    if (name === 'NotAllowedError' || name === 'SecurityError')
      throw new SensorError('denied', 'Camera/microphone permission was denied.');
    if (name === 'NotFoundError') throw new SensorError('not-found', 'No camera or microphone found.');
    if (name === 'NotReadableError' || name === 'AbortError')
      throw new SensorError('busy', 'The camera or microphone is in use by another application.');
    throw new SensorError('unknown', `Could not open camera/microphone: ${String(err)}`);
  }
}

/** Creates a muted, playing <video> fed by the stream's VIDEO tracks only (never plays mic audio back). */
export async function attachVideo(stream: MediaStream): Promise<HTMLVideoElement> {
  const video = document.createElement('video');
  video.muted = true;
  video.playsInline = true;
  video.autoplay = true;
  video.srcObject = new MediaStream(stream.getVideoTracks());
  // Playing a detached <video> can be aborted ("media was removed from the document") on some
  // Chrome builds, so it joins the document first (Sensors.open styles it as an invisible 2x2).
  document.body.appendChild(video);
  try {
    await video.play();
  } catch (err) {
    if (!(err instanceof DOMException) || err.name !== 'AbortError') throw err;
    await video.play();
  }
  if (video.readyState < 2) {
    await new Promise<void>((resolve) => video.addEventListener('loadeddata', () => resolve(), { once: true }));
  }
  return video;
}
