import { CONFIG } from '../config';

export interface OverlayState {
  /** True while the game state is 'playing'. */
  active: boolean;
  /** 0..1 threat level from World.danger(). */
  danger: number;
  /** 0..1 how close the Hush is (pale frost creeping in from the edges). */
  hush: number;
  /** The retry screen: the cave sinks into a dark red veil behind the card. */
  dead: boolean;
}

/**
 * Atmosphere layers: film grain and a dark vignette over everything, a red danger vignette, a brief
 * red flash when a Hollow hears you, a pale frost when the Hush is near, and the jumpscare's white
 * frame and cut to black.
 */
export class Overlays {
  private readonly vignette: HTMLElement;
  private readonly whiteout: HTMLElement;
  private readonly blackout: HTMLElement;
  private readonly frost: HTMLElement;
  private readonly deathVeil: HTMLElement;
  private lastFrost = -1;
  private lastOpacity = -1;

  constructor(root: HTMLElement) {
    const wrap = document.createElement('div');
    wrap.innerHTML =
      '<div class="grain"></div>' +
      '<div class="shade"></div>' +
      '<div class="vignette"></div>' +
      '<div class="whiteout"></div>' +
      '<div class="blackout"></div>' +
      '<div class="frost"></div>' +
      '<div class="deathveil"></div>';
    this.vignette = wrap.querySelector<HTMLElement>('.vignette')!;
    this.whiteout = wrap.querySelector<HTMLElement>('.whiteout')!;
    this.blackout = wrap.querySelector<HTMLElement>('.blackout')!;
    wrap.querySelector<HTMLElement>('.grain')!.style.backgroundImage = `url(${grainTexture()})`;
    this.frost = wrap.querySelector<HTMLElement>('.frost')!;
    this.deathVeil = wrap.querySelector<HTMLElement>('.deathveil')!;
    root.append(...Array.from(wrap.children));
  }

  update(s: OverlayState): void {
    this.deathVeil.classList.toggle('on', s.dead);
    const opacity = s.active ? s.danger * 0.7 : 0;
    if (Math.abs(opacity - this.lastOpacity) > 0.01) {
      this.vignette.style.opacity = String(opacity);
      this.lastOpacity = opacity;
    }
    const frost = s.active ? s.hush * 0.85 : 0;
    if (Math.abs(frost - this.lastFrost) > 0.01) {
      this.frost.style.opacity = String(frost);
      this.lastFrost = frost;
    }
  }

  /** Jumpscare impact: one white frame. */
  whiteFlash(): void {
    this.whiteout.classList.remove('flash');
    void this.whiteout.offsetWidth;
    this.whiteout.classList.add('flash');
  }

  /** Jumpscare end: a hard cut to black (until the next screen). */
  setBlackout(on: boolean): void {
    this.blackout.classList.toggle('on', on);
  }

  /** A brief red flash: "it heard you". */
  flash(): void {
    this.vignette.classList.remove('flash');
    void this.vignette.offsetWidth;
    this.vignette.classList.add('flash');
  }
}

/** A tiling grey-noise tile for the film grain (made once, as a data URL). */
export function grainTexture(): string {
  const size = CONFIG.GRAIN_TILE_PX;
  const c = document.createElement('canvas');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d')!;
  const img = g.createImageData(size, size);
  for (let i = 0; i < img.data.length; i += 4) {
    const v = Math.floor(Math.random() * 256);
    img.data[i] = v;
    img.data[i + 1] = v;
    img.data[i + 2] = v;
    img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c.toDataURL('image/png');
}
