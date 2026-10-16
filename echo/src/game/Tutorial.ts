import { CONFIG } from '../config';
import type { PlayerIntent } from '../input/intent';
import type { World, WorldEvent } from './World';

export type TutorialStep = 'clap' | 'loudness' | 'look' | 'walk' | 'hum' | 'exit';

export const TUTORIAL_ORDER: TutorialStep[] = ['clap', 'loudness', 'look', 'walk', 'hum', 'exit'];

const PROMPTS: Record<TutorialStep, string> = {
  clap: 'Clap your hands once.',
  loudness: 'Short, sharp sounds paint the dark. Try a soft tongue click… then a LOUD clap.',
  look: 'Turn your head left or right to look around.',
  walk: 'Lean toward the screen to walk. Sit back to stop.',
  hum: 'Hum a steady note: the fireflies in your jar wake up and light the cave around you.',
  exit: 'Follow the scratched red arrows on the walls. Clap to see them clearly.',
};

/** Shown after the prompt in ?sim=1 only. */
const SIM_KEYS: Record<TutorialStep, string> = {
  clap: '[Space]',
  loudness: '[Shift+Space, then Space]',
  look: '[← →]',
  walk: '[↑]',
  hum: '[hold H]',
  exit: '',
};

/** Teaches each mechanic in turn; every step advances when the player actually does the thing. */
export class Tutorial {
  step: TutorialStep = 'clap';
  private pulseCount = 0;
  private yawTravel = 0;
  private lastYaw: number;
  private distanceAtStepStart: number;
  private humMs = 0;

  constructor(
    private readonly world: World,
    private readonly sim: boolean,
  ) {
    this.lastYaw = world.player.yaw;
    this.distanceAtStepStart = world.player.distanceWalked;
  }

  get prompt(): string {
    const keys = SIM_KEYS[this.step];
    return this.sim && keys ? `${PROMPTS[this.step]} ${keys}` : PROMPTS[this.step];
  }

  update(dtS: number, intent: PlayerIntent, events: WorldEvent[]): void {
    const p = this.world.player;
    const yawDelta = Math.abs(p.yaw - this.lastYaw);
    this.lastYaw = p.yaw;
    const pulses = events.filter((e) => e.type === 'pulse').length;

    switch (this.step) {
      case 'clap':
        if (pulses > 0) this.advance();
        break;
      case 'loudness':
        this.pulseCount += pulses;
        if (this.pulseCount >= CONFIG.TUTORIAL_PULSES) this.advance();
        break;
      case 'look':
        this.yawTravel += yawDelta;
        if (this.yawTravel >= CONFIG.TUTORIAL_LOOK_RAD) this.advance();
        break;
      case 'walk':
        if (p.distanceWalked - this.distanceAtStepStart >= CONFIG.TUTORIAL_WALK_M) this.advance();
        break;
      case 'hum':
        if (intent.hum) this.humMs += dtS * 1000;
        if (this.humMs >= CONFIG.TUTORIAL_HUM_MS) this.advance();
        break;
      case 'exit':
        break;
    }
  }

  private advance(): void {
    const next = TUTORIAL_ORDER[TUTORIAL_ORDER.indexOf(this.step) + 1];
    if (!next) return;
    this.step = next;
    this.pulseCount = 0;
    this.yawTravel = 0;
    this.distanceAtStepStart = this.world.player.distanceWalked;
    this.humMs = 0;
  }
}
