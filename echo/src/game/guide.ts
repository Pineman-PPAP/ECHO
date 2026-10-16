import { CONFIG } from '../config';
import { cellCenter, findPath, isWall, worldToCell, type Cell, type Level } from './grid';

/** Permanent paint, on an adjacent wall and pointing along it toward the exit. */
export interface WallGuideMark {
  cell: Cell;
  wx: number;
  wz: number;
  /** +1 right / -1 left in the wall's local frame. */
  direction: number;
  seed: number;
}

/** Bake once per level, including side passages. Paint never follows the player.
 * Only walls parallel to the next route step are valid, so paint cannot point into solid rock.
 */
export function wallGuideMarks(level: Level): WallGuideMark[] {
  const marks: WallGuideMark[] = [];
  for (let r = 0; r < level.rows; r++) {
    for (let c = 0; c < level.cols; c++) {
      if (isWall(level, c, r) || (c + r) % CONFIG.GUIDE_WALL_SPACING_CELLS !== 0) continue;
      const path = findPath(level, { c, r }, level.exit);
      if (!path || path.length === 0) continue;
      const dx = path[0].c - c, dz = path[0].r - r;
      const sides = [[-dz, dx], [dz, -dx]].filter(([wx, wz]) => isWall(level, c + wx, r + wz));
      if (sides.length === 0) continue;
      const seed = ((c * 73856093 ^ r * 19349663) >>> 0) / 4294967296;
      const [wx, wz] = sides[Math.floor(seed * sides.length)];
      marks.push({ cell: { c, r }, wx, wz, direction: dx * -wz + dz * wx, seed });
    }
  }
  return marks;
}

/**
 * Where the exit draft should blow from: a few cells ahead on the shortest route to the exit.
 * Its side (left / right / behind) then tells the player which way to turn, even in a
 * winding maze where the exit itself is on the other side of a wall.
 */
export function guidePoint(level: Level, x: number, z: number): { x: number; z: number } {
  const path = findPath(level, worldToCell(x, z), level.exit);
  if (!path || path.length === 0) return cellCenter(level.exit);
  return cellCenter(path[Math.min(CONFIG.DRAFT_LOOKAHEAD_CELLS, path.length) - 1]);
}

/** One route sample: a cell centre and its onward yaw (same convention as player.yaw). */
export interface TrailMark {
  x: number;
  z: number;
  yaw: number;
}

/**
 * Sample the next `count` route cells, each pointing toward the following cell. The exit cell is
 * left out (it has its own pad). This route utility is independent of permanent wall-paint placement.
 */
export function guideTrail(level: Level, x: number, z: number, count: number): TrailMark[] {
  const from = worldToCell(x, z);
  const path = findPath(level, from, level.exit);
  if (!path) return [];
  const marks: TrailMark[] = [];
  const n = Math.min(count, path.length - 1); // path's last cell is the exit
  for (let i = 0; i < n; i++) {
    const p = cellCenter(path[i]);
    marks.push({ x: p.x, z: p.z, yaw: stepYaw(path[i], path[i + 1]) });
  }
  return marks;
}

/** Yaw that faces from cell a to the neighbouring cell b (forward = (-sin yaw, -cos yaw)). */
function stepYaw(a: Cell, b: Cell): number {
  return Math.atan2(-(b.c - a.c), -(b.r - a.r));
}
