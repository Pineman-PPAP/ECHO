import { CONFIG } from '../config';
import { cellCenter, findPath, floorCellsWithin, worldToCell, type Cell, type Level } from './grid';

export type MonsterState = 'idle' | 'alert' | 'search' | 'patrol';

/**
 * A "Hollow". Pure game logic (no three.js). It is blind and finds the player only by sound; World
 * passes its speed each frame (a run while hunting, a creep otherwise).
 *   idle   - wanders to random nearby cells (slow)
 *   alert  - heard a sound: turns toward it and walks the shortest path there (full speed)
 *   search - reached the sound: wanders 1-2 cells around it for SEARCH_DURATION_MS, then idle
 *   patrol - follows a scripted route (authored moments), then idle; a heard sound overrides it
 */
export class Monster {
  x: number;
  z: number;
  state: MonsterState = 'idle';
  /** True if the monster moved during the last update() (drives the scrape sound). */
  moving = false;
  /** Metres per second actually moved during the last update(). */
  speed = 0;
  /** Facing angle in radians = atan2(dx, dz) of the last movement (for drawing afterimages). */
  heading = 0;
  /**
   * The exact spot it is heading for when alert (the last sound or sighting), else null. Its route
   * goes cell by cell to that spot's cell, then straight to the spot (a cell is 3 m wide: stopping
   * at the cell's centre could leave it out of reach of a player standing near the cell's edge).
   */
  goal: { x: number; z: number } | null = null;
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

  /**
   * The monster heard a sound at world (x, z): it turns toward its route at once (turning isn't
   * moving, so its eyes swing round toward the sound at once) and heads there. Unreachable
   * sounds are ignored.
   */
  hear(level: Level, x: number, z: number): void {
    const path = findPath(level, this.cell, worldToCell(x, z));
    if (path === null) return;
    this.state = 'alert';
    this.path = path;
    this.goal = { x, z };
    const next = path.length > 0 ? cellCenter(path[0]) : { x, z };
    this.faceToward(next.x, next.z);
  }

  /** Turn (without moving) to face world point (x, z). */
  faceToward(x: number, z: number): void {
    const dx = x - this.x;
    const dz = z - this.z;
    if (Math.hypot(dx, dz) > 1e-6) this.heading = Math.atan2(dx, dz);
  }

  /** Authored moments: put the monster on a cell (out of the player's sight) with no route. */
  placeAt(cell: Cell): void {
    const p = cellCenter(cell);
    this.x = p.x;
    this.z = p.z;
    this.path = [];
    this.state = 'idle';
    this.goal = null;
  }

  /** Linger around the current cell (search state) for SEARCH_DURATION_MS. */
  lurk(nowMs: number): void {
    this.path = [];
    this.goal = null;
    this.state = 'search';
    this.searchUntilMs = nowMs + CONFIG.SEARCH_DURATION_MS;
  }

  /** Follow `route` (cells after the current one), then go idle. Sounds still override it. */
  patrol(route: Cell[]): void {
    this.path = route.map((c) => ({ ...c }));
    this.state = 'patrol';
    this.goal = null;
    if (this.path.length > 0) {
      const next = cellCenter(this.path[0]);
      this.faceToward(next.x, next.z);
    }
  }

  /**
   * @param baseSpeed metres/second allowed this frame (0 => it doesn't move).
   * @param rand seeded RNG from rng.ts
   */
  update(dtS: number, baseSpeed: number, level: Level, nowMs: number, rand: () => number): void {
    this.moving = false;
    this.speed = 0;
    if (baseSpeed <= 0 || dtS <= 0) return;

    if (this.path.length === 0 && !(this.state === 'alert' && this.goal)) {
      if (this.state === 'patrol') this.state = 'idle';
      if (this.state === 'alert') {
        this.state = 'search';
        this.goal = null;
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
          : this.state === 'patrol'
            ? CONFIG.PATROL_SPEED_FACTOR
            : CONFIG.IDLE_SPEED_FACTOR;
    const budget = baseSpeed * factor * dtS;
    let remaining = budget;
    while (remaining > 1e-6) {
      const toGoal = this.path.length === 0;
      const wp = !toGoal ? cellCenter(this.path[0]) : this.state === 'alert' ? this.goal : null;
      if (!wp) break;
      const dx = wp.x - this.x;
      const dz = wp.z - this.z;
      const d = Math.hypot(dx, dz);
      if (d > 1e-6) this.heading = Math.atan2(dx, dz);
      if (d <= remaining) {
        this.x = wp.x;
        this.z = wp.z;
        remaining -= d;
        if (toGoal) this.goal = null;
        else this.path.shift();
      } else {
        this.x += (dx / d) * remaining;
        this.z += (dz / d) * remaining;
        remaining = 0;
      }
      this.moving = true;
    }
    this.speed = (budget - remaining) / dtS;
  }
}
