/** URL flags, parsed once at startup. See plan section "URL flags". */
export interface Flags {
  /** DEV ONLY: keyboard instead of camera/mic, no calibration. */
  sim: boolean;
  /** Show the pipeline/debug panel from the start. */
  debug: boolean;
  /** Level index to start at (0 = tutorial). Clamped by App. */
  level: number;
  /** Real sensors but skip calibration (use defaultCalibration()). */
  skipCal: boolean;
}

export function readFlags(search: string = window.location.search): Flags {
  const p = new URLSearchParams(search);
  const on = (key: string) => p.get(key) === '1' || p.get(key) === 'true';
  const level = Number.parseInt(p.get('level') ?? '0', 10);
  return {
    sim: on('sim'),
    debug: on('debug'),
    level: Number.isFinite(level) && level >= 0 ? level : 0,
    skipCal: on('skipcal'),
  };
}
