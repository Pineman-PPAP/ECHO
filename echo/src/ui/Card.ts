import type { FaceFrame } from '../input/face/FaceTracker';

export interface CardContent {
  /** Small line above the title, e.g. "Step 3 of 8". */
  kicker?: string;
  /** Pictogram above the title (SVG markup from ui/icons.ts). */
  icon?: string;
  title: string;
  /** Plain text; "\n" becomes a line break. */
  body?: string;
  /** A quieter line under the body (calibration: why the game needs this step). */
  detail?: string;
  /** Two-column list: input -> what it does. */
  rows?: ReadonlyArray<readonly [string, string]>;
  /** Live line under the progress bar (countdown, reading, result). */
  status?: string;
  statusTone?: 'live' | 'ok' | 'warn';
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
  private readonly kickerEl: HTMLElement;
  private readonly iconEl: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly detailEl: HTMLElement;
  private readonly rowsEl: HTMLElement;
  private readonly statusEl: HTMLElement;
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
      <p class="card-kicker"></p>
      <div class="card-icon" hidden></div>
      <h1></h1>
      <canvas class="card-cam" width="320" height="240" hidden></canvas>
      <p class="card-body"></p>
      <dl class="card-rows" hidden></dl>
      <p class="card-detail"></p>
      <div class="card-bar" hidden><i></i></div>
      <p class="card-status"></p>
      <p class="card-hint"></p>
      <button type="button" hidden></button>`;
    root.appendChild(this.el);
    this.kickerEl = this.el.querySelector('.card-kicker')!;
    this.iconEl = this.el.querySelector('.card-icon')!;
    this.titleEl = this.el.querySelector('h1')!;
    this.bodyEl = this.el.querySelector('.card-body')!;
    this.detailEl = this.el.querySelector('.card-detail')!;
    this.rowsEl = this.el.querySelector('.card-rows')!;
    this.statusEl = this.el.querySelector('.card-status')!;
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
    const key = JSON.stringify([
      c.kicker,
      c.icon,
      c.title,
      c.body,
      c.detail,
      c.rows,
      c.status,
      c.statusTone,
      c.hint,
      c.tone,
      c.showCamera,
      c.button?.label,
      c.progress !== undefined,
    ]);
    this.onClick = c.button?.onClick ?? null;
    if (key === this.key) return;
    this.key = key;
    this.el.dataset.tone = c.tone ?? 'normal';
    this.kickerEl.textContent = c.kicker ?? '';
    this.iconEl.hidden = !c.icon;
    this.iconEl.innerHTML = c.icon ?? '';
    this.titleEl.textContent = c.title;
    this.bodyEl.textContent = c.body ?? '';
    this.detailEl.textContent = c.detail ?? '';
    this.rowsEl.hidden = !c.rows || c.rows.length === 0;
    this.rowsEl.replaceChildren(
      ...(c.rows ?? []).flatMap(([k, v]) => {
        const dt = document.createElement('dt');
        dt.textContent = k;
        const dd = document.createElement('dd');
        dd.textContent = v;
        return [dt, dd];
      }),
    );
    this.statusEl.textContent = c.status ?? '';
    this.statusEl.dataset.tone = c.statusTone ?? 'live';
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
    g.strokeStyle = face?.present ? '#d9d6cc' : '#c0392b';
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
