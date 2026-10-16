import { grainTexture } from './Overlays';

/**
 * The filmed jumpscare (public/jumpscare.mp4): a full-screen clip over the game, under the white
 * frame and the blackout, with the game's own film grain and dark edges on top so it reads as part
 * of the cave. It preloads at startup; if it isn't ready, or the browser refuses to play it, the
 * caller cuts to black instead.
 */
export class JumpscareVideo {
  readonly video: HTMLVideoElement;
  private readonly wrap: HTMLElement;
  private started = false;
  private _playing = false;
  private _failed = false;

  constructor(root: HTMLElement) {
    this.wrap = document.createElement('div');
    this.wrap.className = 'jumpvid';
    this.wrap.hidden = true;
    this.video = document.createElement('video');
    this.video.src = `${import.meta.env.BASE_URL}jumpscare.mp4`;
    this.video.preload = 'auto';
    this.video.playsInline = true;
    this.video.disablePictureInPicture = true;
    const grain = document.createElement('div');
    grain.className = 'grain';
    grain.style.backgroundImage = `url(${grainTexture()})`;
    const shade = document.createElement('div');
    shade.className = 'shade';
    this.wrap.append(this.video, grain, shade);
    root.append(this.wrap);
    this.video.addEventListener('playing', () => {
      if (!this.started) return;
      this._playing = true;
      this.wrap.classList.remove('jolt');
      void this.wrap.offsetWidth;
      this.wrap.classList.add('jolt');
    });
    this.video.load();
  }

  /** Enough of the clip is buffered to play it through without a stall. */
  get ready(): boolean {
    return this.video.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA && !this.video.error;
  }

  /** True once frames are actually on screen. */
  get playing(): boolean {
    return this._playing;
  }

  /** play() was refused or the clip errored. */
  get failed(): boolean {
    return this._failed || !!this.video.error;
  }

  get ended(): boolean {
    return this.video.ended;
  }

  play(): void {
    this.started = true;
    this._playing = false;
    this._failed = false;
    this.video.currentTime = 0;
    this.wrap.hidden = false; // black until the first frame, so the cave never shows through
    this.video.play().catch(() => {
      this._failed = true;
    });
  }

  hide(): void {
    this.started = false;
    this._playing = false;
    this.wrap.hidden = true;
    this.wrap.classList.remove('jolt');
    this.video.pause();
    this.video.currentTime = 0;
  }
}
