# M4: Tutorial, level hints and atmosphere

**Goal:**
- The tutorial teaches each mechanic with live prompts that advance when the player actually does the thing.
- Non-tutorial levels open with a short hint.
- Blinks become visible to spectators (eyelids), and danger becomes visible (red vignette, "they moved" flash).
- Menus and the title screen gently pulse the maze in the background ("attract mode").

You write this code yourself; there is no stage folder. Follow the specs exactly, including names, so the tests and later milestones line up. Keep `World`/`Tutorial` logic pure and tested.

## 1. New CONFIG keys (add to `echo/src/config.ts`, in the "Game flow" section)

```ts
  /** Menus and the title screen emit a soft background pulse this often so the maze is visible behind cards. */
  ATTRACT_PULSE_MS: 2600,
  /** Non-tutorial levels show their hint line for this long after play starts. */
  LEVEL_HINT_MS: 6000,
  /** A monster that started moving within this distance while the eyes were closed triggers the red flash on reopening. */
  MOVED_FLASH_RADIUS: 10,
  /** Title screen camera slowly rotates (rad/s). */
  TITLE_SPIN_RATE: 0.12,
```

## 2. `echo/src/game/Tutorial.ts` (new, pure logic)

```ts
import type { PlayerIntent } from '../input/intent';
import type { World, WorldEvent } from './World';

export type TutorialStep = 'clap' | 'loudness' | 'look' | 'walk' | 'hum' | 'exit';

export const TUTORIAL_ORDER: TutorialStep[] = ['clap', 'loudness', 'look', 'walk', 'hum', 'exit'];

const PROMPTS: Record<TutorialStep, string> = {
  clap: 'Clap your hands once.',
  loudness: 'Every sound paints the dark. Try a soft tongue click… then a LOUD clap.',
  look: 'Turn your head left or right to look around.',
  walk: 'Lean toward the screen to walk. Sit back to stop.',
  hum: 'Hum a steady note. Higher hum = narrow beam, lower hum = wide beam.',
  exit: 'Follow the chime to the way out.',
};

/** Shown after the prompt in ?sim=1 only. */
const SIM_KEYS: Record<TutorialStep, string> = {
  clap: '[Space]',
  loudness: '[Shift+Space, then Space]',
  look: '[← →]',
  walk: '[↑]',
  hum: '[hold H, use [ and ]]',
  exit: '',
};
```

Class `Tutorial`:
- `constructor(world: World, sim: boolean)`
- `step: TutorialStep` (starts at `'clap'`)
- `get prompt(): string`: `PROMPTS[step]`, plus `' ' + SIM_KEYS[step]` when `sim` and the key text isn't empty.
- `update(dtS: number, intent: PlayerIntent, events: WorldEvent[]): void`. Advancement rules, checked every call:
  - `clap`: any `pulse` event in `events` → next.
  - `loudness`: counts `pulse` events in this step; at **2** → next.
  - `look`: accumulates `|player.yaw - lastYaw|` every update (`lastYaw` starts at the constructor's yaw and updates every call, in every step). At **π/2** total in this step → next.
  - `walk`: `player.distanceWalked - distanceAtStepStart >= 4` → next.
  - `hum`: while `intent.beam` is non-null, add `dtS * 1000` to a counter; at **1500 ms** → next.
  - `exit`: final; never advances.
- Advancing resets the per-step counters: pulse count, yaw travel, `distanceAtStepStart = player.distanceWalked`, hum ms.

**Test** `echo/tests/tutorial.test.ts`. Use `new World(LEVELS[0])` and the `intent()` helper from `tests/helpers.ts`; call `world.update(...)` then `tutorial.update(...)` with the returned events. Cover:
1. Prompt starts at `'clap'`; one intent with `pulses: [1]` → `'loudness'`; two more pulses → `'look'`.
2. `turnRate: 1` (rad/s) for 1.7 s at 60 fps → `'walk'`.
3. First reset the heading, because step 2 turned the player: `world.player.yaw = facingToYaw('E')` (from `grid.ts`; the tutorial corridor runs east for ~13 m). Then `moveSpeed: 2.4` until `distanceWalked` grows 4 m → `'hum'`.
4. `beam: beamFromHum(30, 220, 30)` for 1.6 s → `'exit'`.
5. `prompt` contains `[Space]` only when constructed with `sim = true`.

## 3. Level hints

In `App.ts` add a constant map:

```ts
const LEVEL_HINTS: Record<string, string> = {
  listener: 'Make noise to see. Every blink lets it move.',
  choir: 'Lean gently to sneak. Footsteps make noise.',
};
```

HUD prompt while `playing`:
1. If the tutorial is active: `tutorial.prompt`.
2. Otherwise, if `nowMs - levelStartMs < LEVEL_HINT_MS`: `LEVEL_HINTS[def.id] ?? ''`.
3. Otherwise `''`.

## 4. App integration of the tutorial

- New field `private tutorial: Tutorial | null = null`.
- In `startLevel()`: `this.tutorial = this.world.level.def.tutorial ? new Tutorial(this.world, this.sim !== null) : null;`
- In `step()`, `playing` case, right after `this.route(events, …)`: `this.tutorial?.update(dtS, intent, events);`
- In `updateOverlays()`: replace `prompt: ''` with the rule from §3.

## 5. `echo/src/ui/Overlays.ts` (new): eyelids, "THEY MOVE" label, danger vignette, flash

DOM, created in the constructor and appended to `root`:

```html
<div class="vignette"></div>
<div class="eyelids"><div class="lid top"></div><div class="lid bottom"></div></div>
<div class="eyes-label"></div>
```

API:

```ts
export class Overlays {
  constructor(root: HTMLElement);
  /** Call every frame. `active` = state is 'playing'. */
  update(s: { active: boolean; eyesClosed: boolean; eyesClosedMs: number; danger: number }): void;
  /** A brief red flash: "something moved while you weren't looking". */
  flash(): void;
}
```

Behaviour:
- **Eyelids:** class `closed` on `.eyelids` when `active && eyesClosed`. Each lid animates its height 0 → 50.5 % in 70 ms. Spectators see every blink; the player has their eyes closed anyway.
- **Label:** when `active && eyesClosed`, text `THEY MOVE`, or `THEY ARE COMING` once `eyesClosedMs >= CONFIG.LONG_CLOSE_MS`. Class `on` makes it visible. It sits above the lids (z-index).
- **Vignette:** `opacity = active ? danger * 0.7 : 0`. Set the inline style only when the value changes by more than 0.01.
- **`flash()`:** remove and re-add the class `flash` on the vignette (force reflow with `void el.offsetWidth` between) so the keyframe restarts.

CSS (append to `styles.css`):

```css
/* ---------------- atmosphere overlays ---------------- */
.vignette {
  position: absolute; inset: 0; pointer-events: none; z-index: 3; opacity: 0;
  background: radial-gradient(ellipse at center, rgba(255, 0, 0, 0) 45%, rgba(255, 0, 0, 0.55) 100%);
}
.vignette.flash { animation: echo-flash 180ms ease-out; }
@keyframes echo-flash { from { opacity: 1; } }
.eyelids { position: absolute; inset: 0; pointer-events: none; z-index: 4; }
.eyelids .lid { position: absolute; left: 0; right: 0; height: 0; background: #000; transition: height 70ms ease-in; }
.eyelids .top { top: 0; }
.eyelids .bottom { bottom: 0; }
.eyelids.closed .lid { height: 50.5%; }
.eyes-label {
  position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 6; pointer-events: none;
  color: var(--red); font: 700 22px var(--mono); letter-spacing: 0.35em; opacity: 0; transition: opacity 120ms;
}
.eyes-label.on { opacity: 1; }
```

The HUD (z-index 5) stays visible above the lids. That's intended: the chip reads "EYES CLOSED · THEY MOVE".

App wiring:
- Field `private readonly overlays: Overlays`, constructed right after the `Hud`.
- In `updateOverlays()`: `this.overlays.update({ active: playing, eyesClosed: intent.eyesClosed, eyesClosedMs: intent.eyesClosedMs, danger: playing ? this.world.danger() : 0 })`.
- **"They moved" flash:**
  - Fields `private prevEyesClosed = false` and `private movedWhileClosed = false`.
  - In `route()`, on `monsterMoveStart`: if the monster is within `CONFIG.MOVED_FLASH_RADIUS` of the player, set `movedWhileClosed = true`. Monsters only move while the eyes are closed, so no extra check is needed.
  - In the `playing` case after `route`: `if (this.prevEyesClosed && !intent.eyesClosed && this.movedWhileClosed) { this.overlays.flash(); this.movedWhileClosed = false; }`, then `this.prevEyesClosed = intent.eyesClosed;`.

## 6. Attract mode (background pulses behind cards)

In `App.step()`, for the states `title`, `intro`, `gameover`, `escaped`, `victory` (**not** `calibrating`, `playing`, `paused`, `caught`):
- Keep a field `private nextAttractMs = 0`. When `nowMs >= nextAttractMs`, call `this.world.pulses.add(p.x, CONFIG.EYE_HEIGHT, p.z, clockS, 0.9)` and set `nextAttractMs = nowMs + CONFIG.ATTRACT_PULSE_MS`.
- Every frame in those states, call `this.world.pulses.prune(clockS)`. `World.update` isn't running there, so nothing else prunes. Note these pulses don't go through `World.update`, so monsters never hear them.
- In `title` only: `this.world.player.yaw += CONFIG.TITLE_SPIN_RATE * dtS` (a slow cinematic turn; `startLevel` creates a fresh World, so this doesn't leak into play).

## Verify

1. `npm run check` (69 + new tutorial tests) and `npm run build` pass.
2. Sim, at `?sim=1&level=0`:
   - The title card has the maze pulsing and slowly turning behind it.
   - Begin, then Space: the tutorial prompts advance in order as you press Space, Shift+Space, Space, ←, ↑, H; the last prompt is "Follow the chime…".
   - Hold B: black eyelids close from top and bottom, with "THEY MOVE" in red; after 0.9 s, "THEY ARE COMING".
3. Sim, at `?sim=1&level=1`, with the M2 console snippet adapted:
   - Teleport 6 m from the monster, clap: the red vignette grows (danger).
   - Hold B 0.5 s, release: one red flash.
   - The hint "Make noise to see…" shows for the first 6 s of play.
4. **HUMAN CHECK:** the user plays the tutorial hands-free again (M3 T8). Prompts advance naturally, and eyelids track real blinks with no visible lag.

## Acceptance

- [ ] Tutorial tests pass; all previous tests pass; build passes.
- [ ] Every sim check above behaves as described.
- [ ] User confirmed the hands-free tutorial run.
- [ ] Tick M4 in `plan/PROGRESS.md`.
