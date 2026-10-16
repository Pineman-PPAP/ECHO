import { CONFIG } from '../config';
import { cellCenter, worldToCell, type Cell } from './grid';
import type { World } from './World';

/**
 * Authored pacing moments, placed per level in levels.ts. Each trigger fires once, when the player
 * first enters its trigger cell. Monsters are only ever placed out of the player's sight.
 */
export type MomentDef =
  /** Foreshadowing: a pair of red eyes at `at` watches the player, then vanishes. There is no creature. */
  | { kind: 'watcher'; trigger: Cell; at: Cell }
  /** The cave falls silent (no drone, no draft, no fake sounds) while the player is inside this rectangle. */
  | { kind: 'quiet'; from: Cell; to: Cell }
  /** Hollow number `monster` is waiting at `at`, facing the player, when the player reaches `trigger`. */
  | { kind: 'ambush'; trigger: Cell; monster: number; at: Cell; prompt: string }
  /** Hollow number `monster` appears at route[0] (out of sight) and walks the route past the player. */
  | { kind: 'walkPast'; trigger: Cell; monster: number; route: Cell[]; prompt: string }
  /** Everything wakes up and hunts the player until the level ends. */
  | { kind: 'finale'; trigger: Cell; prompt: string };

export type MomentKind = MomentDef['kind'];

export interface MomentEvent {
  kind: MomentKind;
  /** HUD line to show for MOMENT_PROMPT_MS, or null. */
  prompt: string | null;
}

/** The tutorial watcher's eyes. It keeps turning to face the player while it's there. */
export interface Watcher {
  x: number;
  z: number;
  heading: number;
  untilMs: number;
}

/** Runs a level's moments. Pure logic: it changes World state, World turns the results into events. */
export class Moments {
  /** True while the player stands in a 'quiet' region. */
  quiet = false;
  /** True after a 'finale' fired. */
  finale = false;
  watcher: Watcher | null = null;
  private readonly fired = new Set<number>();
  private nextRealertMs = 0;

  constructor(private readonly defs: readonly MomentDef[]) {}

  /** @param pulsed the player made a pulse this frame (it scares the watcher away) */
  update(world: World, nowMs: number, pulsed: boolean): MomentEvent[] {
    const out: MomentEvent[] = [];
    const p = world.player;
    const cell = worldToCell(p.x, p.z);
    this.quiet = this.defs.some((d) => d.kind === 'quiet' && inRect(cell, d.from, d.to));

    this.defs.forEach((d, i) => {
      if (d.kind === 'quiet' || this.fired.has(i)) return;
      if (cell.c !== d.trigger.c || cell.r !== d.trigger.r) return;
      this.fired.add(i);
      switch (d.kind) {
        case 'watcher': {
          const w = cellCenter(d.at);
          this.watcher = { x: w.x, z: w.z, heading: 0, untilMs: nowMs + CONFIG.WATCHER_SHOW_MS };
          out.push({ kind: d.kind, prompt: null });
          break;
        }
        case 'ambush': {
          const m = world.monsters[d.monster];
          if (!m) break;
          m.placeAt(d.at);
          m.faceToward(p.x, p.z);
          m.lurk(nowMs);
          out.push({ kind: d.kind, prompt: d.prompt });
          break;
        }
        case 'walkPast': {
          const m = world.monsters[d.monster];
          if (!m || d.route.length < 2) break;
          m.placeAt(d.route[0]);
          m.patrol(d.route.slice(1));
          out.push({ kind: d.kind, prompt: d.prompt });
          break;
        }
        case 'finale':
          this.finale = true;
          this.nextRealertMs = nowMs;
          out.push({ kind: d.kind, prompt: d.prompt });
          break;
      }
    });

    const w = this.watcher;
    if (w) {
      w.heading = Math.atan2(p.x - w.x, p.z - w.z);
      if (pulsed || nowMs >= w.untilMs || Math.hypot(p.x - w.x, p.z - w.z) < CONFIG.WATCHER_VANISH_M) this.watcher = null;
    }

    // Finale: every Hollow knows where you are, again and again.
    if (this.finale && world.monstersEnabled && nowMs >= this.nextRealertMs) {
      this.nextRealertMs = nowMs + CONFIG.FINALE_REALERT_MS;
      for (const m of world.monsters) m.hear(world.level, p.x, p.z);
    }
    return out;
  }
}

function inRect(cell: Cell, a: Cell, b: Cell): boolean {
  return (
    cell.c >= Math.min(a.c, b.c) && cell.c <= Math.max(a.c, b.c) && cell.r >= Math.min(a.r, b.r) && cell.r <= Math.max(a.r, b.r)
  );
}
