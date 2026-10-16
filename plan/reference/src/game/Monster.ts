import { CONFIG } from '../config';
import { cellCenter, findPath, floorCellsWithin, worldToCell, type Cell, type Level } from './grid';

export type MonsterState = 'idle' | 'alert' | 'search';

/**
 * A "Hollow". Pure game logic (no three.js). It only moves when World passes a speed > 0,
 * which World does only while the player's eyes are closed.
 *   idle   - wanders to random nearby cells (slow)
 *   alert  - heard a sound: walks the shortest path to where the sound came from (full speed)
 *   search - reached the sound: wanders 1-2 cells around it for SEARCH_DURATION_MS, then idle
 */
export class Monster {
  x: number;
  z: number;
  state: MonsterState = 'idle';
  /** True if the monster moved during the last update() (drives the scrape sound). */
  moving = false;
  /** Facing angle in radians = atan2(dx, dz) of the last movement (for drawing afterimages). */
  heading = 0;
  private path: Cell[] = [];
  private searchUntilMs = 0;

  constructor(
    readonly id: number,
    spawn: Cell,
  ) {
    const p = cellCenter(spawn);
    this.x = p.x;
    this.z = p.z;
  }

  get cell(): Cell {
    return worldToCell(this.x, this.z);
  }

  /** Remaining waypoints (read-only copy, for debug drawing and tests). */
  get waypoints(): Cell[] {
    return this.path.map((p) => ({ ...p }));
  }

  /** The monster heard a sound at world (x, z): head there. Unreachable sounds are ignored. */
  hear(level: Level, x: number, z: number): void {
    const path = findPath(level, this.cell, worldToCell(x, z));
    if (path === null) return;
    this.state = 'alert';
    this.path = path;
  }

  /**
   * @param baseSpeed metres/second allowed this frame. 0 => frozen (player's eyes are open).
   * @param rand seeded RNG from rng.ts
   */
  update(dtS: number, baseSpeed: number, level: Level, nowMs: number, rand: () => number): void {
    this.moving = false;
    if (baseSpeed <= 0 || dtS <= 0) return;

    if (this.path.length === 0) {
      if (this.state === 'alert') {
        this.state = 'search';
        this.searchUntilMs = nowMs + CONFIG.SEARCH_DURATION_MS;
      } else if (this.state === 'search' && nowMs >= this.searchUntilMs) {
        this.state = 'idle';
      }
      const maxSteps = this.state === 'search' ? 2 : 3;
      const options = floorCellsWithin(level, this.cell, 1, maxSteps);
      if (options.length === 0) return;
      const pick = options[Math.floor(rand() * options.length)];
      this.path = findPath(level, this.cell, pick) ?? [];
      if (this.path.length === 0) return;
    }

    const factor =
      this.state === 'alert'
        ? CONFIG.ALERT_SPEED_FACTOR
        : this.state === 'search'
          ? CONFIG.SEARCH_SPEED_FACTOR
          : CONFIG.IDLE_SPEED_FACTOR;
    let remaining = baseSpeed * factor * dtS;
    while (remaining > 1e-6 && this.path.length > 0) {
      const wp = cellCenter(this.path[0]);
      const dx = wp.x - this.x;
      const dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) this.heading = Math.atan2(dx, dz);
      if (d <= remaining) {
        this.x = wp.x;
        this.z = wp.z;
        remaining -= d;
        this.path.shift();
      } else {
        this.x += (dx / d) * remaining;
        this.z += (dz / d) * remaining;
        remaining = 0;
      }
      this.moving = true;
    }
  }
}
