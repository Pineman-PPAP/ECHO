export interface HudState {
  levelName: string;
  objective: string;
  /** Bottom-centre instruction ('' hides it). Tutorial prompts go here. */
  prompt: string;
  facePresent: boolean;
  /** Mic level above the noise floor (dB), or null in sim mode. */
  micAboveDb: number | null;
  /** Hum pitch while humming, else null. */
  humHz: number | null;
  sim: boolean;
}

/**
 * In-game overlay. Top-left: level + objective. Top-right: live "sensor chips" so players and
 * judges always see what the game perceives (face, mic level, hum). Bottom: the current prompt.
 */
export class Hud {
  private readonly el: HTMLElement;
  private readonly t: Record<string, HTMLElement> = {};
  private last = '';

  constructor(root: HTMLElement) {
    this.el = document.createElement('div');
    this.el.className = 'hud';
    this.el.hidden = true;
    this.el.innerHTML = `
      <div class="hud-level"><b data-h="level"></b><span data-h="objective"></span></div>
      <div class="hud-chips">
        <div class="chip" data-h="face"></div>
        <div class="chip mic"><span>MIC</span><div class="meter"><i data-h="mic"></i></div></div>
        <div class="chip" data-h="hum"></div>
      </div>
      <div class="hud-prompt" data-h="prompt"></div>`;
    root.appendChild(this.el);
    this.el.querySelectorAll<HTMLElement>('[data-h]').forEach((n) => (this.t[n.dataset.h!] = n));
  }

  show(on: boolean): void {
    this.el.hidden = !on;
  }

  update(s: HudState): void {
    if (this.el.hidden) return;
    // The meter moves every frame; text only when it changes.
    const mic = s.micAboveDb === null ? 0 : Math.max(0, Math.min(1, s.micAboveDb / 45));
    this.t.mic.style.width = `${mic * 100}%`;
    const key = JSON.stringify([s.levelName, s.objective, s.prompt, s.facePresent, s.humHz && Math.round(s.humHz / 5), s.sim, s.micAboveDb === null]);
    if (key === this.last) return;
    this.last = key;
    this.t.level.textContent = s.levelName;
    this.t.objective.textContent = s.objective;
    this.t.prompt.textContent = s.prompt;
    this.t.prompt.hidden = s.prompt === '';
    this.t.face.textContent = s.facePresent ? 'FACE' : 'NO FACE';
    this.t.face.classList.toggle('danger', !s.facePresent);
    this.t.hum.textContent = s.humHz ? `HUM ${Math.round(s.humHz)} Hz` : s.sim ? 'DEV SIM' : 'HUM –';
    this.t.hum.classList.toggle('active', !!s.humHz);
  }
}
