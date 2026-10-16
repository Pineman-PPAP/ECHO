import { CONFIG } from '../config';
import type { HumParams } from '../input/mapping';

/**
 * The jar of fireflies in the player's left hand: the hum's light. Pure logic (no three.js).
 * Humming wakes the fireflies and their glow eases up to the hum's level; when the hum stops they
 * gently fade back to darkness when the hum stops. Light comes from the jar, all around (not a cone).
 *   glow       0..1, how brightly they shine (sets the light's reach and strength)
 *   excitement 0..1, from the hum's pitch (render only: higher note = faster swirling and blinking)
 */
export class FireflyJar {
  glow = 0;
  excitement = 0;

  update(dtS: number, hum: HumParams | null): void {
    const target = hum ? CONFIG.JAR_MIN_HUM_GLOW + (1 - CONFIG.JAR_MIN_HUM_GLOW) * Math.pow(Math.min(Math.max(hum.level, 0), 1), CONFIG.JAR_HUM_CURVE) : 0;
    this.glow = ease(this.glow, target, dtS, target > this.glow ? CONFIG.JAR_WAKE_S : CONFIG.JAR_SLEEP_S);
    // Finish the fade below the visible-light threshold, rather than retaining an idle glow.
    if (!hum && this.glow < CONFIG.JAR_LIT_MIN) this.glow = 0;
    this.excitement = ease(this.excitement, hum ? hum.pitch01 : 0, dtS, CONFIG.JAR_WAKE_S);
  }

  /** True when the glow is bright enough to light the rock and reveal creatures. */
  get lit(): boolean {
    return this.glow >= CONFIG.JAR_LIT_MIN;
  }

  /** How far the light reaches (m); 0 when not lit. */
  get radius(): number {
    if (!this.lit) return 0;
    return CONFIG.JAR_MIN_RADIUS_M + (CONFIG.JAR_MAX_RADIUS_M - CONFIG.JAR_MIN_RADIUS_M) * this.glow;
  }
}

/** Exponential approach of `value` toward `target` with time constant `tauS`. */
function ease(value: number, target: number, dtS: number, tauS: number): number {
  return value + (target - value) * (1 - Math.exp(-Math.max(dtS, 0) / tauS));
}
