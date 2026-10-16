import type { FaceFrame } from '../input/face/FaceTracker';

export interface CardContent {
  title: string;
  /** Plain text; "\n" becomes a line break. */
  body?: string;
  /** Small line under the body, e.g. "Clap to continue". */
  hint?: string;
  /** 0..1 shows a progress bar; undefined hides it. */
  progress?: number;
  tone?: 'normal' | 'gold' | 'danger';
  /** Show the mirrored webcam preview (calibration "find your face" step). */
  showCamera?: boolean;
  button?: { label: string; onClick: () => void };
}

/**
 * The centred panel used for every screen: title, loading, calibration steps, level intros,
 * pause, game over, victory, errors. show() may be called every frame; the DOM is only touched
 * when the content changes.
 */
export class Card {
  private readonly el: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly hintEl: HTMLElement;
  private readonly barEl: HTMLElement;
  private readonly barFill: HTMLElement;
  private readonly cam: HTMLCanvasElement;
  private readonly button: HTMLButtonElement;
  private key = '';
  private onClick: (() => void) | null = null;
  private video: HTMLVideoElement | null = null;

  constructor(root: HTMLElement) {
    this.el = document.createElement('section');
    this.el.className = 'card';
    this.el.hidden = true;
    this.el.innerHTML = `
      <h1></h1>
      <canvas class="card-cam" width="320" height="240" hidden></canvas>
      <p class="card-body"></p>
      <div class="card-bar" hidden><i></i></div>
      <p class="card-hint"></p>
      <button type="button" hidden></button>`;
    root.appendChild(this.el);
    this.titleEl = this.el.querySelector('h1')!;
    this.bodyEl = this.el.querySelector('.card-body')!;
    this.hintEl = this.el.querySelector('.card-hint')!;
    this.barEl = this.el.querySelector('.card-bar')!;
    this.barFill = this.barEl.querySelector('i')!;
    this.cam = this.el.querySelector('.card-cam')!;
    this.button = this.el.querySelector('button')!;
    this.button.addEventListener('click', () => this.onClick?.());
  }

  get visible(): boolean {
    return !this.el.hidden;
  }

  setVideo(video: HTMLVideoElement): void {
    this.video = video;
  }

  show(c: CardContent): void {
    this.el.hidden = false;
    if (c.progress !== undefined) this.barFill.style.width = `${Math.max(0, Math.min(1, c.progress)) * 100}%`;
    const key = JSON.stringify([c.title, c.body, c.hint, c.tone, c.showCamera, c.button?.label, c.progress !== undefined]);
    this.onClick = c.button?.onClick ?? null;
    if (key === this.key) return;
    this.key = key;
    this.el.dataset.tone = c.tone ?? 'normal';
    this.titleEl.textContent = c.title;
    this.bodyEl.textContent = c.body ?? '';
    this.hintEl.textContent = c.hint ?? '';
    this.barEl.hidden = c.progress === undefined;
    this.cam.hidden = !c.showCamera;
    this.button.hidden = !c.button;
    this.button.textContent = c.button?.label ?? '';
  }

  hide(): void {
    if (this.el.hidden) return;
    this.el.hidden = true;
    this.key = '';
  }

  /** Call every frame while the camera preview is shown. */
  drawCamera(face: FaceFrame | null): void {
    if (this.cam.hidden) return;
    const g = this.cam.getContext('2d')!;
    const w = this.cam.width;
    const h = this.cam.height;
    g.fillStyle = '#000';
    g.fillRect(0, 0, w, h);
    if (this.video && this.video.readyState >= 2) {
      g.save();
      g.scale(-1, 1);
      g.drawImage(this.video, -w, 0, w, h);
      g.restore();
    }
    const lm = face?.landmarks;
    g.strokeStyle = face?.present ? '#4fd8ff' : '#ff2a2a';
    g.lineWidth = 3;
    if (lm && lm.length > 0) {
      let x0 = 1;
      let y0 = 1;
      let x1 = 0;
      let y1 = 0;
      for (const p of lm) {
        x0 = Math.min(x0, p.x);
        y0 = Math.min(y0, p.y);
        x1 = Math.max(x1, p.x);
        y1 = Math.max(y1, p.y);
      }
      g.strokeRect((1 - x1) * w, y0 * h, (x1 - x0) * w, (y1 - y0) * h);
    } else {
      g.strokeRect(2, 2, w - 4, h - 4);
    }
  }
}
