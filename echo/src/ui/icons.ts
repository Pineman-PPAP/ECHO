import type { CalibStepId } from '../input/calibration';

/** Thin line pictograms (64×64, drawn in currentColor) for the calibration card. */
const wrap = (paths: string) =>
  `<svg viewBox="0 0 64 64" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;

export const CALIB_ICONS: Record<CalibStepId, string> = {
  face: wrap(
    '<path d="M8 20v-8a4 4 0 0 1 4-4h8M44 8h8a4 4 0 0 1 4 4v8M56 44v8a4 4 0 0 1-4 4h-8M20 56h-8a4 4 0 0 1-4-4v-8"/>' +
      '<ellipse cx="32" cy="32" rx="12" ry="15"/><circle cx="27" cy="30" r="1.4" fill="currentColor"/><circle cx="37" cy="30" r="1.4" fill="currentColor"/>',
  ),
  quiet: wrap('<rect x="26" y="8" width="12" height="26" rx="6"/><path d="M18 28a14 14 0 0 0 28 0M32 42v12M24 54h16"/>'),
  neutral: wrap('<circle cx="32" cy="24" r="12"/><path d="M12 58c2-11 10-16 20-16s18 5 20 16M32 4v4"/>'),
  left: wrap('<circle cx="32" cy="40" r="12"/><path d="M32 28v-3"/><path d="M48 22A22 22 0 0 0 16 22"/><path d="M15 13l1 9 9-1"/>'),
  clap: wrap(
    '<circle cx="32" cy="32" r="3" fill="currentColor"/><circle cx="32" cy="32" r="11"/>' +
      '<circle cx="32" cy="32" r="19" opacity=".55"/><circle cx="32" cy="32" r="27" opacity=".25"/>',
  ),
  hum: wrap('<path d="M18 42V14c6 2 10 5 10 11"/><ellipse cx="13" cy="43" rx="5" ry="4"/><path d="M34 32l24-12M34 32l24 12M34 32h24" opacity=".6"/>'),
  speakers: wrap('<path d="M14 42v-10a18 18 0 0 1 36 0v10"/><rect x="9" y="38" width="9" height="16" rx="3"/><rect x="46" y="38" width="9" height="16" rx="3"/>'),
  done: wrap('<circle cx="32" cy="32" r="22"/><path d="M22 33l7 7 14-15"/>'),
};
