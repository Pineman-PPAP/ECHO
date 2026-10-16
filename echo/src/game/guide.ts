import { CONFIG } from '../config';
import { cellCenter, findPath, worldToCell, type Cell, type Level } from './grid';

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

/** One floor arrow of the exit trail: a cell centre and the yaw it points along (same convention as player.yaw). */
export interface TrailMark {
  x: number;
  z: number;
  yaw: number;
}

/**
 * The gold floor arrows: the next `count` cells of the shortest route, each pointing toward the cell after it.
 * The exit cell itself is left out (it has its own gold pad). Audio alone can't tell front from back on
 * earbuds, so this visual trail is the reliable way out; the draft only draws attention to it. The
 * arrows show only where a pulse or the beam lights them, so finding the way costs noise.
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
