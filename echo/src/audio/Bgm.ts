import { CONFIG } from '../config';

/**
 * Background music (public/bgm.ogg, a seamless loop), played gaplessly from a decoded buffer. It
 * lives on the page's one AudioContext from the moment the page loads, so it plays on the title
 * screen as soon as the browser lets audio start (at once if autoplay is allowed, otherwise on the
 * first click or key press) and never restarts after that.
 */
export class Bgm {
  private readonly gain: GainNode;
  private level = 1;

  constructor(
    private readonly ctx: AudioContext,
    url: string,
  ) {
    this.gain = ctx.createGain();
    this.gain.gain.value = CONFIG.BGM_GAIN * CONFIG.MASTER_VOLUME;
    this.gain.connect(ctx.destination);
    this.load(url).catch(() => {}); // no music is not fatal
  }

  private async load(url: string): Promise<void> {
    const res = await fetch(url);
    const buf = await this.ctx.decodeAudioData(await res.arrayBuffer());
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    src.connect(this.gain);
    src.start();
  }

  /** 0..1 of BGM_GAIN, eased over fadeS. Cheap to call every frame. */
  setLevel(level: number, fadeS: number = CONFIG.BGM_FADE_S): void {
    if (Math.abs(level - this.level) < 0.01) return;
    this.level = level;
    this.gain.gain.setTargetAtTime(CONFIG.BGM_GAIN * CONFIG.MASTER_VOLUME * level, this.ctx.currentTime, fadeS / 3);
  }
}
