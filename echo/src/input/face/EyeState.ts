/**
 * Eyes open/closed with hysteresis, plus blink statistics.
 * Only call update() with frames where a face is present; face loss is handled by the caller
 * (it pauses the game instead of counting as closed eyes, so tracker glitches never kill the player).
 */
export class EyeState {
  closed = false;
  closedSinceMs = 0;
  blinkCount = 0;
  lastBlinkDurationMs = 0;

  constructor(
    private closeThreshold: number,
    private openThreshold: number,
  ) {}

  setThresholds(close: number, open: number): void {
    this.closeThreshold = close;
    this.openThreshold = open;
  }

  get thresholds(): { close: number; open: number } {
    return { close: this.closeThreshold, open: this.openThreshold };
  }

  /** @param score mean blink score 0..1 (1 = fully closed) */
  update(nowMs: number, score: number): void {
    if (!this.closed && score >= this.closeThreshold) {
      this.closed = true;
      this.closedSinceMs = nowMs;
    } else if (this.closed && score <= this.openThreshold) {
      this.closed = false;
      this.blinkCount++;
      this.lastBlinkDurationMs = nowMs - this.closedSinceMs;
    }
  }

  /** Force eyes open (e.g., when the game resumes after a pause). */
  reset(): void {
    this.closed = false;
  }

  closedForMs(nowMs: number): number {
    return this.closed ? nowMs - this.closedSinceMs : 0;
  }
}

/** Thresholds from calibration medians. Returns null if the open/closed difference is too small to trust. */
export function blinkThresholdsFromCalibration(
  openScore: number,
  closedScore: number,
  closeFraction: number,
  openFraction: number,
  minRange: number,
): { close: number; open: number } | null {
  const range = closedScore - openScore;
  if (range < minRange) return null;
  return { close: openScore + closeFraction * range, open: openScore + openFraction * range };
}
