import { CONFIG } from '../config';
import { LEVELS } from '../game/levels';
import { World, type WorldEvent } from '../game/World';
import { idleIntent } from '../input/intent';
import { SimInput } from '../input/SimInput';
import { Renderer } from '../render/Renderer';
import type { Flags } from './flags';

/**
 * M1 version: sim-mode only, one level at a time. M2-M6 grow this into the full state machine.
 */
export class App {
  private readonly renderer: Renderer;
  private readonly sim: SimInput | null;
  private readonly devText: HTMLElement;
  private world!: World;
  private levelIndex: number;
  private readonly appStartMs = performance.now();
  private lastMs = this.appStartMs;
  private lastDevTextMs = 0;
  private lastEvent = '';

  constructor(root: HTMLElement, flags: Flags) {
    root.innerHTML = `
      <div id="stage"></div>
      <div id="dev-badge" class="dev-badge" hidden></div>`;
    this.renderer = new Renderer(root.querySelector<HTMLElement>('#stage')!);
    this.devText = root.querySelector<HTMLElement>('#dev-badge')!;
    this.sim = flags.sim ? new SimInput() : null;
    this.devText.hidden = !flags.sim;
    this.levelIndex = Math.min(flags.level, LEVELS.length - 1);
    this.startLevel(this.levelIndex);
    if (flags.sim) {
      window.addEventListener('keydown', (e) => {
        if (e.code === 'KeyR') this.startLevel(this.levelIndex); // DEV: restart level
        if (e.code === 'KeyN') this.startLevel((this.levelIndex + 1) % LEVELS.length); // DEV: next level
      });
    }
  }

  start(): void {
    requestAnimationFrame(this.frame);
  }

  private startLevel(index: number): void {
    this.levelIndex = index;
    this.world = new World(LEVELS[index], index + 1);
    this.renderer.loadLevel(this.world.level);
    this.lastEvent = `level ${LEVELS[index].name}`;
  }

  private readonly frame = (): void => {
    requestAnimationFrame(this.frame);
    const nowMs = performance.now();
    const dtS = Math.min((nowMs - this.lastMs) / 1000, CONFIG.MAX_DT_S);
    this.lastMs = nowMs;
    const clockS = (nowMs - this.appStartMs) / 1000;

    const intent = this.sim ? this.sim.update(nowMs) : idleIntent();
    const events = this.world.update(dtS, nowMs, clockS, intent);
    for (const e of events) this.onEvent(e);
    this.renderer.render(this.world, clockS, nowMs);

    if (this.sim && nowMs - this.lastDevTextMs > 250) {
      this.lastDevTextMs = nowMs;
      const p = this.world.player;
      this.devText.textContent =
        `DEV SIM INPUT · ${LEVELS[this.levelIndex].name} · ${this.renderer.fps.toFixed(0)} fps · ` +
        `pos ${p.x.toFixed(1)},${p.z.toFixed(1)} · hum ${this.sim.pitchHz.toFixed(0)} Hz · ${this.world.status} · ${this.lastEvent}\n` +
        'arrows/WASD move · Space clap · Shift+Space click · H hum · [ ] pitch · B eyes closed · F face lost · R restart · N next level';
    }
  };

  private onEvent(e: WorldEvent): void {
    if (e.type === 'pulse') this.lastEvent = `pulse r=${e.pulse.maxRadius.toFixed(1)} m`;
    else if (e.type === 'exit') this.lastEvent = 'ESCAPED (press R / N)';
    else if (e.type === 'caught') this.lastEvent = 'CAUGHT (press R)';
  }
}
